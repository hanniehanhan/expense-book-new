import express from 'express';
import helmet from 'helmet';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { categories, expenseInput, validDate, validMonth } from './validation.js';

const digest = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createApp({ store, password, secure = false } = {}) {
  const app = express();
  const cookieName = secure ? '__Host-moa_session' : 'moa_session';
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/' };
  const sign = payload => createHmac('sha256', password).update(payload).digest('base64url');
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'upgrade-insecure-requests': secure ? [] : null } }, strictTransportSecurity: secure ? undefined : false }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      // JSON-only API + custom header prevent cross-origin form submissions.
      if (!req.is('application/json') || req.get('X-Moa-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site') {
        return res.status(403).json({ error: '허용되지 않은 요청입니다.' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.get('/api/health', (req, res) => res.json({ configured: Boolean(store && password?.length >= 12) }));
  app.use('/api', (req, res, next) => {
    if (!store || !password || password.length < 12) return res.status(503).json({ error: '서버 설정이 필요합니다. DATABASE_URL과 12자 이상의 APP_PASSWORD를 설정해 주세요.' });
    next();
  });
  app.post('/api/login', async (req, res) => {
    // On Vercel this header is replaced by its trusted proxy; locally use the socket IP.
    const ip = secure ? (req.get('x-vercel-forwarded-for') || req.socket.remoteAddress) : req.socket.remoteAddress;
    const key = createHmac('sha256', password).update(ip || 'unknown').digest('hex');
    if (!await store.allowLogin(key)) return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.' });
    if (typeof req.body?.password !== 'string' || !equal(req.body.password, password)) return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
    res.cookie(cookieName, `${payload}.${sign(payload)}`, { ...cookieOptions, maxAge: 12 * 60 * 60 * 1000 });
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => {
    try {
      const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const [payload, signature, extra] = (cookie || '').split('.');
      if (!payload || !signature || extra || !equal(signature, sign(payload))) throw new Error();
      const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (!Number.isFinite(exp) || exp <= Date.now()) throw new Error();
      next();
    } catch { res.status(401).json({ error: '로그인이 필요합니다.' }); }
  });
  app.get('/api/session', (req, res) => res.json({ authenticated: true, categories }));
  app.get('/api/expenses', async (req, res) => {
    const { month, date } = req.query;
    if (!validMonth(month) || (date !== undefined && (!validDate(date) || !date.startsWith(month)))) return res.status(400).json({ error: '조회 월과 날짜를 확인해 주세요.' });
    res.json({ expenses: await store.list(month, date) });
  });
  app.get('/api/summary', async (req, res) => {
    if (!validMonth(req.query.month)) return res.status(400).json({ error: '올바른 월을 선택해 주세요.' });
    res.json(await store.summary(req.query.month));
  });
  const validate = (req, res, next) => {
    try { req.expense = expenseInput(req.body); next(); }
    catch (error) { res.status(400).json({ error: error.message }); }
  };
  app.post('/api/expenses', validate, async (req, res) => res.status(201).json(await store.create(req.expense)));
  app.param('id', (req, res, next, id) => {
    if (!idPattern.test(id)) return res.status(400).json({ error: '올바르지 않은 내역 ID입니다.' });
    next();
  });
  app.put('/api/expenses/:id', validate, async (req, res) => {
    const row = await store.update(req.params.id, req.expense);
    if (!row) return res.status(404).json({ error: '내역을 찾을 수 없습니다. 목록을 새로고침해 주세요.' });
    res.json(row);
  });
  app.delete('/api/expenses/:id', async (req, res) => {
    if (!await store.remove(req.params.id)) return res.status(404).json({ error: '내역을 찾을 수 없습니다.' });
    res.status(204).end();
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { dotfiles: 'deny' }));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '요청이 너무 큽니다.' });
    // Never log database errors: providers may include connection details.
    res.status(503).json({ error: '데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' });
  });
  return app;
}

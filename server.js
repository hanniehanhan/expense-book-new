import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createApp } from './lib/app.js';
import { createStore } from './lib/store.js';

let store;
try { if (process.env.DATABASE_URL) store = createStore(process.env.DATABASE_URL); }
catch { console.error('DATABASE_URL 형식을 확인해 주세요.'); }
const app = createApp({ store, password: process.env.APP_PASSWORD, secure: process.env.VERCEL === '1' || process.env.NODE_ENV === 'production' });
export default app;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(Number(process.env.PORT) || 3000, '0.0.0.0', (error) => {
    if (error) {
      console.error(`서버 실행 실패 (${error.code || 'UNKNOWN'}). 포트와 실행 권한을 확인해 주세요.`);
      process.exitCode = 1;
      return;
    }
    console.log(`모아 가계부: http://localhost:${Number(process.env.PORT) || 3000}`);
    if (!store || !process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 12) console.log('.env에 DATABASE_URL 및 12자 이상의 APP_PASSWORD를 설정해 주세요.');
  });
}

import { neon } from '@neondatabase/serverless';

export function createStore(url) {
  const sql = neon(url);
  let ready;
  async function init() {
    if (!ready) ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        title VARCHAR(100) NOT NULL,
        category VARCHAR(30) NOT NULL,
        amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 999999999),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date)`;
      await sql`CREATE TABLE IF NOT EXISTS login_limits (
        key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL
      )`;
    })().catch(error => { ready = undefined; throw error; });
    await ready;
  }
  const columns = rows => rows.map(row => ({ ...row, amount: Number(row.amount) }));
  return {
    async allowLogin(key) {
      await init();
      await sql`DELETE FROM login_limits WHERE expires_at < now()`;
      const [row] = await sql`INSERT INTO login_limits (key, attempts, expires_at)
        VALUES (${key}, 1, now() + interval '15 minutes')
        ON CONFLICT (key) DO UPDATE SET attempts = login_limits.attempts + 1
        RETURNING attempts`;
      return row.attempts <= 10;
    },
    async list(month, date) {
      await init();
      return columns(await sql`SELECT id, to_char(date, 'YYYY-MM-DD') AS date, title, category, amount
        FROM expenses WHERE date >= ${`${month}-01`}::date
        AND date < (${`${month}-01`}::date + interval '1 month')
        AND (${date || null}::date IS NULL OR date = ${date || null}::date)
        ORDER BY date DESC, created_at DESC`);
    },
    async summary(month) {
      await init();
      const rows = await sql`SELECT category, SUM(amount)::text AS total, COUNT(*)::integer AS count
        FROM expenses WHERE date >= ${`${month}-01`}::date
        AND date < (${`${month}-01`}::date + interval '1 month') GROUP BY category ORDER BY SUM(amount) DESC`;
      const categories = rows.map(row => ({ ...row, total: Number(row.total) }));
      return { total: categories.reduce((n, row) => n + row.total, 0), count: categories.reduce((n, row) => n + row.count, 0), categories };
    },
    async create(data) {
      await init();
      const { date, title, category, amount } = data;
      return columns(await sql`INSERT INTO expenses (date, title, category, amount) VALUES (${date}, ${title}, ${category}, ${amount})
        RETURNING id, to_char(date, 'YYYY-MM-DD') AS date, title, category, amount`)[0];
    },
    async update(id, data) {
      await init();
      const { date, title, category, amount } = data;
      return columns(await sql`UPDATE expenses SET date=${date}, title=${title}, category=${category}, amount=${amount}
        WHERE id=${id}::uuid RETURNING id, to_char(date, 'YYYY-MM-DD') AS date, title, category, amount`)[0];
    },
    async remove(id) {
      await init();
      return (await sql`DELETE FROM expenses WHERE id=${id}::uuid RETURNING id`).length > 0;
    }
  };
}

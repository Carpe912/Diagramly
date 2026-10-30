import { Pool } from 'pg';
import { createServer } from './app';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`CREATE TABLE IF NOT EXISTS documents (
 id text PRIMARY KEY, title text NOT NULL, revision integer NOT NULL,
 document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
)`);
const app = createServer(
  {
    async list() {
      return (
        await pool.query(
          'SELECT id,title,revision,updated_at FROM documents ORDER BY updated_at DESC',
        )
      ).rows;
    },
    async get(id) {
      return (
        (await pool.query('SELECT revision,document FROM documents WHERE id=$1', [id])).rows[0] ??
        null
      );
    },
    async save(id, document, expected) {
      // 原子版本比较，避免多个标签页静默覆盖同一文档。
      const values = [id, (document as { title: string }).title, document];
      if (expected === 0)
        return (
          (
            await pool.query(
              'INSERT INTO documents(id,title,revision,document) VALUES($1,$2,1,$3) ON CONFLICT(id) DO NOTHING RETURNING revision',
              values,
            )
          ).rows[0]?.revision ?? null
        );
      return (
        (
          await pool.query(
            'UPDATE documents SET title=$2,document=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$4 RETURNING revision',
            [...values, expected],
          )
        ).rows[0]?.revision ?? null
      );
    },
  },
  process.env.DIAGRAMLY_CREDENTIALS ?? '',
);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
const shutdown = async () => {
  await app.close();
  await pool.end();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

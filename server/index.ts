import { Pool } from 'pg';
import { createServer } from './app';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`CREATE TABLE IF NOT EXISTS documents (
 id text PRIMARY KEY, title text NOT NULL, revision integer NOT NULL,
 document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
)`);
await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz');
const app = createServer(
  {
    async list(trash = false) {
      return (
        await pool.query(
          `SELECT id,title,revision,updated_at FROM documents WHERE deleted_at IS ${trash ? 'NOT NULL' : 'NULL'} ORDER BY updated_at DESC`,
        )
      ).rows;
    },
    async get(id) {
      return (
        (
          await pool.query(
            'SELECT revision,document FROM documents WHERE id=$1 AND deleted_at IS NULL',
            [id],
          )
        ).rows[0] ?? null
      );
    },
    async setDeleted(id, expected, restore) {
      return (
        (
          await pool.query(
            `UPDATE documents SET deleted_at=${restore ? 'NULL' : 'now()'},revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND deleted_at IS ${restore ? 'NOT NULL' : 'NULL'} RETURNING revision`,
            [id, expected],
          )
        ).rows[0]?.revision ?? null
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
            'UPDATE documents SET title=$2,document=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$4 AND deleted_at IS NULL RETURNING revision',
            [...values, expected],
          )
        ).rows[0]?.revision ?? null
      );
    },
  },
  process.env.DIAGRAMLY_CREDENTIALS ?? '',
);
await app.listen({ host: process.env.HOST || '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
const shutdown = async () => {
  await app.close();
  await pool.end();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

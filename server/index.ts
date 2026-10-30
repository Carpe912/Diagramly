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
      const result = await pool.query(
        `INSERT INTO documents(id,title,revision,document)
      SELECT $1,$2,1,$3 WHERE $4=0
      ON CONFLICT(id) DO UPDATE SET title=$2,document=$3,revision=documents.revision+1,updated_at=now()
      WHERE documents.revision=$4 RETURNING revision`,
        [id, (document as { title: string }).title, document, expected],
      );
      // 已存在文档的更新不走 INSERT 条件。
      if (result.rows[0]) return result.rows[0].revision;
      if (expected > 0)
        return (
          (
            await pool.query(
              'UPDATE documents SET title=$2,document=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$4 RETURNING revision',
              [id, (document as { title: string }).title, document, expected],
            )
          ).rows[0]?.revision ?? null
        );
      return null;
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

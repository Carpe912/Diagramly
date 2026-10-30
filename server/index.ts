import { accounts } from './accounts';
import { Pool } from 'pg';
import { registerPlatform } from './platform';
import { createServer } from './app';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`CREATE TABLE IF NOT EXISTS documents (
 id text PRIMARY KEY, title text NOT NULL, revision integer NOT NULL,
 document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
)`);
await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz');
await pool.query(`CREATE TABLE IF NOT EXISTS document_versions (
 document_id text NOT NULL REFERENCES documents(id), revision integer NOT NULL,
 document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_id,revision)
)`);
await pool.query(`INSERT INTO document_versions(document_id,revision,document)
 SELECT id,revision,document FROM documents ON CONFLICT DO NOTHING`);
await pool.query(
  "ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT ''",
);
const accountService = await accounts(pool, process.env.DIAGRAMLY_CREDENTIALS ?? '');
const app = createServer(
  {
    authenticate: accountService.authenticate,
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
    async nameVersion(id, revision, label) {
      return !!(
        await pool.query(
          'UPDATE document_versions SET label=$3 WHERE document_id=$1 AND revision=$2 RETURNING revision',
          [id, revision, label],
        )
      ).rowCount;
    },
    async versions(id) {
      return (
        await pool.query(
          "SELECT revision,label,created_at,document->>'title' AS title FROM document_versions WHERE document_id=$1 ORDER BY revision DESC",
          [id],
        )
      ).rows;
    },
    async version(id, revision) {
      return (
        (
          await pool.query(
            'SELECT document FROM document_versions WHERE document_id=$1 AND revision=$2',
            [id, revision],
          )
        ).rows[0] ?? null
      );
    },
    async save(id, document, expected) {
      // 文档和历史快照同一事务提交，冲突时不产生虚假版本。
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const values = [id, (document as { title: string }).title, document];
        const result =
          expected === 0
            ? await client.query(
                'INSERT INTO documents(id,title,revision,document) VALUES($1,$2,1,$3) ON CONFLICT(id) DO NOTHING RETURNING revision',
                values,
              )
            : await client.query(
                'UPDATE documents SET title=$2,document=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$4 AND deleted_at IS NULL RETURNING revision',
                [...values, expected],
              );
        const revision = result.rows[0]?.revision;
        if (revision)
          await client.query(
            'INSERT INTO document_versions(document_id,revision,document) VALUES($1,$2,$3)',
            [id, revision, document],
          );
        await client.query('COMMIT');
        return revision ?? null;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  },
  process.env.DIAGRAMLY_CREDENTIALS ?? '',
);
accountService.register(app);
await registerPlatform(app, pool);
await app.listen({ host: process.env.HOST || '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
const shutdown = async () => {
  await app.close();
  await pool.end();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

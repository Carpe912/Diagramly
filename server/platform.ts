import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const kinds = z.enum([
  'roles',
  'applications',
  'devices',
  'operations',
  'terminals',
  'interfaces',
  'objects',
  'tables',
  'statements',
  'requirements',
  'todos',
]);
const record = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().max(10000).default(''),
    data: z
      .object({
        tableIds: z.array(z.string().uuid()).max(100).optional(),
        fields: z
          .array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(160) }).strict())
          .max(200)
          .optional(),
      })
      .strict()
      .default({}),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export async function registerPlatform(app: FastifyInstance, pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS business_records(id text PRIMARY KEY,kind text NOT NULL,name text NOT NULL,description text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1,deleted_at timestamptz)`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS attachments(id text PRIMARY KEY,name text NOT NULL,mime text NOT NULL,data bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz)`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS discussions(id text PRIMARY KEY,document_id text NOT NULL REFERENCES documents(id),anchor text,body text NOT NULL,replies jsonb NOT NULL DEFAULT '[]',status text NOT NULL DEFAULT 'open',revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now())`,
  );
  await pool.query(
    "ALTER TABLE business_records ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'",
  );
  await pool.query(
    "ALTER TABLE discussions ADD COLUMN IF NOT EXISTS author text NOT NULL DEFAULT ''",
  );
  app.get('/api/business/:kind', async (request) => {
    const kind = kinds.parse((request.params as { kind: string }).kind);
    return (
      await pool.query(
        'SELECT id,name,description,data,revision FROM business_records WHERE kind=$1 AND deleted_at IS NULL ORDER BY name',
        [kind],
      )
    ).rows;
  });
  app.put('/api/business/:kind/:id', async (request, reply) => {
    const { kind, id } = z.object({ kind: kinds, id: z.string().uuid() }).parse(request.params);
    const body = record.parse(request.body);
    const result =
      body.expectedRevision === 0
        ? await pool.query(
            'INSERT INTO business_records(id,kind,name,description,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING revision',
            [id, kind, body.name, body.description, body.data],
          )
        : await pool.query(
            'UPDATE business_records SET name=$3,description=$4,data=$5,revision=revision+1 WHERE id=$1 AND kind=$2 AND revision=$6 AND deleted_at IS NULL RETURNING revision',
            [id, kind, body.name, body.description, body.data, body.expectedRevision],
          );
    return result.rows[0] ?? reply.code(409).send({ message: '业务记录已变化，请重新读取' });
  });
  app.delete('/api/business/:kind/:id', async (request, reply) => {
    const { kind, id } = z.object({ kind: kinds, id: z.string().uuid() }).parse(request.params);
    const { expectedRevision } = z
      .object({ expectedRevision: z.coerce.number().int().positive() })
      .parse(request.query);
    if (
      (
        await pool.query(
          `SELECT 1 FROM documents WHERE document::text LIKE $1
           UNION ALL SELECT 1 FROM document_versions WHERE document::text LIKE $1
           UNION ALL SELECT 1 FROM business_records WHERE deleted_at IS NULL AND data::text LIKE $1 LIMIT 1`,
          [`%${id}%`],
        )
      ).rowCount
    )
      return reply.code(409).send({ message: '记录仍被文档、历史版本或业务数据引用，暂不能删除' });
    const result = await pool.query(
      'UPDATE business_records SET deleted_at=now(),revision=revision+1 WHERE id=$1 AND kind=$2 AND revision=$3 AND deleted_at IS NULL RETURNING id',
      [id, kind, expectedRevision],
    );
    return result.rowCount ? { ok: true } : reply.code(409).send({ message: '记录已变化，请刷新' });
  });
  app.get(
    '/api/attachments',
    async () =>
      (
        await pool.query(
          'SELECT id,name,mime,octet_length(data) AS size,created_at FROM attachments WHERE deleted_at IS NULL ORDER BY created_at DESC',
        )
      ).rows,
  );
  app.post('/api/attachments', async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(255),
        mime: z.string().max(160),
        data: z
          .string()
          .max(8 * 1024 * 1024)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .strict()
      .parse(request.body);
    const data = Buffer.from(body.data, 'base64');
    if (!data.length || data.length > 6 * 1024 * 1024)
      return reply.code(400).send({ message: '附件须为非空文件且不超过6MB' });
    const id = randomUUID();
    await pool.query('INSERT INTO attachments(id,name,mime,data) VALUES($1,$2,$3,$4)', [
      id,
      body.name,
      body.mime,
      data,
    ]);
    return { id };
  });
  app.get('/api/attachments/:id', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const row = (
      await pool.query('SELECT name,data FROM attachments WHERE id=$1 AND deleted_at IS NULL', [id])
    ).rows[0];
    if (!row) return reply.code(404).send({ message: '附件不存在' });
    return reply
      .type('application/octet-stream')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`)
      .send(row.data);
  });
  app.delete('/api/attachments/:id', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    // 关联仍在使用时禁止删除，避免文档中的附件引用失效。
    if (
      (
        await pool.query(
          `SELECT 1 FROM documents WHERE document::text LIKE $1
           UNION ALL SELECT 1 FROM document_versions WHERE document::text LIKE $1
           UNION ALL SELECT 1 FROM business_records WHERE deleted_at IS NULL AND data::text LIKE $1 LIMIT 1`,
          [`%${id}%`],
        )
      ).rowCount
    )
      return reply.code(409).send({ message: '附件仍被文档或历史版本引用，暂不能删除' });
    await pool.query('UPDATE attachments SET deleted_at=now() WHERE id=$1', [id]);
    return { ok: true };
  });
  app.get(
    '/api/documents/:id/discussions',
    async (request) =>
      (
        await pool.query(
          'SELECT id,anchor,body,replies,status,revision,created_at,author FROM discussions WHERE document_id=$1 ORDER BY created_at',
          [(request.params as { id: string }).id],
        )
      ).rows,
  );
  app.post('/api/documents/:id/discussions', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const body = z
      .object({ anchor: z.string().max(100).nullable(), body: z.string().trim().min(1).max(10000) })
      .strict()
      .parse(request.body);
    const document = (
      await pool.query('SELECT document FROM documents WHERE id=$1 AND deleted_at IS NULL', [id])
    ).rows[0]?.document;
    if (!document) return reply.code(404).send({ message: '文档不存在' });
    if (body.anchor && !document.nodes[body.anchor] && !document.edges[body.anchor])
      return reply.code(400).send({ message: '锚点不存在，请重新选择图形' });
    const commentId = randomUUID();
    await pool.query(
      'INSERT INTO discussions(id,document_id,anchor,body,author) VALUES($1,$2,$3,$4,$5)',
      [commentId, id, body.anchor, body.body, request.identity!.username],
    );
    return { id: commentId };
  });
  app.patch('/api/discussions/:id', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const body = z
      .object({
        expectedRevision: z.number().int().positive(),
        reply: z.string().trim().min(1).max(10000).optional(),
        status: z.enum(['open', 'resolved']).optional(),
      })
      .strict()
      .refine((value) => !!value.reply || !!value.status)
      .parse(request.body);
    const replies = body.reply
      ? [
          {
            body: body.reply,
            author: request.identity?.username,
            created_at: new Date().toISOString(),
          },
        ]
      : [];
    const result = await pool.query(
      'UPDATE discussions SET replies=replies || $2::jsonb,status=COALESCE($3,status),revision=revision+1 WHERE id=$1 AND revision=$4 RETURNING revision',
      [id, JSON.stringify(replies), body.status ?? null, body.expectedRevision],
    );
    return result.rows[0] ?? reply.code(409).send({ message: '讨论已更新，请重新读取' });
  });
}

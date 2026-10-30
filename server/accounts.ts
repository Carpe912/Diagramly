import { randomUUID, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))),
  );
async function hash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt)).toString('hex');
}
export async function accounts(pool: Pool, credentials: string) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS accounts(id text PRIMARY KEY,username text UNIQUE NOT NULL,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('admin','editor','viewer')),active boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1)`,
  );
  const split = credentials.indexOf(':');
  if (split < 1) throw new Error('初始账号配置无效');
  const username = credentials.slice(0, split);
  if (!(await pool.query('SELECT 1 FROM accounts LIMIT 1')).rowCount)
    await pool.query(
      'INSERT INTO accounts(id,username,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [randomUUID(), username, await hash(credentials.slice(split + 1)), 'admin'],
    );
  return {
    async authenticate(header: string) {
      if (!header.startsWith('Basic ')) return null;
      const value = Buffer.from(header.slice(6), 'base64').toString('utf8'),
        index = value.indexOf(':');
      if (index < 1) return null;
      const row = (
        await pool.query(
          'SELECT id,username,password_hash,role FROM accounts WHERE username=$1 AND active',
          [value.slice(0, index)],
        )
      ).rows[0];
      if (!row) return null;
      const [salt, digest] = row.password_hash.split(':');
      const expected = Buffer.from(digest, 'hex'),
        actual = await derive(value.slice(index + 1), salt);
      return expected.length === actual.length && timingSafeEqual(expected, actual)
        ? { id: row.id, username: row.username, role: row.role }
        : null;
    },
    register(app: FastifyInstance) {
      app.get('/api/session', async (request) => request.identity);
      app.get(
        '/api/users',
        async () =>
          (
            await pool.query(
              'SELECT id,username,role,active,revision FROM accounts ORDER BY username',
            )
          ).rows,
      );
      app.post('/api/users', async (request) => {
        const body = z
          .object({
            username: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
            password: z.string().min(12).max(200),
            role: z.enum(['admin', 'editor', 'viewer']),
          })
          .strict()
          .parse(request.body);
        const id = randomUUID();
        await pool.query(
          'INSERT INTO accounts(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
          [id, body.username, await hash(body.password), body.role],
        );
        return { id };
      });
      app.post('/api/password', async (request) => {
        const { password } = z
          .object({ password: z.string().min(12).max(200) })
          .strict()
          .parse(request.body);
        await pool.query('UPDATE accounts SET password_hash=$2,revision=revision+1 WHERE id=$1', [
          request.identity!.id,
          await hash(password),
        ]);
        return { ok: true };
      });
      app.patch('/api/users/:id', async (request, reply) => {
        const id = z
          .string()
          .uuid()
          .parse((request.params as { id: string }).id);
        const body = z
          .object({
            expectedRevision: z.number().int().positive(),
            role: z.enum(['admin', 'editor', 'viewer']),
            active: z.boolean(),
          })
          .strict()
          .parse(request.body);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            "SELECT id FROM accounts WHERE role='admin' AND active ORDER BY id FOR UPDATE",
          );
          const result = await client.query(
            'UPDATE accounts SET role=$2,active=$3,revision=revision+1 WHERE id=$1 AND revision=$4 RETURNING id',
            [id, body.role, body.active, body.expectedRevision],
          );
          if (
            !result.rowCount ||
            !(await client.query("SELECT 1 FROM accounts WHERE role='admin' AND active")).rowCount
          ) {
            await client.query('ROLLBACK');
            return reply.code(409).send({ message: '账号已变化或不能停用最后一个管理员' });
          }
          await client.query('COMMIT');
          return { ok: true };
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      });
    },
  };
}

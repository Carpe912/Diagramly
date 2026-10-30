import { documentSchema, type DiagramDocument } from '../../domain/model';
import { z } from 'zod';
let authorization = '';
let serverRole = 'viewer';
export const getServerRole = () => serverRole;
export async function identifyServerSession() {
  const session = z
    .object({ username: z.string(), role: z.enum(['admin', 'editor', 'viewer']) })
    .parse(await request('/session'));
  serverRole = session.role;
  return session;
}

export function login(username: string, password: string) {
  authorization = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}`;
}
export const hasServerSession = () => !!authorization;
export async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE || '/api'}${path}`, {
    ...options,
    headers: {
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      Authorization: authorization,
      ...options.headers,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const message = await response.json().catch(() => ({}));
    throw new Error(message.message ?? `服务请求失败（${response.status}）`);
  }
  return response.json();
}
export const listDocuments = async (trash = false) =>
  z
    .array(z.object({ id: z.string(), title: z.string(), revision: z.number() }))
    .parse(await request(trash ? '/documents?trash=true' : '/documents'));
export const getDocument = async (id: string) =>
  z
    .object({ document: documentSchema, revision: z.number().int().positive() })
    .parse(await request(`/documents/${encodeURIComponent(id)}`));
/** 每个文档串行提交，版本冲突或响应不确定时停止写入，避免覆盖与重复重试。 */
export class DocumentSync {
  private queue: Promise<void> = Promise.resolve();
  private failure?: Error;
  private last: string;
  constructor(
    private revision: number,
    document: DiagramDocument,
  ) {
    this.last = JSON.stringify(document);
  }
  save(document: DiagramDocument) {
    const snapshot = structuredClone(document);
    const next = this.queue.then(async () => {
      if (this.failure) throw this.failure;
      const serialized = JSON.stringify(snapshot);
      if (serialized === this.last) return;
      try {
        const result = z.object({ revision: z.number().int().positive() }).parse(
          await request(`/documents/${encodeURIComponent(snapshot.id)}`, {
            method: 'PUT',
            body: JSON.stringify({ document: snapshot, expectedRevision: this.revision }),
          }),
        );
        this.revision = result.revision;
        this.last = serialized;
      } catch (e) {
        this.failure = e instanceof Error ? e : new Error('远程保存失败');
        throw this.failure;
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
export async function downloadAttachment(id: string, name: string) {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE || '/api'}/attachments/${encodeURIComponent(id)}`,
    {
      headers: { Authorization: authorization },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error('附件下载失败');
  const url = URL.createObjectURL(await response.blob()),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function clearServerSession() {
  authorization = '';
  serverRole = 'viewer';
}

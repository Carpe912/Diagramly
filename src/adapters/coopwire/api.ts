import { z } from 'zod';
export const coopwireConfigSchema = z
  .object({
    baseUrl: z.string().refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, '接口地址须为不含凭证的 HTTP(S) 地址或留空使用同域'),
    projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    flowchartId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    flowchartType: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  })
  .strict();
export type CoopwireConfig = z.infer<typeof coopwireConfigSchema>;
export interface ActivityDetail {
  activity: {
    id: string;
    version: number;
    actName?: string;
    actType?: string;
    actDetailDesc?: string;
    isKeyStep?: boolean;
    code?: string;
    orgId?: string[];
    ioputs?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  data?: { actName?: string };
  [key: string]: unknown;
}
export interface FlowDetail {
  id: string;
  name: string;
  version: number;
  drawioXml: string;
  lockUser?: unknown;
  flowObj?: { acts?: Record<string, unknown>[]; [key: string]: unknown };
  [key: string]: unknown;
}
export interface Organization {
  orgId: string;
  orgName: string;
  index?: number;
  porgId?: string;
}
export class CoopwireError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'conflict' | 'rejected' | 'uncertain' | 'protocol',
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
  }
}
// Values live in memory only. Host applications may inject their own token refresh/header callback.
let auth: { headers?: () => HeadersInit | Promise<HeadersInit>; refresh?: () => Promise<void> } =
  {};
export function configureCoopwireAuth(provider: typeof auth) {
  auth = provider;
}
const envelopeSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
  results: z.unknown().optional(),
});
export class CoopwireApi {
  readonly config: CoopwireConfig;
  constructor(
    config: CoopwireConfig,
    private fetcher: typeof fetch = fetch,
    private timeout = 20000,
  ) {
    this.config = coopwireConfigSchema.parse(config);
  }
  private scope(kind: 'portrait' | 'scopeDefine' | 'scope') {
    return `/rest/quality/investigate/${kind}/p/${this.config.projectId}`;
  }
  private async request(
    path: string,
    options: {
      body?: unknown;
      params?: Record<string, string | number | boolean>;
      refresh?: boolean;
    } = {},
  ): Promise<unknown> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params ?? {})) query.set(key, String(value));
    const headers = new Headers(await auth.headers?.());
    headers.set('x-logwireCloud-resource', 'drawio');
    const multipart = options.body instanceof FormData;
    if (options.body !== undefined && options.body !== null && !multipart)
      headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await this.fetcher.call(
        globalThis,
        `${this.config.baseUrl.replace(/\/$/, '')}${path}${query.size ? `?${query}` : ''}`,
        {
          method: 'body' in options ? 'POST' : 'GET',
          credentials: 'include',
          headers,
          body:
            options.body == null
              ? undefined
              : multipart
                ? (options.body as FormData)
                : JSON.stringify(options.body),
          signal: AbortSignal.timeout(this.timeout),
          redirect: 'error',
        },
      );
    } catch {
      throw new CoopwireError(
        '请求未得到确认；不会自动重发业务写入，请先核对远端状态',
        'uncertain',
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new CoopwireError('Coopwire 登录已失效或没有权限', 'auth', response.status);
    if (response.status === 409)
      throw new CoopwireError('Coopwire 版本冲突，请重新加载远端文档', 'conflict', 409);
    if (!response.ok)
      throw new CoopwireError(
        `Coopwire 请求失败（HTTP ${response.status}）`,
        response.status >= 500 ? 'uncertain' : 'rejected',
        response.status,
      );
    let data: z.infer<typeof envelopeSchema>;
    try {
      data = envelopeSchema.parse(await response.json());
    } catch {
      throw new CoopwireError('Coopwire 返回格式不正确，操作结果待核对', 'protocol');
    }
    if (data.code === 1002) {
      // The business envelope explicitly rejected auth, so one replay after host refresh is safe.
      if (auth.refresh && options.refresh !== false) {
        await auth.refresh();
        return this.request(path, { ...options, refresh: false });
      }
      throw new CoopwireError(
        'Coopwire 登录已过期，请在宿主重新登录',
        'auth',
        response.status,
        data.code,
      );
    }
    if (data.code !== 0)
      throw new CoopwireError(
        data.msg || `Coopwire 业务请求被拒绝（${data.code}）`,
        data.code === -100000 ? 'uncertain' : 'rejected',
        response.status,
        data.code,
      );
    return data.results;
  }
  async organizations(): Promise<Organization[]> {
    return z
      .array(
        z
          .object({
            orgId: z.string(),
            orgName: z.string(),
            index: z.number().optional(),
            porgId: z.string().nullish(),
          })
          .passthrough(),
      )
      .parse(await this.request(`${this.scope('scope')}/qryOrgs`))
      .map((o) => ({ ...o, porgId: o.porgId ?? undefined }))
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }
  async flow(): Promise<FlowDetail> {
    return z
      .object({
        id: z.string(),
        name: z.string(),
        version: z.number().int().nonnegative(),
        drawioXml: z
          .string()
          .nullish()
          .transform((s) => s ?? ''),
        flowObj: z
          .object({ acts: z.array(z.record(z.string(), z.unknown())).optional() })
          .passthrough()
          .nullish()
          .transform((v) => v ?? undefined),
      })
      .passthrough()
      .parse(
        await this.request(`${this.scope('scopeDefine')}/qryFlowDiagramDetail`, {
          params: { id: this.config.flowchartId, showSimple: true },
        }),
      );
  }
  async activity(id: string): Promise<ActivityDetail> {
    return z
      .object({
        activity: z
          .object({ id: z.string(), version: z.number().int().nonnegative() })
          .passthrough(),
        data: z.object({ actName: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .parse(
        await this.request(`${this.scope('portrait')}/queryActDetail`, { params: { actId: id } }),
      ) as ActivityDetail;
  }
  // Client-assigned 24-hex IDs follow the old batchCreateActs contract.
  async createActivity(id: string, data: Record<string, unknown>) {
    await this.request(`${this.scope('portrait')}/addActs`, { body: [{ ...data, id }] });
    return id;
  }
  async copyActivity(id: string, name: string) {
    return z
      .string()
      .min(1)
      .parse(await this.request(`${this.scope('portrait')}/copyAct`, { body: [{ id, name }] }));
  }
  async updateActivity(id: string, version: number, data: Record<string, unknown>) {
    const result = await this.request(`${this.scope('portrait')}/updateAct`, {
      params: { actId: id, version, updateDrawio: true, ignoreNameCheck: true },
      body: data,
    });
    if (Array.isArray(result))
      throw new CoopwireError('活动名称冲突，需要选择不同名称', 'rejected');
    return z.number().int().nonnegative().parse(result);
  }
  async updateDescription(id: string, version: number, orgIds: string[], text: string) {
    const body = new FormData();
    body.append(
      'data',
      new Blob([JSON.stringify({ actDetailDesc: text })], { type: 'application/json' }),
    );
    await this.request(`${this.scope('portrait')}/updateActDetailDesc`, {
      body,
      params: { actId: id, version, orgId: orgIds.join(',') },
    });
  }
  async saveIo(id: string, version: number, data: Record<string, unknown>) {
    const body = new FormData();
    body.append('data', new Blob([JSON.stringify(data)], { type: 'application/json' }));
    await this.request(`${this.scope('portrait')}/saveIoput`, {
      body,
      params: { actId: id, version, updateDrawio: true },
    });
  }
  async deleteIo(id: string, version: number, ioId: string) {
    await this.request(`${this.scope('portrait')}/delIoput`, {
      body: null,
      params: { actId: id, version, ioputId: ioId, updateDrawio: false },
    });
  }
  async saveFlow(version: number, drawioXml: string, data: unknown, png: Blob) {
    const body = new FormData();
    body.append('file', png, '流程图.png');
    body.append(
      'data',
      new Blob(
        [JSON.stringify({ drawioXml, data, flowDiagramId: this.config.flowchartId, version })],
        { type: 'application/json' },
      ),
    );
    return z
      .number()
      .int()
      .nonnegative()
      .parse(await this.request(`${this.scope('scopeDefine')}/saveFlowDiagramRelation`, { body }));
  }
}

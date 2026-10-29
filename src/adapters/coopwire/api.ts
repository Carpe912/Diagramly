import { z } from 'zod';
const baseUrlSchema = z
  .string()
  .trim()
  .refine((value) => {
    const path = value.replace(/\/+$/, '');
    if (!path || path === '/rest') return true;
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
  }, '接口地址请填写 HTTP(S) 后端地址、/rest 或留空，不支持凭证、查询参数和片段')
  .transform((value) => {
    const path = value.replace(/\/+$/, '');
    if (!path || path === '/rest') return '';
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/(?:\/rest)+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  });
export const coopwireConfigSchema = z
  .object({
    baseUrl: baseUrlSchema,
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
export interface BusinessOption {
  value: string;
  label: string;
}
export interface BusinessMutation {
  kind: 'io' | 'exception';
  action: 'save' | 'delete';
  data: Record<string, unknown>;
}
export interface ActivityOptions {
  applications: BusinessOption[];
  devices: BusinessOption[];
  flows: BusinessOption[];
  terminals: BusinessOption[];
  operateTypes: BusinessOption[];
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
// 鉴权配置仅保存在内存，宿主可注入请求头与令牌刷新回调。
let auth: { headers?: () => HeadersInit | Promise<HeadersInit>; refresh?: () => Promise<void> } =
  {};
export function configureCoopwireAuth(provider: typeof auth) {
  auth = provider;
}
/** 使用 Coopwire 已有 Cookie 刷新登录态；请求体与原前端保持一致。 */
export async function refreshCoopwireSession(baseUrl = '', fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${baseUrlSchema.parse(baseUrl)}/rest/platform/refreshToken`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: null,
    redirect: 'error',
  });
  if (!response.ok) throw new CoopwireError('Coopwire 登录刷新失败', 'auth', response.status);
  const result = envelopeSchema.parse(await response.json());
  if (result.code !== 0)
    throw new CoopwireError(
      result.msg || 'Coopwire 登录刷新失败',
      'auth',
      response.status,
      result.code,
    );
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
      // 业务响应明确拒绝鉴权后，允许宿主刷新登录态并重试一次。
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
  // 客户端分配 24 位十六进制 ID，沿用旧版批量创建活动约定。
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
    const clear: Record<string, boolean> = {};
    if (data.actSystemUsed === '') clear.clearSystemUsed = true;
    if (Array.isArray(data.actDevicesUsed) && !data.actDevicesUsed.length)
      clear.clearDeviceUsed = true;
    if (data.linkFlow === '') clear.clearLinkFlow = true;
    if (data.inputSystemOrDeviceId === '') clear.clearInputSystemOrDeviceId = true;
    if (data.outputSystemOrDeviceId === '') clear.clearOutputSystemOrDeviceId = true;
    const result = await this.request(`${this.scope('portrait')}/updateAct`, {
      params: { actId: id, version, updateDrawio: true, ignoreNameCheck: true, ...clear },
      body: data,
    });
    if (Array.isArray(result))
      throw new CoopwireError('活动名称冲突，需要选择不同名称', 'rejected');
    return z.number().int().nonnegative().parse(result);
  }
  async updateDescription(
    id: string,
    version: number,
    orgIds: string[],
    text: string,
    field: 'actDetailDesc' | 'keyStep' = 'actDetailDesc',
  ) {
    const body = new FormData();
    body.append(
      'data',
      new Blob([JSON.stringify({ [field]: text })], { type: 'application/json' }),
    );
    await this.request(`${this.scope('portrait')}/updateActDetailDesc`, {
      body,
      params: { actId: id, version, orgId: orgIds.join(',') },
    });
  }
  async saveTimeRange(
    id: string,
    version: number,
    range: { actTimeStart: number; actTimeEnd: number } | null,
    rangeId?: string,
  ) {
    if (!range && !rangeId) return;
    await this.request(
      `${this.scope('portrait')}/${range ? (rangeId ? 'updateTimeRange' : 'addTimeRange') : 'delTimeRange'}`,
      {
        body: range ? { ...range, ...(rangeId ? { id: rangeId } : {}) } : null,
        params: { actId: id, version, ...(!range && rangeId ? { rangeId } : {}) },
      },
    );
  }
  async activityOptions(): Promise<ActivityOptions> {
    const p = this.config.projectId;
    const [apps, devices, flows, terminals, operations] = await Promise.all([
      this.request(`/rest/project/application/p/${p}/selectApp`, { body: null }),
      this.request(`/rest/quality/investigate/core/p/${p}/queryDevice`, {
        body: { additionalFilters: {} },
      }),
      this.request(`${this.scope('scopeDefine')}/qryFlowDiagram`, {
        body: { additionalFilters: { isDelete: false } },
      }),
      this.request(
        `/rest/global/dictionary/f/${encodeURIComponent('investigate|core|prHardwaresInvolved')}`,
      ),
      this.request(`/rest/quality/investigate/act/p/${p}/qryOperateTypeEnums`, { body: null }),
    ]);
    const records = z.array(z.object({ id: z.string(), name: z.string() }).passthrough());
    const list = (value: unknown) =>
      records.parse(value).map((item) => ({ value: item.id, label: item.name }));
    return {
      applications: list(apps),
      devices: list(z.object({ data: records }).parse(devices).data),
      flows: list(z.object({ data: records }).parse(flows).data).filter(
        (item) => item.value !== this.config.flowchartId,
      ),
      terminals: z
        .array(z.object({ metaCode: z.string(), metaValue: z.string() }))
        .parse(terminals)
        .map((item) => ({ value: item.metaCode, label: item.metaValue })),
      operateTypes: z
        .array(z.string())
        .parse(operations)
        .map((value) => ({ value, label: value })),
    };
  }
  async interfaceOptions(): Promise<BusinessOption[]> {
    const result = await this.request(
      `/rest/quality/${this.config.projectId}/interfaceDesign/list`,
      {
        body: { additionalFilters: {}, pageNum: 1, limit: 100000 },
      },
    );
    return z
      .object({ data: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()) })
      .parse(result)
      .data.map((item) => ({ value: item.id, label: item.name }));
  }
  async flowActivities(flowId: string): Promise<BusinessOption[]> {
    const result = await this.request(
      `/rest/quality/investigate/act/p/${this.config.projectId}/getByFlow`,
      { params: { flowId } },
    );
    return z
      .array(z.object({ id: z.string(), actName: z.string(), actType: z.string() }))
      .parse(result)
      .filter((item) =>
        ['manualOnline', 'manualOffline', 'systemOperate', 'interfaceDocking'].includes(
          item.actType,
        ),
      )
      .map((item) => ({ value: item.id, label: item.actName }));
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
  async mutateBusiness(actId: string, version: number, mutation: BusinessMutation) {
    const { kind, action, data } = mutation;
    if (kind === 'io') {
      if (action === 'save') await this.saveIo(actId, version, data);
      else await this.deleteIo(actId, version, String(data.id));
      return;
    }
    const existing = typeof data.id === 'string' && !!data.id;
    const params = existing
      ? { exceptionId: String(data.id), version: Number(data.version) }
      : undefined;
    await this.request(
      `${this.scope('portrait')}/${action === 'delete' ? 'delException' : existing ? 'editException' : 'addException'}`,
      {
        body:
          action === 'delete'
            ? null
            : {
                actLinked: data.actLinked ?? '',
                exceptionDesc: data.exceptionDesc,
                exceptionRate: data.exceptionRate ?? 0,
                resolveMethod: data.resolveMethod,
                systemOrDeviceId: data.systemOrDeviceId ?? '',
                isSystemOrDeviceException: data.isSystemOrDeviceException ?? false,
                belongType: 'activity',
                belongId: actId,
              },
        params,
      },
    );
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

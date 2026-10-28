import { demoDocument } from '../../src/application/demo';
import type { DiagramDocument } from '../../src/domain/model';
import type { ActivityDetail, FlowDetail } from '../../src/adapters/coopwire/api';
export const testConfig = {
  baseUrl: '',
  projectId: 'project_test',
  flowchartId: 'flow_test',
  flowchartType: 'tobe',
};
export function remoteFixture() {
  const doc = demoDocument();
  doc.nodes.lane_sales.bounds.height = 210;
  doc.entities.entity_lane_sales.roleIds = ['role_sales'];
  doc.entities.entity_lane_ops.roleIds = ['role_ops'];
  for (const id of ['receive', 'confirm', 'deliver', 'check'])
    doc.entities[doc.nodes[id].entityId].externalRef = {
      provider: 'coopwire',
      id: `remote_${id}`,
      version: 1,
    };
  return doc;
}
export const embed = (doc: DiagramDocument) =>
  `<mxGraphModel diagramlyDocument="${JSON.stringify(doc).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>`;
export class MemoryJournal {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
export class FakeCoopwire {
  document = remoteFixture();
  flow: FlowDetail = {
    id: testConfig.flowchartId,
    name: '测试流程',
    version: 8,
    drawioXml: embed(this.document),
  };
  activities = new Map<string, ActivityDetail>();
  calls: { method: string; action: string; body: unknown; query: URLSearchParams }[] = [];
  fail?: { action: string; kind: 'rejected' | 'lost'; after?: boolean };
  private sequence = 0;
  constructor() {
    for (const node of Object.values(this.document.nodes)) {
      const entity = this.document.entities[node.entityId];
      if (!entity.externalRef) continue;
      this.activities.set(entity.externalRef.id, {
        activity: {
          id: entity.externalRef.id,
          version: 1,
          actName: entity.name,
          code: entity.code,
          actType:
            node.type === 'decision'
              ? 'decide'
              : entity.activityType === 'system'
                ? 'systemOperate'
                : 'manualOnline',
          orgId: node.parentId === 'lane_sales' ? ['role_sales'] : ['role_ops'],
          actDetailDesc: entity.description,
          isKeyStep: entity.critical,
          ioputs: [
            ...entity.inputs.map((desc, i) => ({
              id: `${node.id}_in_${i}`,
              type: 'input',
              desc,
              attachments: ['preserved_attachment'],
            })),
            ...entity.outputs.map((desc, i) => ({
              id: `${node.id}_out_${i}`,
              type: 'output',
              desc,
            })),
          ],
        },
      });
    }
  }
  get writeCount() {
    return this.calls.filter((c) => c.method === 'POST').length;
  }
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), 'http://test.local'), init);
    const url = new URL(request.url),
      action = url.pathname.split('/').at(-1)!,
      query = url.searchParams;
    let body: unknown;
    if (
      request.method === 'POST' &&
      request.headers.get('content-type')?.includes('multipart/form-data')
    ) {
      const multipart = await request.formData(),
        data = multipart.get('data');
      body = JSON.parse(typeof data === 'string' ? data : await (data as Blob).text());
      if (action === 'saveFlowDiagramRelation' && !(multipart.get('file') instanceof Blob))
        throw new Error('Missing PNG');
    } else if (request.method === 'POST') {
      const text = await request.text();
      body = text ? JSON.parse(text) : null;
    }
    this.calls.push({ action, query, method: request.method, body });
    const failure = this.fail?.action === action ? this.fail : undefined;
    if (failure) this.fail = undefined;
    if (failure && !failure.after) {
      if (failure.kind === 'lost') throw new TypeError('Simulated lost response');
      return Response.json({ code: 1234, msg: '测试：业务拒绝' });
    }
    let result: unknown;
    const data = body as Record<string, unknown>,
      id = query.get('actId') ?? '';
    const detail = this.activities.get(id);
    if (action === 'qryOrgs')
      result = [
        { orgId: 'role_sales', orgName: '销售角色', index: 0 },
        { orgId: 'role_ops', orgName: '交付角色', index: 1 },
      ];
    else if (action === 'qryFlowDiagramDetail') result = structuredClone(this.flow);
    else if (action === 'queryActDetail') {
      if (!detail) return Response.json({ code: 404, msg: '活动不存在' });
      result = structuredClone(detail);
    } else if (action === 'addActs') {
      for (const item of body as Record<string, unknown>[]) {
        const newId = String(item.id);
        if (this.activities.has(newId)) return Response.json({ code: 409, msg: 'ID 已存在' });
        this.activities.set(newId, {
          activity: {
            ...item,
            id: newId,
            actName: String(item.actName),
            actType: String(item.actType),
            version: 1,
            ioputs: [],
          },
        });
      }
      result = null;
    } else if (action === 'copyAct') {
      const item = (body as { id: string; name: string }[])[0],
        source = this.activities.get(item.id)!;
      const copy = structuredClone(source);
      result = `remote_copy_${++this.sequence}`;
      copy.activity.id = String(result);
      copy.activity.actName = item.name;
      copy.activity.version = 1;
      copy.activity.code = '';
      this.activities.set(String(result), copy);
    } else if (action === 'saveFlowDiagramRelation') {
      if (data.version !== this.flow.version)
        return Response.json({ code: 999, msg: '版本冲突' }, { status: 409 });
      this.flow.drawioXml = String(data.drawioXml);
      this.flow.flowObj = data.data as FlowDetail['flowObj'];
      result = ++this.flow.version;
    } else if (['updateAct', 'updateActDetailDesc', 'saveIoput', 'delIoput'].includes(action)) {
      if (!detail || Number(query.get('version')) !== detail.activity.version)
        return Response.json({ code: 999, msg: '活动版本冲突' }, { status: 409 });
      if (action === 'updateAct' || action === 'updateActDetailDesc')
        Object.assign(detail.activity, data);
      if (action === 'saveIoput') {
        const io = detail.activity.ioputs ?? (detail.activity.ioputs = []),
          index = io.findIndex((i) => i.id === data.id);
        const value = { ...data, id: data.id ?? `io_${++this.sequence}` };
        if (index < 0) io.push(value);
        else io[index] = value;
      }
      if (action === 'delIoput')
        detail.activity.ioputs = detail.activity.ioputs?.filter(
          (i) => i.id !== query.get('ioputId'),
        );
      result = ++detail.activity.version;
    } else throw new Error(`Unexpected API: ${action}`);
    if (failure?.kind === 'lost')
      throw new TypeError('Simulated committed write with lost response');
    return Response.json({ code: 0, results: result });
  }
}

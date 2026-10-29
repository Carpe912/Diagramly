// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Editor } from '../src/application/editor';
import { createShapeRegistry } from '../src/shapes/registry';
import { CoopwireApi, configureCoopwireAuth } from '../src/adapters/coopwire/api';
import { CoopwireSession } from '../src/adapters/coopwire/session';
import { readFlow, writeFlow, flowRelations } from '../src/adapters/coopwire/codec';
import { createAgentTools } from '../src/agent/tools';
import type { Command } from '../src/application/commands';
import { FakeCoopwire, MemoryJournal, testConfig, remoteFixture } from './support/coopwire';

const registry = createShapeRegistry();
const png = async () => new Blob(['png-test'], { type: 'image/png' });
async function setup() {
  const backend = new FakeCoopwire(),
    journal = new MemoryJournal();
  const session = new CoopwireSession(
    new CoopwireApi(testConfig, backend.fetch.bind(backend) as typeof fetch),
    registry,
    png,
    journal,
  );
  const editor = new Editor(await session.open(), registry);
  editor.attachTransport(session);
  return { backend, session, editor, journal };
}
const makeCommand = (
  editor: Editor,
  operations: Command['operations'],
  commandId = 'cmd_remote_test',
): Command => ({
  commandId,
  expectedRevision: editor.snapshot.revision,
  origin: 'user',
  label: '远程编辑',
  operations,
});
afterEach(() => configureCoopwireAuth({}));
describe('Coopwire transport', () => {
  it('Agent 对齐预览不写入，应用与撤销仅同步流程位置并保留业务身份', async () => {
    const { editor, backend } = await setup(),
      before = editor.snapshot,
      tools = createAgentTools(editor);
    const input = {
      ...makeCommand(
        editor,
        [{ type: 'nodes.align', ids: ['receive', 'confirm'], mode: 'left' }],
        'agent_align',
      ),
      origin: 'agent',
    };
    const preview = tools.preview(input);
    expect(preview.document.nodes.confirm.bounds.x).toBe(before.nodes.receive.bounds.x);
    expect(backend.writeCount).toBe(0);
    await tools.apply(input);
    expect(readFlow(backend.flow, registry).document.nodes.confirm.bounds.x).toBe(
      before.nodes.receive.bounds.x,
    );
    expect(editor.snapshot.entities).toEqual(before.entities);
    await editor.undoAsync();
    expect(readFlow(backend.flow, registry).document.nodes).toEqual(before.nodes);
    expect(backend.calls.filter((c) => c.method === 'POST').map((c) => c.action)).toEqual([
      'saveFlowDiagramRelation',
      'saveFlowDiagramRelation',
    ]);
  });
  it('样式仅保存流程关系，撤销后远程 XML 恢复，业务属性不被改写', async () => {
    const { editor, backend } = await setup(),
      before = editor.snapshot;
    await editor.submit(
      makeCommand(editor, [
        { type: 'node.appearance', id: 'receive', strokeWidth: 4, pattern: 'dotted', opacity: 60 },
        {
          type: 'edge.appearance',
          id: 'edge_check',
          startArrow: 'diamond',
          endFill: false,
          startSpacing: 10,
          jumpStyle: 'gap',
          jumpSize: 12,
        },
      ]),
    );
    expect(backend.calls.filter((c) => c.method === 'POST').map((c) => c.action)).toEqual([
      'saveFlowDiagramRelation',
    ]);
    expect(readFlow(backend.flow, registry).document).toEqual(editor.snapshot);
    expect(editor.snapshot.entities).toEqual(before.entities);
    await editor.undoAsync();
    const restored = readFlow(backend.flow, registry).document;
    expect(restored.nodes).toEqual(before.nodes);
    expect(restored.edges).toEqual(before.edges);
    expect(backend.calls.filter((c) => c.method === 'POST').map((c) => c.action)).toEqual([
      'saveFlowDiagramRelation',
      'saveFlowDiagramRelation',
    ]);
  });
  it('opens roles, the diagram and business details without any writes', async () => {
    const { backend, editor, session } = await setup();
    expect(backend.writeCount).toBe(0);
    expect(session.organizations).toHaveLength(2);
    expect(editor.snapshot.entities.entity_receive.externalRef?.version).toBe(1);
  });
  it('commits business edits and versioned multipart diagram data before local acceptance', async () => {
    const { backend, editor, session } = await setup();
    await editor.submit(
      makeCommand(editor, [{ type: 'node.update', id: 'receive', patch: { name: '远端新名称' } }]),
    );
    expect(backend.activities.get('remote_receive')?.activity.actName).toBe('远端新名称');
    expect(editor.snapshot.entities.entity_receive.name).toBe('远端新名称');
    expect(session.remoteVersion).toBe(9);
    const save = backend.calls.find((c) => c.action === 'saveFlowDiagramRelation')!;
    expect(save.body).toMatchObject({ flowDiagramId: 'flow_test', version: 8 });
    expect(readFlow(backend.flow, registry).document).toEqual(editor.snapshot);
  });
  it('creates activities with stable client-assigned IDs and belongs to the selected flow', async () => {
    const { editor, backend } = await setup(),
      op = editor.createNode('activity', 120, 45, 'lane_sales');
    await editor.submit(makeCommand(editor, [op]));
    const create = backend.calls.find((c) => c.action === 'addActs')!;
    expect(create.body).toMatchObject([
      { belongId: 'flow_test', belongType: 'tobeAct', orgId: ['role_sales'] },
    ]);
    expect((create.body as { id: string }[])[0].id).toMatch(/^[0-9a-f]{24}$/);
    if (op.type === 'node.create')
      expect(editor.snapshot.entities[op.entity.id].externalRef?.provider).toBe('coopwire');
  });
  it('copies remote activities once and keeps independent identities', async () => {
    const { editor, backend } = await setup();
    const command = makeCommand(editor, [
      {
        type: 'node.duplicate',
        id: 'receive',
        newId: 'copy',
        newEntityId: 'entity_copy',
        offset: { x: 30, y: 30 },
      },
    ]);
    const [a, b] = await Promise.all([editor.submit(command), editor.submit(command)]);
    expect(a).toEqual(b);
    expect(backend.calls.filter((c) => c.action === 'copyAct')).toHaveLength(1);
    expect(editor.snapshot.entities.entity_copy.externalRef?.id).not.toBe('remote_receive');
  });
  it('uses compensating remote updates for undo and redo', async () => {
    const { editor, backend } = await setup();
    await editor.submit(
      makeCommand(editor, [{ type: 'node.update', id: 'receive', patch: { name: '更新' } }]),
    );
    await editor.undoAsync();
    expect(backend.activities.get('remote_receive')?.activity.actName).toBe('接收客户订单');
    await editor.redoAsync();
    expect(backend.activities.get('remote_receive')?.activity.actName).toBe('更新');
    expect(editor.snapshot.revision).toBe(3);
  });
  it('removes diagram relations without deleting business objects, and restores them on undo', async () => {
    const { editor, backend } = await setup();
    await editor.submit(makeCommand(editor, [{ type: 'node.delete', id: 'receive' }]));
    expect(backend.activities.has('remote_receive')).toBe(true);
    expect(backend.flow.flowObj?.acts?.some((a) => a.actId === 'remote_receive')).toBe(false);
    await editor.undoAsync();
    expect(backend.flow.flowObj?.acts?.some((a) => a.actId === 'remote_receive')).toBe(true);
    expect(backend.calls.some((c) => c.action === 'delAct')).toBe(false);
  });
  it('does not copy/create again after undoing and redoing creation', async () => {
    const { editor, backend } = await setup();
    await editor.submit(
      makeCommand(editor, [
        {
          type: 'node.duplicate',
          id: 'receive',
          newId: 'copy',
          newEntityId: 'entity_copy',
          offset: { x: 30, y: 30 },
        },
      ]),
    );
    const id = editor.snapshot.entities.entity_copy.externalRef?.id;
    await editor.undoAsync();
    await editor.redoAsync();
    expect(editor.snapshot.entities.entity_copy.externalRef?.id).toBe(id);
    expect(backend.calls.filter((c) => c.action === 'copyAct')).toHaveLength(1);
  });
  it('rejects external diagram or activity version conflicts before writing', async () => {
    const { editor, backend } = await setup();
    backend.flow.version++;
    await expect(
      editor.submit(makeCommand(editor, [{ type: 'document.rename', title: '冲突' }])),
    ).rejects.toThrow('版本');
    expect(backend.writeCount).toBe(0);
    expect(editor.snapshot.revision).toBe(0);
    backend.flow.version--;
    backend.activities.get('remote_receive')!.activity.version++;
    await expect(
      editor.submit(
        makeCommand(
          editor,
          [{ type: 'node.update', id: 'receive', patch: { name: '冲突' } }],
          'cmd_conflict_2',
        ),
      ),
    ).rejects.toThrow('活动');
    expect(backend.writeCount).toBe(0);
  });
  it('retains local state on a rejected save and resumes acknowledged steps without duplicate writes', async () => {
    const { editor, backend } = await setup();
    backend.fail = { action: 'saveFlowDiagramRelation', kind: 'rejected' };
    const command = makeCommand(editor, [
      {
        type: 'node.duplicate',
        id: 'receive',
        newId: 'copy',
        newEntityId: 'entity_copy',
        offset: { x: 30, y: 30 },
      },
    ]);
    await expect(editor.submit(command)).rejects.toThrow('业务拒绝');
    expect(editor.snapshot.nodes.copy).toBeUndefined();
    await editor.retryRemote();
    expect(editor.snapshot.nodes.copy).toBeDefined();
    expect(backend.calls.filter((c) => c.action === 'copyAct')).toHaveLength(1);
  });
  it('blocks blind retries when a copy committed but its response was lost', async () => {
    const { editor, backend, journal } = await setup();
    backend.fail = { action: 'copyAct', kind: 'lost', after: true };
    const command = makeCommand(editor, [
      {
        type: 'node.duplicate',
        id: 'receive',
        newId: 'copy',
        newEntityId: 'entity_copy',
        offset: { x: 30, y: 30 },
      },
    ]);
    await expect(editor.submit(command)).rejects.toThrow('确认');
    await expect(editor.retryRemote()).rejects.toThrow('禁止重发');
    expect(backend.calls.filter((c) => c.action === 'copyAct')).toHaveLength(1);
    expect(journal.data.size).toBe(1);
    expect(editor.snapshot.nodes.copy).toBeUndefined();
  });
  it('preserves the journal across sessions and requires explicit read reconciliation', async () => {
    const { editor, backend, journal } = await setup();
    backend.fail = { action: 'saveFlowDiagramRelation', kind: 'rejected' };
    await expect(
      editor.submit(
        makeCommand(editor, [{ type: 'node.update', id: 'receive', patch: { name: '待核对' } }]),
      ),
    ).rejects.toThrow();
    const session = new CoopwireSession(
      new CoopwireApi(testConfig, backend.fetch.bind(backend) as typeof fetch),
      registry,
      png,
      journal,
    );
    await session.open();
    const doc = await session.reloadAndReconcile();
    expect(Object.values(doc.entities).some((e) => e.name === '待核对')).toBe(true);
    expect([...journal.data.keys()].some((key) => key.endsWith(':recovery'))).toBe(true);
  });
  it('preserves rich IO fields while editing text, and removes IO with its own endpoint', async () => {
    const { editor, backend } = await setup();
    await editor.submit(
      makeCommand(editor, [
        { type: 'node.update', id: 'receive', patch: { inputs: ['更新输入'], outputs: [] } },
      ]),
    );
    const io = backend.activities.get('remote_receive')!.activity.ioputs!;
    expect(io.find((i) => i.type === 'input')).toMatchObject({
      desc: '更新输入',
      attachments: ['preserved_attachment'],
    });
    expect(io.some((i) => i.type === 'output')).toBe(false);
    expect(backend.calls.some((c) => c.action === 'delIoput')).toBe(true);
  });
  it('writes description multipart and changes role membership with version checks', async () => {
    const { editor, backend } = await setup();
    await editor.submit(
      makeCommand(editor, [
        { type: 'node.update', id: 'receive', patch: { description: '新说明', critical: true } },
        { type: 'node.move', id: 'receive', parentId: 'lane_ops', x: 120, y: 55 },
      ]),
    );
    expect(backend.activities.get('remote_receive')?.activity).toMatchObject({
      actDetailDesc: '新说明',
      isKeyStep: true,
      orgId: ['role_ops'],
    });
  });
  it('prevents unbound roles and direct local bypasses in remote mode', async () => {
    const { editor, backend } = await setup();
    expect(() =>
      editor.execute(makeCommand(editor, [{ type: 'document.rename', title: '绕过' }])),
    ).toThrow('submit');
    await expect(
      editor.submit(makeCommand(editor, [editor.createNode('activity', 10, 10)])),
    ).rejects.toThrow('组织角色');
    expect(backend.writeCount).toBe(0);
  });
  it('routes Agent apply through the same actual remote adapter', async () => {
    const { editor, backend } = await setup(),
      tools = createAgentTools(editor);
    const command = {
      ...makeCommand(editor, [
        { type: 'node.update', id: 'receive', patch: { name: 'Agent 远程活动' } },
      ]),
      origin: 'agent',
    };
    tools.preview(command);
    expect(backend.writeCount).toBe(0);
    await tools.apply(command);
    expect(backend.activities.get('remote_receive')?.activity.actName).toBe('Agent 远程活动');
  });
});
describe('HTTP and codec boundaries', () => {
  it('uses credentials, preserves multipart content type, and never automatically retries network failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network'));
    const api = new CoopwireApi(testConfig, fetcher);
    await expect(api.copyActivity('a', 'copy')).rejects.toThrow('确认');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('include');
  });
  it('refreshes explicit expired-auth envelopes once using host-supplied memory headers', async () => {
    const refresh = vi.fn(async () => {}),
      fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ code: 1002 }))
        .mockResolvedValueOnce(Response.json({ code: 0, results: 'new_remote_id' }));
    configureCoopwireAuth({
      headers: () => ({ Authorization: 'test-only-memory-value' }),
      refresh,
    });
    const api = new CoopwireApi(testConfig, fetcher);
    expect(await api.copyActivity('a', 'copy')).toBe('new_remote_id');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe(
      'test-only-memory-value',
    );
  });
  it('rejects authentication, partial batch success and malformed envelopes', async () => {
    for (const response of [
      new Response('', { status: 403 }),
      Response.json({ code: -100000 }),
      Response.json({ unexpected: true }),
    ]) {
      const api = new CoopwireApi(testConfig, vi.fn<typeof fetch>().mockResolvedValue(response));
      await expect(api.copyActivity('a', 'copy')).rejects.toThrow();
    }
  });
  it('round-trips canonical metadata and exports the old flow relation shape', () => {
    const doc = remoteFixture(),
      xml = writeFlow(doc, registry, 'cmd_codec');
    const loaded = readFlow({ id: 'f', name: 'n', version: 1, drawioXml: xml }, registry);
    expect(loaded.document).toEqual(doc);
    const relations = flowRelations(doc);
    expect(relations.acts).toHaveLength(4);
    expect(relations.swimlanes).toHaveLength(2);
    expect(relations.acts.find((a) => a.xmlId === 'receive')).toMatchObject({
      actId: 'remote_receive',
      orgId: ['role_sales'],
    });
  });
  it('migrates vertical legacy swimlanes, normalizes business roots and retains relation-only activities', () => {
    const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="lane" value="角色" parent="1" vertex="1" style="swimlane;swimlaneLane;roleId=role_sales;"><mxGeometry width="240" height="500"/></mxCell><object id="act" data-id="remote_a" data-act-type="manualOnline" data-act-name="旧活动"><mxCell parent="lane" vertex="1" style="active;"><mxGeometry y="100" width="150" height="100"/></mxCell></object></root></mxGraphModel>`;
    const result = readFlow(
      {
        id: 'f',
        name: 'n',
        version: 1,
        drawioXml: xml,
        flowObj: { acts: [{ actId: 'remote_missing', xmlId: 'absent', orgId: ['role_sales'] }] },
      },
      registry,
    );
    expect(Object.values(result.document.nodes).filter((n) => n.type === 'activity')).toHaveLength(
      2,
    );
    expect(result.warnings.some((w) => w.includes('仅存在于流程关系'))).toBe(true);
  });
  it('refuses unsupported legacy cells and unsafe XML instead of silently dropping them', () => {
    expect(() =>
      readFlow(
        { id: 'f', name: 'n', version: 1, drawioXml: '<!DOCTYPE x><mxGraphModel/>' },
        registry,
      ),
    ).toThrow();
    expect(() =>
      readFlow(
        {
          id: 'f',
          name: 'n',
          version: 1,
          drawioXml:
            '<mxGraphModel><root><mxCell id="x" vertex="1" style="customUnknown"/></root></mxGraphModel>',
        },
        registry,
      ),
    ).toThrow('尚未支持');
  });
});
describe('legacy business metadata preservation', () => {
  it('does not rewrite activities on geometry-only changes when API uses orgRelation rather than orgId', async () => {
    const backend = new FakeCoopwire();
    for (const detail of backend.activities.values()) {
      delete detail.activity.orgId;
      detail.activity.orgRelation = [];
    }
    const session = new CoopwireSession(
      new CoopwireApi(testConfig, backend.fetch.bind(backend) as typeof fetch),
      registry,
      png,
      new MemoryJournal(),
    );
    const editor = new Editor(await session.open(), registry);
    editor.attachTransport(session);
    await editor.submit(makeCommand(editor, [{ type: 'node.move', id: 'receive', x: 225, y: 45 }]));
    expect(backend.calls.filter((c) => c.method === 'POST').map((c) => c.action)).toEqual([
      'saveFlowDiagramRelation',
    ]);
  });
  it('copies without overwriting rich descriptions, IO or manualOffline type', async () => {
    const backend = new FakeCoopwire(),
      original = backend.activities.get('remote_receive')!;
    original.activity.actType = 'manualOffline';
    original.activity.actDetailDesc = '<p>保留<strong>富文本</strong></p>';
    const session = new CoopwireSession(
      new CoopwireApi(testConfig, backend.fetch.bind(backend) as typeof fetch),
      registry,
      png,
      new MemoryJournal(),
    );
    const editor = new Editor(await session.open(), registry);
    editor.attachTransport(session);
    await editor.submit(
      makeCommand(editor, [
        {
          type: 'node.duplicate',
          id: 'receive',
          newId: 'copy',
          newEntityId: 'entity_copy',
          offset: { x: 30, y: 30 },
        },
      ]),
    );
    const copy = backend.activities.get('remote_copy_1')!;
    expect(copy.activity.actType).toBe('manualOffline');
    expect(copy.activity.actDetailDesc).toBe(original.activity.actDetailDesc);
    expect(
      backend.calls.filter((c) =>
        ['updateActDetailDesc', 'saveIoput', 'delIoput'].includes(c.action),
      ),
    ).toHaveLength(0);
  });
  it('rejects remote identity injection through newly created Agent nodes', async () => {
    const { editor, backend } = await setup(),
      operation = editor.createNode('activity', 120, 45, 'lane_sales');
    if (operation.type !== 'node.create') throw Error();
    operation.entity.externalRef = { provider: 'coopwire', id: 'unrelated_business_id' };
    await expect(editor.submit(makeCommand(editor, [operation]))).rejects.toThrow('注入');
    expect(backend.writeCount).toBe(0);
  });
  it('keeps the original XML backup when canonical metadata is saved repeatedly', () => {
    const original = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>',
      doc = remoteFixture();
    const first = readFlow(
      { id: 'f', name: 'n', version: 1, drawioXml: writeFlow(doc, registry, 'cmd_a', original) },
      registry,
    );
    const second = readFlow(
      {
        id: 'f',
        name: 'n',
        version: 2,
        drawioXml: writeFlow(first.document, registry, 'cmd_b', first.legacySource),
      },
      registry,
    );
    expect(second.legacySource).toBe(original);
  });
});
describe('remote pools', () => {
  it('persists pool orientation, nested lane ownership and colors without touching business activities', async () => {
    const { editor, backend } = await setup();
    await editor.submit(
      makeCommand(editor, [
        { type: 'pool.orientation', id: 'pool_order', orientation: 'vertical' },
        { type: 'node.appearance', id: 'pool_order', fill: '#edf7f0', fontColor: '#335544' },
      ]),
    );
    expect(backend.calls.filter((c) => c.method === 'POST').map((c) => c.action)).toEqual([
      'saveFlowDiagramRelation',
    ]);
    const restored = readFlow(backend.flow, registry).document;
    expect(restored.nodes.pool_order.type).toBe('pool-vertical');
    expect(restored.nodes.lane_sales.parentId).toBe('pool_order');
    expect(restored.nodes.pool_order.appearance.fill).toBe('#edf7f0');
    expect(backend.flow.drawioXml).toContain('verticalSwimlane');
    expect(backend.flow.drawioXml).toContain('sourceJettySize=');
    expect(restored.edges.edge_deliver.source.portId).toBe('right');
    expect(restored.edges.edge_deliver.target.portId).toBe('left');
    expect(flowRelations(restored).otherCells.some((n) => n.xmlId === 'pool_order')).toBe(false);
  });
  it('preserves pool direction, organization IDs and colors from the old XML container structure', () => {
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="p" parent="1" vertex="1" style="swimlane;verticalSwimlane;swimlaneContainer;fillColor=#23324A;fontColor=#FFF;"><mxGeometry x="40" y="70" width="480" height="600"/></mxCell><mxCell id="l1" value="角色一" parent="p" vertex="1" style="swimlane;swimlaneLane;roleId=role_sales;fillColor=#5D6D86;fontColor=#FFF;"><mxGeometry y="28" width="240" height="572"/></mxCell><mxCell id="l2" value="角色二" parent="p" vertex="1" style="swimlane;swimlaneLane;"><mxGeometry x="240" y="28" width="240" height="572"/></mxCell></root></mxGraphModel>';
    const result = readFlow(
      { id: 'f', name: '测试泳池', version: 1, drawioXml: xml },
      registry,
    ).document;
    const pool = Object.values(result.nodes).find((n) => n.type === 'pool-vertical')!;
    expect(pool).toBeDefined();
    expect(pool.appearance).toMatchObject({ headerFill: '#23324A', fontColor: '#FFFFFF' });
    const lanes = Object.values(result.nodes).filter((n) => n.parentId === pool.id);
    expect(lanes).toHaveLength(2);
    expect(lanes[1].bounds.x).toBe(lanes[0].bounds.width);
    expect(result.entities[lanes[0].entityId].roleIds).toEqual(['role_sales']);
  });
});
describe('pool relation ordering', () => {
  it('exports inserted lanes in visual order without exposing pools as business records', () => {
    const editor = new Editor(remoteFixture(), registry);
    editor.dispatch('插入泳道', [
      {
        type: 'pool.lane.add',
        poolId: 'pool_order',
        laneId: 'inserted_lane',
        entityId: 'inserted_entity',
        name: '中间泳道',
        index: 1,
      },
    ]);
    const relations = flowRelations(editor.snapshot);
    expect(relations.swimlanes.map((lane) => lane.xmlId)).toEqual([
      'lane_sales',
      'inserted_lane',
      'lane_ops',
    ]);
    expect(relations.acts).toHaveLength(4);
    expect(relations.otherCells.some((cell) => cell.xmlId === 'pool_order')).toBe(false);
  });
});
describe('活动画像详情', () => {
  it('读取人工线下类型及详情，原有文档仍可打开', async () => {
    const backend = new FakeCoopwire(),
      activity = backend.activities.get('remote_receive')!.activity;
    Object.assign(activity, {
      actType: 'manualOffline',
      keyStep: '<p>先确认库存</p>',
      hoursOnceAct: 2,
      progressRate: 45,
      fixedCycleKey: 'week',
      fixedCycleWeekValues: [1, 3],
      displaySetting: { timeVisible: true, futureFlag: true },
      timeRanges: { id: 'time_original', actTimeStart: 8, actTimeEnd: 18 },
    });
    const session = new CoopwireSession(
      new CoopwireApi(testConfig, backend.fetch.bind(backend) as typeof fetch),
      registry,
      png,
      new MemoryJournal(),
    );
    const doc = await session.open();
    expect(doc.entities.entity_receive.activityType).toBe('offline');
    expect(doc.entities.entity_receive.details).toMatchObject({
      keyStep: '<p>先确认库存</p>',
      hoursOnceAct: '2',
      progressRate: 45,
      fixedCycleWeekValues: ['1', '3'],
      timeRanges: { actTimeStart: 8, actTimeEnd: 18 },
    });
    expect(backend.writeCount).toBe(0);
  });
  it('补充说明与时间范围使用专用接口，普通字段增量保存，撤销会补偿写入', async () => {
    const { editor, backend } = await setup();
    backend.activities.get('remote_receive')!.activity.displaySetting = { futureFlag: true };
    await editor.submit(
      makeCommand(editor, [
        {
          type: 'node.update',
          id: 'receive',
          patch: {
            activityType: 'offline',
            details: {
              keyStep: '扫描订单后检查库存',
              progressRate: 65,
              hoursOnceAct: '2.5',
              actDevicesUsed: ['device_scanner'],
              displaySetting: { timeVisible: true },
              timeRanges: { actTimeStart: 9, actTimeEnd: 17 },
            },
          },
        },
      ]),
    );
    const saved = backend.activities.get('remote_receive')!.activity;
    expect(saved).toMatchObject({
      actType: 'manualOffline',
      keyStep: '扫描订单后检查库存',
      progressRate: 65,
      hoursOnceAct: '2.5',
      displaySetting: { timeVisible: true, futureFlag: true },
      timeRanges: { actTimeStart: 9, actTimeEnd: 17 },
    });
    expect(backend.calls.find((c) => c.action === 'updateAct')?.body).not.toHaveProperty('keyStep');
    expect(backend.calls.find((c) => c.action === 'updateAct')?.body).not.toHaveProperty(
      'timeRanges',
    );
    expect(backend.calls.filter((c) => c.action === 'addTimeRange')).toHaveLength(1);
    await editor.undoAsync();
    expect(saved).toMatchObject({
      actType: 'manualOnline',
      keyStep: '',
      progressRate: 0,
      actDevicesUsed: [],
      timeRanges: null,
    });
    expect(backend.calls.some((c) => c.action === 'delTimeRange')).toBe(true);
    await editor.redoAsync();
    expect(saved.progressRate).toBe(65);
  });
  it('详情支持部分字段更新，不清空其他业务字段，并拒绝非法日期', async () => {
    const { editor } = await setup();
    await editor.submit(
      makeCommand(editor, [
        {
          type: 'node.update',
          id: 'receive',
          patch: { details: { keyStep: '保留说明', displaySetting: { timeVisible: true } } },
        },
      ]),
    );
    await editor.submit(
      makeCommand(
        editor,
        [
          {
            type: 'node.update',
            id: 'receive',
            patch: { details: { progressRate: 20, displaySetting: { cycleVisible: true } } },
          },
        ],
        'cmd_details_2',
      ),
    );
    expect(editor.snapshot.entities.entity_receive.details).toMatchObject({
      keyStep: '保留说明',
      progressRate: 20,
      displaySetting: { timeVisible: true, cycleVisible: true },
    });
    expect(() =>
      editor.preview(
        makeCommand(
          editor,
          [
            {
              type: 'node.update',
              id: 'receive',
              patch: { details: { fixedCycleWeekValues: ['8'] } },
            },
          ],
          'cmd_invalid',
        ),
      ),
    ).toThrow();
  });
  it('加载真实业务选项协议并发送清空关联参数', async () => {
    const backend = new FakeCoopwire(),
      api = new CoopwireApi(testConfig, backend.fetch.bind(backend) as typeof fetch);
    expect(await api.activityOptions()).toMatchObject({
      applications: [{ value: 'app_erp', label: '订单应用' }],
      devices: [{ value: 'device_scanner', label: '扫码枪' }],
      terminals: [{ value: 'desktop', label: '电脑' }],
    });
    await api.updateActivity('remote_receive', 1, {
      actSystemUsed: '',
      actDevicesUsed: [],
      linkFlow: '',
    });
    const call = backend.calls.find((c) => c.action === 'updateAct')!;
    expect(call.query.get('clearSystemUsed')).toBe('true');
    expect(call.query.get('clearDeviceUsed')).toBe('true');
    expect(call.query.get('clearLinkFlow')).toBe('true');
  });
});

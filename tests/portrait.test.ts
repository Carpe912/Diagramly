// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '../src/application/editor';
import { emptyDocument } from '../src/domain/model';
import { createShapeRegistry } from '../src/shapes/registry';
import { nodePresentation } from '../src/shapes/presentation';
import {
  businessSelectionSchema,
  flowchartContext,
  portraitEventSchema,
  portraitUrl,
  selectionFor,
} from '../src/adapters/coopwire/portrait';
import { refreshCoopwireSession } from '../src/adapters/coopwire/api';
import { CoopwireApi } from '../src/adapters/coopwire/api';
import { CoopwireSession } from '../src/adapters/coopwire/session';
import { readFlow } from '../src/adapters/coopwire/codec';
import { FakeCoopwire, MemoryJournal, testConfig } from './support/coopwire';

describe('嵌入业务面板', () => {
  it('仅在流程图环境接受参数，并严格限定消息来源所需的数据', () => {
    expect(flowchartContext('https://example.test/?flowchart=0')).toBeUndefined();
    expect(
      flowchartContext(
        'https://example.test/?flowchart=1&projectId=project_test&flowchartId=flow_test&flowchartType=tobe',
      )?.config,
    ).toEqual(testConfig);
    const selection = selectionFor(testConfig, 'node_1', 'act_1', 'manualOffline', 'scene_1');
    expect(businessSelectionSchema.parse(selection).actType).toBe('manualOffline');
    expect(
      portraitUrl('https://coop.example.test', selection, 'session_1', 'https://editor.test')
        .pathname,
    ).toBe('/enterprise/diagramly/portrait/project_test');
    expect(() =>
      portraitUrl('javascript:alert(1)', selection, 's', 'https://editor.test'),
    ).toThrow();
    expect(
      portraitEventSchema.safeParse({
        channel: 'diagramly.portrait',
        version: 1,
        sessionId: 's',
        type: 'changed',
        requestId: -1,
        actId: 'act_1',
      }).success,
    ).toBe(false);
  });

  it('沿用原前端的空请求体刷新登录态', async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.method).toBe('POST');
      expect(options.body).toBeNull();
      expect(options.credentials).toBe('include');
      return Response.json({ code: 0, results: null });
    });
    await refreshCoopwireSession('https://coop.example.test', fetcher as unknown as typeof fetch);
    expect(fetcher.mock.calls[0][0]).toBe('https://coop.example.test/rest/platform/refreshToken');
  });

  it('外部表单保存后只写流程关系，保留图形与业务 ID，并隔离旧撤销历史', async () => {
    const backend = new FakeCoopwire();
    const registry = createShapeRegistry();
    const session = new CoopwireSession(
      new CoopwireApi(testConfig, backend.fetch.bind(backend) as typeof fetch),
      registry,
      async () => new Blob(['png-test'], { type: 'image/png' }),
      new MemoryJournal(),
    );
    const editor = new Editor(await session.open(), registry);
    editor.attachTransport(session);
    await editor.submit({
      commandId: 'before_external',
      expectedRevision: editor.snapshot.revision,
      origin: 'user',
      label: '移动节点',
      operations: [{ type: 'node.move', id: 'receive', x: 220, y: 46 }],
    });
    expect(editor.canUndo).toBe(true);
    const before = editor.snapshot;
    const activity = backend.activities.get('remote_receive')!;
    activity.activity.actName = '原面板修改的名称';
    activity.activity.version++;
    backend.calls.length = 0;
    await editor.synchronizeExternal((current) =>
      session.refreshActivities(current, ['remote_receive']),
    );
    expect(editor.snapshot.nodes.receive.id).toBe(before.nodes.receive.id);
    expect(editor.snapshot.entities.entity_receive.externalRef?.id).toBe('remote_receive');
    expect(editor.snapshot.entities.entity_receive.name).toBe('原面板修改的名称');
    expect(editor.snapshot.entities.entity_receive.externalRef?.version).toBe(2);
    expect(editor.canUndo).toBe(false);
    expect(
      backend.calls.filter((call) => call.method === 'POST').map((call) => call.action),
    ).toEqual(['saveFlowDiagramRelation']);
  });

  it('引用活动先选择目标，再将关联信息交给原业务创建接口', async () => {
    const backend = new FakeCoopwire();
    const registry = createShapeRegistry();
    const session = new CoopwireSession(
      new CoopwireApi(testConfig, backend.fetch.bind(backend) as typeof fetch),
      registry,
      async () => new Blob(['png-test'], { type: 'image/png' }),
      new MemoryJournal(),
    );
    const editor = new Editor(await session.open(), registry);
    editor.attachTransport(session);
    const operation = editor.createNode('activity', 100, 45, 'lane_ops');
    if (operation.type !== 'node.create') throw new Error('创建操作无效');
    operation.entity.activityType = 'linked';
    operation.entity.details = {
      linkFlow: 'other_flow',
      linkAct: 'other_activity',
      showOrgName: true,
    };
    await editor.submit({
      commandId: 'create_linked',
      expectedRevision: editor.snapshot.revision,
      origin: 'user',
      label: '添加引用活动',
      operations: [operation],
    });
    const creation = backend.calls.find((call) => call.action === 'addActs')!;
    expect(creation.body).toMatchObject([
      {
        actType: 'linkAct',
        linkFlow: 'other_flow',
        linkAct: 'other_activity',
        showOrgName: true,
      },
    ]);
  });

  it('外部表单后的流程保存失败时保留原画布并阻止继续提交', async () => {
    const backend = new FakeCoopwire();
    const registry = createShapeRegistry();
    const session = new CoopwireSession(
      new CoopwireApi(testConfig, backend.fetch.bind(backend) as typeof fetch),
      registry,
      async () => new Blob(['png-test'], { type: 'image/png' }),
      new MemoryJournal(),
    );
    const editor = new Editor(await session.open(), registry);
    editor.attachTransport(session);
    const before = editor.snapshot;
    backend.activities.get('remote_receive')!.activity.version++;
    backend.fail = { action: 'saveFlowDiagramRelation', kind: 'rejected' };
    await expect(
      editor.synchronizeExternal((document) =>
        session.refreshActivities(document, ['remote_receive']),
      ),
    ).rejects.toThrow('业务拒绝');
    expect(editor.snapshot).toBe(before);
    expect(editor.busy).toBe(false);
    await expect(
      editor.synchronizeExternal((document) =>
        session.refreshActivities(document, ['remote_receive']),
      ),
    ).rejects.toThrow('存在未完成保存');
  });

  it('阶段为一个有独立 ID 的组合节点，水平和垂直方向保留标题和虚线', () => {
    const registry = createShapeRegistry();
    const editor = new Editor(emptyDocument(), registry);
    for (const type of ['stage-horizontal', 'stage-vertical']) {
      const operation = editor.createNode(type, 0, 0);
      editor.dispatch('添加阶段', [operation]);
      if (operation.type !== 'node.create') throw new Error('创建操作无效');
      const parts = nodePresentation(editor.snapshot, operation.node, registry).parts;
      expect(parts[0].text).toContain('阶段');
      expect(parts.some((part) => part.key.startsWith('line-'))).toBe(true);
    }
    expect(Object.keys(editor.snapshot.nodes)).toHaveLength(2);
  });

  it('旧流程的阶段标题条和装饰虚线合并为单个节点', () => {
    const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="stage_h" value="需求阶段" style="shape=step;barStep;fillColor=#1ba1e2;fontColor=#ffffff;" vertex="1" parent="1"><mxGeometry x="20" y="30" width="150" height="42" as="geometry"/></mxCell>
      <mxCell id="line_h" style="endArrow=none;barArrow;dashed=1;" edge="1" parent="1" target="stage_h"><mxGeometry relative="1" as="geometry"/></mxCell>
      <mxCell id="stage_v" value="交付阶段" style="shape=vstep;horizontal=0;fillColor=#1ba1e2;" vertex="1" parent="1"><mxGeometry x="400" y="30" width="50" height="150" as="geometry"/></mxCell>
      <mxCell id="line_v" style="endArrow=none;vbarArrow;dashed=1;" edge="1" parent="1" target="stage_v"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const result = readFlow(
      { id: 'flow_test', name: '旧流程', version: 1, drawioXml: xml },
      createShapeRegistry(),
    );
    expect(Object.values(result.document.nodes).map((node) => node.type)).toEqual([
      'stage-horizontal',
      'stage-vertical',
    ]);
    expect(Object.keys(result.document.edges)).toHaveLength(0);
  });
});

# Coopwire 远程业务接入

## 已实现的链路

顶部「连接 Coopwire」填写接口地址、projectId、flowchartId 和 flowchartType，连接时读取现有流程及组织角色。连接后，界面编辑、画布手势和 Agent apply 都经过 `Editor.submit → CoopwireSession → CoopwireApi`。

编辑器先在副本中校验最终文档，再读取流程/活动版本，提交业务变化，最后保存流程 XML、关系数据和真实渲染的 PNG。收到保存确认后，才更新本机业务文档和撤销历史。请求期间禁用画布编辑，其他提交被明确拒绝，避免业务请求重叠。

业务实体的 `externalRef` 保存 `provider: coopwire`、真实活动 ID 与活动 version；本机节点 ID、实体 ID 与远程活动 ID 各自独立。普通 UI/Agent 命令不能替换已有业务引用，也不能通过创建节点注入任意远程 ID。

## 沿用的接口

`{portrait}` = `/rest/quality/investigate/portrait/p/{projectId}`，`{scopeDefine}` = `/rest/quality/investigate/scopeDefine/p/{projectId}`。

| 操作          | 请求                                                        | 关键参数与格式                                                                                |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 组织字典      | GET `/rest/quality/investigate/scope/p/{projectId}/qryOrgs` | 按 index 排序，用 orgId/orgName 绑定泳道                                                      |
| 流程详情      | GET `{scopeDefine}/qryFlowDiagramDetail`                    | `id=flowchartId&showSimple=true`，读取 version、XML 与 flowObj                                |
| 活动详情      | GET `{portrait}/queryActDetail`                             | `actId`，保留实体版本与复杂 IO 原字段                                                         |
| 创建活动      | POST `{portrait}/addActs`                                   | JSON 单条数组，客户端分配稳定 24 位十六进制 ID，actName、actType、orgId、belongId、belongType |
| 复制活动      | POST `{portrait}/copyAct`                                   | `[{id,name}]`，读取真实新活动 ID；不靠模型 CHANGE 扫描补救                                    |
| 修改活动      | POST `{portrait}/updateAct`                                 | query: actId、version、updateDrawio、ignoreNameCheck；JSON 中仅发送变化的业务字段             |
| 活动描述      | POST `{portrait}/updateActDetailDesc`                       | multipart `data` JSON Blob；query 带 actId、version、orgId                                    |
| 保存 IO       | POST `{portrait}/saveIoput`                                 | multipart `data` JSON Blob，保留已有 IO 的 id、附件等复杂字段                                 |
| 删除 IO       | POST `{portrait}/delIoput`                                  | query: actId、version、ioputId、updateDrawio=false                                            |
| 保存图形/关系 | POST `{scopeDefine}/saveFlowDiagramRelation`                | multipart `file` 为实际 PNG，`data` 为 JSON Blob，含 flowDiagramId、version、drawioXml、data  |
| 删除图形      | 上述完整流程关系保存                                        | 从 acts/nodes/edges 中移除关联；**不调用 portrait/delAct 永久删除业务活动**                   |

创建时 `belongType = flowchartType + 'Act'`。调色板的四个活动入口分别映射 manualOnline、manualOffline、systemOperate、interfaceDocking；判断、子流程、并行分别映射 decide、subAct、parallel。引用活动先通过原 `addLinkActForm` 选择目标，再在创建载荷中传入 linkFlow、linkAct、showOrgName。复制旧活动保留原类型和富文本。

泳道组织选择使用真正的 roleIds 数组。角色变化通过活动更新和流程关系一起提交。仅移动位置、改变颜色或改连线时，不更新无关业务活动。真实详情接口的组织字段为 orgRelation；适配器以文档原/新角色归属比较变化，不因响应中没有 orgId 就反复写入全部活动。

文本输入输出编辑按原记录位置匹配，保存时保留原 IO 对象的其他字段；新增简单文本 IO 使用 `formatType: text`、`dataObjectType: text`。完整业务编辑由嵌入的原 `UserPortrait` 和引用活动表单承担。原组件保存后只刷新该活动并同步流程关系，不重复提交业务字段。现有富文本描述仅在用户明确通过基础属性编辑描述时写入纯文本版本；单纯复制、拖动、换色不会覆写它。

画布标题保存在规范化元数据中；当前不调用缺少完整参数契约的 editFlowDiagram 重命名后端流程列表条目。

## 鉴权与部署

复制 `.env.example` 为 `.env.local` 填写非敏感的 VITE_COOPWIRE_* 配置。此工作区已经填入本次用户提供的项目和流程配置，文件被 Git 忽略。

### 同域生产部署

将编辑器与 Coopwire 的 `/rest` 放在同域代理之后，前端接口地址留空或填写 `/rest`。也支持完整后端地址（例如 `https://your-coopwire.example` 或 `https://your-coopwire.example/rest`）；自动去掉尾部的 `/rest` 与斜杠，再统一拼接业务路径，登录刷新使用同一规则，避免 `/rest/rest`。接口地址不能包含用户名、密码、查询参数或片段。HTTP 请求使用 `credentials: include` 和 `x-logwireCloud-resource: drawio`，无需把 Cookie 放进浏览器 JavaScript、JSON 文档或 localStorage。

如果宿主用请求头鉴权，可以在受信任的宿主集成代码中调用：

```ts
import { configureCoopwireAuth } from './src/adapters/coopwire/api';
configureCoopwireAuth({
  headers: async () => host.getRequestHeaders(),
  refresh: async () => host.refreshLogin(),
});
```

只有业务响应明确返回 `code=1002` 时，才向 `/rest/platform/refreshToken` 发送带 Cookie、JSON Content-Type、空请求体的 POST，成功后重发一次；网络错误、超时和 5xx 不会自动重发业务写入。401/403、409、非零业务 code、部分批量成功 code、错误响应结构均作为失败处理。嵌入面板的部署与源地址配置见[业务图形详情](activity-details.md)。

### 本机开发代理

浏览器不能通过 fetch 设置任意 Cookie。Vite 支持服务器端开发代理：

```dotenv
COOPWIRE_TARGET=https://your-coopwire.example
COOPWIRE_SESSION_FILE=/absolute/private/coopwire-session.json
```

鉴权文件仅保存在本机、Git 外，内容为 JSON `{ "cookie": "..." }`，权限设为 600。不要给密钥变量添加 VITE_ 前缀。代理在每次转发时读取会话文件中的 Cookie，仅附加到转发请求；刷新接口成功返回的新 Cookie 原子更新到该私有文件，不会下发到本机页面。本项目 dev 监听 127.0.0.1；开发代理不作为公开部署服务器。

测试与源码不包含本次用户的 Cookie。实际鉴权文件位于临时目录，过期后替换文件即可，无需重启 dev。仅更新 access_token 时应移除已过期的 GSESSION 等旧登录字段，避免它们优先参与鉴权。生产环境应使用现有宿主的会话与反向代理，不部署这个开发鉴权文件。

## 失败、去重与恢复

旧后端提供多个独立 HTTP 接口，没有可证明的跨接口原子事务或复制幂等键。因此不能承诺“本机没更新就表示服务器完全没变化”。

`CoopwireSession` 在本机维护按环境/项目/流程隔离的事务记录，记录原命令、目标文档、已确认步骤与响应。记录中不含鉴权信息。

- 相同命令在当前 Editor 中并发提交，只发送一次，返回同一结果。
- 创建使用稳定客户端 ID；复制使用服务器返回的独立 ID。
- 某步骤被明确拒绝时，本机文档不提交，事务记录保留。点击「重试上次操作」只继续未确认成功的步骤，已确认的 copy/create 不再执行。
- 超时、网络中断、5xx 或错误协议导致写入是否生效不确定时，停止重发。界面提供「读取远端核对」，不会盲目再次复制。
- 刷新后发现未完成记录，不自动回放。明确重新读取远端后，保留原事务的 recovery 备份，按服务器当前状态继续编辑。
- 删除图形仅删除流程关联。撤销/重做也要经过远程提交；恢复删除关联或重做创建会重用已知活动身份，不创建第二份业务对象。
- 流程版本和活动版本在提交前检查，每次业务请求使用当前版本。并发修改会拒绝写入或令流程保存失败，需要重新加载核对。

多个独立客户端仍可能在“业务更新完成、流程保存之前”竞争；本机日志不能提供分布式锁或跨接口回滚。若要求跨客户端严格原子性和永久幂等，应在 Coopwire 后端增加统一 command endpoint、持久幂等 receipt 与事务/outbox。这是旧接口能力的边界，不是用前端重试可以弥补的功能。

## 旧 XML 与数据保留

`readFlow` 支持本次流程涉及的水平/垂直泳池、归属泳道、四类活动、引用活动、判断、子流程、并行、开始/结束、阶段标题条与装饰虚线、描述附属框及可映射连线。水平/垂直泳池的方向和泳道归属被保留，泳道尺寸适配当前布局约束，活动内部 Cell 合并为一个业务节点。无法识别的业务图形、未知顶点、非法端点和压缩/非法 XML 会停止加载，保留当前画布，避免静默丢数据。

发现只在 flowObj 中存在、XML 中不存在的活动时，会保留一个待核对节点并读取其真实业务详情。已知 `#active-edge#` 无终点装饰标记不转成业务连线，界面显示迁移说明。

首次转换会把原始 XML 作为 `diagramlyLegacySource` 属性备份进保存后的 XML；后续保存复用原备份，不递归膨胀。连接配置面板提供「下载原始 XML」。新 XML 同时包含标准 mxCell 渲染与 `diagramlyDocument` 规范化元数据，下次直接恢复文档。

该兼容层不承诺旧 draw.io 业务插件的全部编辑能力和像素级排版一致；复杂 stencil、多页与富文本完整编辑仍需专门迁移。当前 JSON 导出仅导出规范化文档，原始 XML 通过上述独立按钮备份。

## 验证范围

2026-10-29 使用用户最新提供的 Cookie 再次做了真实只读核对：组织接口返回 40 条记录，目标流程 version 28、4 个关联业务活动，抽样活动详情可读取；旧 XML 中包括 manualOnline、subAct、interfaceDocking。会话有效，因此没有调用刷新接口；没有向目标环境发出业务写请求。

写操作使用隔离的 Coopwire 契约测试验证，包括创建、复制、修改、描述/IO、多步骤失败续传、响应丢失后的停止重发、版本冲突、恢复记录、远程撤销重做和 Agent。浏览器测试实际走 fetch、真实 XML 编码与 SVG → Canvas → PNG → multipart 上传链路，但 `/rest` 请求全部由测试后端拦截，无法修改真实项目。

运行 `npm test`、`npm run test:e2e` 和 `npm run build`。测试使用虚构业务数据，不保存本次真实流程内容或鉴权信息。

活动画像的新增字段、增量更新和时间范围专用接口见 [业务图形详情](activity-details.md)。使用本机代理已只读验证实际流程及活动详情，以及应用、设备、流程、终端、操作方式选项；编辑与撤销的业务写入通过隔离后端测试，不会修改测试环境现有业务数据。

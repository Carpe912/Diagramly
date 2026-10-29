# 业务图形详情与原前端联动

仅 `flowchart=1` 的 Coopwire 远程画布显示业务详情。节点要有已确认的 `externalRef.id` 和可读取的活动详情；本机示例、开始结束、泳池泳道及无业务 ID 的节点不显示详情标签。点击有业务详情的节点时，右侧自动打开原有表单。

## 保留原业务表单

Diagramly 不再维护一套简化的活动表单。右侧 iframe 加载 `coopwire-frontend` 的 `/enterprise/diagramly/portrait/:projectId`，入口按活动类型加载原有 `UserPortrait/index.vue` 或 `linkActDetail.vue`。原组件继续负责活动类型对应的字段、关联业务、字典、弹窗与专用接口。嵌入时传入 `actId`、`pid`、`flowId`、`businessId` 和流程图模式；不引入旧画布的锁功能。

父子页面使用固定频道、会话 ID、活动 ID、请求序号以及严格的窗口来源与 Origin 校验。只接受当前选中活动的响应。原组件完成首次读取后发送 `loaded`；保存后发送 `changed`。Diagramly 根据活动 ID 重新读取最新版本和名称等投影字段，再保存流程 XML、关系与 PNG。原组件已完成业务写入，画布同步不会重复调用 `updateAct`。同步成功后清空旧撤销历史，避免旧快照覆盖表单刚保存的数据。

引用活动创建先在原前端的 `addLinkActForm` 选择其他流程与活动，再将 `linkFlow`、`linkAct`、`showOrgName` 一同交给 `addActs`。原表单中的关联流程预览继续调用原前端的 `DrawPreview`。

## 图形库

人工线上、人工线下、系统操作、接口分别显示为独立入口，内部共用 `activity` 节点与三段式投影；其业务类型分别是 `manualOnline`、`manualOffline`、`systemOperate`、`interfaceDocking`。判断、子流程、并行保留独立节点类型；引用活动在选择目标后生成 `linkAct`。开始、结束、定向连接器和水平／垂直阶段位于同一业务调色板。阶段是一个带稳定 ID 的组合节点，旧 XML 中的标题条和装饰虚线会合并导入。

## 部署与鉴权

需要同时部署 Diagramly 和修改后的 `coopwire-frontend`。同域部署时保持 `VITE_COOPWIRE_FRONTEND_ORIGIN` 为空；跨源部署时填原前端源地址，并在原前端构建环境设置 `VUE_APP_DIAGRAMLY_EMBED_ORIGINS` 为允许嵌入的 Diagramly 源地址，多个源用逗号分隔。部署时需确认反向代理与 CSP 允许该页面作为 iframe 加载。

浏览器请求沿用 Coopwire Cookie。业务响应明确返回登录过期码时，编辑器按原前端契约向 `/rest/platform/refreshToken` 发送空体 POST，刷新后最多重试一次；网络不确定的业务写入不自动重试。Cookie 和令牌不放入仓库、URL、文档或 iframe 消息。

原组件保存和流程关系保存分属不同接口，后端没有跨接口事务。流程保存失败时，提示用户读取远端核对，原业务表单的修改仍可能已经生效。参见 [远程业务接入](coopwire-integration.md)。

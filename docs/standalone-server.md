# 独立服务改造

第一阶段提供 JSON 文档后端，使用 PostgreSQL JSONB 保存标准文档，不写 XML，不创建 Coopwire 活动。

## 接口

- GET /api/health：服务进程健康检查，暂不代表数据库状态。
- GET /api/documents：文档列表。
- GET /api/documents/:id：文档内容和服务端版本。
- PUT /api/documents/:id：提交 document 和 expectedRevision。新建传 0，冲突返回 409。

除健康检查外，接口使用 HTTP Basic 鉴权，账号由 DIAGRAMLY_CREDENTIALS 指定。对外部署必须先配置 HTTPS；这是单账号初始实现，不是多人账号体系。

## 本地部署

在未提交的环境文件中配置 POSTGRES_PASSWORD 和 DIAGRAMLY_CREDENTIALS（用户名:密码），然后运行 docker compose --env-file <环境文件> up --build -d。

前端入口为 8080，API 和数据库不暴露主机端口。密码涉及 DATABASE_URL 时需进行 URL 编码，建议初始密码使用较长的随机字母数字字符串。数据库使用持久卷；上线前需要另行配置备份与恢复流程。

## 当前边界

编辑器顶部的文档库入口可以登录、新建和打开服务端文档。打开后自动保存 JSON，IndexedDB 按文档 ID 保留副本。登录凭证仅保存在内存，刷新后需重新登录。保存失败或冲突后停止远程写入，需重新打开并核对本机草稿，不会盲目重试覆盖。

开发时分别启动 npm run server 和 npm run dev；Vite 的 /api 默认代理到 127.0.0.1:3000，可用 DIAGRAMLY_API_TARGET 配置。旧 Coopwire 自动连接与界面入口已停用，历史适配器尚待删除。尚未实现离线草稿合并、完整账号体系和版本管理，也尚未在目标服务器部署验证。

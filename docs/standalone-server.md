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

## 当前服务器部署

服务器使用现有 Node 20、PostgreSQL 和 Nginx，通过 systemd 管理 diagramly 服务（未安装 Docker）。部署目录 /opt/diagramly/current 指向 releases 内的发布目录，服务用户为 diagramly，API 仅监听 127.0.0.1:3091。

站点路径 /diagramly/，构建命令：DIAGRAMLY_BASE=/diagramly/ VITE_API_BASE=/diagramly/api npm run build。Nginx 配置模板见 deploy/diagramly-location.conf，systemd 模板见 deploy/diagramly.service。独立数据库及角色均为 diagramly，不复用其他应用的业务库。

环境配置 /opt/diagramly/service.env 与初始登录信息 /opt/diagramly/login.txt 仅 root 可读，不上传至源码仓库。更新时上传新发布目录、安装依赖、切换 current 链接并重启 diagramly；需要回退时将 current 切回上一发布目录。数据库备份与结构迁移必须另行管理，不通过切换代码版本回退数据库。

### 首次部署验证结果

已在服务器验证进程运行、Nginx 本机 HTTPS 路由返回 200、PostgreSQL JSON 创建与读取、版本冲突 409 和未登录访问 401，临时验证文档已清理。

原 sunlingyue.cn 证书于 2026-10-03 过期。尝试独立 Certbot HTTP 验证时，CA 两次收到 403；服务器本机验证路径正常。未替换原证书，公网 HTTPS 仍待修复和验收。新证书需通过可用的 HTTP 验证或 DNS 验证签发后再配置，不建议绕过浏览器证书校验输入登录凭证。

### IP 访问与文档回收站

当前入口为 http://47.116.6.132/diagramly/，按用户要求暂停证书处理。IP 入口为 HTTP，不具备传输加密。文档库支持搜索、复制、移入回收站及恢复；软删除和恢复均进行版本比较，已删除文档不能继续被自动保存覆盖。上线前已在 /opt/diagramly/backups 创建数据库备份，暂未配置定时备份。

# 独立服务与运维

入口：http://47.116.6.132/diagramly/。按用户要求使用 IP 和 HTTP，暂不处理证书。前端与 API 同域，数据库不暴露公网。

## 数据与账号

PostgreSQL JSONB 是图形、活动表单和关联 ID 的主存储，XML 仅用于文件交换。文档写入携带 expectedRevision，冲突返回 409；当前文档与历史快照在同一事务中提交。恢复历史会创建新版本，不覆盖历史内容。命名版本支持为某一快照添加说明。

账号保存加盐 scrypt 密码摘要。DIAGRAMLY_CREDENTIALS 仅用于空账号库的初始管理员创建；修改密码后，旧环境密码不能绕过数据库鉴权。管理员管理账号与所有业务数据，编辑者可维护文档、目录和讨论，只读用户只读并可修改本人密码。当前权限范围为整个工作空间，不含文档级授权。不可停用或降级最后一个有效管理员。

浏览器凭证仅驻留内存，刷新后重新登录。IndexedDB 按文档 ID 保留草稿；远程保存失败或冲突后停止写入。重开时可选择服务器版本，或者将不同的本机草稿另存为新文档，不自动合并。

## API 分组

- /api/health：公开进程健康检查，不代表数据库健康。
- /api/session、/api/users、/api/password：会话身份、管理员账号管理、本人密码。
- /api/documents：文档列表及 JSON 读写；/:id/lifecycle 管理回收站；/:id/versions 查询快照；/:id/versions/:revision/name 命名；/:id/restore 显式恢复。
- /api/business/:kind：角色、应用、设备、操作方式、终端、接口、数据对象、表、单证、需求与待办。编辑和删除校验版本。
- /api/attachments：上传、列表、下载和删除；每文件最大 6MB，当前存储于 PostgreSQL。历史或业务引用仍存在时禁止删除资源，避免恢复后引用失效。
- /api/documents/:id/discussions、/api/discussions/:id：图形锚点讨论、回复与解决状态；删除图形后保留讨论并标记失效锚点。

## 构建与部署

本地开发分别运行 npm run server 和 npm run dev；Vite 的 /api 代理默认到 127.0.0.1:3000，可设置 DIAGRAMLY_API_TARGET。构建环境需要 Node 22.12 以上；服务器运行现有 Node 20，仅运行 tsx 后端和构建产物。

生产构建：DIAGRAMLY_BASE=/diagramly/ VITE_API_BASE=/diagramly/api npm run build。

服务器以 systemd 管理 diagramly.service，用户为 diagramly，API 监听 127.0.0.1:3091。/opt/diagramly/current 指向 releases 中的发布目录。Nginx 配置为 deploy/diagramly-location.conf，不修改其他应用。

私有配置 /opt/diagramly/service.env 与初始登录信息 /opt/diagramly/login.txt 仅 root 可读，不进入源码仓库。更新前备份数据库，上传新发布目录并安装生产依赖，切换 current 符号链接后重启服务。代码回退不回退数据库；当前结构变更均为增量建表和加列。

## 备份与恢复

部署 deploy/backup.py、diagramly-backup.service 和 diagramly-backup.timer。每天北京时间 03:15 后五分钟内备份，保留十四天。归档放在 /opt/diagramly/backups，权限仅 root 可读；pg_dump 成功且 pg_restore --list 检查通过后才生成正式归档。

检查：systemctl status diagramly-backup.timer；手动运行：systemctl start diagramly-backup.service。失败时保留已有归档，可查看 journalctl -u diagramly-backup.service。

恢复演练应新建独立临时数据库，使用 pg_restore --exit-on-error --no-owner 还原归档，检查文档、版本、账号和附件表后删除临时库。不要直接覆盖线上库。正式灾难恢复需停写、保留故障库、还原至新库、校验后切换 DATABASE_URL。

备份目前与应用在同一服务器，尚未配置异机存储；Agent 功能不在本轮范围内。

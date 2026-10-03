# SenderMaster Ops

独立平台邮件运营后台。Next.js / TypeScript / Route Handlers / Prisma / PostgreSQL。仅通过签名内部 API 管理 robot_store；不访问业务数据库、不持有 AWS 凭证。商户登录不能用于此后台。

## 启动

1. 为本项目单独创建 PostgreSQL 数据库和仅能访问该库的角色。使用 `.env.example` 填写环境；开发环境 OPS_ORIGIN=http://localhost:3010。生产数据库权限不要复用业务账号。
2. `npm ci && npm run db:deploy`。生成 Ed25519 私钥放入 OPS_SIGNING_PRIVATE_KEY；公钥配置到 robot_store OPS_SIGNING_PUBLIC_KEY。配置独立随机 MFA_ENCRYPTION_KEY。
3. `npm run owner:init -- owner@example.com`（通过环境注入配置；此命令只允许空管理员表）。访问输出的一次性链接设置密码、验证器和保存恢复码。链接二十四小时有效。
4. `npm run dev`。生产使用 `npm run build && npm start`，只监听 127.0.0.1:3010。

服务端脚本不会自动读取 .env；生产由 systemd EnvironmentFile 注入。开发 CLI 可用 `node --env-file=.env --import tsx scripts/init-owner.ts email`。Next.js 会读取 .env.local。

## 权限与安全

OWNER 包括账号管理、恢复、释放/取消积压。OPERATOR 可查看、调额度、暂停和处理告警。VIEWER 仅读取。核心系统再次验证权限。敏感写操作要求五分钟内完成验证器校验；页面左下角“再次验证”。密码最少14字符，scrypt，TOTP 秘钥 AES-256-GCM 加密；验证码计数器防重放，恢复码只存摘要并原子消耗。密码+恢复码登录会撤销旧会话。

新账号经所有者创建，关闭公开注册。重置密码/验证器会撤销所有会话并重新发初始化链接；停用或修改角色也撤销会话。最后一名已激活所有者不可被停用、降权或重置。所有者丢失全部 MFA/恢复码时必须通过受审计服务器恢复流程，不提供公网绕过入口。受控服务器恢复命令：`npm run admin:recover -- EMAIL "事故编号与原因"`，会清空凭证并撤销会话，保留当前角色和停用状态，记录服务器操作者。

会话摘要存在独立数据库，8小时有效，生产 __Host- cookie，HttpOnly/Secure/SameSite=Strict。所有浏览器写入要求精确 Origin 匹配。登录及 MFA 使用数据库共享限速。管理员记录与业务操作记录分别保存在两个项目。内部接口协议在 contracts/protocol.md。

## 页面

运营概览、商户分页搜索/状态筛选、商户详情与发送设置、明确任务批次预览与审核、告警处理、业务操作记录、管理员与认证记录。页面没有演示商户或伪造指标；核心接口不可用时明确报错。恢复权限不会释放历史邮件，待审核批次15分钟有效。异步操作请在操作记录刷新实际结果。

## 契约、测试和发布

contracts/openapi.json 来自 robot_store/docs/ops/openapi.json。升级接口时一起更新契约并运行 `npm run contract:generate`。生成的 lib/api-types.ts 提供跨项目类型；`npm test` 验证密码、加密及命令契约。`npm run build` 做完整生产构建。

部署用 deploy/sendermaster-ops.service、nginx.conf、release.sh。独立仓库 CI 在 main 测试通过后自动部署 sendermaster-ops，只重启运维后台；不会部署或重启 robot_store。详见 [自动发布说明](deploy/README.md)。发布前先安装核心系统内部路径的公网 deny 规则，再确认 DNS/TLS 和服务端防火墙。只授予部署用户重启 sendermaster-ops 的 sudo 权限；不要授予读取 robot_store 环境的权限。数据库备份包含 MFA 密文和会话摘要，应与 MFA 密钥分开保管。

生产灰度、AWS 事件栈、迁移和回滚的唯一执行说明位于 robot_store/docs/ops/runbook.md。本地构建通过不等于已经上线；生产 IAM、SNS 订阅、DNS 证书与真实邮箱验收需要独立完成。

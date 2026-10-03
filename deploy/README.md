# 自动发布

推送 main 后执行契约检查、独立 PostgreSQL 测试库迁移、生产构建、真实 HTTP 认证/权限测试，再上传测试过的 Linux 构建产物并部署。PR 仅测试，无部署权限；Actions 也支持手动 Run workflow（main）。

唯一 Actions repository secret：`OPS_DEPLOY_SSH_KEY`，使用专门的 `sendermaster-ops-deploy` SSH 身份。密钥通过 forced command 只能调用固定发布程序，不能交互登录、传任意文件或重启其他项目。主机公钥固定于 known_hosts；主机密钥轮换时先核实指纹再更新。

生产环境文件固定在 `/etc/sendermaster-ops/environment`，包含独立数据库 URL、MFA 密钥和内部签名私钥，权限 root-only。数据库和 AWS 凭证不进入 GitHub。Node 22 运行时固定在 `/opt/sendermaster-ops/runtime/bin/node`。

安装时由 root 将 ci-dispatch.sh、release.sh 分别安装到 `/usr/local/sbin/sendermaster-ops-ci-dispatch`、`/usr/local/sbin/sendermaster-ops-release`；runtime-task.cjs 安装到 `/usr/local/libexec/sendermaster-ops-runtime-task.cjs`。这些 root-owned 管理程序不随普通应用发布更新；修改后需要审查并通过服务器管理身份安装。

应用目录采用 `/var/sofi/sendermaster-ops/current` 符号链接，产物位于 releases 子目录。第一版 flat checkout 保留为初始回滚目标。每次发布先备份独立数据库、执行兼容迁移，然后原子切换 current 并仅重启 sendermaster-ops。构建/迁移失败不切换版本；切换后进程、数据库或签名接口健康检查失败，自动切回上一版应用。数据库不会自动还原，新增迁移必须兼容旧版应用。保留最近五个产物目录及当前/上一个版本，数据库备份位于 `/var/backups/sendermaster-ops`。

查看版本：`cat /var/sofi/sendermaster-ops/.deployed-revision`；查看服务：`systemctl status sendermaster-ops`；查看发布审计：`journalctl -t sendermaster-ops-release`。发布锁和 Actions concurrency 防止同时切换；只接受发布时仍是远端 main HEAD 的提交。

服务环境和首次 OWNER 不会在发版时重建，管理员账号、验证器及已生效的商户规则保留。

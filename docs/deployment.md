# 部署、CI/CD 与备份

## 已配置的流水线

`CI and container release` 在 main 提交、版本标签和 PR 上运行：安装锁定依赖 → 类型检查与生产构建 → 业务与 API 测试 → 独立 PostgreSQL 存储测试 → 依赖审计 → Chromium 完整流程 → 上传测试报告。检查成功且不是 PR 时构建并发布 GHCR 镜像。

镜像：`ghcr.io/object-tao/imt:sha-<完整提交SHA>`；main 另有 latest，版本标签另有对应版本。Actions 固定到已核实提交 SHA，Dependabot 定期提出依赖与 Action 更新。

`Deploy an approved image` 支持手动选择 staging / production 及完整提交 SHA。服务器准备好后设置仓库变量 `AUTO_DEPLOY_STAGING=true`，即可在 main 的 CI 和镜像发布全部成功后自动部署 staging。正式环境可通过 GitHub Environment 配置审核者。未配置服务器时该工作流不会自动执行部署。

GitHub Actions 标准构建与 GHCR 发布使用仓库 GITHUB_TOKEN，无需用户把个人令牌交给应用。

## 环境未定时

当前不绑定付费服务器，不启用公共业务入口。可以在 Windows 本机运行 SQLite 完成验收。正式服务器和域名确定后再配置下述项目。

## 服务器一次性准备

1. Linux 主机安装 Docker Engine、Compose 插件及 HTTPS 反向代理，建议正式数据使用 PostgreSQL 17。
2. 在 `/opt/imt` 放置仓库的 `compose.yaml` 及 `deploy/deploy.sh`（改名为 `/opt/imt/deploy.sh`）。部署账户应有该目录和容器所需权限。
3. `/opt/imt/.env` 设置 AUTH_PASSWORD（至少 16 字符）、SESSION_SECRET（至少 32 随机字符）、COOKIE_SECURE=true，及可选 DATABASE_URL。文件权限 600，不纳入版本控制。
4. 反向代理 HTTPS 到 `127.0.0.1:3100`。Compose 只将应用端口绑定到服务器 loopback。未配置 HTTPS 的纯本机 HTTP 验收可设 COOKIE_SECURE=false。
5. 配置 GHCR 拉取权限。若镜像私有，在服务器执行 `docker login ghcr.io` 并使用只读 packages 权限；不要将令牌写入公开仓库。
6. GitHub Settings → Environments 分别创建 staging、production，设置 DEPLOY_HOST、DEPLOY_USER、DEPLOY_KEY、DEPLOY_KNOWN_HOSTS。主机公钥指纹通过可信渠道核对后写入，流水线不会自动信任 ssh-keyscan 的未核实结果。
7. 首次手动触发部署工作流，选已经成功发布镜像的提交。验证后再开启 AUTO_DEPLOY_STAGING。

部署文件通过 SSH 调用服务器脚本。脚本校验提交 SHA，加部署锁，拉取指定镜像，更新应用并轮询容器健康；失败时尝试恢复上一镜像。数据库迁移自动执行，未来引入不兼容迁移时必须额外准备数据库回退，不能只依赖应用镜像回滚。当前未实现零停机蓝绿发布。

## 数据和备份

SQLite 数据在 Docker 命名卷 imt-data；本地为 data/imt.sqlite。数据库与容器分离，重建镜像不删除数据。

本地执行 `npm run backup`，通过 SQLite 在线备份 API 保存到 backups/。恢复：停止应用，保留原数据库备份，将备份替换 DATABASE_FILE 所指向文件；确认旧 WAL / SHM 不会混入（停机后将整组旧数据库文件移到另一目录），再启动核对资源与方案。

PostgreSQL 使用 `pg_dump` / `pg_restore`，应配置独立备份位置、保留期及恢复演练。应用当前提供 SQLite 手动备份命令；尚未安排定时备份及异地存储，需根据服务器落实。

资源 JSON 导出可用于基础资料交换，但不包含全部需求记录、方案版本、会话和审计，不能替代数据库备份。

## 安全与运行边界

单一公司共享访问密码；会话保存在数据库中，8 小时过期，退出后撤销。生产和非本机监听必须配置密码及会话密钥。会话 Cookie 为 HttpOnly、SameSite=Strict；生产 HTTPS 应开启 Secure。

资源变更记录审计事件，但共享密码没有个人操作人身份，不应当作完整的人员审计。角色与账号管理按用户要求留待后续。

跨来源写请求被拒绝；输入由 Zod 校验；数据库参数化查询；不自动加载真实业务资料。传输方案属于辅助规划，危险品或大件的实际许可、承运能力及运力需业务人员确认。

# IMT · 多式联运方案工作台

公司内部使用的中国跨境进出口运输方案系统。维护分段资源，录入城市级运输需求，自动拼接公路、铁路、航空、海运及接驳线路，比较参考费用与交期。支持多组货物、特殊货物适运条件、方案调整、版本快照及 Word / PDF 输出。

当前交付为一期可验收版本，使用真实资料完成业务验收后再用于正式报价。仓库公开，不应提交真实供应商、运价、客户信息、数据库或密钥。

## 本机启动（Windows）

要求 Node.js **24.14 或以上的 24.x**。本项目本地路径：`D:\CodexSessionArchive\IMT\repo`。

```powershell
Set-Location D:\CodexSessionArchive\IMT\repo
$env:npm_config_cache = 'D:\CodexSessionArchive\npm-cache'
npm ci
npm run geo:sync
npm run build
npm start
```

打开 http://127.0.0.1:3100 。默认只监听本机地址，数据库在 `data/imt.sqlite`，不自动导入示例数据。可点击「载入示例数据」体验上海至伦敦的航空、海运、铁路方案。示例全部虚构且只能载入空库。验收真实资源时使用新的空数据库；勿把示例运价用于业务。

开发模式：`npm run dev`，打开 http://127.0.0.1:5173 。若需要配置，复制 `.env.example` 为 `.env`；启动脚本自动加载。开发代理端口默认 3100，修改后同时修改 `vite.config.ts`。

也可运行 `scripts/start-local.ps1`，或项目上级目录的 `启动IMT.cmd`。依赖缓存及构建均保留在 D 盘；这些设置不迁移 Codex 自身聊天记录及应用缓存。

## 业务操作

1. 在「资源网络」录入供应商和运输节点。先选国家，再从全球城市库中选择具体城市；机场、仓库等节点使用准确的 IANA 时区。
2. 录入分段线路，选择起止节点、供应商、运输耗时、处理时间、班期、承运限制及有效期。
3. 录入线路运价及汇率。城市级端点请建立「城市覆盖点」并维护到货站等节点的资源，以免省略提货或派送。
4. 在「方案工作台」选择起运国家／城市及目的国家／城市，填写时间及逐件货物明细，生成候选方案。
5. 查看方案的分段费用、服务范围与待确认事项，可替换、增加、删除运输段后重新校验。
6. 保存方案，在「方案档案」查看版本，导出内部版或客户版。客户版隐藏供应商列和内部备注。
7. PDF 通过「打印 / PDF」打开专用打印页面，再用浏览器「另存为 PDF」。已提供 A4 横向打印样式；Word 为真实 `.docx` 文件。

8. 在「陆运距离与时效」查询城市间货车公路里程、单驾及双驾时效；独立于供应商线路。国内高德、美国和欧洲 HERE Truck 接入已预设，需开通自己的服务账户并执行 `npm run road:configure` 录入密钥、重启应用后查询；详见 [陆运服务开通与测算规则](docs/road-routing.md)。

详细约定见 [需求基线](docs/requirements.md)、[运算规则与边界](docs/engine.md)、[导入指南](docs/import.md)、[全球地名库](docs/geography.md)、[部署与回滚](docs/deployment.md)。

## 技术结构

- `src/`：React + TypeScript 操作界面，Vite 构建。
- `shared/`：Zod 数据契约、纯函数方案引擎、十进制计价、时区与 CSV 处理。
- `server/`：Fastify API、参数校验、事务资源存储、乐观并发控制、访问会话、审计、文档输出。
- `tests/`：业务和接口测试，以及 Playwright 浏览器完整流程。
- `.github/workflows/`：提交检查、PostgreSQL 验证、浏览器验证、容器发布与可配置部署。

默认 SQLite 适用于本机和小型内部单实例验收；正式多人环境优先设置 `DATABASE_URL` 使用 PostgreSQL。两种实现共用参数化查询及存储接口，数据库通过幂等迁移初始化。PG 资源修改使用事务锁以保持关联校验一致性。角色与部门权限不在本期范围。

## 验证

```powershell
npm test
npm run build
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\CodexSessionArchive\playwright-browsers'
npx playwright install chromium
npm run test:e2e
npm audit --audit-level=high
```

CI 使用独立 PostgreSQL 测试数据库验证持久化，API 测试还会验证 SQLite。`TEST_DATABASE_URL` **只能指向可清空的测试库**，测试会清理其资源及方案表。

陆运成功查询会保存到业务数据库，重复条件直接复用，应用重启后仍有效；改变驾驶和等待参数只重新计算时效。数据库记录会标明原始查询时间，历史驾驶耗时不代表实时路况。数据库备份同时包含已保存陆运路线。

正式部署前必须设置访问密码、会话密钥、HTTPS、持久存储、备份，并使用真实资源完成业务验收。生产入口在配置缺失时拒绝启动。部署步骤及当前边界见部署文档。

# CodexBridge Storage Migration Decision

日期：2026-06-22

## 目标

这份文档定义什么时候继续使用 JSON / JSONL，什么时候迁移到 SQLite，什么时候再迁移到 Postgres。

当前原则：

- 私有 beta 和单机小规模运营可以继续使用 JSON / JSONL。
- 需要可靠并发、查询、对账、备份恢复时迁移到 SQLite。
- 需要多节点、多人运营后台、托管服务或跨机器 worker 时迁移到 Postgres。

## 继续使用 JSON / JSONL 的条件

全部满足时可以继续使用当前文件存储：

1. 单机部署。
2. 单个 bot 或少量 bot。
3. 同时只有一个 bridge runtime 写入同一个 bot home。
4. Web operator 只有 1-2 人。
5. 用户量仍是小规模私有 beta。
6. usage ledger、runs、conversation log 主要用于排障，不承担正式财务对账。
7. 可以接受本地文件备份和手工恢复。

当前已满足的保护：

- credits 写入有文件锁。
- state migrations 有文件锁。
- Web 已显示 Storage Readiness。
- Web 可直接执行 state migrations。
- Web migration 执行写入 admin audit。
- 已有 `storage.provider = json | sqlite` 配置入口，默认仍为 `json`。

## 必须迁移到 SQLite 的触发条件

出现任意一项，就应该启动 SQLite 迁移：

1. 同一个 bot 有多个写入入口频繁并发写：Telegram、飞书、Web、CLI 同时活跃。
2. users、credits、usage、runs、conversation logs 的查询开始变慢或需要复杂筛选。
3. 需要稳定对账：paid credits、refund、adjustment 不能只靠 JSONL 人工排查。
4. 需要自动备份、恢复、校验和修复工具。
5. 需要 admin audit、usage ledger、runs 做跨表查询。
6. 单个 bot 的 JSONL 日志达到明显维护成本，例如需要频繁截断、归档或手动搜索。
7. 计划接入自动支付或订单系统。

SQLite 第一阶段只迁产品状态，不迁 workspace 文件。

优先迁移表：

1. `users`
2. `credit_accounts`
3. `usage_events`
4. `runs`
5. `admin_audit_events`
6. `conversation_events`
7. `conversation_review_events`
8. `state_migrations`

## 必须迁移到 Postgres 的触发条件

出现任意一项，就不应该继续停留在 SQLite：

1. 多台服务器或多 worker 同时写入。
2. 需要托管服务给多个 operator 或多个客户使用。
3. 需要集中权限、审计、报表和支付对账。
4. 需要把 CodexBridge 变成长期运行的服务，而不是单机 owner 自用工具。
5. 需要跨区域备份、监控、读写隔离或外部 BI 查询。

Postgres 阶段可以继续保留本机 workspace 文件，但产品状态必须集中化。

## SQLite 迁移执行顺序

1. 已完成：增加 `storage.provider = json | sqlite` 配置，但默认仍为 `json`。
2. 下一步：为 repository 增加 SQLite adapter，保持现有 service API 不变。
3. 增加只读校验命令：读取 JSON / JSONL，生成 SQLite shadow copy，并校验 counts 和 totals。
4. 增加正式迁移命令：写入 SQLite，记录 migration state。
5. 补强 Web Storage Readiness：显示 schema version、pending migrations、校验结果和 provider 切换风险。
6. 灰度：单 bot 切 SQLite，观察 usage、runs、refund、conversation review 是否一致。
7. 稳定后再考虑把新 bot 默认 provider 改成 SQLite。

## 不迁移的内容

短期不迁移：

- workspace 文件
- 上传附件
- runtime log
- bridge log
- Codex session 本身

这些仍保留在 bot home 文件系统里。数据库只存产品状态和索引。

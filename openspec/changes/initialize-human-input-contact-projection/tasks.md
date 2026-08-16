## 1. 初始化契约与失败测试

- [ ] 1.1 盘点现有 Contact Directory identity、ownership、normalized Email、repository 与 database constraint 路径，明确初始化命令必须复用的 primitives。
- [ ] 1.2 添加失败的 domain/repository tests，证明 source-backed Contact uniqueness 与 External Contact normalized Email uniqueness 相互独立，并覆盖 internal/external same-email 共存和并发写入。
- [ ] 1.3 添加失败的 command tests，覆盖默认 dry-run、显式 `--apply`、immutable page Plan/Apply、stable keyset pagination、page-local transaction、安全重跑与最终 exit status。
- [ ] 1.4 添加 architecture tests，证明 HTTP reads、manual sync、provider adapters 与 lifecycle maintenance 均不能调用 initialization composition root。

## 2. Contact 唯一性对齐

- [ ] 2.1 对齐 Contact Directory domain 与 repository predicates，使 source-backed identity 按 authoritative source 保持唯一，normalized Email conflict 只比较同一 workspace 的 External Contacts。
- [ ] 2.2 调整 SQLAlchemy constraints 与对应 database migration，使 persistence 强制执行与 domain layer 一致的 internal/external collision policy。
- [ ] 2.3 添加 focused migration/repository coverage，覆盖已有 duplicate blocker、同 workspace 冲突、跨 workspace 隔离以及并发 create/reuse。

## 3. Page Plan/Apply 命令

- [ ] 3.1 实现 eligible Account/member source reader，使用稳定 `(created_at, id)` keyset pages，并生成包含 action、expected values、object IDs 与 next cursor 的 immutable page Plan。
- [ ] 3.2 在 `api/commands/data_migrate.py` 注册 `flask data-migrate human-input-contacts`，默认 dry-run，只有显式 `--apply` 才允许 page commit。
- [ ] 3.3 每页只使用一个显式 transaction/session；Apply 只消费已物化的 Plan，dry-run 在 flush 后 rollback，apply 只在 commit 成功后输出 actual changes。
- [ ] 3.4 实现 page write failure recovery：rollback/close 整页，保留 failing record 与 Plan/cursor context，使用新 session 从已推导的 next cursor 继续，并在扫描剩余页面后返回 non-zero。
- [ ] 3.5 实现 source/page read failure handling：输出 last safe cursor、立即停止，并保持整条命令可安全从头重跑。

## 4. JSONL 审计与恢复语义

- [ ] 4.1 实现 JSONL writer，使 record、page、failure 与 summary event 仅暴露 mode、phase、cursor、action/outcome、可用 object IDs 和恢复所需的其他 non-PII facts。
- [ ] 4.2 明确区分 planned dry-run action、committed change、reuse/no-op、skipped page、rollback、write failure 与 read failure，禁止把 attempted write 报告为 committed fact。
- [ ] 4.3 添加 command tests，证明每一行都是独立合法 JSON，包含所需 ID/cursor context，不含 Contact PII，并保持确定的 recovery semantics。

## 5. 集成验证与发布

- [ ] 5.1 添加 PostgreSQL integration coverage，覆盖首次初始化、幂等重跑、internal/external same-email 共存、整页 rollback、后续页面继续、read fail-fast 以及无 IM identity/binding side effect。
- [ ] 5.2 运行 focused backend unit suites、database migration checks、formatter、type/lint checks 与 `openspec validate initialize-human-input-contact-projection --strict`。
- [ ] 5.3 记录版本升级顺序：复核默认 dry-run JSONL、处理 blocker、运行 `flask data-migrate human-input-contacts --apply`、保存 committed-change JSONL，并在 lifecycle maintenance ready 前保持 capability gate 关闭。
- [ ] 5.4 审计最终 dependency graph，确认该命令仍是 operations-only Contact Directory composition root，且不复制 ongoing write-through 或 periodic repair policy。

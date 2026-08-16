## ADDED Requirements

### Requirement: Contact initialization data migration MUST be explicit and idempotent

系统 MUST 在 `flask data-migrate` namespace 提供 `human-input-contacts` 运维命令，为已有 eligible Account/member 幂等创建或复用 source-backed Contact。命令 MUST 默认 dry-run，只有显式 `--apply` 才提交写入，并 MUST 允许整条命令安全重跑。该迁移 MUST NOT 读取 provider directory、创建 IM identity/binding，且 MUST NOT 由 HTTP、Contact read 或 manual IM sync 隐式触发。Ongoing Account/member write-through 与 periodic repair MUST 保持在独立 lifecycle owner 中。

命令 MUST 使用稳定 keyset cursor 将 source facts 分成小而有界的页面，MUST NOT 使用 offset pagination 或跨页持有 database transaction。每页 MUST 先生成 immutable Plan，再由 Apply 仅消费该 Plan 执行；Apply MUST NOT 重新读取 source facts 以重新规划 action。dry-run 与 `--apply` MUST 使用同一 page Plan/Apply path，其唯一 mode 差异 MUST 是页面 transaction 最终 rollback 或 commit。迁移 MUST 保持对象级 Plan/Apply flow 显式可读，MUST NOT 为消除少量重复而引入通用 migration framework。

Apply MUST 以单个 page transaction 执行该页全部 planned writes，MUST NOT 使用 nested transaction、savepoint 或 per-record commit。任一 record write、flush 或 commit failure MUST rollback 并关闭整页 transaction、记录已知 failing record 和完整 page Plan/cursor context、跳过该页，并以新 transaction/session 继续后续页面。只有 source/page read failure MUST 立即中止扫描；write failure MUST NOT 提前中止后续页面。完成扫描后若存在 read failure 或未收敛 write failure，命令 MUST 返回 non-zero exit status。

命令 MUST 只输出 JSONL，每行 MUST 是独立 JSON object。record/page event MUST 包含 mode、phase、cursor、action/outcome 及当前事实可用的 `tenant_id`、`account_id`、`member_id` 和 `contact_id`；其他字段 MUST 限于复核、恢复与定位失败所需的 non-PII data。dry-run MUST 输出 Plan records；`--apply` MUST 在页面成功 commit 后输出 actual-change records，failed/skipped/rollback 的 attempted writes MUST NOT 被标记为 changed。

#### Scenario: Dry-run previews initialization through the apply path

- **WHEN** an operator runs `flask data-migrate human-input-contacts` without `--apply`
- **THEN** each page MUST pass its immutable Plan through the same Apply path used by `--apply` and then rollback the page transaction
- **AND** the command MUST emit planned JSONL records without persisting Contact changes

#### Scenario: Apply consumes one immutable page plan

- **WHEN** `flask data-migrate human-input-contacts --apply` processes one source page
- **THEN** Apply MUST execute only the actions and expected values present in that Plan without replanning
- **AND** after commit the JSONL output MUST identify every actual change and its available tenant, account, member and Contact IDs

#### Scenario: A page requires no change

- **WHEN** one dry-run or apply page produces only reuse/no-op actions
- **THEN** both modes MUST execute the same Plan/Apply decisions
- **AND** apply output MUST NOT classify an unchanged record as changed

#### Scenario: A page write fails

- **WHEN** any planned record write, page flush or page commit fails
- **THEN** the command MUST rollback and close the entire page transaction and emit the known failing record plus full page Plan/cursor context as JSONL
- **AND** no attempted write from that page MAY be reported as an actual change
- **AND** the command MUST open a fresh transaction/session and continue from the next cursor already derived by the successful page read

#### Scenario: Existing eligible Accounts are initialized

- **WHEN** apply encounters an eligible existing Account/member without a source-backed Contact
- **THEN** the command MUST create the missing Contact while allowing a same-email External Contact to coexist

#### Scenario: Initialization is rerun

- **WHEN** apply revisits an Account/member that already has a source-backed Contact
- **THEN** the command MUST reuse the existing Contact identity and MUST NOT create a duplicate
- **AND** it MUST emit a reuse/no-op record with the available cursor and object IDs without classifying it as changed

#### Scenario: A source page cannot be read

- **WHEN** the command cannot fully materialize one source page after earlier pages completed
- **THEN** it MUST emit the read failure and last safe cursor as JSONL and immediately stop scanning
- **AND** a later full rerun MUST NOT duplicate Contacts from completed pages

#### Scenario: Manual sync does not initialize Contacts

- **WHEN** an administrator starts manual IM sync or a worker reads a provider directory
- **THEN** the sync path MUST read current eligible Contacts without invoking this command, Contact initialization or lifecycle repair

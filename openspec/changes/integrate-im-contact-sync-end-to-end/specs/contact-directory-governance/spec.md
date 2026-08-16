## ADDED Requirements

### Requirement: Contact initialization data migration MUST be explicit and idempotent

系统 MUST 在 `flask data-migrate` namespace 提供 `human-input-contacts` 运维命令，为已有 eligible Account/member 幂等创建或复用 source-backed Contact。命令 MUST 默认 dry-run，只有显式 `--apply` 才能提交写入；命令 MUST 允许整条命令安全重跑。该迁移 MUST NOT 读取 provider directory、创建 IM identity/binding，且 MUST NOT 由 HTTP、Contact read 或 manual IM sync 隐式触发。Ongoing Account/member write-through 与 periodic repair 不属于该数据迁移。

命令 MUST 使用稳定 keyset cursor 将 source facts 分成小而有界的页面，并 MUST NOT 使用 offset pagination或跨页持有数据库transaction。每页 MUST 先生成 immutable Plan，再由 Apply 仅消费该 Plan 执行；Apply MUST NOT 重新读取 source facts 以重新规划 action。dry-run 与 `--apply` MUST 使用同一 page Plan/Apply path，其唯一模式差异 MUST 是页面 transaction 最终 rollback 或 commit。迁移实现 SHOULD 保持每个对象的 Plan/Apply flow显式可读，MUST NOT 为消除可读的少量重复而引入通用 migration framework。

Apply MUST 以单个 page transaction执行该页全部 planned writes，MUST NOT 使用nested transaction、savepoint或per-record commit。任一record write、flush或commit失败 MUST rollback并关闭整页transaction、记录已知失败record和整个页面的Plan/cursor上下文、跳过该页，并以新transaction/session继续后续页面。只有 source/page read失败 MUST 立即中止扫描；write failure MUST NOT 提前中止后续页面。完成扫描后若存在 read failure或未收敛write failure，命令 MUST 返回 non-zero exit status。

命令 MUST 只输出 JSONL，每行 MUST 是独立的 JSON object。record/page event MUST 包含 mode、phase、cursor、action/outcome及当前事实可用的关键对象 ID，包括 `tenant_id`、`account_id`、`member_id` 和 `contact_id`；其他字段 MUST 限于复核、恢复与定位失败所需的非 PII 迁移数据。dry-run MUST 输出 Plan records；`--apply` MUST 在页面成功 commit 后输出实际变更 records，failed/skipped/rollback 的 attempted writes MUST NOT 被标记为已变更。

#### Scenario: Dry-run 预览 initialization migration

- **WHEN** an operator runs `flask data-migrate human-input-contacts` without `--apply`
- **THEN** each page MUST pass its immutable Plan through the same Apply path used by `--apply` and then rollback the page transaction
- **AND** the command MUST emit the Plan as JSONL without persisting any Contact change

#### Scenario: Apply 消费页面 Plan

- **WHEN** `flask data-migrate human-input-contacts --apply` processes one source page
- **THEN** Apply MUST execute only the actions and expected values present in that page's Plan without replanning
- **AND** after commit the JSONL output MUST identify every actually changed record and its available tenant、account、member and Contact IDs

#### Scenario: 页面无需变更

- **WHEN** one dry-run or apply page produces only reuse/no-op actions
- **THEN** both modes MUST execute the same Plan/Apply decisions
- **AND** apply output MUST NOT classify an unchanged record as actually changed

#### Scenario: 页面内任意写入失败

- **WHEN** any planned record write、page flush or page commit fails
- **THEN** the command MUST rollback and close the entire page transaction、emit the known failing record plus full page cursor and Plan context as JSONL
- **AND** no attempted write from that page MAY be reported as an actual change
- **AND** it MUST open a fresh transaction/session and continue from the next cursor already derived by the successful page read

#### Scenario: 首次导入已有 Account/member

- **WHEN** `flask data-migrate human-input-contacts --apply` encounters an eligible existing Account/member without a source-backed Contact
- **THEN** the command MUST create the missing Contact

#### Scenario: 重复执行 initialization import

- **WHEN** `flask data-migrate human-input-contacts --apply` revisits an Account/member that already has a source-backed Contact
- **THEN** the command MUST reuse the existing Contact identity and MUST NOT create a duplicate
- **AND** it MUST emit a JSONL reuse/no-op record containing the page cursor and available `tenant_id`、`account_id`、`member_id`、`contact_id` context
- **AND** the reused record MUST NOT be classified as an actual change

#### Scenario: 页面读取失败

- **WHEN** the command cannot read or fully materialize one source page after earlier pages completed
- **THEN** it MUST emit the read failure and last safe cursor as JSONL and immediately stop scanning
- **AND** the operator MUST be able to rerun the full command without duplicating Contacts from completed pages

#### Scenario: 写入失败后完成剩余扫描

- **WHEN** one or more record/page writes were skipped and every remaining source page can still be read
- **THEN** the command MUST process all remaining pages before returning a final non-zero summary
- **AND** a later rerun MUST be able to converge the skipped records without duplicating committed Contacts

#### Scenario: Manual sync 不触发 initialization import

- **WHEN** an administrator starts manual IM sync or a worker reads a provider directory
- **THEN** the sync path MUST read current eligible Contacts without invoking `flask data-migrate`、Contact initialization or lifecycle repair

## MODIFIED Requirements

### Requirement: IM identity 必须基于手动同步结果选择

系统 MUST 通过 IM sync 结果提供 IM identity 选择源，MUST NOT 在一期要求管理员手工输入自由文本 IM user ID。IM sync MUST 由 Organization 管理员手动触发：首次在 IM 配置完成后手动同步，后续刷新也由管理员 / owner 手动发起。

#### Scenario: IM 配置完成后手动同步

- **WHEN** an Organization-level IM channel has been configured successfully
- **THEN** 系统 MUST 要求 Organization 管理员手动发起 IM sync，之后才允许从同步结果中选择 IM identity

#### Scenario: 从同步 IM contact 中选择 IM identity

- **WHEN** an admin configures IM identity for a contact
- **THEN** 系统 MUST 提供基于同步 IM contacts 的搜索与选择能力，且该搜索 MUST 支持按 IM user ID 查询
- **AND** it MUST NOT depend on free-text IM user ID input

## Context

这个 change 现在的职责是一次性 spec migration，而不是长期持有 implementation design。它需要把 correction 分发到三个稳定去处：

1. `human-input-v2-api-contracts` 的最终 API contract delta
2. `openspec/specs/` 下的 living core specs
3. 明确的 Linear issue / focused OpenSpec owner

因此，本 design 的核心不是再展开产品设计，而是定义“哪些 correction 去哪里，归档后不留下什么”。

## Distribution Decisions

### 1. API-facing corrections are absorbed into the final contract change

以下 correction 进入 `human-input-v2-api-contracts` 的最终 delta，并在 archive 前同步到 living specs：

- console contact-management contract no longer rejects internal/external same-email coexistence
- runtime form contract keeps Dynamic Email on the public email-proof path
- console migration-helper contract uses `all_workspace_contacts`
- workspace override / EE binding contract adopts scope-aware IM identity reuse

理由：这些都是最终产品 contract，不应该在 archive 后继续通过 correction overlay 才能生效。

### 2. Core domain corrections go directly into living specs

以下 correction 直接修改 living core specs：

- `human-input-v2-contact-directory-core`
- `human-input-v2-recipient-resolution-core`
- `human-input-v2-submission-runtime`
- `human-input-v2-im-control-plane-core`
- `contact-directory-governance`
- `hitl-recipient-resolution`
- `hitl-approval-access-control`

理由：这些已经是长期存在的 domain rules，不应再由 active change-local spec shadow 它们。

### 3. Migration and node-editor compatibility are not left as hidden overlay work

`all_workspace_contacts` 与 imported overlap compatibility 的规则本身要进入 living / final specs，但剩余实现与 UI round-trip owner 必须显式转交：

- backend helper implementation already landed: archived `WTA-1288`
- frontend / round-trip / compatibility presentation owner: `WTA-1971`

这消除了原先 “correction change 还在暗中拥有 migration compatibility” 的问题。

### 4. IM card handled-status update is not a correction-only concern

它是新增行为，不是简单的 wording correction，因此不继续由本 change 持有。

- normative successor: `WTA-1970`
- decoder / provider evidence stays with `add-im-card-event-decoding`
- downstream inbox/runtime wiring remains outside this correction change

### 5. Open questions must be resolved before archive

原 `design.md` 里的 open questions 处理如下：

- `all_workspace_contacts` 是否成为一等 authoring 类型
  - Resolution: no, remains migration-only; future expansion requires a new dedicated change.
- imported duplicate recipient 的 UI 呈现
  - Resolution: transfer implementation to `WTA-1971`; the normative requirement is “preserve and round-trip, do not silently normalize away”.
- Contact-backed 与 EmailAddress-backed same-email overlap 是否要单独补 scenario
  - Resolution: yes; the living specs now carry an explicit scenario preserving distinct canonical subjects.
- IM card status update covers which terminal states
  - Resolution: transfer to `WTA-1970`; this correction change no longer owns that behavioral matrix.

## Archive Outcome

归档前，本 change 应满足：

- 不再持有任何独有且未分发的 normative delta
- tasks 只描述 correction 已同步 / 已转交 / 已明确 owner
- archive 后不会再需要把它作为“隐含 overlay”与 living specs 一起阅读

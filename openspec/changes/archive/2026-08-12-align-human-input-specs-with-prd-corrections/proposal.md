## Why

这个 change 的价值已经不是“再持有一套长期 active spec overlay”，而是一次性把 PRD correction 分发到正确位置：

- API correction 并入最终 API contract delta
- domain correction 并入 living core specs
- migration / node-editor compatibility 转交给已有或新增 owner
- 新增行为（IM card handled-status update）从 correction-only change 中拆出

如果继续把它保留成 active implementation-facing change，归档后会留下隐含 overlay：读者必须同时参考 living specs 和一个已退役 correction change 才能知道真实规则，这会再次制造漂移。

## What Changes

- 将 contact uniqueness、Dynamic Email、`all_workspace_contacts`、scope-aware IM binding reuse 等 correction 同步到对应 living specs 或最终 API contract delta。
- 将 migration / node-editor compatibility work 转交给明确 owner，而不是继续由 correction change 隐含持有。
- 将 IM card handled-status update 从“PRD correction”拆出，交给独立 Linear owner。
- 关闭 `design.md` 里的 open questions：要么直接定论，要么明确转交 successor，不允许它们以隐含 overlay 形式留在 archive 中。

## Capabilities

### Modified Capabilities

- `human-input-v2-contact-directory-core`
- `human-input-v2-recipient-resolution-core`
- `human-input-v2-submission-runtime`
- `human-input-v2-im-control-plane-core`
- `human-input-console-management-api`
- `human-input-runtime-form-api`
- `human-input-v2-migration`
- `human-input-v2-node-editor`

### Scope Transfers

- IM card handled-status update -> `WTA-1970`
- migration compatibility UI round-trip -> `WTA-1971`

## Impact

- living core specs under `openspec/specs/`
- final API contract delta under `human-input-v2-api-contracts`
- successor Linear issues and focused OpenSpec changes

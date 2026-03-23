# Merge Log: sandboxed-agent-rebase ← main

## Overview

| Segment | Target Commit | Commits | Description | Status |
|---------|--------------|---------|-------------|--------|
| 1 | `657eeb65` | 50 | Early changes: deps, Switch组件, 基础重构 | ✅ |
| 2 | `9c339239` | 129 | Mid refactors: model_runtime, prompt, storage | ✅ |
| 3 | `92bde350` | 56 | dify_graph 大迁移 | ⬚ |
| 4 | `fb41b215` | 165 | Post-backend refactors | ⬚ |
| 5 | `main HEAD` | 103 | Final changes | ⬚ |

- **Base commit**: `98466e2d`
- **Branch**: `sandboxed-agent-rebase`
- **Total main commits**: 503

---

## Segment 1: Early Changes (50 commits → `657eeb65`) ✅

### Conflicts: 33 files
- 2 modify/delete (agent runners → keep deletion)
- 10 backend content (memory, segments, file_manager, agent_node, llm_utils, etc.)
- 19 frontend content (Switch defaultValue→value, UnoCSS icons, data-testid)
- 2 lock files (pyproject.toml, uv.lock → regenerated)

### Post-merge fixes
- Fixed `core.file` → `core.workflow.file` imports (18 files)
- Updated Switch `defaultValue` → `value` in 5 files
- Updated `ACCOUNT_SETTING_TAB.PROVIDER` → `SANDBOX_PROVIDER`/`MODEL_PROVIDER`
- Regenerated eslint-suppressions.json, added `--pass-on-unpruned-suppressions`

### Test Results: ✅ All passed

---

## Segment 2: Mid Refactors (129 commits → `9c339239`) ✅

### Conflicts: 43 files
- 2 modify/delete (agent runners → keep deletion)
- 14 backend content (advanced_chat, prompt, llm node, storage, variable_factory, etc.)
- 22 frontend content (chat components, citation, oauth, account-setting, hitl-input-block)
- 5 lock/config files (pyproject.toml, uv.lock, pnpm-lock, package.json, eslint-suppressions)

### Post-merge fixes
- Rewrote `post-login-redirect.spec.ts` for new in-memory API
- Added `nodeOutputVars` parameter to hitl-input-block tests
- Updated `UpdateWorkflowNodesMapPayload` usage in tests
- Added `enable_collaboration_mode`/`enable_creators_platform` to SystemFeatures mocks
- Fixed `UPDATE_WORKFLOW_NODES_MAP` import path

### Test Results: ⏳ Pending

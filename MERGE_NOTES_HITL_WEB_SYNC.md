# HITL Web Integration Merge Notes

Date: 2026-02-06  
Scope: Frontend (`web/`) integration between `origin/build/feat/hitl` and `origin/feat/support-agent-sandbox`

## 1. Context and Goal

This merge effort combines two large frontend change streams:

- `origin/build/feat/hitl`: Human-in-the-Loop (HITL) capabilities, workflow pause/resume, human input forms, related UI/events/types.
- `origin/feat/support-agent-sandbox`: Sandbox and frontend refactors, including structural changes in workflow debug/preview hooks and shared runtime paths.

Primary objective:

- Integrate `web/` safely without HITL regression.
- Keep backend/API conflict handling isolated from product branches where possible.
- Preserve both branches’ effective frontend logic, especially around streaming events and workflow state transitions.

## 2. Current Integration Snapshot

Current integration branch: `wip/hitl-merge-web-conflicts-20260206-175434`

Current `web/` merge footprint:

- Total changed files in index: `266`
- Added: `79`
- Modified: `183`
- Deleted: `4`
- Files modified by both branches (overlap hotspot): `81`

High-level distribution (approximate by path category):

- `i18n`: `66`
- `workflow/nodes/human-input`: `28`
- `workflow` other files: `46`
- `workflow/hooks/use-workflow-run-event`: `9`
- `base/chat`: `26`
- `base/prompt-editor`: `23`
- `workflow/panel/debug-and-preview`: `7`
- `service`: `8`
- `icons`: `11`
- `eslint-suppressions.json`: `1`

## 3. What This Merge Contains (Functional Context)

Core merge content across frontend:

- New HITL workflow node surface:
  - New Human Input node implementation and panel components.
  - Delivery methods (WebApp/Email and related UI configuration paths).
- Workflow run event pipeline:
  - Added handling for `human_input_required`, `human_input_form_filled`, `human_input_form_timeout`, `workflow_paused`.
  - Added/updated run-event hooks and workflow state propagation.
- Debug/preview refactor integration:
  - Existing refactor into smaller hooks was retained.
  - Incoming HITL logic from the other branch was migrated into the new structure.
- Chat rendering and interaction:
  - Human input form list and submitted-form list rendering in result views.
  - Pause-aware behavior in workflow/chat result components.
- Prompt editor support:
  - HITL input block support and request URL block integration.
- Service/runtime updates:
  - Stream parser and callback type expansion in `web/service/base.ts`.
  - HITL form submission service endpoints in `web/service/workflow.ts`.
- Supporting assets:
  - HITL icon assets and references.
  - Multi-locale translation updates for workflow/common/share strings.

## 4. Hardening Patches Added After Review

After conflict resolution, additional safety fixes were applied to avoid HITL degradation:

1. Guard `findIndex` before `splice` in form-filled handlers  
   - Prevent accidental `splice(-1, 1)` that could remove the wrong form.
   - Files:
     - `web/app/components/workflow/hooks/use-workflow-run-event/use-workflow-node-human-input-form-filled.ts`
     - `web/app/components/base/chat/chat/hooks.ts`

2. Guard `findIndex` before timeout field update  
   - Prevent out-of-bounds access when timeout event arrives for non-existing local entry.
   - Files:
     - `web/app/components/workflow/hooks/use-workflow-run-event/use-workflow-node-human-input-form-timeout.ts`
     - `web/app/components/base/chat/chat/hooks.ts`

3. Fix tracing index condition for node-started event  
   - Correct handling when `currentIndex === 0` to avoid duplicated tracing entries.
   - File:
     - `web/app/components/workflow/hooks/use-workflow-run-event/use-workflow-node-started.ts`

4. Fix trigger-run-all input validation  
   - Correct empty-array guard for `TriggerType.All`.
   - File:
     - `web/app/components/workflow-app/hooks/use-workflow-run.ts`

These are behavior-preserving safeguards: they do not change intended flow, only remove edge-case breakage.

## 5. Recommended Merge Strategy (Relay Branch Model)

This strategy is feasible and stable for this responsibility.

Core principle:

- Treat integration as a dedicated frontend relay branch.
- Do not directly merge this integration branch back into `feat/support-agent-sandbox`.

### Step-by-step process

1. Create and keep a fixed relay branch (example: `int/hitl-web-sync`).
2. On relay branch, repeat:
   - Merge `origin/build/feat/hitl`.
   - Merge `origin/feat/support-agent-sandbox`.
   - Resolve only `web/` conflicts as the business target.
   - Avoid carrying backend conflict resolutions into product branches.
3. Commit every loop iteration so the relay branch is always checkout-able and buildable.
4. Before exporting result, merge latest `feat/support-agent-sandbox` into relay one more time to avoid rollback of recent sandbox frontend changes.
5. Export only `web/` back to sandbox branch:
   - `git checkout int/hitl-web-sync -- web`
   - or `git restore --source=int/hitl-web-sync --staged --worktree web`
   - create one alignment commit in `feat/support-agent-sandbox`.

## 6. Why This Strategy Works

- Backend conflicts stay isolated in relay workflow and do not block sandbox branch progress.
- Future merge to `main` should mostly contain incremental conflicts instead of re-opening this large web integration.
- Squash merge on HITL branch is acceptable; Git merge correctness is content-based, not commit-lineage-based.

## 7. Validation Gates Per Iteration

Run these checks in each relay cycle:

1. Conflict sanity:
   - `git diff --name-only --diff-filter=U -- web`
   - `rg "^(<<<<<<<|=======|>>>>>>>)" web`

2. Type/lint sanity:
   - `cd web && pnpm type-check:tsgo`
   - `cd web && pnpm eslint <targeted-hitl-files> --cache --concurrency=auto`

3. Targeted tests (at minimum):
   - Prompt editor shortcuts plugin tests.
   - Workflow/rag pipeline tests impacted by this merge.
   - HITL-specific unit tests once stabilized.

4. Functional smoke focus:
   - Workflow pause/resume event chain.
   - Human input required -> submit -> continue path.
   - Human input timeout rendering/update path.
   - Debug-and-preview flow plus chat-with-history/embedded-chat wrappers.

## 8. Open Follow-ups

1. Add explicit unit tests for index-guard behavior in HITL handlers:
   - form filled when node id is missing.
   - form timeout when node id is missing.
   - node-started update when tracing index is `0`.

2. Resolve existing repository-level type-check blocker unrelated to this patch:
   - `web/app/components/base/chat/chat/hooks.hitl.spec.tsx` currently reports argument-count mismatch.

3. Keep translation synchronization process clear:
   - English keys are the source of truth.
   - Non-English locale completion can follow in separate localization pass.

4. If `web/eslint-suppressions.json` grows during conflict loops, regenerate in a dedicated cleanup commit.

## 9. Final Promotion Plan to Mainline

When HITL is finalized:

1. Refresh relay branch from latest sandbox and latest HITL source.
2. Re-run the validation gates.
3. Export `web/` only to `feat/support-agent-sandbox` in one commit.
4. Merge sandbox branch to `main` with normal review.
5. Handle only net-new conflicts introduced after this integration window.

## 10. Operational Rule Summary

- Use `int/hitl-web-sync` as the long-lived integration relay.
- Keep merges frequent and small.
- Keep commits incremental and reproducible.
- Keep HITL event/data flow as non-regression priority.
- Export frontend result as content-only alignment (`web/`) to sandbox branch.

## 11. Mainline Merge Replay Risk and Web Preservation Procedure (2026-02-07)

### Verified conclusion

Even if `web/` content is already aligned, Git can still replay frontend conflicts in a later merge to `main` if the branch only copied files but did not record merge ancestry with HITL.

Observed in local probes:

1. `origin/feat/support-agent-sandbox` + merge `origin/build/feat/hitl`:
   - `web` conflicts: `24`
2. `pre-align-hitl-frontend` + merge `origin/build/feat/hitl`:
   - `web` conflicts: `0`
3. Sandbox branch with one `web` alignment commit (`git checkout pre-align-hitl-frontend -- web`) + merge `origin/build/feat/hitl`:
   - `web` conflicts: `31`

Interpretation:

- File-content alignment commit is not equivalent to merge-lineage alignment.
- `git checkout --ours -- web` resolves conflicting paths only, but does not revert auto-merged non-conflict web changes.

### Recommended operational flow when backend later merges `main`

Preconditions:

1. Freeze a stable window: no new commits on `main` and sandbox during operation.
2. Update `pre-align-hitl-frontend` by merging latest `main` and latest sandbox first.
3. Export `web/` from `pre-align-hitl-frontend` to sandbox and commit one explicit alignment commit.

When backend branch performs `git merge origin/main`:

1. If the decision is to keep current branch's frontend completely, restore `web/` to pre-merge `HEAD`:
   - `git restore --source=HEAD --staged --worktree -- web`
2. If restore is blocked by unmerged `modify/delete` entries, use fallback:
   - `git checkout HEAD -- web`
   - resolve remaining unmerged web paths to ours (for delete-on-ours case: `git rm <path>`)
   - `git restore --source=HEAD --staged --worktree --no-overlay -- web`
3. Confirm `web/` is fully unchanged in merge state:
   - `git status --short -- web` should be empty
   - `git diff --name-only --diff-filter=U -- web` should be empty
   - `git diff --cached --name-only -- web` should be empty
   - `git diff --name-only -- web` should be empty
4. Continue resolving only non-web conflicts and finish merge commit.

### Practical rule

If the intent is "this merge should not change frontend", enforce it with `restore` to `HEAD` on `web/` rather than relying only on `checkout --ours -- web`.

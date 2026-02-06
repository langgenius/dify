# Add Missing Telemetry ID Fields

## TL;DR

> **Quick Summary**: Add `dify.credential.id` and `dify.event.id` to enterprise telemetry events where corresponding `.name` fields exist. These IDs are already available in metadata/envelope and only require reading + outputting.
> 
> **Deliverables**: 
> - Add `dify.credential.id` to node execution events (read from metadata)
> - Add `dify.event.id` to all telemetry events (read from envelope)
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - sequential (credential.id first, then event.id)
> **Critical Path**: Task 1 → Task 2

---

## Context

### Original Request
User wants all telemetry data to have corresponding IDs for every `.name` field to enable reliable aggregation and prevent ambiguity when names change or duplicate.

### Interview Summary
**Key Discussions**:
- workspace=tenant: No need for separate `workspace.id` (tenant_id serves this purpose)
- "Directly available": If field exists in metadata/envelope and just needs reading, it counts
- Skip fields requiring upstream propagation or new logic

**Current State**:
- ✅ `dify.app.name` + `dify.app_id` (already paired)
- ✅ `dify.dataset.names` + `dify.dataset.ids` (already paired)
- ✅ `dify.workspace.name` + `dify.tenant_id` (workspace=tenant per user)
- ✅ `dify.plugin.name` stores `plugin_unique_identifier` (acts as ID)
- ❌ `dify.credential.name` missing `dify.credential.id` (but credential_id in metadata)
- ❌ `dify.event.name` missing `dify.event.id` (but event_id in envelope)
- ⏸️ `gen_ai.provider.name` / `gen_ai.tool.name` - IDs not in metadata (deferred)

### Research Findings
- `credential_id` available at: `api/core/app/workflow/layers/persistence.py:491` → stored in node_data metadata → accessible in `ops_trace_manager.py:1164` and `enterprise_trace.py` metadata dict
- `event_id` available at: `api/enterprise/telemetry/contracts.py:67` (TelemetryEnvelope) → accessible in `metric_handler.py` when processing events

---

## Work Objectives

### Core Objective
Add `dify.credential.id` and `dify.event.id` to enterprise telemetry attributes for events that already output the corresponding `.name` fields.

### Concrete Deliverables
- `dify.credential.id` added to node execution events (where `dify.credential.name` exists)
- `dify.event.id` added to all telemetry events processed through metric_handler

### Definition of Done
- [ ] Query telemetry logs for node execution events → `dify.credential.id` present when `dify.credential.name` exists
- [ ] Query telemetry logs for any event → `dify.event.id` present in attributes
- [ ] All existing tests pass

### Must Have
- Credential ID only added when credential exists (don't add null/empty values)
- Event ID always added (every event has envelope.event_id)

### Must NOT Have (Guardrails)
- Do NOT add provider.id or tool.id (not in metadata, would require upstream changes)
- Do NOT change existing field names or remove any fields
- Do NOT add workspace.id (workspace=tenant per user requirement)

---

## Verification Strategy

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks MUST be verifiable WITHOUT any human action.

### Test Decision
- **Infrastructure exists**: YES (pytest)
- **Automated tests**: Tests-after (verify field presence)
- **Framework**: pytest

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

> All verification done by agent via grep/read to confirm attribute output in code.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
└── Task 1: Add dify.credential.id

Wave 2 (After Wave 1):
└── Task 2: Add dify.event.id

Critical Path: Task 1 → Task 2
Sequential execution required (separate files/patterns)
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 2 | None |
| 2 | 1 | None | None |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1 | task(category="quick", load_skills=[], run_in_background=false) |
| 2 | 2 | task(category="quick", load_skills=[], run_in_background=false) |

---

## TODOs

- [ ] 1. Add dify.credential.id to node execution events

  **What to do**:
  - Read `credential_id` from metadata in `_node_execution_trace` method
  - Add `"dify.credential.id": metadata.get("credential_id")` to attrs dict (only if credential_id exists and is not None)
  - Follow same pattern as existing `dify.credential.name` (line 368)

  **Must NOT do**:
  - Do NOT add credential.id if it's None or empty string
  - Do NOT add to events other than node execution
  - Do NOT change how credential_id is populated in metadata upstream

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file edit, straightforward field addition, clear pattern to follow
  - **Skills**: []
    - No special skills needed - standard Python dict manipulation
  - **Skills Evaluated but Omitted**: N/A

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential)
  - **Blocks**: Task 2 (different file, cleaner to do sequentially)
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `api/enterprise/telemetry/enterprise_trace.py:368` - Pattern for adding credential.name from metadata (line: `"dify.credential.name": metadata.get("credential_name")`)
  - `api/enterprise/telemetry/enterprise_trace.py:365-370` - Context where credential fields are added (shows conditional node_execution_id pattern)

  **API/Type References** (contracts to implement against):
  - `api/core/app/workflow/layers/persistence.py:491-493` - Where credential_id is set in node_data (shows it comes from tool_info metadata)
  - `api/core/ops/ops_trace_manager.py:1163-1176` - Where credential_id flows into metadata dict (line 1164: credential_id from node_data)

  **Test References** (testing patterns to follow):
  - No existing tests for credential fields - verification via code inspection

  **Documentation References** (specs and requirements):
  - Context from this plan: credential_id must only be added when it exists (not null/empty)

  **WHY Each Reference Matters**:
  - Line 368 shows exact dict.get() pattern and naming convention (dify.credential.*)
  - persistence.py:491 proves credential_id is available in metadata when tool uses credentials
  - ops_trace_manager.py:1163-1176 shows metadata construction including credential_id
  - These together confirm: metadata already has credential_id, just need to output it

  **Acceptance Criteria**:

  **Agent-Executed QA Scenarios (MANDATORY — per-scenario, ultra-detailed):**

  ```
  Scenario: credential.id added when credential exists
    Tool: Grep + Read
    Preconditions: Code changes applied to enterprise_trace.py
    Steps:
      1. Read api/enterprise/telemetry/enterprise_trace.py lines 360-380
      2. Assert: Line exists matching pattern "dify.credential.id.*metadata.get.*credential_id"
      3. Assert: credential.id added in same conditional block as credential.name (after line 368)
      4. Assert: Pattern uses metadata.get("credential_id") (not direct access)
    Expected Result: credential.id field added using safe dict.get pattern
    Evidence: Code snippet showing the added line

  Scenario: credential.id not added to non-node events
    Tool: Grep
    Preconditions: Code changes applied
    Steps:
      1. Grep api/enterprise/telemetry/enterprise_trace.py for "dify.credential.id"
      2. Assert: Only ONE occurrence (in _node_execution_trace method)
      3. Assert: NOT in _message_trace, _workflow_trace, _tool_trace, _dataset_retrieval_trace
    Expected Result: credential.id only in node execution context
    Evidence: Grep output showing single occurrence
  ```

  **Evidence to Capture**:
  - [ ] Code snippet showing added line with proper indentation
  - [ ] Grep confirmation of single occurrence location

  **Commit**: YES
  - Message: `feat(telemetry): add dify.credential.id to node execution events`
  - Files: `api/enterprise/telemetry/enterprise_trace.py`
  - Pre-commit: `make lint`

- [ ] 2. Add dify.event.id to all telemetry events

  **What to do**:
  - In `metric_handler.py`, add `"dify.event.id": envelope.event_id` to attributes for ALL event types
  - Add once in common attribute building (before case-specific handling)
  - Ensure event_id is added to rehydration_failed, app events, feedback, and all metric-only events

  **Must NOT do**:
  - Do NOT skip any event type (event.id must be universal)
  - Do NOT add event.id to span attributes (only event attributes in metric_handler)
  - Do NOT change envelope.event_id generation logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, add field in one central location before event dispatch
  - **Skills**: []
    - Standard Python dict manipulation
  - **Skills Evaluated but Omitted**: N/A

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Task 1)
  - **Blocks**: None (final task)
  - **Blocked By**: Task 1 (cleaner to do sequentially, different files)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `api/enterprise/telemetry/metric_handler.py:184` - Existing pattern for adding event_id (REHYDRATION_FAILED case: `"dify.event_id": envelope.event_id`)
  - `api/enterprise/telemetry/metric_handler.py:183` - Shows tenant_id added before event_id (follow same pattern)

  **API/Type References** (contracts to implement against):
  - `api/enterprise/telemetry/contracts.py:67` - TelemetryEnvelope schema showing event_id field (always present)
  - `api/enterprise/telemetry/gateway.py:138` - Where event_id is generated (str(uuid.uuid4()))

  **Test References** (testing patterns to follow):
  - No existing tests - verification via code inspection

  **Documentation References** (specs and requirements):
  - Context from this plan: event.id must be added to ALL events (universal field)

  **WHY Each Reference Matters**:
  - metric_handler.py:184 shows exact pattern: envelope.event_id is directly accessible
  - contracts.py:67 confirms event_id is non-nullable (always present on envelope)
  - gateway.py:138 proves every event gets unique event_id at creation time
  - Pattern at line 183-184 shows safe approach: add common fields before case switch

  **Acceptance Criteria**:

  **Agent-Executed QA Scenarios (MANDATORY — per-scenario, ultra-detailed):**

  ```
  Scenario: event.id added before event-specific processing
    Tool: Read
    Preconditions: Code changes applied to metric_handler.py
    Steps:
      1. Read api/enterprise/telemetry/metric_handler.py lines 175-195
      2. Assert: "dify.event.id": envelope.event_id added before line 189 (before case dispatch)
      3. Assert: Added in same block as tenant_id (line 183)
      4. Assert: Uses envelope.event_id directly (not envelope.event_id or None)
    Expected Result: event.id added early, applies to all event types
    Evidence: Code snippet showing placement before case statement

  Scenario: event.id present in all event type handlers
    Tool: Grep + Read
    Preconditions: Code changes applied
    Steps:
      1. Read metric_handler.py APP_CREATED handler (lines 180-210)
      2. Read metric_handler.py FEEDBACK_CREATED handler (lines 315-340)
      3. Assert: Both inherit event.id from common attrs (added before case dispatch)
      4. Grep for "envelope.event_id" → Assert only ONE new occurrence (in common attrs)
    Expected Result: event.id available to all event types via shared attribute dict
    Evidence: Code showing single central addition point
  ```

  **Evidence to Capture**:
  - [ ] Code snippet showing event.id addition in common attributes section
  - [ ] Grep output confirming single addition point

  **Commit**: YES
  - Message: `feat(telemetry): add dify.event.id to all telemetry events`
  - Files: `api/enterprise/telemetry/metric_handler.py`
  - Pre-commit: `make lint`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat(telemetry): add dify.credential.id to node execution events` | enterprise_trace.py | make lint |
| 2 | `feat(telemetry): add dify.event.id to all telemetry events` | metric_handler.py | make lint |

---

## Success Criteria

### Verification Commands
```bash
# Verify credential.id added
grep -n "dify.credential.id" api/enterprise/telemetry/enterprise_trace.py
# Expected: One line in _node_execution_trace method using metadata.get("credential_id")

# Verify event.id added  
grep -n "dify.event.id" api/enterprise/telemetry/metric_handler.py
# Expected: One line in common attributes section using envelope.event_id
```

### Final Checklist
- [ ] credential.id present in node execution events (when credential exists)
- [ ] event.id present in all telemetry events
- [ ] No new fields added beyond these two
- [ ] Linting passes
- [ ] Code follows existing patterns (dict.get for metadata, direct access for envelope)

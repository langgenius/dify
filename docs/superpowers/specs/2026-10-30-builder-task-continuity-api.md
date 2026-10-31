# ENG-1185 Conversation and Task API integration

All paths below are relative to `/console/api`. They use the existing authenticated Console actor, workspace and App-edit authorization. No browser-supplied Task identity grants access.

## Session projection

`GET /dify-builder/sessions/{session_id}` and existing `command_finished` SSE projections add:

- `task_id`: stable logical Task identity, independent of Stop/Resume execution generation.
- `task_status`: `active`, `paused`, `completed` or `abandoned`.
- `task_summaries`: at most eight structured historical completion records.
- `conversation_cleared`: permanent empty-Conversation marker for the old Session.
- `pending_fix_context`: the proposed failure/checklist source, separate from the current Task's cards.

Summaries record goal, constraints, resource IDs, declared output contract, changed node IDs, change summary, unresolved risks and bounded test evidence. `test_evidence.sealed` describes execution proof; `business_acceptance_state` is separate. A declared output is not an observed result. Summaries contain neither raw inputs/outputs nor credentials and confer no execution permission. Keeping a draft and publishing are the six supported completion exits; abandoning does not forge a completion summary.

## Independent Fix intake

`POST /dify-builder/sessions/{session_id}/fix-intents`:

```json
{
  "base_version": 12,
  "client_action_id": "fix-intake-client-uuid",
  "failed_run_id": "native-workflow-run-uuid"
}
```

Supply exactly one of `failed_run_id` and `checklist_errors`; optional `model_config` uses the existing model shape. A Run must actually be failed and belong to the authorized App/workspace. The response is `{fix_intent_id, status, session}`. Preparation stages an independent SQL record and does not advance a running Task's CAS version.

A current-Task Run is related and does not restart it. A known ended Task may start the next Fix directly. An active unrelated Task exposes a generic Decision with `dismiss_fix` (safe default) and `stop_and_switch_fix`. Submit through the existing `/sessions/{session_id}/actions` endpoint, copying the selected server action's complete payload, including `fix_intent_id` and `expected_task_id`; include the normal `client_action_id`, `base_version` and `base_app_revision`. The generic `confirm` action also accepts `payload.option_id` as before.

Confirmation persists intent first, then uses existing Stop settlement, then atomically starts the new Fix from the latest bound DSL. `pending` or `unknown` prevents activation. Repeating the same confirmed identity observes its result; an uncertain queue acknowledgement never authorizes another dispatch. Changed bodies or stale Task identities conflict.

The existing `POST /dify-builder/sessions` with `scenario: "fix"` remains supported. Optional `session_id` selects an owned Conversation explicitly; otherwise the backend selects the caller's active owned writer, then latest non-cleared Conversation. With none, first creation and original failed-Run persistence are atomic. Prefer an explicit client action identity.

## Abandon and clear

`POST /dify-builder/sessions/{session_id}/abandon`:

```json
{
  "base_version": 12,
  "client_action_id": "abandon-client-uuid",
  "expected_task_id": "server-issued-task-id"
}
```

`POST /dify-builder/sessions/{session_id}/clear` takes the same fields plus strictly Boolean `"confirmed": true`. Neither endpoint accepts an App revision or reads the Workflow DSL. Both return a minimal lifecycle receipt with `session_id`, `version`, `last_command_id`, `task_id`, `task_status`, `conversation_cleared`, `conversation_last_seq` and actual `settlement` (`settled`, `pending`, `unknown`). This is a logical control receipt, not proof of completed physical cleanup.

Abandon preserves conversation history and ends old Task authority. Independent Resume cannot revive it. Once all current execution evidence is settled, a fresh message atomically establishes a new Task and proceeds through existing Edit; a duplicate turn observes that reservation without redispatch.

Clear preserves Draft, publication, Run records and private execution audit. It permanently tombstones the old Session: public history, material, native projections and old streams cannot expose the pre-clear context, and old commands cannot resume it. Start the next Conversation through ordinary Session creation, not a message to the cleared Session. No unknown operation is replayed by either control.

## Frontend integration boundary

No frontend component is implemented in this change. The existing Choice interaction merges selected action payload correctly, but its processing/busy gate currently prevents submitting the new independent Fix Decision while the original Task is working. Frontend integration must enable these independent lifecycle actions while retaining ordinary command busy protection, and localize the new fixed Decision wording. API acceptance alone does not establish page acceptance for these controls. Clear should remove the old Session recovery reference and create a new Session for the next prompt.

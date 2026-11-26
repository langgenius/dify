# ENG-1185: Builder task continuity and lifecycle

## Scope and authority

The owner approved completing three remaining backend behaviours: structured task completion summaries, explicit stop-and-switch for an unrelated external Fix, and durable abandon/clear. This implements the existing PRD, especially sections 23.1, 23.4.7–8 and 23.7, rather than changing the product scope. Source PRD: `/Users/chongbinyao/Downloads/Dify App Builder - PRD.md`.

Keep the Dify monorepo, existing native execution, owner authorization, SQL CAS, workflow writer and cancellation settlement. No frontend implementation, Sandbox/Graphon change, additional risk engine, automatic replay of unknown outcomes, or TTL extension. A later frontend integration ticket may document the new contracts.

## Existing guarantees to preserve

- A single active writer per Workflow; every mutation retains the execution-generation and SQL writer fence.
- Stop/Resume is independent of a logical business task. Resume can increment the execution generation without starting another task.
- Existing Run records are immutable evidence. Retest creates a new Run. Neither a summary nor a task switch grants execution consent.
- Related failures from the current task's test already enter diagnose/repair. Preserve that path.
- Each Session remains owned by its original account and tenant; this work does not introduce shared cross-account transcripts.

## Stable task identity and summary

Add additive context fields `logical_task_id`, `logical_task_ordinal`, `task_status`, and a typed bounded `task_summaries` list. A legacy context's identity is deterministically `session.id + ':0'`. Only a genuinely new goal or a confirmed unrelated Fix advances the logical identity; Stop/Resume does not. Generation remains the separate execution fence.

`task_lifecycle.py` exports:

- `task_identity(session, context) -> str` (pure read).
- `advance_task_identity(session, context, entry_mode) -> str` (identity/status only, not execution generation).
- `record_task_completion(env, session, context, outcome) -> None`.
- `mark_task_abandoned(context, reason) -> None`.

Record completion in the existing CAS commit at the six successful keep-draft/publish exits. Publishing records a summary only after native publishing succeeds. Undo and an uncompleted repair must not masquerade as publication or verified completion.

A summary contains the stable task ID, route, outcome, bounded sanitized goal/constraints, resource references, declared output contract, changed node references, and content-free test/evidence references. It must never copy native inputs, outputs, per-node payloads, raw errors, credentials or execution consent. Missing/unknown evidence stays missing/unknown. Keep at most eight summaries; expose them additively in SessionView and supply a bounded history scope to later Builder cognition. Do not recursively turn previous JSON goals into the next goal. Summary generation makes no extra model request.

The typed summary also includes bounded `unresolved_risks` reason codes and explicit evidence provenance (Run IDs, bound revisions, sealed/mode/safety facts). Recorded requirements are not labelled user-confirmed unless an existing confirmation establishes that fact. The declared output contract is not an observed result. A successful Run alone cannot imply sealed or graph-bound verification; keep-draft never implies verified. Redaction tests inject known credentials into goal, requirements and output-contract text as well as execution records.

Add nullable `origin_task_id` to the existing Builder Run row. New writes derive it from the locked task state; old rows remain unchanged. Exact current Run references provide a conservative legacy fallback; merely sharing a Session does not make an old Run related to the current task.

The direct native full-run reservation in `dify_port._reserve_full_run` must write the same lineage under its existing SQL fence, not only `repository.save_run`. Existing attachment material receipts remain scoped to their execution generation; their legacy `task_id` string is not used to infer logical Run ownership. Clearing removes their public references and new-task activation must not inherit pending material or its authority.

## Unrelated Fix intake and confirmation

Persist pending Fix intents in a small dedicated `DifyBuilderFixIntent` table. Preparing an intent must not advance the Session head, pause the task, release its writer or cancel it: doing so would interrupt an in-flight worker before the user confirms.

Add `POST /dify-builder/sessions/{session_id}/fix-intents` with actor-scoped input `client_action_id`, `base_version`, and one validated failed native Run or checklist. The existing create-Fix endpoint reuses the caller's current owned conversation when available: current owned workflow-writer Session first, then most recent owned non-cleared Session. Explicit session selection never falls back to somebody else's Session. With no eligible conversation, retain the existing create path. Serialize the no-session select/create boundary using an existing app/owner transaction lock.

Service-side authority reconstructs the native Run and stable task lineage. Related failures reuse the current task. An unrelated Fix returns the existing generic Decision contract with `dismiss_fix` and `stop_and_switch_fix`; the safe default keeps the current task. Payload binds `fix_intent_id` and the expected logical task ID, not a client assertion of Run ownership.

Fix intake and confirmation re-evaluate this state split under the Session lock:

| Current logical task | Behaviour |
| --- | --- |
| Active, Waiting, Paused or Suspended, with an unrelated Fix | Offer keep-current / explicit stop-and-switch; no stop during preparation. |
| Completed, Idle, or already Abandoned with safely settled cancellation | Start a new logical Fix in the same conversation without a stop prompt. A Completed task stays Completed. |
| Cancellation or any prior effect/dispatch outcome is pending or unknown | Retain the intent and evidence; no activation or automatic replay. |
| The target task changed since the offer | Reject the stale intent. Natural completion of that same task is re-evaluated using the Completed rule. |

The intake response contains `fix_intent_id`, `status`, and a bounded `session` view; the existing create-Fix endpoint continues to return/stream its normal SessionView contract. The generic decision projection supplies `fix_intent_id` and `expected_task_id`. GET only observes. A repeated explicit matching confirmation can move a safely settled stopping intent to activation; no timer or read silently activates it. Durable pending enqueue is dispatched once by its recorded owner; unknown acknowledgement stays unknown.

Submit these intent controls before ordinary busy/native-test guards, through an independent owner like Stop. Confirmation first durably records the explicitly confirmed intent as `stopping`, then calls the existing independently atomic Stop/fence transaction and cancellation. `stopping` means an accepted stop intention, never proof the old task has stopped. This deliberate two-step coordinator avoids passing SQL sessions or callbacks across repository owners. A crash between the steps leaves the old task running until the same explicit confirmation safely resumes coordination; a changed target task is rejected. Pending/unknown settlement never activates the new Fix. Once safely settled, read and synchronize the current DSL, preserve the old history and Run, mark the old task abandoned, advance the stable task ID and execution fence, discard old approvals and pending mutations, and append a new immutable original-failed Run plus Run Context in the same conversation. New-task activation, source Run, intent consumption and the once-only enqueue reservation remain one durable transaction. An unknown enqueue acknowledgement is not retried. Repeated matching prepare/confirm is idempotent; key reuse with a different intent and a stale target task are conflicts.

`fix_intents.py` owns orchestration without SQL; `fix_intent_repository.py` owns its short locked persistence operations. No external cancellation/model/queue call occurs inside a SQL transaction.

## Abandon and clear

Add independent control endpoints:

- `POST /dify-builder/sessions/{id}/abandon`: `base_version`, `client_action_id`, optional `expected_task_id` (otherwise rebuilt from the observed base version).
- `POST /dify-builder/sessions/{id}/clear`: the same fields plus explicit `confirmed: true`.

Both return a minimal JSON lifecycle receipt, not the ordinary graph-reading SessionView. Clear does not accept/read app revision and must not call the model, read or synchronize the DSL, enqueue cognition, create ProcessTrace or create a Run. The frontend supplies its confirmation dialog before the explicit confirmed request; no frontend work is included here.

Use a locked Session control transaction to bind actor/tenant/task identity, persist idempotency and advance the cancellation fence. Abandon invalidates old cards, approvals and recovery while preserving transcript, Draft and Run evidence. A later explicitly submitted goal may start a new logical task in the same Session only after cancellation safely settles and the usual DSL synchronization succeeds.

Clear additionally empties the public conversation, material references, recovery and cognition context. Store a permanent clear tombstone and history floor on that Session; it cannot be resumed or reused by an old action, receipt or cursor. Subsequent new conversation creation uses the existing create endpoint. Historical security/Run evidence remains private and cannot be projected as current conversation history, attachments, test snapshots or diagnostics. Preserve native Draft, published versions, Runs, System Skills and any input/snapshot needed by immutable execution audit; do not claim physical process cleanup from an acknowledgement timeout.

The ordinary `_build_session_view` reads graph revision/publication evidence, so cleared GET uses a separate minimal no-graph view. Old pagination, SSE, native decide/resume and historic replay must respect the tombstone/task binding. Cancellation may settle existing physical effects into private audit, but cannot restore a cleared conversation or grant new execution authority.

Close the identified check-then-insert races at `create_checkpoint`, `save_run`, and `save_test_input`: fence within the write transaction, not just before it. Existing cancellation outcome audit must still be able to settle previously dispatched work without recreating task authority.

`conversation_lifecycle.py` exports `clear`, `abandon`, `is_conversation_cleared`, `cleared_session_view`, `stop_task_for_switch`, and `observe_task_stop`. They reuse the existing cancellation owner and SQL lock order.

The shared switching signatures are frozen as:

```python
stop_task_for_switch(service, session_id: str, actor: Actor, *,
                     expected_task_id: str, client_action_id: str) -> tuple[Session, DifyBuilderContext]
observe_task_stop(service, session_id: str, actor: Actor, *,
                  client_action_id: str, deliver: bool = False) -> Literal['settled', 'pending', 'unknown']
prepare_fix_intent(service, session_id: str, actor: Actor, *,
                   failed_run_id: str | None, checklist_errors=None,
                   model_config=None, client_action_id: str) -> FixIntentReceipt
submit_fix_intent(service, session_id: str, actor: Actor, action: Action) -> SessionView
```

`FixIntentReceipt` contains `fix_intent_id`, `status`, and `session`. `submit_fix_intent` accepts only the offered `dismiss_fix` or `stop_and_switch_fix` payload tied to the durable intent and expected task. That explicit command invokes Stop once; subsequent matching explicit confirmations may observe settlement and activate only when settled. No GET/reconciler automatically switches task. The activation owner reserves its enqueue before calling the queue; an ACK unknown is permanently distinguished from an unattempted reservation and is never dispatched again.

## Validation and delivery

Use targeted red/green tests for identity across Resume, truthful summary provenance/redaction, related/unrelated Run routing, confirmation-before-stop, cancellation/ACK unknown, immutable Run preservation, no-graph clear, old cursor/receipt isolation, and late worker writes. Add real PostgreSQL/Redis races at the existing writer/control fixtures and authenticated HTTP DTO round trips.

Independently review the combined change before integration. Verify Local synthetic paths first, then full Main/Builder CI and the official image, then Dev synthetic E2E with source/schema identity, screenshots and sanitized Trace in ENG-1185. Backend work is pushed to `feat/dify-builder` without a backend PR. A schema change requires a compatible migration and carefully drained Dev rollout; preserve unrelated workers, queue configuration and historical unknown records.

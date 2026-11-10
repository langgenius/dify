# Dify Builder

App Builder UI and session logic for the Build, Edit, and Fix APIs. The feature
owns conversation, interactions, and session state; `editor/` connects it to the
workflow canvas.

## Find the Behavior Owner

| Development task                                                      | Owner                                                          |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Attach Builder to the workflow editor                                 | [`editor/index.tsx`]                                           |
| Open the panel or offer a repair                                      | [`editor/panel-toggle.tsx`], [`fix-button.tsx`]                |
| Add Builder repair actions to the workflow checklist                  | [`editor/checklist.tsx`]                                       |
| Highlight the nodes currently edited by Builder                       | [`editor/node-decoration.tsx`]                                 |
| Record manual viewport navigation during a Builder task               | [`editor/use-viewport-interaction.ts`]                         |
| Pass an opening prompt across navigation                              | [`creation.ts`], [`editor/creation-start.tsx`]                 |
| Panel layout, scrolling, clear/abandon confirmation                   | [`panel/index.tsx`]                                            |
| Input, attachment upload, send/stop/resume controls                   | [`composer/index.tsx`]                                         |
| Accept or clear the attachment draft                                  | [`composer/use-attachment-draft.ts`]                           |
| Select a model or show model availability                             | [`model/`]                                                     |
| Group and render committed conversation                               | [`conversation/`]                                              |
| Display test outputs or native run details                            | [`conversation/test-result/`]                                  |
| Edit a form, choose resources, or confirm a decision                  | [`interactions/`]                                              |
| Render context in both history and a Fix decision                     | [`cards/`]                                                     |
| Resolve reply language and fixed copy                                 | [`i18n/`]                                                      |
| Coordinate commands, reset, restore, and accepted session projections | [`session/use-session-controller.ts`]                          |
| Load history or reconcile missing conversation rows                   | [`session/use-session-history.ts`]                             |
| Connect and restore the shared session event stream                   | [`session/use-session-stream.ts`]                              |
| Stop a task and any active test, or resume the task                   | [`session/use-task-control.ts`]                                |
| Admit or switch a Fix task                                            | [`session/use-fix-control.ts`]                                 |
| Clear a conversation or abandon a task                                | [`session/use-lifecycle-control.ts`]                           |
| Reconcile an uncertain lifecycle operation                            | [`session/use-lifecycle-recovery.ts`]                          |
| Submit material to an existing session                                | [`session/use-material-control.ts`]                            |
| Persist recovery identities                                           | [`session/persistence.tsx`], [`session/storage.ts`]            |
| Refresh the canvas or project workflow run events                     | [`editor/use-canvas-refresh.ts`], [`editor/use-run-events.ts`] |
| Derive shared capabilities and dispatch UI commands                   | [`state.ts`]                                                   |

`session/state.ts` owns authoritative session projections and transient stream
state. `state.ts` owns feature-level coordination and UI commands. Control hooks
receive the existing controller refs, so extraction does not create additional
command owners or retry identities. The editor keeps session scope mounted when
the panel closes. `creation.ts` intentionally lives outside that scope.

Workflow App owns draft persistence and canvas coordination in
`workflow-app/store/workflow/`. The `editor/` entrypoints attach Builder's
checklist actions, node decoration, and viewport interaction to that owner.
Session controls keep their request identities and shared refs in the mounted
controller rather than creating separate command sessions in each UI surface.

Keep tests beside their owner. Feature-level `__tests__/` covers cross-module
flows and holds shared fixtures. Cross-feature integration tests remain under
`web/__tests__/` or the workflow consumer that owns the integration.

From `web/`, run the feature suites with:

```sh
vp test run --project unit features/dify-builder
vp test run --project browser features/dify-builder
```

## Session and Rendering Contracts

Only the streaming assistant tail subscribes to token updates, so committed
history and form cards do not rerender for every delta.

The controller loads durable conversation groups through a paginated JSON GET.
Create, action, and message POSTs return JSON. The client opens the session SSE
stream and applies its `session_ready` snapshot before submitting work. The
same stream delivers command progress, native test updates, and committed
cards and replies through `conversation_item_appended`. After two minutes without
a pending command, submission, or unresolved native test, Builder closes the
stream and stops reconnecting. The next message or action reopens the stream for
the same session before submission. Disabling Builder closes the stream.
Re-enabling it restores the saved session and observes its existing native test
without submitting another run. New-session prompts and
message commands render the submitted user text immediately. Message turns use
their client-generated `turn_id`, and the matching durable event supplies sequence and version
metadata without adding a second bubble. The local display item never
participates in durable sequence-gap checks.
During an active command, restore keeps the preceding interaction dock hidden
until the settled state arrives, so a submitted form does not reappear as an
unfinished disabled form. Interrupted commands still expose recovery choices.
Recovery explanations belong to the existing decision description. Builder
does not append new `notice` items or expose `recovery.message`. Legacy notices
remain readable and retain their sequence numbers for pagination and reconnect
watermarks, but are hidden in the conversation and excluded from model history.
User submission receipts and native dynamic replies retain their existing
payloads. Model changes update the selector and terminal state without adding
a conversation item.
The stream checks durable session state on idle heartbeats while a command or
native test is active. It emits the settled or interrupted projection if a
terminal broadcast was missed.
Trace export records restore requests, JSON state snapshots, and reconnect
requests even before the first SSE event arrives.
`agent_message` owns native assistant text: all deltas
share a preallocated `seq` and `turn_id`, and its `done` frame promotes that
exact accumulated text into the live conversation. Model replies use their
native deltas. Complete handler replies use `conversation_item_appended` after
commit, with `reply_mode: complete`. They bypass the text queue and appear in
full with a brief transition; history hydration does not replay it.
The browser reveals native queued text at a bounded rate on animation frames;
following card/item events for those turns wait until that visible queue is drained. The
empty `done` frame is emitted only after the assistant turn is durable. Each
frame also carries the cumulative UTF-8 byte count; a mismatch at `done`
exposes a dropped delta and leaves the sequence missing so terminal gap
recovery reloads the persisted reply. `command_finished` carries only the final
bounded projection and `conversation_last_seq`, which confirms
the command's persistence. There is no public `commit` event and no terminal
assistant-text replacement. The conversation GET is used only for initial
restore, reconnect, or a sequence gap detected from the terminal watermark.
`progress` frames carry ordered, single-activity deltas. The browser reduces
them by `operation_id`; `revision` and `at_version` reject stale updates. The
durable assistant turn retains the complete execution snapshot.
The worker saves the full observed activity list before each live broadcast.
Redis keys are scoped to the tenant, session, and activated worker lease, with
a bounded TTL and monotonic snapshot writes. Reconnect establishes the live
subscription before reading this snapshot, then emits `progress_snapshot`
before queued live events. The browser restores its ordered completed and
active activities in one update and ignores subsequent revisions already
included in the snapshot. Released or replaced leases and already committed
session versions never restore old in-flight progress.

Build creation persists the opening goal before dispatching the internal
`start_build` command. `build.capability_check` is an automatic working step;
it never exposes a first-step goal action to the frontend.

Canvas notifications have three variants. `graph_changed` is emitted once after
a changed mutation batch commits (`cause: apply`), or after a checkpoint is
restored (`cause: restore`). Rejected and unchanged batches emit no graph event.
`edit_targets_changed` replaces the complete local highlight set with `node_ids`;
an empty list clears it. `publish_workflow` refreshes publication metadata.
Highlights never select nodes, open configuration panels, or move the viewport.
Session event handlers clear targets on task completion and entry into testing,
including accepted restore snapshots. Reset and rollback events also clear them.
Restoring a checkpoint uses the graph notification itself to clear highlights;
a revert without a checkpoint sends only an empty edit-target set. Repeated
clears leave an already empty target set unchanged.

Builder draft refreshes preserve the current viewport and apply the returned
graph without restoring local node or edge selections. Session updates, graph
notifications, restore, and retry use the same fetch-and-apply path. A successful
refresh confirms canvas readiness; failed or superseded refreshes cannot start
the pending automatic retest.
Refresh scheduling follows accepted session events, graph notifications, and
command completion. Manual retry invokes the refresh command directly. Starting
a command, reset, and unmount invalidate older responses; no atom-watching effect
starts requests. The same events synchronize the canvas lock directly, including
refresh failure and completion. Only unmount cleanup retains lifecycle effects.
The refresh module owns canvas-state reset; the outer reset command clears
the composer and checklist state.
Native test events retain the editor's existing per-node tracking and navigation.
The current native receipt supplies the waiting and running status. The final
approval schedules continuation of the same Run and records a standard choice
receipt. Each approval presents the details for its current operation.
The composer shows Stop during a native test and hides it while a form is open.
Once cancellation settles, Resume continues the Builder task. A new test
requires a separate Test Run.

`workflow` envelopes carry the complete native debugger payload alongside
Builder's session, operation, version, and revision metadata. Accepted
payloads dispatch directly to the editor's shared `useWorkflowRunEvent`
callbacks, including node, retry, iteration, loop, text, agent log, human-input,
pause, and terminal events. An inner workflow `error` or `workflow_finished`
does not terminate the outer Builder command. Chatflow message/text events
without a run ID use the run started in the same command, with native message
chunks and replacements handled by the shared text callbacks. Complete live
canvas updates need no subsequent detail or node-execution queries. On reopen
or recovery, the current native receipt supplies an unfinished Run's ID.
Persisted test cards supply IDs for completed runs. Native Test records the
edges Graphon traverses before and after each approval on the same Run. The
receipt and result card restore that path with the ordinary canvas edge colors;
other edges, including branches that share a target, stay neutral.
Native execution status remains
authoritative over Builder validation cards. An interrupted run clears live
animation without inventing a failed result. Canvas refresh completion reapplies
saved runtime fields directly, without rebuilding the live run from node rows.

Builder executes the native workflow generator inside its existing worker task
while retaining streaming callbacks. It does not enqueue a child workflow task
and wait for another Celery pool slot: a worker consuming both queues at
concurrency 1 would otherwise deadlock until the stream times out.

Build/Edit repair approval persists the changed graph and stops at
`build.execution` / `edit.apply_changes`. The initiating client waits for that
session version's canvas refresh to succeed, then submits one `run_test` /
`run_affected_tests` action with the matching session and app revisions. The
pending retest is cleared on reset, restore, another command, or a version
conflict; reopening historical waiting states never starts a test. A failed
refresh leaves the test pending until a successful retry. This separates graph
application from execution, so even newly created nodes exist before their
first workflow callback runs.

Only `SessionView.active_interaction` is editable. It contains an action id,
version, and `card_seq`; the UI resolves that reference against conversation
items instead of receiving a duplicate card payload in session state.
Historical form and resource cards are omitted from the transcript; submitted
responses remain visible there.
Unsubmitted field drafts remain local component state and are intentionally not
persisted.

Interaction controls derive their locale from the latest accepted progress or
SessionView's `reply_language`, falling back to the account locale when unsupported or empty.
The independent `difyBuilder` i18n namespace owns fixed copy for the whole panel.
The backend sends typed `{ type: "copy", id, params }` references, or ordered
`{ type: "parts", parts }` for replies combining fixed frames and literal prose.
Dynamic content is never matched against translation source strings. Language
metadata is persisted per item, so later language changes do not relocalize
history. The override does not change account language or cookies.

Optimistic receipts use the same renderer and send a separate `receipt_snapshot`
containing localized display strings. The server preserves raw submitted values
and validates the snapshot's interaction kind and field keys before freezing it.
Historical literal receipts remain unchanged. Fixed copy never invokes a model;
only user language detection and dynamic cognition retain model calls.

The browser persists the recoverable session id in `sessionStorage`, under
`dify-builder:v1:{tenantId}:{userId}:{appId}:active-session-id`. Pending lifecycle
admission identities use its `:control` key and restore as uncertain operations;
persistence never replays them. Conversation and streamed text remain in memory.

Keep UI-only state, such as composer drafts and expanded cards, in the owning
component. Add derived atoms for shared fields instead of passing the complete
`SessionView` through React Context.

Builder renders only its interaction cards: plan, form, resource selection,
failed-run context, checklist preflight context, and test result. Change,
error, summary, and publish details arrive as assistant text. The preflight
card and its styles live in `cards/`; they intentionally do not import
or share the workflow header checklist component.

Test result cards show final outputs directly for successful and failed runs,
with text, JSON, and file rendering plus a scrollable full-content region.
The header carries the execution status. The body retains exceptional-outcome
headlines and failure reasons, without duplicate success/failure headlines,
review boilerplate, raw JSON disclosures, or execution IDs.
Saved `terminal_outputs` belong to their individual cards. When output evidence
is absent, the card reads its native `dify_run_id` through the authorized run
detail endpoint for display; native content is never copied into Builder
conversation or session state. Known empty results and unavailable reads have
distinct feedback. Expanding run details loads native node tracing on demand.

## External Modules

- `@/service/console`: generated `consoleClient` methods for typed JSON and SSE
  routes. The shared client owns authentication and CSRF behavior.

[`cards/`]: cards/
[`composer/index.tsx`]: composer/index.tsx
[`composer/use-attachment-draft.ts`]: composer/use-attachment-draft.ts
[`conversation/`]: conversation/
[`conversation/test-result/`]: conversation/test-result/
[`creation.ts`]: creation.ts
[`editor/checklist.tsx`]: editor/checklist.tsx
[`editor/creation-start.tsx`]: editor/creation-start.tsx
[`editor/index.tsx`]: editor/index.tsx
[`editor/node-decoration.tsx`]: editor/node-decoration.tsx
[`editor/panel-toggle.tsx`]: editor/panel-toggle.tsx
[`editor/use-canvas-refresh.ts`]: editor/use-canvas-refresh.ts
[`editor/use-run-events.ts`]: editor/use-run-events.ts
[`editor/use-viewport-interaction.ts`]: editor/use-viewport-interaction.ts
[`fix-button.tsx`]: fix-button.tsx
[`i18n/`]: i18n/
[`interactions/`]: interactions/
[`model/`]: model/
[`panel/index.tsx`]: panel/index.tsx
[`session/persistence.tsx`]: session/persistence.tsx
[`session/storage.ts`]: session/storage.ts
[`session/use-fix-control.ts`]: session/use-fix-control.ts
[`session/use-lifecycle-control.ts`]: session/use-lifecycle-control.ts
[`session/use-lifecycle-recovery.ts`]: session/use-lifecycle-recovery.ts
[`session/use-material-control.ts`]: session/use-material-control.ts
[`session/use-session-controller.ts`]: session/use-session-controller.ts
[`session/use-session-history.ts`]: session/use-session-history.ts
[`session/use-session-stream.ts`]: session/use-session-stream.ts
[`session/use-task-control.ts`]: session/use-task-control.ts
[`state.ts`]: state.ts

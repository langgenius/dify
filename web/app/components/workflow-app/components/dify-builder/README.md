# Dify Builder

In-editor App Builder UI and session logic for the Build, Edit, and Fix APIs.

## Internal Modules

- `panel.tsx`: panel composition, conversation scrolling, and shared interaction
  coordination. `panel/` owns the header, background, empty state, and footer.
- `session/`: scoped session atoms, pure projection helpers, the SSE lifecycle
  controller, an animation-frame buffer for assistant text deltas, and a
  low-frequency live-progress projection.
- `conversation/`: conversation grouping and focused card components. Only the
  streaming assistant tail subscribes to token updates, so committed history
  and form cards do not rerender for every delta.
- `provider/`: session persistence and canvas synchronization boundaries.
- `store.ts`: derived feature state and UI commands.

The controller restores bounded session state with JSON GET and loads durable
conversation groups through a separate paginated JSON GET. Create, action, and
message commands use typed POST SSE requests; an independent GET SSE route is
opened only while reconnecting to an active command. SSE never carries full
history: `command_started` is a bounded handshake, the server persists durable
items internally, and emits each non-assistant item through
`conversation_item_appended`. New-session prompts and message commands render
the submitted user text immediately. Message turns use their client-generated
`turn_id`; the matching durable event then supplies sequence and version
metadata without adding a second bubble. The local display item never
participates in durable sequence-gap checks.
`agent_message` owns assistant text: all deltas
share a preallocated `seq` and `turn_id`, and its `done` frame promotes that
exact accumulated text into the live conversation. Model replies use their
native deltas; deterministic Builder copy is split at natural text boundaries.
The browser reveals queued text at a bounded rate on animation frames and does
not process later card/item events until that visible queue is drained. The
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

Build creation persists the opening goal before dispatching the internal
`start_build` command. `build.capability_check` is an automatic working step;
it never exposes a first-step goal action to the frontend.

`workflow` envelopes carry the complete native debugger payload alongside
Builder's session, operation, version, and revision metadata. Accepted
payloads dispatch directly to the editor's shared `useWorkflowRunEvent`
callbacks, including node, retry, iteration, loop, text, agent log, human-input,
pause, and terminal events. An inner workflow `error` or `workflow_finished`
does not terminate the outer Builder command. Chatflow message/text events
without a run ID use the run started in the same command, with native message
chunks and replacements handled by the shared text callbacks. Complete live runs need no
subsequent detail or node-execution queries. Those queries use persisted test
cards' `dify_run_id` only when reopening history or recovering missing events.
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

The browser persists only an unfinished or restartable failed session id in `sessionStorage`, under
`dify-builder:v1:{tenantId}:{userId}:{appId}:active-session-id`. Conversation,
status, versions, and streamed text are never written to browser storage.

Keep UI-only state, such as composer drafts and expanded cards, in the owning
component. Add derived atoms for shared fields instead of passing the complete
`SessionView` through React Context.

Builder renders only its interaction cards: plan, form, resource selection,
failed-run context, checklist preflight context, and test result. Change,
error, summary, and publish details arrive as assistant text. The preflight
card and its styles live in `conversation/`; they intentionally do not import
or share the workflow header checklist component.

## External Modules

- `@/service/client`: generated `consoleClient` methods for typed JSON and SSE
  routes. The shared client owns authentication and CSRF behavior.

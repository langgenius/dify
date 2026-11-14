# Service API message branches

Status: proposed implementation for #36395; pending maintainer review.

## Contract

Advanced Chat clients may send `parent_message_id` to `POST /chat-messages`.
Omission retains the legacy linear-history behavior. An explicit null starts a
new root in an existing conversation; an explicit message ID continues that
turn. An edited question is a new turn under the original question's predecessor,
with its own answer, message ID, workflow run and normal usage charges. No old
turn or descendant is rewritten or deleted. Clients supply query, inputs and
files using the existing request contract; attachment omission/reuse is not a
new server-side operation in this first slice.

The selection requires an existing Advanced Chat app and conversation belonging
to the admitted tenant, app and end user. Every selected ancestor has the same
owner chain. Missing references and cycles fail closed. Historical API rows with
the nil parent sentinel require an admission transaction: lock the owned
conversation, resolve the selected chain, lock its rows and materialize each nil
edge as its chronological predecessor (or null for the root). A nil edge whose
timestamp is shared by another owned conversation message is ambiguous and is
rejected before any edge is written. Random UUID ordering cannot prove the
original predecessor. Both Web and Service API messages participate in this
check because they can share an end-user conversation.

This changes legacy parent-link values from a sentinel to equivalent explicit
edges. It never changes message IDs, queries, answers or descendants; pagination
and the response schema remain compatible. A selection with more than 500 ancestors is rejected rather than
silently truncating the branch's dialogue count. Omitted-field legacy calls keep
their existing behavior. The nil UUID is not a client-selectable parent; select an actual turn
or null instead.

The application admits the history once before enqueueing. After queue and pause
boundaries it batch-validates frozen IDs, the full owner chain and persisted
explicit links, without deriving chronological predecessors again. It passes the resolved IDs explicitly through the generate
entity and graph run context into memory. A memory read loads those exact IDs,
in their selected order, rather than consulting the most recent conversation
row. This avoids cross-branch history when another run creates a newer row and
survives serialization and Human Input resume. Deleted ancestors cause failure,
never fallback to another branch. Short metadata transactions contain no model I/O.

Legacy normalization defines compatibility edges from the currently recorded
time order; it does not recover an original model-context snapshot that was never
stored. It is idempotent and may already have committed if a later generation
fails or the client does not subscribe. The generation itself remains a fresh,
non-idempotent request. Unsupported workflows are rejected before normalization.

## State and concurrency

This operation branches the transcript only. It uses the current published
workflow and current conversation variables, as normal Chatflow invocation does.
It does not restore historical variable values, revoke prior external effects,
or make tool execution idempotent. Concurrent generations retain independent
transcript selections; conversation variables remain shared, so this is not a
claim of isolated concurrent workflow-state updates. A client that needs
sequential variable mutations must serialize its conversation requests.

Graphs containing new Dify Agent workspace nodes are rejected before enqueueing.
Their independently persisted Agent sessions do not yet support transcript
branching. Plugin Agent nodes and LLM-backed nodes use the selected memory.

Generation, streaming, cancellation, error recording and billing continue through
the existing generation path. A failed new turn may remain recorded, but the old
branch stays available. Each accepted call is a new generation; there is no
automatic retry of a possibly accepted request.

## Structure and validation

The application service owns input policy and declares a scoped history port.
The existing message repository implements the port using a bounded recursive
metadata query and a short transaction for legacy-edge materialization.
Conditional updates and selected-row locks reject concurrent deletion or edge changes;
the composition root wires it. Existing execution-kernel changes only carry the
resolved selection into node memory; no new business implementation lives there.
Import contracts keep the new application service free of ORM/framework imports.

Validation covers real scoped repository reads, roots and middle turns, legacy
linear rows, foreign/missing/cyclic ancestors, exact prompt history despite newer
branches, serialized selections, explicit-null versus omitted request fields,
and unchanged default memory. OpenAPI artifacts are generated from the schema
owner. Actual command results are recorded in the PR, not assumed by this ADR.

## Follow-ups

A dedicated regenerate endpoint can add server-side question/attachment reuse.
Historical workflow-state restoration needs its own snapshot and side-effect
contract; it is deliberately outside this first implementation.

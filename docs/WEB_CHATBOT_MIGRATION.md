# Chatbot Guest history migration

The Web migration endpoints support ordinary published Chatbot Apps in addition
to Workflow and Chatflow Apps. Legacy Agent configurations, including Apps still
stored as `chat` before their first Agent invocation, remain unsupported. A
Chatbot with non-Chatbot Guest conversation history is also excluded rather than
admitting an execution path without ownership fencing.

## Snapshot contract

Chatbot Claim transfers committed Guest resources in the existing per-Passport
transaction. It does not register, stop, or wait for Chatbot generation tasks.
`stop_requested_run_count` continues to count Workflow/Chatflow stop requests;
Chatbot Claim reports zero.

The original EndUser remains the execution actor. Message creation, answer and
error persistence, generated attachments, automatic titles, and history loading
recheck the current conversation owner under the same identity fence used by
migration. A write that commits first is included in the transfer. If migration
commits first, the old Guest operation fails without modifying Account history.
Locks are held only for database work, not model or storage I/O.

Conversation and message identifiers and historical sender identities remain
unchanged. Account-linked EndUsers can continue migrated conversations. Guest
Passports remain usable for new conversations and retries, but cannot access
the transferred history.

In-flight requests may return an error and lose an uncommitted answer, leaving
an incomplete turn in the transferred history. Claim does not promise immediate
termination of model calls or SSE streams, retract content already read or
emitted, or roll back external model charges. Unattached resources created after
the snapshot remain Guest-owned and can be included in a later Claim.

## Deployment

Deploy the ownership-fenced writers to every serving process and drain old
processes and their in-flight requests before exposing Chatbot Claim. Do not
serve migration requests on the new version while old unfenced writers are still
running. Existing `WEBAPP_ACCOUNT_PASSPORT_ENABLED` gating remains in effect; no
schema migration or execution-tracking table is required.

Workflow and Chatflow retain their existing stop, readiness, and transactional
recheck protocol. No cross-Passport atomicity is introduced.

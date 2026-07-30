# Agent Unified Tracing Design

## Goal

Extend unified tracing with semantic Dify Agent execution and human-in-the-loop
(HITL) visibility without changing Agent execution behavior or exposing private
runtime data.

The feature covers the new Dify Agent backend only:

- Agent v2 nodes in Workflow and Chatflow;
- Agent Apps (`AppMode.AGENT`) that execute through the Agent backend.

It does not cover arbitrary external callers of the Agent backend `/runs` API
or the legacy in-process `AppMode.AGENT_CHAT` ReAct implementation.

## Scope and Trace Granularity

The collected unit is a semantic event, not an Agent backend transport event.
The trace model includes only:

- an `agent_run` for each Agent backend execution attempt;
- LLM turns;
- tool calls;
- `human_wait` operations.

It excludes raw stream deltas, HTTP requests, backend runtime internals, shell
activity, and provider-specific transport details.

Each backend attempt remains a distinct `agent_run`. Retries are not folded into
one aggregate span. A continuation after an accepted human submission is also
a separate run, identified by `role=resume`; it is not a retry.

```text
agent_node or message
└─ agent_run
   ├─ llm
   ├─ tool
   ├─ llm
   └─ tool
```

LLM and tool spans are siblings below their `agent_run`. Causality that cannot
be represented by nesting is recorded through metadata such as `tool_call_id`,
`requested_by_span_id`, and `resumes_tool_call_id`.

### Workflow-as-Tool Parent Stitching

When an Agent tool call invokes a Workflow-as-Tool, the child Workflow trace
must use the concrete Agent tool-call span as its provider parent:

```text
workflow
└─ agent_node
   └─ agent_run
      └─ workflow_as_tool call
         └─ child workflow
```

The normalized tool-call span has a stable ID. That ID is propagated as the
parent-context key, together with the outer Workflow Run ID, through the Agent
backend core-tool invocation boundary and into the child Workflow generation
extras. It is an opaque correlation key despite the legacy
`parent_node_execution_id` field name; it need not identify a persisted
Workflow node execution.

The parent Agent tool-call span publishes a provider context only after its
parent trace export succeeds. A synchronously invoked child Workflow can finish
first; its existing retryable unified-trace dispatch waits for the context, then
restores the provider parent after the outer trace publishes it. Incompatible
provider destinations retain the existing linked-root fallback.

## Privacy and Bounded Capture

Tracing may record, after normalization and bounded truncation:

- prompts and LLM outputs;
- tool arguments and results;
- token usage;
- textual reasoning or thinking;
- Agent final output.

Tracing must not record credentials, authentication tokens, JWE payloads,
reasoning signatures, shell environment variables, or provider-private fields.

Every bounded field records `truncated=true` when its value was shortened.
This policy applies before data enters a persisted trace fragment.

## Implementation Defaults

The API redacts sensitive keys and JWE-shaped values before fragment
persistence. Strings are bounded to 16 KiB and collections to 100 entries.
These are fixed internal safety limits, not App settings.

Trace failures are fail-open: they are logged and represented only through
canonical incomplete metadata (`complete`, `warning_codes`, and
`dropped_event_count`). They do not change Agent, Workflow, or Message
execution results.

## Internal Contract and Ownership

The Agent backend event source is isolated behind a generic protocol:

```text
Pydantic AI event
→ PydanticAIAgentEventNormalizer
→ AgentSemanticEvent
→ AgentSemanticTraceCollector
→ AgentRunTraceFragment
→ CanonicalTraceBuilder
→ Canonical spans
```

`AgentEventNormalizer` is a generic `Protocol`. Only the concrete
`PydanticAIAgentEventNormalizer` may import or depend on Pydantic AI event
types. `AgentSemanticTraceCollector` consumes only stable
`AgentSemanticEvent` values and writes provider-neutral
`AgentRunTraceFragment` values.

`CanonicalTraceBuilder` remains responsible for Dify topology and canonical
span construction. It consumes Agent fragments and generic HITL records; it
does not parse Pydantic AI events. Provider adapters continue to receive only
canonical spans.

Tracing errors are fail-open. Event parsing, fragment persistence, or canonical
trace construction failures cannot fail an Agent execution. A recoverable
partial export records:

```json
{
  "complete": false,
  "warning_codes": ["..."],
  "dropped_event_count": 1
}
```

## Human Wait Is a Unified Tracing Semantic

`human_wait` is a generic unified tracing operation, not an Agent-only span.
It covers:

- ordinary Human Input nodes;
- an Agent node's `ask_human` tool;
- an Agent App's `ask_human` tool.

`HumanInputForm` is the lifecycle authority. A normalized private
`HumanWaitRecord` contains a stable wait/form ID, owner correlation,
request/completion timestamps, sanitized bounded input/output, and an outcome:

```text
waiting | submitted | timed_out | expired | canceled
```

The record uses form creation as the wait start. Submission, expiration, or
cancellation determines its terminal outcome and completion time. It preserves
form, node, and tool-call correlations without exporting access tokens,
recipient secrets, or other sensitive form-delivery details.

### Workflow and Chatflow HITL

A Workflow Run remains one final trace across pause and resume:

```text
workflow
└─ agent_node
   ├─ agent_run { role=initial }
   ├─ human_wait
   └─ agent_run { role=resume }
```

The `human_wait` span has the actual interval from request to terminal human
outcome. It is a direct child of the owning Human Input or Agent node, rather
than a child of either Agent run. A normal Human Input node likewise emits its
own `human_wait` child span.

A Workflow pause does not export the final Workflow trace. The existing resume
behavior reconstructs the transient `TraceQueueManager`; a final trace task is
then emitted only after succeeded, partially succeeded, failed, or stopped.

Agent fragments needed before a Workflow/Chatflow pause are private temporary
state and must be persisted with the private pause state. They are restored on
resume and retained through repeated pauses. Redis TTL alone is not sufficient
for this purpose.

### Agent App HITL

Agent App HITL intentionally remains two independent Message traces:

```text
Conversation trace session
├─ Message M1
│  └─ human_wait { phase=requested, wait_id=W }
└─ Message M2
   └─ human_wait { phase=resumed, wait_id=W, wait_duration_ms=..., link=M1 }
```

The traces share the conversation trace session and are correlated with
`wait_id` plus a span link. They do not have a cross-trace parent-child
relationship. This avoids an invalid span that starts before the root of the
second Message trace and permits M1 to export immediately after it enters the
human wait.

M1 fragments are deleted after its export succeeds or terminally fails. M2
starts a new Collector and fragment set when the human result causes the
continuation Message to run. No Agent App fragment must survive the human wait.

## Fragment Lifecycle

Agent fragments are tracing-only temporary data. They are never published as
user-visible Message metadata.

- Delete fragments after successful export.
- Delete fragments after terminal export failure.
- Retain fragments only while an export retry has been accepted.
- Use TTL only as crash-recovery cleanup.
- Persist Workflow/Chatflow fragments in private pause state while a run is
  paused, then resume the normal lifecycle after completion.

## Collection Gate and Provider Routing

Collection starts only when unified tracing is effective at the beginning of
the trace. The decision is locked for that trace:

- a Workflow/Chatflow run is evaluated when it starts and does not change on
  resume;
- each Agent App Message is evaluated independently, so M1 and M2 can have
  separate start-time decisions.

The effective condition is that the calling App has tracing enabled with a
valid provider configuration, unified tracing is globally enabled, and that
provider is registered for unified dispatch.

The trace destination belongs to the execution host, not to a reusable Agent:

| Execution | Tracing configuration owner |
| --- | --- |
| Agent App conversation | the Agent App backing App |
| Workflow/Chatflow Agent node | the invoking Workflow App |

Consequently, enabling a provider for an Agent App does not enable export for
that Agent when it is invoked from a Workflow. The Workflow App must configure
tracing itself. This is deliberately independent of existing Agent execution
configuration and does not introduce a new model/tool/prompt ownership rule.

## Agent v2 Configuration UI

The current Agent v2 detail route (`/agents/<agent_id>`) has Configure, Access
Point, Logs, and Monitor pages but no tracing configuration UI. The general
App overview already has provider configuration and enablement controls backed
by the existing App tracing APIs.

Agent v2 Monitor will expose the same tracing configuration controls for the
Agent App backing App. It does not introduce Agent-specific provider storage or
new backend APIs. Its UI must state that the setting applies only to Agent App
conversations; Agent executions embedded in a Workflow use the Workflow App's
tracing configuration.

## Compatibility

Unified tracing remains opt-in. Legacy trace routing is unchanged for providers
not registered for unified dispatch. Existing Workflow HITL pause/resume
behavior remains intact: pause does not export a final trace, and a resumed
terminal execution does. Agent execution continues even if tracing collection
or export is unavailable.

# Agent Unified Tracing Progress

Tracks implementation against `docs/superpowers/plans/2026-07-29-agent-unified-tracing.md`.

## Completed

- **Task 1 — semantic contracts and privacy boundary** (`641b2631a1`): agent semantic event contracts, bounded/redacted values, and Pydantic AI normalization.
- **Task 2 — fail-open Agent-run collector** (`b3ee16e672`): independent serializable fragments and partial collection warnings.
- **Task 3 — human-wait lifecycle**: repository records retain terminal transition time; submissions, node timeouts, and global timeouts publish sanitized `HumanWaitRecord`s. Global timeout restores the private pause trace state and publishes its final Workflow trace before cleanup.
- **Task 4 — canonical fragment merge** (`d407afd8b6`, `3375ad9fcc`, `84cc3df0c5`): Agent operations and human-wait spans are represented in canonical traces.
- **Task 5 — execution-host wiring**: Workflow Agent nodes and Agent App runner collect raw backend stream fragments under the per-app provider gate. Workflow fragments persist in node metadata; Agent App fragments are carried privately to Message trace tasks.
- **Task 5a — Workflow-as-Tool parent stitching**: workflow tool names mark matching Agent tool operations with `provider_type=workflow`; canonical Workflow Agent tool spans publish parent context. The opaque `run_id:tool:tool_call_id` boundary propagation remains covered end to end.
- **Task 6 — pause/resume fragment persistence** (`4bad48508e`): private `WorkflowTraceState` survives pause-state serialization, node fragments accumulate by node execution, terminal waits replace prior state by wait ID, and terminal Workflow trace tasks carry both collections.
- **Task 7 — trace dispatch lifecycle**: canonical Message traces merge private Agent fragments, and trace-file cleanup retains retryable payloads while deleting successful or terminal payloads.
- **Task 8 — Agent App HITL boundaries**: initial and resumed Agent App attempts publish their own fragments; requested waits attach to M1, resumed waits attach to M2 with duration metadata and a link back to M1.
- **Task 9 — Agent v2 monitoring UI reuse**: the existing App tracing panel now accepts explicit App identity and optional read-only state. Agent Monitor resolves the backing App through the generated Agent detail query, preserves App ACL behavior, explains the capture scope, and adds no Agent-specific tracing API or storage.
- **Task 10 — regression verification and boundary documentation**: the design records fixed capture limits, pre-persistence redaction, and fail-open incomplete-trace behavior. Final backend, frontend, and static-check regressions pass.
- **Runtime follow-up — streamed operation assembly**: consecutive text/thinking deltas now form one LLM operation per model turn, with tool boundaries starting the next turn. Native `FunctionToolCallEvent` / `FunctionToolResultEvent` pairs are normalized so successful tool outputs no longer finalize as `tool result missing`.
- **Runtime follow-up — Workflow-as-Tool trace parenting**: the invocation-local parent context now remains active while lazy workflow tool messages are consumed and transformed, so the child workflow can attach beneath the Agent tool-call span. Cleanup still runs after successful consumption and when lazy iteration raises.

## Verification to date

Final verification:

- 526 unified-trace, Workflow Agent-node, Agent App, task-pipeline, trace-transport, cleanup, and timeout tests passed.
- 466 additional pause persistence, repository, service, workflow-execute, and API tool tests passed.
- 23 Dify Agent core-tool tests and the affected runner usage test passed independently.
- 15 Agent Monitor, App tracing-panel, and App overview tests passed.
- API and Dify Agent Ruff checks passed.
- Full `pnpm check` passed with the repository's existing warning baseline.
- 61 focused normalizer, collector, Agent App, and Workflow Agent tests passed after the streamed-operation follow-up; the complete 64-test unified-trace suite also passed.
- 10 Agent tool inner-service tests, including lazy success and failure lifecycle coverage, passed after the Workflow-as-Tool parenting follow-up; the 64-test unified-trace suite and affected-file Ruff checks also passed.

An expanded mixed Dify Agent test invocation exposed an existing collection-order isolation issue: `dify_core_tools/test_layer.py` installs global Graphon stubs that can replace `LLMUsage` before `runtime/test_runner.py` is imported. Both affected suites pass independently, and this branch does not modify that test fixture.

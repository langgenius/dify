# Agent Run ID Context Injection Fix

## Problem

Workflow-as-Tool invocations made by Dify Agent still emit independent traces
because their inner API requests do not contain a parent workflow run ID or
tool-call span ID.

The Agent runner intends to inject its runtime `run_id` into the
`dify.execution_context` layer before entering the compositor. Two normalization
boundaries prevented that injection:

1. `normalize_composition()` returns `layer_configs` keyed by layer **name**,
   while the original runner read and wrote that mapping with the layer **type**
   `dify.execution_context`.
2. Real create-run requests cross an HTTP JSON boundary, so
   `RunLayerSpec.config` is deserialized as a plain mapping rather than a
   `DifyExecutionContextLayerConfig`. A typed-only `isinstance` guard therefore
   still skipped injection after the name lookup was corrected.

The standard request builder names the layer `execution_context`; without both
name resolution and config validation, `agent_run_id` remains `None`.

The core-tools layer consequently cannot construct
`<agent_run_id>:tool:<tool_call_id>`, and the API never receives the parent
context required to attach the child workflow trace.

## Runtime Evidence

For the latest reproduced run:

- The outer Agent trace contains the Workflow tool span and publishes its
  provider parent context successfully.
- LangSmith records the child workflow with its own trace ID,
  `parent_run_id=None`, and no linked-parent metadata.
- Redis contains the expected provider context under
  `<agent_run_id>:tool:<tool_call_id>`, proving parent publication succeeds.
- A real API-side capture proves that `AgentToolInnerService` forwards parent
  fields correctly when they are present in the request.
- A create-run JSON round-trip changes the execution-context config from
  `DifyExecutionContextLayerConfig` to `dict`, reproducing the remaining runner
  guard failure exactly.

## Scope

Change only the Agent runner's runtime injection of `agent_run_id` and its
focused tests. Do not change the public run protocol, API tool invocation DTOs,
trace transport, provider adapters, span IDs, or layer naming rules.

## Design

Resolve the execution-context config through the composition layer declaration:

1. Find the composition layer whose `type` is
   `dify.execution_context`.
2. Use that declaration's `name` to read and update `layer_configs`.
3. If its config is a mapping produced by HTTP deserialization, validate it as
   `DifyExecutionContextLayerConfig`.
4. For a validated or already typed config, create the existing model copy with
   `agent_run_id=self.run_id`.
5. Preserve the runner's current behavior when no compatible execution-context
   layer exists.

Looking up the layer declaration by type and then using its name follows the
normalization contract and supports both the standard `execution_context` name
and valid custom layer names. Validating mapping input restores the concrete DTO
that direct Python callers already preserve without changing the public schema.

## Verification

Add focused tests proving that:

- A JSON-round-tripped run with the standard `execution_context` layer name
  exposes `agent_run_id` to the core-tools layer.
- A JSON-round-tripped run with a valid custom execution-context layer name
  receives the same injection.
- A Workflow core-tool request constructs
  `tool_call_span_id=<run_id>:tool:<tool_call_id>` and carries the outer
  workflow run ID.

Run the focused Dify Agent runner/core-tools tests, the affected API
inner-service tests, the unified tracing regression suite, and Ruff checks for
all modified Python files.

## Compatibility and Risks

This corrects internal layer lookup and HTTP config normalization without
changing serialized schemas. Existing compositions using the standard name begin
receiving the intended runtime-only field. Custom names are supported by
resolving the name from the layer declaration instead of introducing another
fixed-name dependency.

The injected value is the runner's already-public run ID and remains confined
to trusted execution context. Non-core tools and runs without an
execution-context layer retain their current behavior.

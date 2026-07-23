# Chatflow Root Span Naming Design

## Goal

Make unified tracing identify Chatflow roots consistently in Phoenix and LangSmith by naming the outer span `chatflow_<workflow_run_id>` instead of the generic `message`.

## Design

Change only the Chatflow root span created by `CanonicalTraceBuilder._build_workflow` when `WorkflowTraceInfo.message_id` is present. Keep its canonical ID as the message ID and preserve its hierarchy, inputs, outputs, metadata (`trace_entity_type="message"`), and parent-context publication behavior. The child workflow span remains `workflow_<workflow_run_id>`.

Regular Workflow roots and standalone Message traces keep their existing names. Because naming is defined in the canonical builder, all unified tracing adapters receive the same result without provider-specific changes.

## Compatibility

Queries or dashboards filtering Chatflow roots by the exact span name `message` must switch to `chatflow_<workflow_run_id>` or use `trace_entity_type="message"`. No trace IDs, parent relationships, or provider contracts change.

## Verification

Update the focused canonical trace builder test to assert the Chatflow root name. Retain existing assertions covering Workflow and standalone Message naming so the change cannot leak into those paths.

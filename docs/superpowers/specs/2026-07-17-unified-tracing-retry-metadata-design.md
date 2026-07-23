# Unified Tracing Retry Metadata Design

## Problem

Workflow node retry attempts are persisted in the terminal node execution's `process_data` under `__dify_retry_history`. Unified tracing loads that process data but currently omits retry information from the canonical node span, so LangSmith and Phoenix cannot show that retries occurred.

## Existing data

Each persisted retry attempt can contain:

- `retry_index`
- `inputs`
- `process_data`
- `outputs`
- `error`
- `elapsed_time`
- `execution_metadata`
- `created_at`
- `finished_at`

The terminal node execution separately retains its final status, error, inputs, and outputs.

## Design

`CanonicalTraceBuilder` will read retry history from each workflow node execution's process data and add a compact summary to that node span's metadata.

For a node with retries, the metadata will include:

```json
{
  "retry_count": 3,
  "retry_attempts": [
    {
      "retry_index": 1,
      "error": "HTTP 500",
      "elapsed_time": 1.2,
      "created_at": 1700000001,
      "finished_at": 1700000011
    }
  ]
}
```

Each summary contains only:

- `retry_index`
- `error`
- `elapsed_time`
- `created_at`
- `finished_at`

Inputs, process data, outputs, and execution metadata are intentionally omitted to avoid duplicating potentially large or sensitive payloads in provider metadata.

`retry_count` is the number of valid persisted retry attempts. It does not include the terminal node attempt, whose outcome remains represented by the canonical span's existing status, error, timing, inputs, and outputs.

Nodes without valid retry history will not receive either metadata field.

## Malformed history

Retry metadata is observability enrichment and must not prevent the terminal trace from being exported. The builder will:

- require the history container to be a list
- accept only Mapping entries
- require a positive, non-boolean integer `retry_index`
- skip malformed entries
- preserve valid attempts in persisted order

## Provider behavior

No provider-specific retry translation is needed:

- Unified LangSmith already sends canonical metadata through `extra.metadata`.
- Unified Phoenix already serializes canonical metadata into `openinference.span.metadata`.

The legacy providers remain unchanged.

## Tests

Focused tests will verify:

1. Three persisted retry attempts produce `retry_count: 3` and three ordered summaries.
2. Summary entries contain only the five approved fields and exclude inputs, process data, outputs, and execution metadata.
3. Malformed entries are skipped without failing trace construction.
4. A node without retry history receives no retry metadata.
5. LangSmith receives the canonical retry summary through `extra.metadata`.
6. Phoenix includes the same summary in `openinference.span.metadata`.

## Scope

This change does not create retry spans, alter node hierarchy, expose full attempt payloads, modify retry persistence, or change legacy tracing providers.

# KnowledgeFS public error contract

KnowledgeFS exposes a stable, additive failure contract to Dify. Internal exception messages remain
in server diagnostics and must not cross the product boundary because provider responses can contain
credentials, headers, signed URLs, database details, or other deployment data.

## HTTP contract

Dify requests version 2 by sending:

```http
X-KnowledgeFS-Error-Contract: 2
```

An unsuccessful JSON response retains the legacy `code` and `error` properties and adds `failure`:

```json
{
  "code": "MODEL_SELECTION_NOT_FOUND",
  "error": "The selected model is no longer available in this workspace. Select another model before retrying.",
  "failure": {
    "action": "configure_model",
    "category": "configuration",
    "code": "MODEL_SELECTION_NOT_FOUND",
    "message": "The selected model is no longer available in this workspace. Select another model before retrying.",
    "retryPolicy": "after_configuration",
    "stage": "model_preflight",
    "traceId": "trace-reference"
  }
}
```

Direct clients that do not request version 2 continue to receive the legacy response shape during the
compatibility window. Dify always requests version 2 and validates the response before forwarding it.
Malformed structured failures are discarded and replaced by the existing generic BFF error.
The BFF also replaces every upstream `message` with category-owned copy; a registered code alone is
not sufficient to make arbitrary upstream text trustworthy.

## Failure fields

| Field | Required | Meaning |
| --- | --- | --- |
| `code` | yes | Registered, stable machine code. Unknown diagnostic codes become a registered family fallback. |
| `category` | yes | One of `authorization`, `canceled`, `configuration`, `conflict`, `dependency`, `internal`, `not_found`, `rate_limit`, `timeout`, or `validation`. |
| `message` | yes | Safe server fallback. Web clients should prefer localized copy selected from category and action. |
| `retryPolicy` | yes | `automatic`, `manual`, `after_configuration`, or `never`. |
| `action` | no | Suggested recovery: `configure_model`, `configure_parser`, `configure_source`, `contact_admin`, `reupload`, or `retry`. |
| `parameters` | no | At most eight allowlisted scalar hints. Arbitrary keys and secret-bearing values are rejected. |
| `stage` | no | Identifier-only public processing stage matching `^[a-z][a-z0-9_.-]{0,127}$`. |
| `traceId` | no | Identifier-only support reference matching `^[A-Za-z0-9._:-]{1,128}$`; it is not an authorization token. |

## Retry semantics

- `automatic`: the failure is transient. Workers may retry, and a user may retry a terminal task.
- `manual`: automatic attempts are exhausted or inappropriate, but an explicit retry is safe.
- `after_configuration`: retry is disabled until the indicated configuration is changed.
- `never`: retrying the same operation cannot succeed; the user must change the input or permissions.

The UI must derive its Retry button from `retryPolicy`, not merely from `state == failed`.

## Background tasks and streams

Document, source, bulk, semantic-enrichment, and research task responses expose the same `failure`
shape. Legacy `errorCode` and `errorMessage` remain during migration; `errorMessage` is always replaced
with the catalog fallback before it is returned. A terminal document-task SSE event contains the same
failure object as polling, so changing transport cannot change the user-visible diagnosis. Research
task polling and progress SSE follow the same rule. Query-stream `answer.error` events also include a
structured `failure`; no raw model, provider, or runtime exception is written into the stream.
Nonterminal research progress events deliberately omit worker retry exception text; only bounded
stage and retry metadata are public.

Some asynchronous failures are returned inside successful HTTP responses. Failed source workflows,
source imports, source credential tests, document compilation jobs, staged commits, and knowledge
space status diagnostics therefore use the same `failure` contract and sanitize their legacy fields
before serialization. A `200` status never makes a stored provider or parser message public.

The public `code` field is a closed set generated from the central KnowledgeFS catalog. Dify rejects
unknown or malformed structured failures instead of forwarding their message, and Web has an
exhaustive mapping for every generated code. Adding a new public code therefore requires updating the
catalog, generated contracts, and product presentation together.

## Security and observability rules

- Only messages declared in the central catalog, or an explicitly reviewed `publicMessage`, may be
  returned or persisted as a product-facing message.
- Unknown exceptions and unknown codes become `KNOWLEDGE_FS_INTERNAL_ERROR` or a registered family
  fallback. The original exception stays in structured server logs.
- Public parameters use an explicit key allowlist. File contents, filenames, URLs, credentials,
  headers, provider payloads, SQL text, stack traces, and exception messages are prohibited.
- `stage` and `traceId` accept identifiers only. Secret-bearing prose is dropped even when supplied
  in a structurally valid failure object.
- Dify logs only the upstream status, registered code, category, action, operation ID, and trace ID.
- Web renders localized category/action copy and may display `traceId` for internal failures. It never
  renders the legacy raw message.

## Adding a failure

1. Add a stable descriptor to `packages/api/src/knowledge-fs-errors.ts`.
2. Choose the HTTP status, category, retry policy, and recovery action deliberately.
3. Map the internal exception to the code without copying its diagnostic message.
4. Add tests for normalization, polling/SSE parity, retry behavior, BFF validation, and UI fallback as
   applicable.
5. Regenerate the KnowledgeFS OpenAPI and Dify contract artifacts and update the contract lock after
   reviewing the diff.

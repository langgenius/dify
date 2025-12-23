# Node.js SDK Refactor and Enhancement Spec

## Context

Dify provides a Python SDK with broad coverage and a smaller Node.js SDK. This document defines a detailed requirements and design plan to refactor and enhance the Node.js SDK. Scope is the Service API in this repo (`api/controllers/service_api`), with complete chatflow (advanced chat) and workflow coverage. The Node SDK must be ESM-only, and configuration should mirror the Python SDK.

## Python SDK Baseline (Config, Errors, Streaming)

- Config parity target: `base_url` (default `https://api.dify.ai/v1`), `timeout` (seconds), `max_retries`, `retry_delay`, `enable_logging`.
- Node config exposes the same set of options (camelCase names) with identical defaults.
- Retry behavior: exponential backoff on network/timeout errors; no retry on 4xx except 429.
- Error mapping: AuthenticationError (401), RateLimitError (429 + Retry-After), ValidationError (422), APIError (>=400), NetworkError, TimeoutError, FileUploadError.
- Validation: `user` is string, `rating` in `["like", "dislike"]`, pagination ints, files list/dict, max size/length checks.
- Streaming: SSE-style `data:` lines parsed from `iter_lines`; `response_mode="streaming"` activates streaming consumption.
- Service API streaming may emit `event:` lines in SSE (not just `data:`).
- Async: Python has separate async clients; Node should be async-first and provide streaming iterators.
- Scope note: Python SDK includes non-service API endpoints; Node scope is Service API only.

## Current Node.js SDK Assessment (sdks/nodejs-client)

### Existing coverage

- DifyClient: feedback, parameters, file upload, text-to-audio, meta.
- CompletionClient: create completion message.
- ChatClient: create chat, suggested, stop, conversations list, messages list, rename/delete conversation, audio-to-text.
- WorkflowClient: run and stop workflow.
- Streaming: supported via axios responseType "stream" but no SSE parsing helper.

### Gaps vs Service API

- No Knowledge Base client: datasets, documents, segments, child chunks, metadata, tags, hit-testing, RAG pipeline.
- No Workspace models endpoint.
- Missing app info/site and file preview endpoints.
- Missing conversation variables and annotations endpoints.
- Missing message feedback list and completion stop.
- Missing pipeline streaming support (datasource node run and pipeline run).
- No dataset-token auth support (service API uses app tokens and dataset tokens).
- Missing async streaming helpers (async iterators, SSE parsing with `event:` lines).
- Missing retriever_from support for chat/completion.
- Missing binary response handling for file preview and text-to-audio streaming.

### Refactor targets and issues

- Inconsistent method placement: CompletionClient includes runWorkflow; WorkflowClient duplicates.
- getConversations uses first_id parameter but Service API uses last_id.
- getSuggested uses GET but sends user in request body, not query params.
- messageFeedback rating type is number in types, but API expects "like"/"dislike".
- File upload detection only handles global FormData; lacks Node form-data support and boundary headers.
- Chatflow support is missing (no workflow_id in chat payload, no chatflow-specific helpers).
- Missing completion stop endpoint and message feedback content support.
- No timeout, retry, or rate limit handling.
- No standardized error types or error body parsing.
- No request/response logging parity (`enableLogging` in Node, `enable_logging` in Python).
- No typed response models; index.d.ts uses many any types.
- ESM-only distribution is required, but the current JS-only build and thin typings are insufficient.
- Tests cover only a small subset; no streaming, error mapping, or file upload edge cases.

## Requirements

### Functional requirements

1. Service API coverage (complete)
   - App/core: `/parameters`, `/meta`, `/info`, `/site`, `/files/upload`, `/files/{file_id}/preview`, `/audio-to-text`, `/text-to-audio`.
   - Completion: `/completion-messages`, `/completion-messages/{task_id}/stop`.
   - Chat + chatflow (advanced chat): `/chat-messages`, `/chat-messages/{task_id}/stop`, `/conversations`, `/conversations/{id}`, `/conversations/{id}/name`, `/messages`, `/messages/{id}/suggested`, `/messages/{id}/feedbacks`, `/app/feedbacks`, `/conversations/{id}/variables`, `/conversations/{id}/variables/{variable_id}`, annotation APIs under `/apps/annotations` and `/apps/annotation-reply`.
   - Workflow: `/workflows/run`, `/workflows/run/{workflow_run_id}`, `/workflows/{workflow_id}/run`, `/workflows/tasks/{task_id}/stop`, `/workflows/logs`.
   - Knowledge base: datasets, documents, indexing status, segments, child chunks, metadata, tags, hit-testing, RAG pipeline, document status batch updates.
   - Workspace: `/workspaces/current/models/model-types/{model_type}`.
1. Async and streaming support (comprehensive)
   - All SDK methods are `async` (Promise-based); no sync variants.
   - Provide SSE parsing for both `data:` and `event:` lines, plus AsyncIterable helpers.
   - Streaming endpoints: chat/completion/workflow runs, RAG pipeline run, datasource node run, and any response_mode=streaming variants.
1. Configuration parity with Python SDK
   - `baseUrl`, `timeout`, `maxRetries`, `retryDelay`, `enableLogging` only (same semantics as Python).
   - Retry logic mirrors Python SDK behavior (exponential backoff on network/timeout errors).
1. File upload support
   - Accept FormData, Blob/File, or Node stream with metadata.
   - Handle multipart boundaries and headers correctly.
1. Error handling
   - Map HTTP errors to typed exceptions with status_code, message, and response body.
   - Honor Retry-After for 429 responses.
1. Typed models
   - Provide TypeScript interfaces for request and response payloads.
   - Avoid `any` in public surface.
1. Backward compatibility
   - Preserve existing exports and method names where possible.
   - Deprecation warnings for renamed or moved methods.

### Non-functional requirements

- TypeScript-first source with generated .d.ts.
- ESM-only distribution (Node SDK must be ESM).
- Node 18+ support.
- Deterministic, low-dependency HTTP layer.
- Comprehensive unit tests and lightweight integration tests (mocked HTTP).
- Clear documentation and examples.

## Service API Inventory (Authoritative for Node SDK)

### Root

- GET `/`

### App Core

- GET `/parameters`
- GET `/meta`
- GET `/info`
- GET `/site`

### Files and Audio

- POST `/files/upload` (multipart/form-data)
- GET `/files/{file_id}/preview` (query: `as_attachment`, binary response)
- POST `/audio-to-text` (multipart/form-data)
- POST `/text-to-audio` (payload: `message_id`, `voice`, `text`, `streaming`, binary response when streaming)

### Completion

- POST `/completion-messages` (supports `response_mode`, `retriever_from`)
- POST `/completion-messages/{task_id}/stop`

### Chat + Chatflow (advanced chat)

- POST `/chat-messages`
  - Payload: `inputs`, `query`, `files`, `response_mode`, `conversation_id`, `auto_generate_name`, `workflow_id`, `retriever_from`
  - Notes: `workflow_id` enables chatflow; `response_mode="streaming"` returns SSE.
- POST `/chat-messages/{task_id}/stop`
- GET `/conversations` (query: `last_id`, `limit`, `sort_by`)
- DELETE `/conversations/{conversation_id}`
- POST `/conversations/{conversation_id}/name` (payload: `name`, `auto_generate`)
- GET `/messages` (query: `conversation_id`, `first_id`, `limit`)
- GET `/messages/{message_id}/suggested`
- POST `/messages/{message_id}/feedbacks` (payload: `rating`, `content`)
- GET `/app/feedbacks` (query: `page`, `limit`)
- GET `/conversations/{conversation_id}/variables` (query: `last_id`, `limit`, `variable_name`)
- PUT `/conversations/{conversation_id}/variables/{variable_id}` (payload: `value`)

### Annotations

- POST `/apps/annotation-reply/{action}`
- GET `/apps/annotation-reply/{action}/status/{job_id}`
- GET/POST `/apps/annotations`
- PUT/DELETE `/apps/annotations/{annotation_id}`

### Workflow

- POST `/workflows/run` (supports `response_mode`)
- GET `/workflows/run/{workflow_run_id}`
- POST `/workflows/{workflow_id}/run` (supports `response_mode`)
- POST `/workflows/tasks/{task_id}/stop`
- GET `/workflows/logs` (query: keyword/status/time range/pagination)

### Knowledge Base (Datasets)

- GET/POST `/datasets`
- GET/PATCH/DELETE `/datasets/{dataset_id}`
- PATCH `/datasets/{dataset_id}/documents/status/{action}` (body: `document_ids: string[]`)
- GET/POST/PATCH/DELETE `/datasets/tags`
- POST `/datasets/tags/binding`
- POST `/datasets/tags/unbinding`
- GET `/datasets/{dataset_id}/tags`

### Documents

- POST `/datasets/{dataset_id}/document/create_by_text` (alias `/create-by-text`)
- POST `/datasets/{dataset_id}/documents/{document_id}/update_by_text` (alias `/update-by-text`)
- POST `/datasets/{dataset_id}/document/create_by_file` (alias `/create-by-file`)
- POST `/datasets/{dataset_id}/documents/{document_id}/update_by_file` (alias `/update-by-file`)
- GET `/datasets/{dataset_id}/documents`
- GET `/datasets/{dataset_id}/documents/{batch}/indexing-status`
- GET/DELETE `/datasets/{dataset_id}/documents/{document_id}`

### Segments

- POST/GET `/datasets/{dataset_id}/documents/{document_id}/segments`
- GET/POST/DELETE `/datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}`

### Child Chunks

- POST/GET `/datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks`
- PATCH/DELETE `/datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}`

### Metadata

- GET/POST `/datasets/{dataset_id}/metadata`
- PATCH/DELETE `/datasets/{dataset_id}/metadata/{metadata_id}`
- GET `/datasets/{dataset_id}/metadata/built-in`
- POST `/datasets/{dataset_id}/metadata/built-in/{action}`
- POST `/datasets/{dataset_id}/documents/metadata`

### Hit Testing

- POST `/datasets/{dataset_id}/hit-testing`
- POST `/datasets/{dataset_id}/retrieve` (alias)

### RAG Pipeline

- GET `/datasets/{dataset_id}/pipeline/datasource-plugins`
- POST `/datasets/{dataset_id}/pipeline/datasource/nodes/{node_id}/run` (streaming)
- POST `/datasets/{dataset_id}/pipeline/run` (supports `response_mode`)
- POST `/datasets/pipeline/file-upload`
  - Note: routes are defined in `api/controllers/service_api/dataset/rag_pipeline/` but not imported in `api/controllers/service_api/__init__.py`, so they are not exposed unless registered.

### Workspace

- GET `/workspaces/current/models/model-types/{model_type}`

## Service API Authentication

- App endpoints use an app API token (`ApiToken.type = "app"`) via `Authorization: Bearer <token>`.
- Dataset and workspace endpoints use a dataset API token (`ApiToken.type = "dataset"`).
- SDK must expose a clear separation: app-scoped clients (chat/completion/workflow/etc) and dataset-scoped clients (knowledge base + workspace models).

## End-User Context

- Many app endpoints require a `user` identifier in query or body (chat, completion, conversations, messages, feedback, file upload, audio).
- SDK must place `user` in the correct location per endpoint (query vs JSON vs form data).
- `user` is required for chat/completion APIs even though it is not part of their Pydantic payload schemas.
- Placement reference:
  - Query: `/conversations`, `/messages`, `/messages/{message_id}/suggested`, `/conversations/{conversation_id}/variables`, `/files/{file_id}/preview`.
  - JSON: `/completion-messages`, `/completion-messages/{task_id}/stop`, `/chat-messages`, `/chat-messages/{task_id}/stop`, `/conversations/{conversation_id}/name`, `/conversations/{conversation_id}` (delete), `/messages/{message_id}/feedbacks`, `/text-to-audio`, `/workflows/run`, `/workflows/{workflow_id}/run`, `/workflows/tasks/{task_id}/stop`.
  - Form: `/files/upload`, `/audio-to-text`.

## Proposed Design

### Package structure

```
sdks/nodejs-client/
  src/
    index.ts
    client/
      base.ts
      chat.ts
      completion.ts
      workflow.ts
      knowledge-base.ts
      workspace.ts
    http/
      client.ts
      retry.ts
      sse.ts
      form-data.ts
    types/
      common.ts
      chat.ts
      completion.ts
      workflow.ts
      knowledge-base.ts
      workspace.ts
    errors/
      dify-error.ts
  tests/
  dist/
```

### Module format

- ESM-only package (`type: "module"`), explicit `exports` map, and generated typings.
- No CommonJS build; provide migration guidance for CJS consumers.

### HTTP layer

- Use axios (ESM) as the HTTP client to minimize migration risk.
- Centralize request building: method, base URL, headers, query params, body, responseType.
- Implement retry strategy aligned with Python SDK:
  - Exponential backoff with jitter.
  - Retry network errors and timeouts; honor `Retry-After` on 429; do not retry other 4xx.
- Timeout handling aligned with Python SDK:
  - Single `timeout` (seconds) for total request duration; default 60.
  - Internal connect timeout of 5s where feasible.
  - For streaming, allow `timeout=0` to disable.
- Set a default User-Agent (e.g., `dify-client-node/<version>`) similar to Python SDK.

### Async model

- All methods return Promises (async-first, no sync client).
- Streaming APIs expose AsyncIterable helpers plus access to raw Node Readable streams.

### Client configuration (Python parity)

```
type DifyClientConfig = {
  apiKey: string
  baseUrl?: string
  timeout?: number
  maxRetries?: number
  retryDelay?: number
  enableLogging?: boolean
}
```

- Use seconds for timeout to match Python SDK.
- No extra configuration knobs beyond Python parity; per-request options are limited to API payload fields.
- Convert timeout seconds to axios milliseconds internally.
- `enableLogging` logs request method/URL and response status without sensitive payloads.
- Defaults: timeout 60s, maxRetries 3, retryDelay 1s.

### Parameter validation (match Python behavior)

- Reject empty/whitespace-only strings and oversize strings.
- Validate pagination params are integers.
- Validate `rating` is `"like"` or `"dislike"`.
- Validate `files` is list or dict.
- Enforce list and dict size limits where applicable.

### Streaming model

- Implement SSE parsing in http/sse.ts:
  - Parse both "data:" and "event:" lines and emit structured events.
  - Support JSON decoding and error frames.
- Expose stream APIs as async iterators:
  - createChatMessageStream(...) returns AsyncIterable<ChatStreamEvent>
  - createCompletionMessageStream(...)
  - workflowRunStream(...)
  - pipelineRunStream(...)
  - datasourceNodeRunStream(...)
- Provide helpers:
  - stream.toText() to concatenate answer chunks.
  - stream.toReadable() for Node streams.
- Support binary streaming for text-to-audio when `streaming=true` (raw audio stream, not SSE).

### File upload

- Provide a helper to normalize inputs:
  - Node: accept fs.ReadStream with filename and contentType.
  - Browser: accept File or Blob.
- If FormData is provided, do not override Content-Type.
- For Node form-data library, merge form.getHeaders() into request headers.

### Error handling

- Create error classes:
  - DifyError (base), APIError, AuthenticationError, RateLimitError, ValidationError, NetworkError, TimeoutError.
- Normalize error payloads to include:
  - statusCode, message, responseBody, requestId if present.
- Surface `retryAfter` on RateLimitError when the header is present.
- Do not rely on `code`/`error_code` semantics; treat HTTP status and raw response body as authoritative.

### API surface and method layout

- DifyClient: base methods and common config.
- Sub-clients:
  - ChatClient, CompletionClient, WorkflowClient, KnowledgeBaseClient, WorkspaceClient.
- Token scoping:
  - App token clients: DifyClient, ChatClient, CompletionClient, WorkflowClient.
  - Dataset token clients: KnowledgeBaseClient, WorkspaceClient.
- Prefer composition over inheritance for easier testing:
  - Each sub-client receives a shared HttpClient instance.
- ChatClient supports chat and chatflow (advanced chat); workflow_id in the request enables chatflow.
- Keep compatibility:
  - Export legacy classes that delegate to new implementation.
  - Deprecate CompletionClient.runWorkflow in favor of WorkflowClient.run.

### Types and models

- Provide typed request/response interfaces based on API specs.
- Expose a generic response wrapper:
  - DifyResponse<T> = { data: T; status: number; headers: Record\<string, string> }
- Provide specific stream event types:
  - ChatStreamEvent, CompletionStreamEvent, WorkflowStreamEvent, PipelineStreamEvent.
- Chat request model includes workflow_id, auto_generate_name, and retriever_from.
- Completion request model includes retriever_from.

### Documentation and examples

- Add usage examples:
  - Blocking chat/completion.
  - Streaming with async iterator.
  - Chatflow example using workflow_id in /chat-messages.
  - Dataset/document lifecycle example using dataset token.
  - RAG pipeline streaming example.
  - File upload with FormData and Node streams.
  - Error handling with try/catch and error types.
- Provide best practice guidance:
  - Use unique user IDs.
  - Reuse client instances for connection pooling.
  - Respect rate limits and backoff on 429.
  - Prefer streaming for long outputs.

## Migration and Compatibility Plan

1. Phase 1: Introduce new TypeScript core and HTTP layer while preserving current API.
1. Phase 2: Expand API coverage to complete Service API inventory.
1. Phase 3: Deprecate legacy inconsistencies (runWorkflow on CompletionClient, wrong params).
1. Phase 4: Publish major release with full Service API parity, ESM-only packaging, and typed surface.

## Implementation Checklist

- Build TypeScript ESM scaffolding with exports map and typings.
- Implement HttpClient (axios) with retries, timeout, and enableLogging.
- Add SSE parser + AsyncIterable helpers for streaming endpoints (support `event:` lines).
- Implement app-scope clients: DifyClient, ChatClient, CompletionClient, WorkflowClient.
- Implement dataset-scope clients: KnowledgeBaseClient (datasets, documents, segments, child chunks, metadata, tags, hit-testing, pipeline).
- Implement WorkspaceClient for available models.
- Add parameter validation mirroring Python SDK.
- Add error classes and error mapping.
- Add retriever_from support for chat/completion requests.
- Handle binary responses for file preview and text-to-audio streaming.
- Address RAG pipeline registration (document or guard availability if not registered).
- Update README and usage examples (chatflow, workflow, datasets, pipeline).
- Add unit tests for requests, errors, and streaming.

## Testing Plan

- Unit tests for:
  - Request building, headers, params, and body.
  - Correct placement of `user` in query/body/form per endpoint.
  - Error mapping and retry logic.
  - SSE parsing with sample payloads (`data:` and `event:` lines).
  - File upload header behavior.
  - Binary response handling for file preview and text-to-audio streaming.
  - Dataset-token auth flows and scope separation.
  - Pipeline/datasource streaming response handling.
- Integration-style tests using mocked HTTP (MSW or nock).
- Optional smoke tests against a local Dify instance (disabled by default).

## Risks and Mitigations

- API mismatch risk: Validate endpoints against Dify Service API docs and integration tests.
- Streaming compatibility: Account for axios stream handling differences and fallback to buffered mode if needed.
- ESM-only adoption: Provide migration guidance for CommonJS consumers.
- Token scope confusion: Clearly separate app-token vs dataset-token clients and validate in docs/tests.
- Backward compatibility: Maintain legacy exports and provide clear migration docs.

## Best Practices Summary

- Always set a stable user identifier for conversation continuity.
- Use streaming for long responses to reduce latency.
- Handle 429 with backoff and respect Retry-After.
- Keep a single shared client per service for efficiency.
- Avoid logging sensitive data even when enableLogging is true.
- Use dataset tokens for knowledge base and workspace endpoints.

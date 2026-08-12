# Non-JSON OpenAPI Responses

Scope: endpoints emitted by `api/dev/generate_swagger_specs.py` into the generated `console`, `openapi`, `service`, and `web` specs.

The current Flask-RESTX generator still emits these response entries under `application/json`. The schema model names below record the actual runtime response intent so contract generation does not treat them as missing annotations.

## Binary And Audio

| Spec    | Method | Path                                                                    | Runtime response                               | Schema                |
| ------- | ------ | ----------------------------------------------------------------------- | ---------------------------------------------- | --------------------- |
| console | POST   | `/apps/{app_id}/text-to-audio`                                          | Audio stream, usually `audio/mpeg`             | `AudioBinaryResponse` |
| console | POST   | `/installed-apps/{installed_app_id}/text-to-audio`                      | Audio stream, usually `audio/mpeg`             | `AudioBinaryResponse` |
| console | POST   | `/trial-apps/{app_id}/text-to-audio`                                    | Audio stream, usually `audio/mpeg`             | `AudioBinaryResponse` |
| web     | POST   | `/text-to-audio`                                                        | Audio stream, usually `audio/mpeg`             | `AudioBinaryResponse` |
| service | POST   | `/text-to-audio`                                                        | Audio stream, usually `audio/mpeg`             | `AudioBinaryResponse` |
| console | POST   | `/datasets/{dataset_id}/documents/download-zip`                         | `application/zip` attachment                   | `BinaryFileResponse`  |
| service | POST   | `/datasets/{dataset_id}/documents/download-zip`                         | `application/zip` attachment                   | `BinaryFileResponse`  |
| service | GET    | `/files/{file_id}/preview`                                              | Original file MIME type, optionally attachment | `BinaryFileResponse`  |
| console | GET    | `/workspaces/current/plugin/icon`                                       | Plugin asset MIME type                         | `BinaryFileResponse`  |
| console | GET    | `/workspaces/current/plugin/asset`                                      | `application/octet-stream`                     | `BinaryFileResponse`  |
| console | GET    | `/workspaces/current/tool-provider/builtin/{provider}/icon`             | Tool icon MIME type                            | `BinaryFileResponse`  |
| console | GET    | `/workspaces/current/trigger-provider/{provider}/icon`                  | Trigger icon response                          | `BinaryFileResponse`  |
| console | GET    | `/workspaces/{tenant_id}/model-providers/{provider}/{icon_type}/{lang}` | Model provider icon MIME type                  | `BinaryFileResponse`  |

## Text File Exports

| Spec    | Method | Path                                                          | Runtime response                                                        | Schema             |
| ------- | ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| console | GET    | `/apps/{app_id}/feedbacks/export`                             | `text/csv` attachment by default; `format=json` returns JSON attachment | `TextFileResponse` |
| console | GET    | `/workspaces/current/customized-snippets/{snippet_id}/export` | `application/x-yaml` attachment                                         | `TextFileResponse` |

## Fixed SSE Streams

| Spec    | Method | Path                                                                   | Runtime response    | Schema                |
| ------- | ------ | ---------------------------------------------------------------------- | ------------------- | --------------------- |
| console | GET    | `/workflow/{workflow_run_id}/events`                                   | `text/event-stream` | `EventStreamResponse` |
| console | GET    | `/apps/{app_id}/workflows/draft/runs/{run_id}/node-outputs/events`     | `text/event-stream` | `EventStreamResponse` |
| console | GET    | `/apps/{app_id}/workflows/published/runs/{run_id}/node-outputs/events` | `text/event-stream` | `EventStreamResponse` |
| openapi | POST   | `/apps/{app_id}/run`                                                   | `text/event-stream` | `EventStreamResponse` |
| openapi | GET    | `/apps/{app_id}/tasks/{task_id}/events`                                | `text/event-stream` | `EventStreamResponse` |
| service | GET    | `/workflow/{task_id}/events`                                           | `text/event-stream` | `EventStreamResponse` |
| web     | GET    | `/workflow/{task_id}/events`                                           | `text/event-stream` | `EventStreamResponse` |

## Generated Responses With Streaming Variants

These endpoints call `helper.compact_generate_response(...)`. They return JSON in blocking mode and `text/event-stream` in streaming mode. Some console/debug paths always pass `streaming=True`.

| Spec    | Method | Path                                                                              | Streaming behavior                                                        | Schema                      |
| ------- | ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------- |
| console | POST   | `/apps/{app_id}/completion-messages`                                              | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| console | POST   | `/apps/{app_id}/advanced-chat/workflows/draft/run`                                | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/apps/{app_id}/advanced-chat/workflows/draft/iteration/nodes/{node_id}/run`      | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/apps/{app_id}/advanced-chat/workflows/draft/loop/nodes/{node_id}/run`           | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/apps/{app_id}/workflows/draft/run`                                              | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/apps/{app_id}/workflows/draft/iteration/nodes/{node_id}/run`                    | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/apps/{app_id}/workflows/draft/loop/nodes/{node_id}/run`                         | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/apps/{app_id}/workflows/draft/trigger/run`                                      | Returns waiting JSON until an event arrives; then streams workflow events | `GeneratedAppResponse`      |
| console | POST   | `/apps/{app_id}/workflows/draft/trigger/run-all`                                  | Returns waiting JSON until an event arrives; then streams workflow events | `GeneratedAppResponse`      |
| console | GET    | `/installed-apps/{installed_app_id}/messages/{message_id}/more-like-this`         | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| console | POST   | `/installed-apps/{installed_app_id}/completion-messages`                          | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| console | POST   | `/installed-apps/{installed_app_id}/chat-messages`                                | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/installed-apps/{installed_app_id}/workflows/run`                                | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/trial-apps/{app_id}/chat-messages`                                              | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/trial-apps/{app_id}/completion-messages`                                        | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| console | POST   | `/trial-apps/{app_id}/workflows/run`                                              | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/snippets/{snippet_id}/workflows/draft/run`                                      | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/snippets/{snippet_id}/workflows/draft/iteration/nodes/{node_id}/run`            | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/snippets/{snippet_id}/workflows/draft/loop/nodes/{node_id}/run`                 | Always streaming                                                          | `GeneratedAppResponse`      |
| console | POST   | `/rag/pipelines/{pipeline_id}/workflows/draft/run`                                | Always streaming                                                          | `RagPipelineOpaqueResponse` |
| console | POST   | `/rag/pipelines/{pipeline_id}/workflows/published/run`                            | `response_mode=streaming`                                                 | `RagPipelineOpaqueResponse` |
| console | POST   | `/rag/pipelines/{pipeline_id}/workflows/draft/iteration/nodes/{node_id}/run`      | Always streaming                                                          | `RagPipelineOpaqueResponse` |
| console | POST   | `/rag/pipelines/{pipeline_id}/workflows/draft/loop/nodes/{node_id}/run`           | Always streaming                                                          | `RagPipelineOpaqueResponse` |
| console | POST   | `/rag/pipelines/{pipeline_id}/workflows/draft/datasource/nodes/{node_id}/run`     | Always streaming                                                          | `RagPipelineOpaqueResponse` |
| console | POST   | `/rag/pipelines/{pipeline_id}/workflows/published/datasource/nodes/{node_id}/run` | Always streaming                                                          | `RagPipelineOpaqueResponse` |
| service | POST   | `/completion-messages`                                                            | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| service | POST   | `/chat-messages`                                                                  | `response_mode=streaming`; agent apps are streaming-only                  | `GeneratedAppResponse`      |
| service | POST   | `/workflows/run`                                                                  | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| service | POST   | `/workflows/{workflow_id}/run`                                                    | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| service | POST   | `/datasets/{dataset_id}/pipeline/run`                                             | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| service | POST   | `/datasets/{dataset_id}/pipeline/datasource/nodes/{node_id}/run`                  | Always streaming                                                          | `GeneratedAppResponse`      |
| web     | POST   | `/completion-messages`                                                            | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| web     | POST   | `/chat-messages`                                                                  | `response_mode=streaming`; agent apps are streaming-only                  | `GeneratedAppResponse`      |
| web     | GET    | `/messages/{message_id}/more-like-this`                                           | `response_mode=streaming`                                                 | `GeneratedAppResponse`      |
| web     | POST   | `/workflows/run`                                                                  | Always streaming                                                          | `GeneratedAppResponse`      |

## Redirects Not Included In Generated Contracts

These console endpoints are browser redirect flows with no 2xx success response. They are documented in the backend OpenAPI as `302` responses with `RedirectResponse`, but `openapi-ts.api.config.ts` excludes 3xx-only operations from the oRPC contract input because they are not JSON contract operations.

| Spec    | Method | Path                                              | Runtime response                                  | Schema             |
| ------- | ------ | ------------------------------------------------- | ------------------------------------------------- | ------------------ |
| console | GET    | `/mcp/oauth/callback`                             | Redirect to console OAuth result page             | `RedirectResponse` |
| console | GET    | `/oauth/authorize/{provider}`                     | Redirect to OAuth authorization URL               | `RedirectResponse` |
| console | GET    | `/oauth/data-source/callback/{provider}`          | Redirect to console with data source OAuth result | `RedirectResponse` |
| console | GET    | `/oauth/login/{provider}`                         | Redirect to OAuth authorization URL               | `RedirectResponse` |
| console | GET    | `/oauth/plugin/{provider_id}/datasource/callback` | Redirect to console OAuth callback page           | `RedirectResponse` |
| console | GET    | `/oauth/plugin/{provider}/tool/callback`          | Redirect to console tool OAuth result page        | `RedirectResponse` |
| console | GET    | `/oauth/plugin/{provider}/trigger/callback`       | Redirect to console trigger OAuth result page     | `RedirectResponse` |

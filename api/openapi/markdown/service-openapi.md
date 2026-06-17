# Service API
API for application services

## Version: 1.0

### Available authorizations
#### Bearer (HTTP, bearer)
Use the Service API key as a Bearer token in the Authorization header.
Bearer format: API_KEY

---
## service_api
Service operations

### [GET] /
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [IndexInfoResponse](#indexinforesponse)<br> |

### ~~[POST] /datasets/{dataset_id}/document/create_by_text~~

***DEPRECATED***

Deprecated legacy alias for creating a new document by providing text content. Use /datasets/{dataset_id}/document/create-by-text instead.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentTextCreatePayload](#documenttextcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document created successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 400 | Bad request - invalid parameters |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}
**Delete Document**

Permanently delete a document and all its chunks from the knowledge base.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Success. |
| 400 | `document_indexing` : Cannot delete document during indexing. |
| 401 | Unauthorized - invalid API token |
| 403 | `archived_document_immutable` : The archived document is not editable. |
| 404 | `not_found` : Document Not Exists. |

### [GET] /datasets/{dataset_id}/documents/{document_id}
**Get Document**

Retrieve detailed information about a specific document, including its indexing status, metadata, and processing statistics.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| metadata | query | Metadata response mode | No | string, <br>**Available values:** "all", "only", "without", <br>**Default:** all |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document details. The response shape varies based on the `metadata` query parameter. When `metadata` is `only`, only `id`, `doc_type`, and `doc_metadata` are returned. When `metadata` is `without`, `doc_type` and `doc_metadata` are omitted. | **application/json**: [DocumentDetailResponse](#documentdetailresponse)<br> |
| 400 | `invalid_metadata` : Invalid metadata value for the specified key. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : No permission. |  |
| 404 | `not_found` : Document not found. |  |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}
Update an existing document by uploading a file

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  No | **multipart/form-data**: { **"data"**: string, **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Document not found |  |

### ~~[POST] /datasets/{dataset_id}/documents/{document_id}/update_by_text~~

***DEPRECATED***

Deprecated legacy alias for updating an existing document by providing text content. Use /datasets/{dataset_id}/documents/{document_id}/update-by-text instead.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentTextUpdate](#documenttextupdate)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Document not found |  |

---
## default

### [GET] /app/feedbacks
**List App Feedbacks**

Retrieve a paginated list of all feedback submitted for messages in this application, including both end-user and admin feedback.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query | Number of feedbacks per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | A list of application feedbacks. | **application/json**: [AppFeedbackListResponse](#appfeedbacklistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [POST] /messages/{message_id}/feedbacks
**Submit Message Feedback**

Submit feedback for a message. End users can rate messages as `like` or `dislike`, and optionally provide text feedback. Pass `null` for `rating` to revoke previously submitted feedback.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MessageFeedbackPayloadWithUser](#messagefeedbackpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Feedback submitted successfully | **application/json**: [ResultResponse](#resultresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Message does not exist. |  |

---
## default

### [POST] /apps/annotation-reply/{action}
**Configure Annotation Reply**

Enables or disables the annotation reply feature. Requires embedding model configuration when enabling. Executes asynchronously — use [Get Annotation Reply Job Status](/api-reference/annotations/get-annotation-reply-job-status) to track progress.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform: 'enable' or 'disable' | Yes | string, <br>**Available values:** "disable", "enable" |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AnnotationReplyActionPayload](#annotationreplyactionpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotation reply settings task initiated. | **application/json**: [AnnotationJobStatusResponse](#annotationjobstatusresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [GET] /apps/annotation-reply/{action}/status/{job_id}
**Get Annotation Reply Job Status**

Retrieves the status of an asynchronous annotation reply configuration job started by [Configure Annotation Reply](/api-reference/annotations/configure-annotation-reply).

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action type | Yes | string |
| job_id | path | Job ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved task status. | **application/json**: [AnnotationJobStatusResponse](#annotationjobstatusresponse)<br> |
| 400 | `invalid_param` : The specified job does not exist. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Job not found |  |

### [GET] /apps/annotations
**List Annotations**

Retrieves a paginated list of annotations for the application. Supports keyword search filtering.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| keyword | query | Keyword to search annotations | No | string |
| limit | query | Number of annotations per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved annotation list. | **application/json**: [AnnotationList](#annotationlist)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [POST] /apps/annotations
**Create Annotation**

Creates a new annotation. Annotations provide predefined question-answer pairs that the app can match and return directly instead of generating a response.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AnnotationCreatePayload](#annotationcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Annotation created successfully. | **application/json**: [Annotation](#annotation)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [DELETE] /apps/annotations/{annotation_id}
**Delete Annotation**

Deletes an annotation and its associated hit history.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path | Annotation ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Annotation deleted successfully. |
| 401 | Unauthorized - invalid API token |
| 403 | `forbidden` : Insufficient permissions to edit annotations. |
| 404 | `not_found` : Annotation does not exist. |

### [PUT] /apps/annotations/{annotation_id}
**Update Annotation**

Updates the question and answer of an existing annotation.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path | Annotation ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AnnotationCreatePayload](#annotationcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotation updated successfully. | **application/json**: [Annotation](#annotation)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : Insufficient permissions to edit annotations. |  |
| 404 | `not_found` : Annotation does not exist. |  |

---
## default

### [POST] /audio-to-text
**Convert Audio to Text**

Convert audio file to text. Supported MIME types: `audio/mp3`, `audio/mpga`, `audio/m4a`, `audio/wav`, and `audio/amr`. File size limit is `30 MB`.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary, **"user"**: string }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully converted audio to text. | **application/json**: [AudioTranscriptResponse](#audiotranscriptresponse)<br> |
| 400 | - `app_unavailable` : App unavailable or misconfigured. - `provider_not_support_speech_to_text` : Model provider does not support speech-to-text. - `provider_not_initialize` : No valid model provider credentials found. - `provider_quota_exceeded` : Model provider quota exhausted. - `model_currently_not_support` : Current model does not support this operation. - `completion_request_error` : Speech recognition request failed. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 413 | `audio_too_large` : Audio file size exceeded the limit. |  |
| 415 | `unsupported_audio_type` : Audio type is not allowed. |  |
| 500 | `internal_server_error` : Internal server error. |  |

### [POST] /text-to-audio
**Convert Text to Audio**

Convert text to speech.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TextToAudioPayloadWithUser](#texttoaudiopayloadwithuser)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Returns the generated audio. Generator responses are streamed by the service as `audio/mpeg`; otherwise the provider output is returned directly. |
| 400 | - `app_unavailable` : App unavailable or misconfigured. - `provider_not_initialize` : No valid model provider credentials found. - `provider_quota_exceeded` : Model provider quota exhausted. - `model_currently_not_support` : Current model does not support this operation. - `completion_request_error` : Text-to-speech request failed. |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |
| 500 | `internal_server_error` : Internal server error. |

---
## default

### [POST] /chat-messages
**Send Chat Message**

Send a request to the chat application.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatRequestPayloadWithUser](#chatrequestpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successful response. The content type and structure depend on the `response_mode` parameter in the request.  - If `response_mode` is `blocking`, returns `application/json` with a `ChatCompletionResponse` object. - If `response_mode` is `streaming`, returns `text/event-stream` with a stream of Server-Sent Events. | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | - `app_unavailable` : App unavailable or misconfigured. - `not_chat_app` : App mode does not match the API route. - `conversation_completed` : The conversation has ended. - `provider_not_initialize` : No valid model provider credentials found. - `provider_quota_exceeded` : Model provider quota exhausted. - `model_currently_not_support` : Current model unavailable. - `completion_request_error` : Text generation failed. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Conversation does not exist. |  |
| 429 | - `too_many_requests` : Too many concurrent requests for this app. - `rate_limit_error` : The upstream model provider rate limit was exceeded. |  |
| 500 | `internal_server_error` : Internal server error. |  |

### [POST] /chat-messages/{task_id}/stop
**Stop Chat Message Generation**

Stops a chat message generation task. Only supported in `streaming` mode.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | The ID of the task to stop | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RequiredServiceApiUserPayload](#requiredserviceapiuserpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | `not_chat_app` : App mode does not match the API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Task not found |  |

### [GET] /messages/{message_id}/suggested
**Get Next Suggested Questions**

Get next questions suggestions for the current message.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message ID | Yes | string (uuid) |
| user | query | End user identifier | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Suggested questions retrieved successfully | **application/json**: [SimpleResultStringListResponse](#simpleresultstringlistresponse)<br> |
| 400 | - `not_chat_app` : App mode does not match the API route. - `bad_request` : Suggested questions feature is disabled. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Message does not exist. |  |
| 500 | `internal_server_error` : Internal server error. |  |

### [GET] /workflow/{task_id}/events
**Stream Workflow Events**

Resume the Server-Sent Events stream for a workflow run after a pause or a dropped SSE connection. For runs that have already finished, the stream emits a single `workflow_finished` event and closes.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Workflow run ID | Yes | string |
| continue_on_pause | query | Keep the stream open across workflow_paused events | No | boolean |
| include_state_snapshot | query | Replay from persisted state snapshot | No | boolean |
| user | query | End user identifier | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Server-Sent Events stream. Each event is delivered as `data: {JSON}\\n\\n`. Event payloads follow the same schemas as the original streaming response. | **text/event-stream**: [EventStreamResponse](#eventstreamresponse)<br> |
| 400 | `not_workflow_app` : Please check if your app mode matches the right API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Workflow run not found. |  |

### [GET] /workflows/logs
**List Workflow Logs**

Retrieve paginated workflow execution logs with filtering options.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| created_at__after | query |  | No | string |
| created_at__before | query |  | No | string |
| created_by_account | query |  | No | string |
| created_by_end_user_session_id | query |  | No | string |
| keyword | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |
| status | query |  | No | string, <br>**Available values:** "failed", "stopped", "succeeded" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved workflow logs. | **application/json**: [WorkflowAppLogPaginationResponse](#workflowapplogpaginationresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [GET] /workflows/run/{workflow_run_id}
**Get Workflow Run Detail**

Retrieve the current execution results of a workflow task based on the workflow execution ID.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_run_id | path | Workflow run ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved workflow run details. | **application/json**: [WorkflowRunResponse](#workflowrunresponse)<br> |
| 400 | `not_workflow_app` : App mode does not match the API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Workflow run not found. |  |

---
## default

### [POST] /chat-messages
**Send Chat Message**

Send a request to the chat application.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatRequestPayloadWithUser](#chatrequestpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successful response. The content type and structure depend on the `response_mode` parameter in the request.  - If `response_mode` is `blocking`, returns `application/json` with a `ChatCompletionResponse` object. - If `response_mode` is `streaming`, returns `text/event-stream` with a stream of Server-Sent Events. | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | - `app_unavailable` : App unavailable or misconfigured. - `not_chat_app` : App mode does not match the API route. - `conversation_completed` : The conversation has ended. - `provider_not_initialize` : No valid model provider credentials found. - `provider_quota_exceeded` : Model provider quota exhausted. - `model_currently_not_support` : Current model unavailable. - `completion_request_error` : Text generation failed. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Conversation does not exist. |  |
| 429 | - `too_many_requests` : Too many concurrent requests for this app. - `rate_limit_error` : The upstream model provider rate limit was exceeded. |  |
| 500 | `internal_server_error` : Internal server error. |  |

### [POST] /chat-messages/{task_id}/stop
**Stop Chat Message Generation**

Stops a chat message generation task. Only supported in `streaming` mode.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | The ID of the task to stop | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RequiredServiceApiUserPayload](#requiredserviceapiuserpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | `not_chat_app` : App mode does not match the API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Task not found |  |

### [GET] /messages/{message_id}/suggested
**Get Next Suggested Questions**

Get next questions suggestions for the current message.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message ID | Yes | string (uuid) |
| user | query | End user identifier | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Suggested questions retrieved successfully | **application/json**: [SimpleResultStringListResponse](#simpleresultstringlistresponse)<br> |
| 400 | - `not_chat_app` : App mode does not match the API route. - `bad_request` : Suggested questions feature is disabled. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Message does not exist. |  |
| 500 | `internal_server_error` : Internal server error. |  |

---
## default

### [POST] /completion-messages
**Send Completion Message**

Send a request to the text generation application.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CompletionRequestPayloadWithUser](#completionrequestpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successful response. The content type and structure depend on the `response_mode` parameter in the request.  - If `response_mode` is `blocking`, returns `application/json` with a `CompletionResponse` object. - If `response_mode` is `streaming`, returns `text/event-stream` with a stream of `ChunkCompletionEvent` objects. | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | - `app_unavailable` : App unavailable or misconfigured. - `provider_not_initialize` : No valid model provider credentials found. - `provider_quota_exceeded` : Model provider quota exhausted. - `model_currently_not_support` : Current model unavailable. - `completion_request_error` : Text generation failed. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Conversation not found |  |
| 429 | `too_many_requests` : Too many concurrent requests for this app. |  |
| 500 | `internal_server_error` : Internal server error. |  |

### [POST] /completion-messages/{task_id}/stop
**Stop Completion Message Generation**

Stops a completion message generation task. Only supported in `streaming` mode.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | The ID of the task to stop | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RequiredServiceApiUserPayload](#requiredserviceapiuserpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | `app_unavailable` : App unavailable or misconfigured. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Task not found |  |

---
## default

### [GET] /conversations
**List Conversations**

Retrieve the conversation list for the current user, ordered by most recently active.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query | Last conversation ID for pagination | No | string |
| limit | query | Number of conversations to return | No | integer, <br>**Default:** 20 |
| sort_by | query | Sort order for conversations | No | string, <br>**Available values:** "-created_at", "-updated_at", "created_at", "updated_at", <br>**Default:** -updated_at |
| user | query | End user identifier | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved conversations list. | **application/json**: [ConversationInfiniteScrollPagination](#conversationinfinitescrollpagination)<br> |
| 400 | `not_chat_app` : App mode does not match the API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Last conversation does not exist (invalid `last_id`). |  |

### [DELETE] /conversations/{c_id}
**Delete Conversation**

Delete a conversation.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [OptionalServiceApiUserPayload](#optionalserviceapiuserpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully. |
| 400 | `not_chat_app` : App mode does not match the API route. |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |
| 404 | `not_found` : Conversation does not exist. |

### [POST] /conversations/{c_id}/name
**Rename Conversation**

Rename a conversation or auto-generate a name. The conversation name is used for display on clients that support multiple conversations.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ConversationRenamePayloadWithUser](#conversationrenamepayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation renamed successfully. | **application/json**: [SimpleConversation](#simpleconversation)<br> |
| 400 | `not_chat_app` : App mode does not match the API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Conversation does not exist. |  |

### [GET] /conversations/{c_id}/variables
**List Conversation Variables**

Retrieve variables from a specific conversation.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation ID | Yes | string (uuid) |
| last_id | query | Last variable ID for pagination | No | string |
| limit | query | Number of variables to return | No | integer, <br>**Default:** 20 |
| user | query | End user identifier | No | string |
| variable_name | query | Filter variables by name | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved conversation variables. | **application/json**: [ConversationVariableInfiniteScrollPaginationResponse](#conversationvariableinfinitescrollpaginationresponse)<br> |
| 400 | `not_chat_app` : App mode does not match the API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Conversation does not exist. |  |

### [PUT] /conversations/{c_id}/variables/{variable_id}
**Update Conversation Variable**

Update the value of a specific conversation variable. The value must match the expected type.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation ID | Yes | string (uuid) |
| variable_id | path | Variable ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ConversationVariableUpdatePayloadWithUser](#conversationvariableupdatepayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable updated successfully. | **application/json**: [ConversationVariableResponse](#conversationvariableresponse)<br> |
| 400 | - `not_chat_app` : App mode does not match the API route. - `bad_request` : Variable value type mismatch. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | - `not_found` : Conversation does not exist. - `not_found` : Conversation variable does not exist. |  |

### [GET] /messages
**List Conversation Messages**

Returns historical chat records in a scrolling load format, with the first page returning the latest `limit` messages, i.e., in reverse order.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| conversation_id | query | Conversation UUID | Yes | string |
| first_id | query | First message ID for pagination | No | string |
| limit | query | Number of messages to return (1-100) | No | integer, <br>**Default:** 20 |
| user | query | End user identifier | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved conversation history. | **application/json**: [MessageInfiniteScrollPagination](#messageinfinitescrollpagination)<br> |
| 400 | `not_chat_app` : App mode does not match the API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | - `not_found` : Conversation does not exist. - `not_found` : First message does not exist. |  |

---
## default

### [GET] /datasets
**List Knowledge Bases**

Returns a paginated list of knowledge bases. Supports filtering by keyword and tags.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| include_all | query | Include all datasets | No | boolean |
| keyword | query | Search keyword | No | string |
| limit | query | Number of items per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| tag_ids | query | Filter by tag IDs | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | List of knowledge bases. | **application/json**: [DatasetListResponse](#datasetlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets
**Create an Empty Knowledge Base**

Create a new empty knowledge base. After creation, use [Create Document by Text](/api-reference/documents/create-document-by-text) or [Create Document by File](/api-reference/documents/create-document-by-file) to add documents.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasetCreatePayload](#datasetcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Knowledge base created successfully. | **application/json**: [DatasetDetailResponse](#datasetdetailresponse)<br> |
| 400 | Bad request - invalid parameters |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 409 | `dataset_name_duplicate` : The dataset name already exists. Please modify your dataset name. |  |

### [DELETE] /datasets/{dataset_id}
**Delete Knowledge Base**

Permanently delete a knowledge base and all its documents. The knowledge base must not be in use by any application.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Success. |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - dataset API access or workspace access denied |
| 404 | `not_found` : Dataset not found. |
| 409 | `dataset_in_use` : The knowledge base is being used by some apps. Please remove it from the apps before deleting. |

### [GET] /datasets/{dataset_id}
**Get Knowledge Base**

Retrieve detailed information about a specific knowledge base, including its embedding model, retrieval configuration, and document statistics.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Knowledge base details. | **application/json**: [DatasetDetailWithPartialMembersResponse](#datasetdetailwithpartialmembersresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : Insufficient permissions to access this knowledge base. |  |
| 404 | `not_found` : Dataset not found. |  |

### [PATCH] /datasets/{dataset_id}
**Update Knowledge Base**

Update the name, description, permissions, or retrieval settings of an existing knowledge base. Only the fields provided in the request body are updated.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasetUpdatePayload](#datasetupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Knowledge base updated successfully. | **application/json**: [DatasetDetailWithPartialMembersResponse](#datasetdetailwithpartialmembersresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : Insufficient permissions to access this knowledge base. |  |
| 404 | `not_found` : Dataset not found. |  |

### [POST] /datasets/{dataset_id}/hit-testing
**Retrieve Chunks from a Knowledge Base / Test Retrieval**

Performs a search query against a knowledge base to retrieve the most relevant chunks. This endpoint can be used for both production retrieval and test retrieval.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HitTestingPayload](#hittestingpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Retrieval results. | **application/json**: [HitTestingResponse](#hittestingresponse)<br> |
| 400 | - `dataset_not_initialized` : The dataset is still being initialized or indexing. Please wait a moment. - `provider_not_initialize` : No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials. - `provider_quota_exceeded` : Your quota for Dify Hosted OpenAI has been exhausted. Please go to Settings -> Model Provider to complete your own provider credentials. - `model_currently_not_support` : Dify Hosted OpenAI trial currently not support the GPT-4 model. - `completion_request_error` : Completion request failed. - `invalid_param` : Invalid parameter value. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : Insufficient permissions. |  |
| 404 | `not_found` : Knowledge base not found. |  |
| 500 | `internal_server_error` : An internal error occurred during retrieval. |  |

### [POST] /datasets/{dataset_id}/retrieve
**Retrieve Chunks from a Knowledge Base / Test Retrieval**

Performs a search query against a knowledge base to retrieve the most relevant chunks. This endpoint can be used for both production retrieval and test retrieval.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HitTestingPayload](#hittestingpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Retrieval results. | **application/json**: [HitTestingResponse](#hittestingresponse)<br> |
| 400 | - `dataset_not_initialized` : The dataset is still being initialized or indexing. Please wait a moment. - `provider_not_initialize` : No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials. - `provider_quota_exceeded` : Your quota for Dify Hosted OpenAI has been exhausted. Please go to Settings -> Model Provider to complete your own provider credentials. - `model_currently_not_support` : Dify Hosted OpenAI trial currently not support the GPT-4 model. - `completion_request_error` : Completion request failed. - `invalid_param` : Invalid parameter value. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : Insufficient permissions. |  |
| 404 | `not_found` : Knowledge base not found. |  |
| 500 | `internal_server_error` : An internal error occurred during retrieval. |  |

---
## default

### [POST] /datasets/pipeline/file-upload
**Upload Pipeline File**

Upload a file for use in a knowledge pipeline. Accepts a single file via `multipart/form-data`.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully. | **application/json**: [PipelineUploadFileResponse](#pipelineuploadfileresponse)<br> |
| 400 | - `no_file_uploaded` : Please upload your file. - `filename_not_exists_error` : The specified filename does not exist. - `too_many_files` : Only one file is allowed. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 413 | `file_too_large` : File size exceeded. |  |
| 415 | `unsupported_file_type` : File type not allowed. |  |

### [GET] /datasets/{dataset_id}/pipeline/datasource-plugins
**List Datasource Plugins**

List the datasource nodes configured in the knowledge pipeline. Each node includes the plugin it uses plus the metadata needed to run it.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| is_published | query |  | No | boolean, <br>**Default:** true |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | List of datasource nodes configured in the pipeline. | **application/json**: [DatasourcePluginListResponse](#datasourcepluginlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | `not_found` : Dataset not found. |  |

### [POST] /datasets/{dataset_id}/pipeline/datasource/nodes/{node_id}/run
**Run Datasource Node**

Execute a single datasource node within the knowledge pipeline. Returns a streaming response with the node execution results.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceNodeRunPayload](#datasourcenoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Streaming response with node execution events. | **text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | `not_found` : Dataset not found. |  |

### [POST] /datasets/{dataset_id}/pipeline/run
**Run Pipeline**

Execute the full knowledge pipeline for a knowledge base. Supports both streaming and blocking response modes.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [PipelineRunApiEntity](#pipelinerunapientity)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Pipeline execution result. Format depends on `response_mode`: streaming returns a `text/event-stream`, blocking returns a JSON object. | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : Forbidden. |  |
| 404 | `not_found` : Dataset not found. |  |
| 500 | `pipeline_run_error` : Pipeline execution failed. |  |

---
## default

### [DELETE] /datasets/tags
**Delete Knowledge Tag**

Permanently delete a knowledge base tag. Does not delete the knowledge bases that were tagged.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagDeletePayload](#tagdeletepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Success. |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

### [GET] /datasets/tags
**List Knowledge Tags**

Returns the list of all knowledge base tags in the workspace.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | List of tags. | **application/json**: [KnowledgeTagListResponse](#knowledgetaglistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [PATCH] /datasets/tags
**Update Knowledge Tag**

Rename an existing knowledge base tag.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagUpdatePayload](#tagupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tag updated successfully. | **application/json**: [KnowledgeTagResponse](#knowledgetagresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |

### [POST] /datasets/tags
**Create Knowledge Tag**

Create a new tag for organizing knowledge bases.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagCreatePayload](#tagcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tag created successfully. | **application/json**: [KnowledgeTagResponse](#knowledgetagresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |

### [POST] /datasets/tags/binding
**Create Tag Binding**

Bind one or more tags to a knowledge base. A knowledge base can have multiple tags.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagBindingPayload](#tagbindingpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Success. |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

### [POST] /datasets/tags/unbinding
**Delete Tag Binding**

Remove one or more tags from a knowledge base.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagUnbindingPayload](#tagunbindingpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Success. |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

### [GET] /datasets/{dataset_id}/tags
**Get Knowledge Base Tags**

Returns the list of tags bound to a specific knowledge base.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tags bound to the knowledge base. | **application/json**: [DatasetBoundTagListResponse](#datasetboundtaglistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

---
## default

### [POST] /datasets/{dataset_id}/document/create-by-file
**Create Document by File**

Create a document by uploading a file. Supports common document formats (PDF, TXT, DOCX, etc.). Processing is asynchronous — use the returned `batch` ID with [Get Document Indexing Status](/api-reference/documents/get-document-indexing-status) to track progress.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"data"**: string, **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document created successfully. | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 400 | - `no_file_uploaded` : Please upload your file. - `too_many_files` : Only one file is allowed. - `filename_not_exists_error` : The specified filename does not exist. - `provider_not_initialize` : No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials. - `invalid_param` : Knowledge base does not exist, external datasets not supported, file too large, unsupported file type, missing required fields, or invalid doc_form (must be `text_model`, `hierarchical_model`, or `qa_model`). |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets/{dataset_id}/document/create-by-text
**Create Document by Text**

Create a document from raw text content. The document is processed asynchronously — use the returned `batch` ID with [Get Document Indexing Status](/api-reference/documents/get-document-indexing-status) to track progress.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentTextCreatePayload](#documenttextcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document created successfully. | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 400 | - `provider_not_initialize` : No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials. - `invalid_param` : Knowledge base does not exist. / indexing_technique is required. / Invalid doc_form (must be `text_model`, `hierarchical_model`, or `qa_model`). |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### ~~[POST] /datasets/{dataset_id}/document/create_by_file~~

***DEPRECATED***

**Create Document by File**

Create a document by uploading a file. Supports common document formats (PDF, TXT, DOCX, etc.). Processing is asynchronous — use the returned `batch` ID with [Get Document Indexing Status](/api-reference/documents/get-document-indexing-status) to track progress.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"data"**: string, **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document created successfully. | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 400 | - `no_file_uploaded` : Please upload your file. - `too_many_files` : Only one file is allowed. - `filename_not_exists_error` : The specified filename does not exist. - `provider_not_initialize` : No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials. - `invalid_param` : Knowledge base does not exist, external datasets not supported, file too large, unsupported file type, missing required fields, or invalid doc_form (must be `text_model`, `hierarchical_model`, or `qa_model`). |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [GET] /datasets/{dataset_id}/documents
**List Documents**

Returns a paginated list of documents in the knowledge base. Supports filtering by keyword and indexing status.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| keyword | query | Search keyword | No | string |
| limit | query | Number of items per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| status | query | Document status filter | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | List of documents. | **application/json**: [DocumentListResponse](#documentlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | `not_found` : Knowledge base not found. |  |

### [POST] /datasets/{dataset_id}/documents/download-zip
**Download Documents as ZIP**

Download multiple uploaded-file documents as a single ZIP archive. Accepts up to `100` document IDs.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentBatchDownloadZipPayload](#documentbatchdownloadzippayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | ZIP archive containing the requested documents. |
| 401 | Unauthorized - invalid API token |
| 403 | `forbidden` : Insufficient permissions. |
| 404 | `not_found` : Document or dataset not found. |

### [PATCH] /datasets/{dataset_id}/documents/status/{action}
**Update Document Status in Batch**

Enable, disable, archive, or unarchive multiple documents at once.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform: 'enable', 'disable', 'archive', or 'un_archive' | Yes | string, <br>**Available values:** "archive", "disable", "enable", "un_archive" |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentStatusPayload](#documentstatuspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document status updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | `invalid_action` : Invalid action. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : Insufficient permissions. |  |
| 404 | `not_found` : Knowledge base not found. |  |

### [GET] /datasets/{dataset_id}/documents/{batch}/indexing-status
**Get Document Indexing Status**

Check the indexing progress of documents in a batch. Returns the current processing stage and chunk completion counts for each document. Poll this endpoint until `indexing_status` reaches `completed` or `error`. The status progresses through: `waiting` → `parsing` → `cleaning` → `splitting` → `indexing` → `completed`.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| batch | path | Batch ID | Yes | string |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Indexing status for documents in the batch. | **application/json**: [DocumentStatusListResponse](#documentstatuslistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | `not_found` : Knowledge base not found. / Documents not found. |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}
**Delete Document**

Permanently delete a document and all its chunks from the knowledge base.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Success. |
| 400 | `document_indexing` : Cannot delete document during indexing. |
| 401 | Unauthorized - invalid API token |
| 403 | `archived_document_immutable` : The archived document is not editable. |
| 404 | `not_found` : Document Not Exists. |

### [GET] /datasets/{dataset_id}/documents/{document_id}
**Get Document**

Retrieve detailed information about a specific document, including its indexing status, metadata, and processing statistics.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| metadata | query | Metadata response mode | No | string, <br>**Available values:** "all", "only", "without", <br>**Default:** all |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document details. The response shape varies based on the `metadata` query parameter. When `metadata` is `only`, only `id`, `doc_type`, and `doc_metadata` are returned. When `metadata` is `without`, `doc_type` and `doc_metadata` are omitted. | **application/json**: [DocumentDetailResponse](#documentdetailresponse)<br> |
| 400 | `invalid_metadata` : Invalid metadata value for the specified key. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : No permission. |  |
| 404 | `not_found` : Document not found. |  |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}
Update an existing document by uploading a file

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  No | **multipart/form-data**: { **"data"**: string, **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Document not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/download
**Download Document**

Get a signed download URL for a document's original uploaded file.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Download URL generated successfully. | **application/json**: [UrlResponse](#urlresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : No permission to access this document. |  |
| 404 | `not_found` : Document not found. |  |

### ~~[POST] /datasets/{dataset_id}/documents/{document_id}/update-by-file~~

***DEPRECATED***

**Update Document by File**

Update an existing document by uploading a new file. Re-triggers indexing — use the returned `batch` ID with [Get Document Indexing Status](/api-reference/documents/get-document-indexing-status) to track progress.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  No | **multipart/form-data**: { **"data"**: string, **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully. | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 400 | - `too_many_files` : Only one file is allowed. - `filename_not_exists_error` : The specified filename does not exist. - `provider_not_initialize` : No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials. - `invalid_param` : Knowledge base does not exist, external datasets not supported, file too large, unsupported file type, or invalid doc_form (must be `text_model`, `hierarchical_model`, or `qa_model`). |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Document not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/update-by-text
**Update Document by Text**

Update an existing document's text content, name, or processing configuration. Re-triggers indexing if content changes — use the returned `batch` ID with [Get Document Indexing Status](/api-reference/documents/get-document-indexing-status) to track progress.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentTextUpdate](#documenttextupdate)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully. | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 400 | - `provider_not_initialize` : No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials. - `invalid_param` : Knowledge base does not exist, name is required when text is provided, or invalid doc_form (must be `text_model`, `hierarchical_model`, or `qa_model`). |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Document not found |  |

### ~~[POST] /datasets/{dataset_id}/documents/{document_id}/update_by_file~~

***DEPRECATED***

**Update Document by File**

Update an existing document by uploading a new file. Re-triggers indexing — use the returned `batch` ID with [Get Document Indexing Status](/api-reference/documents/get-document-indexing-status) to track progress.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  No | **multipart/form-data**: { **"data"**: string, **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully. | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 400 | - `too_many_files` : Only one file is allowed. - `filename_not_exists_error` : The specified filename does not exist. - `provider_not_initialize` : No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials. - `invalid_param` : Knowledge base does not exist, external datasets not supported, file too large, unsupported file type, or invalid doc_form (must be `text_model`, `hierarchical_model`, or `qa_model`). |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Document not found |  |

---
## default

### [POST] /datasets/{dataset_id}/documents/metadata
**Update Document Metadata in Batch**

Update metadata values for multiple documents at once. Each document in the request receives the specified metadata key-value pairs.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MetadataOperationData](#metadataoperationdata)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document metadata updated successfully. | **application/json**: [DatasetMetadataActionResponse](#datasetmetadataactionresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/metadata
**List Metadata Fields**

Returns the list of all metadata fields (both custom and built-in) for the knowledge base, along with the count of documents using each field.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Metadata fields for the knowledge base. | **application/json**: [DatasetMetadataListResponse](#datasetmetadatalistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/metadata
**Create Metadata Field**

Create a custom metadata field for the knowledge base. Metadata fields can be used to annotate documents with structured information.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MetadataArgs](#metadataargs)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Metadata field created successfully. | **application/json**: [DatasetMetadataResponse](#datasetmetadataresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/metadata/built-in
**Get Built-in Metadata Fields**

Returns the list of built-in metadata fields provided by the system (e.g., document type, source URL).

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Built-in metadata fields. | **application/json**: [DatasetMetadataBuiltInFieldsResponse](#datasetmetadatabuiltinfieldsresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets/{dataset_id}/metadata/built-in/{action}
**Update Built-in Metadata Field**

Enable or disable built-in metadata fields for the knowledge base.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform: 'enable' or 'disable' | Yes | string, <br>**Available values:** "disable", "enable" |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Built-in metadata field toggled successfully. | **application/json**: [DatasetMetadataActionResponse](#datasetmetadataactionresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [DELETE] /datasets/{dataset_id}/metadata/{metadata_id}
**Delete Metadata Field**

Permanently delete a custom metadata field. Documents using this field will lose their metadata values for it.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| metadata_id | path | Metadata ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Success. |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - dataset API access or workspace access denied |
| 404 | Dataset or metadata not found |

### [PATCH] /datasets/{dataset_id}/metadata/{metadata_id}
**Update Metadata Field**

Rename a custom metadata field.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| metadata_id | path | Metadata ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MetadataUpdatePayload](#metadataupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Metadata field updated successfully. | **application/json**: [DatasetMetadataResponse](#datasetmetadataresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset or metadata not found |  |

---
## default

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments
**List Chunks**

Returns a paginated list of chunks within a document. Supports filtering by keyword and status.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| keyword | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |
| status | query |  | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | List of chunks. | **application/json**: [SegmentListResponse](#segmentlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset or document not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments
**Create Chunks**

Create one or more chunks within a document. Each chunk can include optional keywords and an answer field (for QA-mode documents).

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SegmentCreatePayload](#segmentcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Chunks created successfully. | **application/json**: [SegmentCreateListResponse](#segmentcreatelistresponse)<br> |
| 400 | Bad request - segments data is missing |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | `not_found` : Document is not completed or is disabled. |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
**Delete Chunk**

Permanently delete a chunk from the document.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Segment ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Success. |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - dataset API access or workspace access denied |
| 404 | Dataset, document, or segment not found |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
**Get Chunk**

Retrieve detailed information about a specific chunk, including its content, keywords, and indexing status.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Segment ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Chunk details. | **application/json**: [SegmentDetailResponse](#segmentdetailresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, or segment not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
**Update Chunk**

Update a chunk's content, keywords, or answer. Re-triggers indexing for the modified chunk.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Segment ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SegmentUpdatePayload](#segmentupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Chunk updated successfully. | **application/json**: [SegmentDetailResponse](#segmentdetailresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, or segment not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks
**List Child Chunks**

Returns a paginated list of child chunks under a specific parent chunk.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Parent segment ID | Yes | string (uuid) |
| keyword | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | List of child chunks. | **application/json**: [ChildChunkListResponse](#childchunklistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, or segment not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks
**Create Child Chunk**

Create a child chunk under the specified segment.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Parent segment ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChildChunkCreatePayload](#childchunkcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Child chunk created successfully. | **application/json**: [ChildChunkDetailResponse](#childchunkdetailresponse)<br> |
| 400 | `invalid_param` : Create child chunk index failed. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, or segment not found |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}
**Delete Child Chunk**

Permanently delete a child chunk from its parent chunk.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| child_chunk_id | path | Child chunk ID | Yes | string (uuid) |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Parent segment ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Success. |
| 400 | `invalid_param` : Delete child chunk index failed. |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - dataset API access or workspace access denied |
| 404 | Dataset, document, segment, or child chunk not found |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}
**Update Child Chunk**

Update the content of an existing child chunk.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| child_chunk_id | path | Child chunk ID | Yes | string (uuid) |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Parent segment ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChildChunkUpdatePayload](#childchunkupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Child chunk updated successfully. | **application/json**: [ChildChunkDetailResponse](#childchunkdetailresponse)<br> |
| 400 | `invalid_param` : Update child chunk index failed. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, segment, or child chunk not found |  |

---
## default

### [GET] /end-users/{end_user_id}
**Get End User Info**

Retrieve an end user by ID. Useful when other APIs return an end-user ID (e.g., `created_by` from [Upload File](/api-reference/files/upload-file)).

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| end_user_id | path | End user ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | End user retrieved successfully. | **application/json**: [EndUserDetail](#enduserdetail)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `end_user_not_found` : End user not found. |  |

---
## default

### [POST] /files/upload
**Upload File**

Upload a file for use when sending messages, enabling multimodal understanding of images, documents, audio, and video. Uploaded files are for use by the current end-user only.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary, **"user"**: string }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully. | **application/json**: [FileResponse](#fileresponse)<br> |
| 400 | - `no_file_uploaded` : No file was provided in the request. - `too_many_files` : Only one file is allowed per request. - `filename_not_exists_error` : The uploaded file has no filename. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 413 | `file_too_large` : File size exceeded. |  |
| 415 | `unsupported_file_type` : File type not allowed. |  |

### [GET] /files/{file_id}/preview
**Download File**

Preview or download uploaded files previously uploaded via the [Upload File](/api-reference/files/upload-file) API. Files can only be accessed if they belong to messages within the requesting application.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| file_id | path | UUID of the file to preview | Yes | string (uuid) |
| as_attachment | query | Download as attachment | No | boolean |
| user | query | End user identifier | No | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Returns the raw file content. The `Content-Type` header is set to the file's MIME type. If `as_attachment` is `true`, the file is returned as a download with `Content-Disposition: attachment`. |
| 401 | Unauthorized - invalid API token |
| 403 | `file_access_denied` : Access to the requested file is denied. |
| 404 | `file_not_found` : The requested file was not found. |

---
## default

### [GET] /form/human_input/{form_token}
**Get Human Input Form**

Retrieve a paused Human Input form's contents using the `form_token` from a `human_input_required` event. Requires **WebApp** delivery.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path | Human input form token | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Form contents retrieved successfully. | **application/json**: [HumanInputFormDefinitionResponse](#humaninputformdefinitionresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Form not found. |  |
| 412 | - `human_input_form_submitted` : Form already submitted. Forms are one-shot; the first response wins regardless of which user submits it. - `human_input_form_expired` : The form's expiration time passed before submission arrived. |  |

### [POST] /form/human_input/{form_token}
**Submit Human Input Form**

Submit the recipient's response to a paused Human Input form. The workflow resumes on acceptance; use [Stream Workflow Events](/api-reference/chatflows/stream-workflow-events) to follow subsequent events. Requires **WebApp** delivery.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path | Human input form token | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputFormSubmitPayloadWithUser](#humaninputformsubmitpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Form submitted successfully. The response body is an empty object. | **application/json**: [HumanInputFormSubmitResponse](#humaninputformsubmitresponse)<br> |
| 400 | - `bad_request` : Form recipient type is invalid. - `invalid_form_data` : Submission failed validation against the form definition. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Form not found. |  |
| 412 | - `human_input_form_submitted` : Form already submitted. Forms are one-shot; the first response wins regardless of which user submits it. - `human_input_form_expired` : The form's expiration time passed before submission arrived. |  |

---
## default

### [GET] /info
**Get App Info**

Retrieve basic information about this application, including name, description, tags, and mode.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Basic information of the application. | **application/json**: [AppInfoResponse](#appinforesponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Application not found |  |

### [GET] /meta
**Get App Meta**

Retrieve metadata about this application, including tool icons and other configuration details.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved application meta information. | **application/json**: [AppMetaResponse](#appmetaresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Application not found |  |

### [GET] /parameters
**Get App Parameters**

Retrieve the application's input form configuration, including feature switches, input parameter names, types, and default values.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Application parameters information. | **application/json**: [Parameters](#parameters)<br> |
| 400 | `app_unavailable` : App unavailable or misconfigured. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Application not found |  |

### [GET] /site
**Get App WebApp Settings**

Retrieve the WebApp settings of this application, including site configuration, theme, and customization options.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | WebApp settings of the application. | **application/json**: [Site](#site)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | `forbidden` : Site not found for this application or the workspace has been archived. |  |

---
## default

### [GET] /workflow/{task_id}/events
**Stream Workflow Events**

Resume the Server-Sent Events stream for a workflow run after a pause or a dropped SSE connection. For runs that have already finished, the stream emits a single `workflow_finished` event and closes.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Workflow run ID | Yes | string |
| continue_on_pause | query | Keep the stream open across workflow_paused events | No | boolean |
| include_state_snapshot | query | Replay from persisted state snapshot | No | boolean |
| user | query | End user identifier | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Server-Sent Events stream. Each event is delivered as `data: {JSON}\\n\\n`. Event payloads follow the same schemas as the original streaming response. | **text/event-stream**: [EventStreamResponse](#eventstreamresponse)<br> |
| 400 | `not_workflow_app` : Please check if your app mode matches the right API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Workflow run not found. |  |

### [GET] /workflows/logs
**List Workflow Logs**

Retrieve paginated workflow execution logs with filtering options.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| created_at__after | query |  | No | string |
| created_at__before | query |  | No | string |
| created_by_account | query |  | No | string |
| created_by_end_user_session_id | query |  | No | string |
| keyword | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |
| status | query |  | No | string, <br>**Available values:** "failed", "stopped", "succeeded" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved workflow logs. | **application/json**: [WorkflowAppLogPaginationResponse](#workflowapplogpaginationresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [POST] /workflows/run
**Run Workflow**

Execute a workflow. Cannot be executed without a published workflow.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowRunPayloadWithUser](#workflowrunpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successful response. The content type and structure depend on the `response_mode` parameter in the request.  - If `response_mode` is `blocking`, returns `application/json` with a `WorkflowBlockingResponse` object. - If `response_mode` is `streaming`, returns `text/event-stream` with a stream of `ChunkWorkflowEvent` objects. | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | - `not_workflow_app` : App mode does not match the API route. - `provider_not_initialize` : No valid model provider credentials found. - `provider_quota_exceeded` : Model provider quota exhausted. - `model_currently_not_support` : Current model unavailable. - `completion_request_error` : Workflow execution request failed. - `invalid_param` : Invalid parameter value. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Workflow not found |  |
| 429 | - `too_many_requests` : Too many concurrent requests for this app. - `rate_limit_error` : The upstream model provider rate limit was exceeded. |  |
| 500 | `internal_server_error` : Internal server error. |  |

### [GET] /workflows/run/{workflow_run_id}
**Get Workflow Run Detail**

Retrieve the current execution results of a workflow task based on the workflow execution ID.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_run_id | path | Workflow run ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successfully retrieved workflow run details. | **application/json**: [WorkflowRunResponse](#workflowrunresponse)<br> |
| 400 | `not_workflow_app` : App mode does not match the API route. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Workflow run not found. |  |

### [POST] /workflows/tasks/{task_id}/stop
**Stop Workflow Task**

Stop a running workflow task. Only supported in `streaming` mode.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Task ID to stop | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RequiredServiceApiUserPayload](#requiredserviceapiuserpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | - `not_workflow_app` : App mode does not match the API route. - `invalid_param` : Required parameter missing or invalid. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Task not found |  |

### [POST] /workflows/{workflow_id}/run
**Run Workflow by ID**

Execute a specific workflow version identified by its ID. Useful for running a particular published version of the workflow.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_id | path | Workflow ID to execute | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowRunPayloadWithUser](#workflowrunpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Successful response. The content type and structure depend on the `response_mode` parameter in the request.  - If `response_mode` is `blocking`, returns `application/json` with a `WorkflowBlockingResponse` object. - If `response_mode` is `streaming`, returns `text/event-stream` with a stream of `ChunkWorkflowEvent` objects. | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | - `not_workflow_app` : App mode does not match the API route. - `bad_request` : Workflow is a draft or has an invalid ID format. - `provider_not_initialize` : No valid model provider credentials found. - `provider_quota_exceeded` : Model provider quota exhausted. - `model_currently_not_support` : Current model unavailable. - `completion_request_error` : Workflow execution request failed. - `invalid_param` : Required parameter missing or invalid. |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | `not_found` : Workflow not found. |  |
| 429 | - `too_many_requests` : Too many concurrent requests for this app. - `rate_limit_error` : The upstream model provider rate limit was exceeded. |  |
| 500 | `internal_server_error` : Internal server error. |  |

---
## default

### [GET] /workspaces/current/models/model-types/{model_type}
**Get Available Models**

Retrieve the list of available models by type. Primarily used to query `text-embedding` and `rerank` models for knowledge base configuration.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | path | Type of model to retrieve | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Available models for the specified type. | **application/json**: [ProviderWithModelsListResponse](#providerwithmodelslistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |

---
### Schemas

#### AgentThought

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chain_id | string |  | No |
| created_at | integer |  | No |
| files | [ string ] |  | Yes |
| id | string |  | Yes |
| message_id | string |  | Yes |
| observation | string |  | No |
| position | integer |  | Yes |
| thought | string |  | No |
| tool | string |  | No |
| tool_input | string |  | No |
| tool_labels | [JSONValue](#jsonvalue) |  | Yes |

#### Annotation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | No |
| created_at | integer |  | No |
| hit_count | integer |  | No |
| id | string |  | Yes |
| question | string |  | No |

#### AnnotationCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string | Annotation answer | Yes |
| question | string | Annotation question | Yes |

#### AnnotationJobStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| error_msg | string |  | No |
| job_id | string |  | Yes |
| job_status | string |  | Yes |

#### AnnotationList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [Annotation](#annotation) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### AnnotationListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword | string | Keyword to search annotations | No |
| limit | integer, <br>**Default:** 20 | Number of annotations per page | No |
| page | integer, <br>**Default:** 1 | Page number | No |

#### AnnotationReplyActionPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string | Embedding model name | Yes |
| embedding_provider_name | string | Embedding provider name | Yes |
| score_threshold | number | Score threshold for annotation matching | Yes |

#### AppFeedbackListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AppFeedbackResponse](#appfeedbackresponse) ] |  | Yes |

#### AppFeedbackResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |
| content | string |  | No |
| conversation_id | string |  | Yes |
| created_at | string |  | Yes |
| from_account_id | string |  | No |
| from_end_user_id | string |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| message_id | string |  | Yes |
| rating | string |  | Yes |
| updated_at | string |  | Yes |

#### AppInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| author_name | string |  | Yes |
| description | string |  | Yes |
| mode | string |  | Yes |
| name | string |  | Yes |
| tags | [ string ] |  | Yes |

#### AppMetaResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tool_icons | object |  | No |

#### AudioBinaryResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AudioBinaryResponse | string |  |  |

#### AudioTranscriptResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| text | string |  | Yes |

#### BinaryFileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| BinaryFileResponse | string |  |  |

#### ButtonStyle

Button styles for user actions.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ButtonStyle | string | Button styles for user actions. |  |

#### ChatRequestPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate_name | boolean, <br>**Default:** true | Auto generate conversation name | No |
| conversation_id | string | Conversation UUID | No |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| query | string |  | Yes |
| response_mode | string |  | No |
| retriever_from | string, <br>**Default:** dev |  | No |
| trace_session_id | string | Trace session ID for observability grouping | No |
| workflow_id | string | Workflow ID for advanced chat | No |

#### ChatRequestPayloadWithUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate_name | boolean, <br>**Default:** true | Auto generate conversation name | No |
| conversation_id | string | Conversation UUID | No |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| query | string |  | Yes |
| response_mode | string |  | No |
| retriever_from | string, <br>**Default:** dev |  | No |
| trace_session_id | string | Trace session ID for observability grouping | No |
| user | string | End user identifier | Yes |
| workflow_id | string | Workflow ID for advanced chat | No |

#### ChildChunkCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |

#### ChildChunkDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ChildChunkResponse](#childchunkresponse) |  | Yes |

#### ChildChunkListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### ChildChunkListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ChildChunkResponse](#childchunkresponse) ] |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |
| total_pages | integer |  | Yes |

#### ChildChunkResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |
| created_at | integer |  | Yes |
| id | string |  | Yes |
| position | integer |  | Yes |
| segment_id | string |  | Yes |
| type | string |  | Yes |
| updated_at | integer |  | Yes |
| word_count | integer |  | Yes |

#### ChildChunkUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |

#### CompletionRequestPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| query | string |  | No |
| response_mode | string |  | No |
| retriever_from | string, <br>**Default:** dev |  | No |
| trace_session_id | string | Trace session ID for observability grouping | No |

#### CompletionRequestPayloadWithUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| query | string |  | No |
| response_mode | string |  | No |
| retriever_from | string, <br>**Default:** dev |  | No |
| trace_session_id | string | Trace session ID for observability grouping | No |
| user | string | End user identifier | Yes |

#### Condition

Condition detail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| comparison_operator | string, <br>**Available values:** "<", "=", ">", "after", "before", "contains", "empty", "end with", "in", "is", "is not", "not contains", "not empty", "not in", "start with", "≠", "≤", "≥" | *Enum:* `"<"`, `"="`, `">"`, `"after"`, `"before"`, `"contains"`, `"empty"`, `"end with"`, `"in"`, `"is"`, `"is not"`, `"not contains"`, `"not empty"`, `"not in"`, `"start with"`, `"≠"`, `"≤"`, `"≥"` | Yes |
| name | string |  | Yes |
| value | string<br>[ string ]<br>integer<br>number |  | No |

#### ConversationInfiniteScrollPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [SimpleConversation](#simpleconversation) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### ConversationListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string | Last conversation ID for pagination | No |
| limit | integer, <br>**Default:** 20 | Number of conversations to return | No |
| sort_by | string, <br>**Available values:** "-created_at", "-updated_at", "created_at", "updated_at", <br>**Default:** -updated_at | Sort order for conversations<br>*Enum:* `"-created_at"`, `"-updated_at"`, `"created_at"`, `"updated_at"` | No |

#### ConversationRenamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate | boolean |  | No |
| name | string |  | No |

#### ConversationRenamePayloadWithUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate | boolean |  | No |
| name | string |  | No |
| user | string | End user identifier | No |

#### ConversationVariableInfiniteScrollPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ConversationVariableResponse](#conversationvariableresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### ConversationVariableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| description | string |  | No |
| id | string |  | Yes |
| name | string |  | Yes |
| updated_at | integer |  | No |
| value | string |  | No |
| value_type | string |  | Yes |

#### ConversationVariableUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| value |  |  | Yes |

#### ConversationVariableUpdatePayloadWithUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| user | string | End user identifier | No |
| value |  |  | Yes |

#### ConversationVariablesQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string | Last variable ID for pagination | No |
| limit | integer, <br>**Default:** 20 | Number of variables to return | No |
| variable_name | string | Filter variables by name | No |

#### CustomConfigurationStatus

Enum class for custom configuration status.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| CustomConfigurationStatus | string | Enum class for custom configuration status. |  |

#### DatasetBoundTagListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DatasetBoundTagResponse](#datasetboundtagresponse) ] |  | Yes |
| total | integer |  | Yes |

#### DatasetBoundTagResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |

#### DatasetCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Dataset description (max 400 chars) | No |
| embedding_model | string |  | No |
| embedding_model_provider | string |  | No |
| external_knowledge_api_id | string |  | No |
| external_knowledge_id | string |  | No |
| indexing_technique | string |  | No |
| name | string |  | Yes |
| permission | [PermissionEnum](#permissionenum) |  | No |
| provider | string, <br>**Default:** vendor |  | No |
| retrieval_model | [RetrievalModel](#retrievalmodel) |  | No |
| summary_index_setting | object |  | No |

#### DatasetDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_count | integer |  | Yes |
| author_name | string |  | Yes |
| built_in_field_enabled | boolean |  | Yes |
| chunk_structure | string |  | Yes |
| created_at | integer |  | Yes |
| created_by | string |  | Yes |
| data_source_type | string |  | Yes |
| description | string |  | Yes |
| doc_form | string |  | Yes |
| doc_metadata | [ [DatasetDocMetadataResponse](#datasetdocmetadataresponse) ] |  | Yes |
| document_count | integer |  | Yes |
| embedding_available | boolean |  | No |
| embedding_model | string |  | Yes |
| embedding_model_provider | string |  | Yes |
| enable_api | boolean |  | Yes |
| external_knowledge_info | [DatasetExternalKnowledgeInfoResponse](#datasetexternalknowledgeinforesponse) |  | No |
| external_retrieval_model | [DatasetExternalRetrievalModelResponse](#datasetexternalretrievalmodelresponse) |  | Yes |
| icon_info | [DatasetIconInfoResponse](#dataseticoninforesponse) |  | No |
| id | string |  | Yes |
| indexing_technique | string |  | Yes |
| is_multimodal | boolean |  | Yes |
| is_published | boolean |  | Yes |
| name | string |  | Yes |
| permission | string |  | Yes |
| pipeline_id | string |  | Yes |
| provider | string |  | Yes |
| retrieval_model_dict | [DatasetRetrievalModelResponse](#datasetretrievalmodelresponse) |  | Yes |
| runtime_mode | string |  | Yes |
| summary_index_setting | [DatasetSummaryIndexSettingResponse](#datasetsummaryindexsettingresponse) |  | No |
| tags | [ [DatasetTagResponse](#datasettagresponse) ] |  | Yes |
| total_available_documents | integer |  | Yes |
| total_documents | integer |  | Yes |
| updated_at | integer |  | Yes |
| updated_by | string |  | Yes |
| word_count | integer |  | Yes |

#### DatasetDetailWithPartialMembersResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_count | integer |  | Yes |
| author_name | string |  | Yes |
| built_in_field_enabled | boolean |  | Yes |
| chunk_structure | string |  | Yes |
| created_at | integer |  | Yes |
| created_by | string |  | Yes |
| data_source_type | string |  | Yes |
| description | string |  | Yes |
| doc_form | string |  | Yes |
| doc_metadata | [ [DatasetDocMetadataResponse](#datasetdocmetadataresponse) ] |  | Yes |
| document_count | integer |  | Yes |
| embedding_available | boolean |  | No |
| embedding_model | string |  | Yes |
| embedding_model_provider | string |  | Yes |
| enable_api | boolean |  | Yes |
| external_knowledge_info | [DatasetExternalKnowledgeInfoResponse](#datasetexternalknowledgeinforesponse) |  | No |
| external_retrieval_model | [DatasetExternalRetrievalModelResponse](#datasetexternalretrievalmodelresponse) |  | Yes |
| icon_info | [DatasetIconInfoResponse](#dataseticoninforesponse) |  | No |
| id | string |  | Yes |
| indexing_technique | string |  | Yes |
| is_multimodal | boolean |  | Yes |
| is_published | boolean |  | Yes |
| name | string |  | Yes |
| partial_member_list | [ string ] |  | No |
| permission | string |  | Yes |
| pipeline_id | string |  | Yes |
| provider | string |  | Yes |
| retrieval_model_dict | [DatasetRetrievalModelResponse](#datasetretrievalmodelresponse) |  | Yes |
| runtime_mode | string |  | Yes |
| summary_index_setting | [DatasetSummaryIndexSettingResponse](#datasetsummaryindexsettingresponse) |  | No |
| tags | [ [DatasetTagResponse](#datasettagresponse) ] |  | Yes |
| total_available_documents | integer |  | Yes |
| total_documents | integer |  | Yes |
| updated_at | integer |  | Yes |
| updated_by | string |  | Yes |
| word_count | integer |  | Yes |

#### DatasetDocMetadataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### DatasetExternalKnowledgeInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| external_knowledge_api_endpoint | string |  | No |
| external_knowledge_api_id | string |  | No |
| external_knowledge_api_name | string |  | No |
| external_knowledge_id | string |  | No |

#### DatasetExternalRetrievalModelResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| score_threshold | number |  | No |
| score_threshold_enabled | boolean |  | No |
| top_k | integer |  | Yes |

#### DatasetIconInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | No |

#### DatasetKeywordSettingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_weight | number |  | No |

#### DatasetListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| include_all | boolean | Include all datasets | No |
| keyword | string | Search keyword | No |
| limit | integer, <br>**Default:** 20 | Number of items per page | No |
| page | integer, <br>**Default:** 1 | Page number | No |
| tag_ids | [ string ] | Filter by tag IDs | No |

#### DatasetListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DatasetDetailResponse](#datasetdetailresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### DatasetMetadataActionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |

#### DatasetMetadataBuiltInFieldResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| type | string |  | Yes |

#### DatasetMetadataBuiltInFieldsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| fields | [ [DatasetMetadataBuiltInFieldResponse](#datasetmetadatabuiltinfieldresponse) ] |  | Yes |

#### DatasetMetadataListItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| count | integer |  | No |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### DatasetMetadataListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| built_in_field_enabled | boolean |  | Yes |
| doc_metadata | [ [DatasetMetadataListItemResponse](#datasetmetadatalistitemresponse) ] |  | Yes |

#### DatasetMetadataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### DatasetRerankingModelResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_model_name | string |  | No |
| reranking_provider_name | string |  | No |

#### DatasetRetrievalModelResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_enable | boolean |  | Yes |
| reranking_mode | string |  | No |
| reranking_model | [DatasetRerankingModelResponse](#datasetrerankingmodelresponse) |  | No |
| score_threshold | number |  | No |
| score_threshold_enabled | boolean |  | Yes |
| search_method | string |  | Yes |
| top_k | integer |  | Yes |
| weights | [DatasetWeightedScoreResponse](#datasetweightedscoreresponse) |  | No |

#### DatasetSummaryIndexSettingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enable | boolean |  | No |
| model_name | string |  | No |
| model_provider_name | string |  | No |
| summary_prompt | string |  | No |

#### DatasetTagResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### DatasetUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Dataset description (max 400 chars) | No |
| embedding_model | string |  | No |
| embedding_model_provider | string |  | No |
| external_knowledge_api_id | string |  | No |
| external_knowledge_id | string |  | No |
| external_retrieval_model | object |  | No |
| indexing_technique | string |  | No |
| name | string |  | No |
| partial_member_list | [ object ] |  | No |
| permission | [PermissionEnum](#permissionenum) |  | No |
| retrieval_model | [RetrievalModel](#retrievalmodel) |  | No |

#### DatasetVectorSettingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string |  | No |
| embedding_provider_name | string |  | No |
| vector_weight | number |  | No |

#### DatasetWeightedScoreResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_setting | [DatasetKeywordSettingResponse](#datasetkeywordsettingresponse) |  | No |
| vector_setting | [DatasetVectorSettingResponse](#datasetvectorsettingresponse) |  | No |
| weight_type | string |  | No |

#### DatasourceCredentialInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | No |
| is_default | boolean |  | No |
| name | string |  | No |
| type | string |  | No |

#### DatasourceNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | No |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |
| is_published | boolean |  | Yes |

#### DatasourcePluginListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| DatasourcePluginListResponse | array |  |  |

#### DatasourcePluginResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | [ [DatasourceCredentialInfoResponse](#datasourcecredentialinforesponse) ] |  | Yes |
| datasource_type | string |  | No |
| node_id | string |  | No |
| plugin_id | string |  | No |
| provider_name | string |  | No |
| title | string |  | No |
| user_input_variables | [ object ] |  | No |

#### DatasourcePluginsQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| is_published | boolean, <br>**Default:** true |  | No |

#### DocumentAndBatchResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| batch | string |  | Yes |
| document | [DocumentResponse](#documentresponse) |  | Yes |

#### DocumentBatchDownloadZipPayload

Request payload for bulk downloading documents as a zip archive.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_ids | [ string (uuid) ] |  | Yes |

#### DocumentDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| archived | boolean |  | No |
| average_segment_length | number |  | No |
| completed_at | integer |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| created_from | string |  | No |
| data_source_info | object |  | No |
| data_source_type | string |  | No |
| dataset_process_rule | object |  | No |
| dataset_process_rule_id | string |  | No |
| disabled_at | integer |  | No |
| disabled_by | string |  | No |
| display_status | string |  | No |
| doc_form | string |  | No |
| doc_language | string |  | No |
| doc_metadata | [ [DocumentMetadataResponse](#documentmetadataresponse) ] |  | No |
| doc_type | string |  | No |
| document_process_rule | object |  | No |
| enabled | boolean |  | No |
| error | string |  | No |
| hit_count | integer |  | No |
| id | string |  | Yes |
| indexing_latency | number |  | No |
| indexing_status | string |  | No |
| name | string |  | No |
| need_summary | boolean |  | No |
| position | integer |  | No |
| segment_count | integer |  | No |
| summary_index_status | string |  | No |
| tokens | integer |  | No |
| updated_at | integer |  | No |

#### DocumentGetQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| metadata | string, <br>**Available values:** "all", "only", "without", <br>**Default:** all | Metadata response mode<br>*Enum:* `"all"`, `"only"`, `"without"` | No |

#### DocumentListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword | string | Search keyword | No |
| limit | integer, <br>**Default:** 20 | Number of items per page | No |
| page | integer, <br>**Default:** 1 | Page number | No |
| status | string | Document status filter | No |

#### DocumentListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DocumentResponse](#documentresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### DocumentMetadataOperation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_id | string |  | Yes |
| metadata_list | [ [MetadataDetail](#metadatadetail) ] |  | Yes |
| partial_update | boolean |  | No |

#### DocumentMetadataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |
| value | string<br>integer<br>number<br>boolean |  | No |

#### DocumentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| archived | boolean |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| created_from | string |  | No |
| data_source_detail_dict |  |  | No |
| data_source_info |  |  | No |
| data_source_type | string |  | No |
| dataset_process_rule_id | string |  | No |
| disabled_at | integer |  | No |
| disabled_by | string |  | No |
| display_status | string |  | No |
| doc_form | string |  | No |
| doc_metadata | [ [DocumentMetadataResponse](#documentmetadataresponse) ] |  | No |
| enabled | boolean |  | No |
| error | string |  | No |
| hit_count | integer |  | No |
| id | string |  | Yes |
| indexing_status | string |  | No |
| name | string |  | Yes |
| need_summary | boolean |  | No |
| position | integer |  | No |
| summary_index_status | string |  | No |
| tokens | integer |  | No |
| word_count | integer |  | No |

#### DocumentStatusListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DocumentStatusResponse](#documentstatusresponse) ] |  | Yes |

#### DocumentStatusPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_ids | [ string ] | Document IDs to update | No |

#### DocumentStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| cleaning_completed_at | integer |  | Yes |
| completed_at | integer |  | Yes |
| completed_segments | integer |  | No |
| error | string |  | Yes |
| id | string |  | Yes |
| indexing_status | string |  | Yes |
| parsing_completed_at | integer |  | Yes |
| paused_at | integer |  | Yes |
| processing_started_at | integer |  | Yes |
| splitting_completed_at | integer |  | Yes |
| stopped_at | integer |  | Yes |
| total_segments | integer |  | No |

#### DocumentTextCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_form | string, <br>**Default:** text_model |  | No |
| doc_language | string, <br>**Default:** English |  | No |
| embedding_model | string |  | No |
| embedding_model_provider | string |  | No |
| indexing_technique | string |  | No |
| name | string |  | Yes |
| original_document_id | string |  | No |
| process_rule | [ProcessRule](#processrule) |  | No |
| retrieval_model | [RetrievalModel](#retrievalmodel) |  | No |
| text | string |  | Yes |

#### DocumentTextUpdate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_form | string, <br>**Default:** text_model |  | No |
| doc_language | string, <br>**Default:** English |  | No |
| name | string |  | No |
| process_rule | [ProcessRule](#processrule) |  | No |
| retrieval_model | [RetrievalModel](#retrievalmodel) |  | No |
| text | string |  | No |

#### EndUserDetail

Full EndUser record for API responses.

Note: The SQLAlchemy model defines an `is_anonymous` property for Flask-Login semantics
(always False). The database column is exposed as `_is_anonymous`, so this DTO maps
`is_anonymous` from `_is_anonymous` to return the stored value.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | No |
| created_at | dateTime |  | Yes |
| external_user_id | string |  | No |
| id | string |  | Yes |
| is_anonymous | boolean |  | Yes |
| name | string |  | No |
| session_id | string |  | Yes |
| tenant_id | string |  | Yes |
| type | string |  | Yes |
| updated_at | dateTime |  | Yes |

#### EventStreamResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EventStreamResponse | string |  |  |

#### ExecutionContentType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ExecutionContentType | string |  |  |

#### FeedbackListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 | Number of feedbacks per page | No |
| page | integer, <br>**Default:** 1 | Page number | No |

#### FetchFrom

Enum class for fetch from.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FetchFrom | string | Enum class for fetch from. |  |

#### FileInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed_file_extensions | [ string ] |  | No |
| allowed_file_types | [ [FileType](#filetype) ] |  | No |
| allowed_file_upload_methods | [ [FileTransferMethod](#filetransfermethod) ] |  | No |
| output_variable_name | string |  | Yes |
| type | string |  | No |

#### FileListInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed_file_extensions | [ string ] |  | No |
| allowed_file_types | [ [FileType](#filetype) ] |  | No |
| allowed_file_upload_methods | [ [FileTransferMethod](#filetransfermethod) ] |  | No |
| number_limits | integer |  | No |
| output_variable_name | string |  | Yes |
| type | string |  | No |

#### FilePreviewQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| as_attachment | boolean | Download as attachment | No |

#### FileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| extension | string |  | No |
| file_key | string |  | No |
| id | string |  | Yes |
| mime_type | string |  | No |
| name | string |  | Yes |
| original_url | string |  | No |
| preview_url | string |  | No |
| reference | string |  | No |
| size | integer |  | Yes |
| source_url | string |  | No |
| tenant_id | string |  | No |
| user_id | string |  | No |

#### FileTransferMethod

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FileTransferMethod | string |  |  |

#### FileType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FileType | string |  |  |

#### FormInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FormInputConfig | [ParagraphInputConfig](#paragraphinputconfig)<br>[SelectInputConfig](#selectinputconfig)<br>[FileInputConfig](#fileinputconfig)<br>[FileListInputConfig](#filelistinputconfig) |  |  |

#### GeneratedAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| GeneratedAppResponse |  |  |  |

#### HitTestingChildChunk

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |
| id | string |  | Yes |
| position | integer |  | Yes |
| score | number |  | Yes |

#### HitTestingDocument

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data_source_type | string |  | Yes |
| doc_metadata |  |  | Yes |
| doc_type | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |

#### HitTestingFile

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| extension | string |  | Yes |
| id | string |  | Yes |
| mime_type | string |  | Yes |
| name | string |  | Yes |
| size | integer |  | Yes |
| source_url | string |  | Yes |

#### HitTestingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachment_ids | [ string ] |  | No |
| external_retrieval_model | object |  | No |
| query | string |  | Yes |
| retrieval_model | [RetrievalModel](#retrievalmodel) |  | No |

#### HitTestingQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |

#### HitTestingRecord

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| child_chunks | [ [HitTestingChildChunk](#hittestingchildchunk) ] |  | Yes |
| files | [ [HitTestingFile](#hittestingfile) ] |  | Yes |
| score | number |  | Yes |
| segment | [HitTestingSegment](#hittestingsegment) |  | Yes |
| summary | string |  | Yes |
| tsne_position |  |  | Yes |

#### HitTestingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| query | [HitTestingQuery](#hittestingquery) |  | Yes |
| records | [ [HitTestingRecord](#hittestingrecord) ] |  | Yes |

#### HitTestingSegment

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | Yes |
| completed_at | integer |  | Yes |
| content | string |  | Yes |
| created_at | integer |  | Yes |
| created_by | string |  | Yes |
| disabled_at | integer |  | Yes |
| disabled_by | string |  | Yes |
| document | [HitTestingDocument](#hittestingdocument) |  | Yes |
| document_id | string |  | Yes |
| enabled | boolean |  | Yes |
| error | string |  | Yes |
| hit_count | integer |  | Yes |
| id | string |  | Yes |
| index_node_hash | string |  | Yes |
| index_node_id | string |  | Yes |
| indexing_at | integer |  | Yes |
| keywords | [ string ] |  | Yes |
| position | integer |  | Yes |
| sign_content | string |  | Yes |
| status | string |  | Yes |
| stopped_at | integer |  | Yes |
| tokens | integer |  | Yes |
| word_count | integer |  | Yes |

#### HumanInputContent

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| form_definition | [HumanInputFormDefinition](#humaninputformdefinition) |  | No |
| form_submission_data | [HumanInputFormSubmissionData](#humaninputformsubmissiondata) |  | No |
| submitted | boolean |  | Yes |
| type | [ExecutionContentType](#executioncontenttype) |  | No |
| workflow_run_id | string |  | Yes |

#### HumanInputFormDefinition

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| actions | [ [UserActionConfig](#useractionconfig) ] |  | No |
| display_in_ui | boolean |  | No |
| expiration_time | integer |  | Yes |
| form_content | string |  | Yes |
| form_id | string |  | Yes |
| form_token | string |  | No |
| inputs | [ [FormInputConfig](#forminputconfig) ] |  | No |
| node_id | string |  | Yes |
| node_title | string |  | Yes |
| resolved_default_values | object |  | No |

#### HumanInputFormDefinitionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| expiration_time | integer |  | No |
| form_content | string |  | Yes |
| inputs | [ object ] |  | No |
| resolved_default_values | object |  | Yes |
| user_actions | [ object ] |  | No |

#### HumanInputFormSubmissionData

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action_id | string |  | Yes |
| action_text | string |  | Yes |
| node_id | string |  | Yes |
| node_title | string |  | Yes |
| rendered_content | string |  | Yes |
| submitted_data | object |  | No |

#### HumanInputFormSubmitPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string |  | Yes |
| inputs | object | Submitted human input values keyed by output variable name. Use a string for paragraph or select input values, a file mapping for file inputs, and a list of file mappings for file-list inputs. Local file mappings use `transfer_method=local_file` with `upload_file_id`; remote file mappings use `transfer_method=remote_url` with `url` or `remote_url`. | Yes |

#### HumanInputFormSubmitPayloadWithUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string |  | Yes |
| inputs | object | Submitted human input values keyed by output variable name. Use a string for paragraph or select input values, a file mapping for file inputs, and a list of file mappings for file-list inputs. Local file mappings use `transfer_method=local_file` with `upload_file_id`; remote file mappings use `transfer_method=remote_url` with `url` or `remote_url`. | Yes |
| user | string | End user identifier | Yes |

#### HumanInputFormSubmitResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |

#### I18nObject

Model class for i18n object.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| en_US | string |  | Yes |
| zh_Hans | string |  | No |

#### IndexInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| api_version | string |  | Yes |
| server_version | string |  | Yes |
| welcome | string |  | Yes |

#### JSONObject

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JSONObject | object |  |  |

#### JSONValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JSONValue | string<br>integer<br>number<br>boolean<br>object<br>[ object ] |  |  |

#### JSONValueType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JSONValueType |  |  |  |

#### JsonValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JsonValue |  |  |  |

#### KnowledgeTagListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| KnowledgeTagListResponse | array |  |  |

#### KnowledgeTagResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binding_count | string |  | No |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### MessageFeedbackPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | No |
| rating | string |  | No |

#### MessageFeedbackPayloadWithUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | No |
| rating | string |  | No |
| user | string | End user identifier | Yes |

#### MessageFile

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| belongs_to | string |  | No |
| filename | string |  | Yes |
| id | string |  | Yes |
| mime_type | string |  | No |
| size | integer |  | No |
| transfer_method | string |  | Yes |
| type | string |  | Yes |
| upload_file_id | string |  | No |
| url | string |  | No |

#### MessageInfiniteScrollPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [MessageListItem](#messagelistitem) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### MessageListItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_thoughts | [ [AgentThought](#agentthought) ] |  | Yes |
| answer | string |  | Yes |
| conversation_id | string |  | Yes |
| created_at | integer |  | No |
| error | string |  | No |
| extra_contents | [ [HumanInputContent](#humaninputcontent) ] |  | Yes |
| feedback | [SimpleFeedback](#simplefeedback) |  | No |
| id | string |  | Yes |
| inputs | object |  | Yes |
| message_files | [ [MessageFile](#messagefile) ] |  | Yes |
| parent_message_id | string |  | No |
| query | string |  | Yes |
| retriever_resources | [ [RetrieverResource](#retrieverresource) ] |  | Yes |
| status | string |  | Yes |

#### MessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation UUID | Yes |
| first_id | string | First message ID for pagination | No |
| limit | integer, <br>**Default:** 20 | Number of messages to return (1-100) | No |

#### MetadataArgs

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| type | string, <br>**Available values:** "number", "string", "time" | *Enum:* `"number"`, `"string"`, `"time"` | Yes |

#### MetadataDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| value | string<br>integer<br>number |  | No |

#### MetadataFilteringCondition

Metadata Filtering Condition.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conditions | [ [Condition](#condition) ] |  | No |
| logical_operator | string |  | No |

#### MetadataOperationData

Metadata operation data

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| operation_data | [ [DocumentMetadataOperation](#documentmetadataoperation) ] |  | Yes |

#### MetadataUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

#### ModelFeature

Enum class for llm feature.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelFeature | string | Enum class for llm feature. |  |

#### ModelPropertyKey

Enum class for model property key.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelPropertyKey | string | Enum class for model property key. |  |

#### ModelStatus

Enum class for model status.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelStatus | string | Enum class for model status. |  |

#### ModelType

Enum class for model type.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelType | string | Enum class for model type. |  |

#### OptionalServiceApiUserPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| user | string | End user identifier | No |

#### ParagraphInputConfig

Form input definition.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default | [StringSource](#stringsource) |  | No |
| output_variable_name | string |  | Yes |
| type | string |  | No |

#### Parameters

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_reply | [JSONObject](#jsonobject) |  | Yes |
| file_upload | [JSONObject](#jsonobject) |  | Yes |
| more_like_this | [JSONObject](#jsonobject) |  | Yes |
| opening_statement |  |  | No |
| retriever_resource | [JSONObject](#jsonobject) |  | Yes |
| sensitive_word_avoidance | [JSONObject](#jsonobject) |  | Yes |
| speech_to_text | [JSONObject](#jsonobject) |  | Yes |
| suggested_questions | [ string ] |  | Yes |
| suggested_questions_after_answer | [JSONObject](#jsonobject) |  | Yes |
| system_parameters | [SystemParameters](#systemparameters) |  | Yes |
| text_to_speech | [JSONObject](#jsonobject) |  | Yes |
| user_input_form | [ [JSONObject](#jsonobject) ] |  | Yes |

#### PermissionEnum

Shared permission levels for resources (datasets, credentials, etc.)

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PermissionEnum | string | Shared permission levels for resources (datasets, credentials, etc.) |  |

#### PipelineRunApiEntity

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| datasource_info_list | [ object ] |  | Yes |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |
| is_published | boolean |  | Yes |
| response_mode | string |  | Yes |
| start_node_id | string |  | Yes |

#### PipelineUploadFileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | string |  | No |
| created_by | string |  | Yes |
| extension | string |  | Yes |
| id | string |  | Yes |
| mime_type | string |  | No |
| name | string |  | Yes |
| size | integer |  | Yes |

#### PreProcessingRule

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | Yes |
| id | string |  | Yes |

#### ProcessRule

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| mode | [ProcessRuleMode](#processrulemode) |  | Yes |
| rules | [Rule](#rule) |  | No |

#### ProcessRuleMode

Dataset Process Rule Mode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ProcessRuleMode | string | Dataset Process Rule Mode |  |

#### ProviderModelWithStatusEntity

Model class for model response.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| deprecated | boolean |  | No |
| features | [ [ModelFeature](#modelfeature) ] |  | No |
| fetch_from | [FetchFrom](#fetchfrom) |  | Yes |
| has_invalid_load_balancing_configs | boolean |  | No |
| label | [I18nObject](#i18nobject) |  | Yes |
| load_balancing_enabled | boolean |  | No |
| model | string |  | Yes |
| model_properties | object |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |
| status | [ModelStatus](#modelstatus) |  | Yes |

#### ProviderWithModelsListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ProviderWithModelsResponse](#providerwithmodelsresponse) ] |  | Yes |

#### ProviderWithModelsResponse

Model class for provider with models response.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon_small | [I18nObject](#i18nobject) |  | No |
| icon_small_dark | [I18nObject](#i18nobject) |  | No |
| label | [I18nObject](#i18nobject) |  | Yes |
| models | [ [ProviderModelWithStatusEntity](#providermodelwithstatusentity) ] |  | Yes |
| provider | string |  | Yes |
| status | [CustomConfigurationStatus](#customconfigurationstatus) |  | Yes |
| tenant_id | string |  | Yes |

#### RequiredServiceApiUserPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| user | string | End user identifier | Yes |

#### RerankingModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_model_name | string |  | No |
| reranking_provider_name | string |  | No |

#### ResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |

#### RetrievalMethod

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RetrievalMethod | string |  |  |

#### RetrievalModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| metadata_filtering_conditions | [MetadataFilteringCondition](#metadatafilteringcondition) |  | No |
| reranking_enable | boolean |  | Yes |
| reranking_mode | string |  | No |
| reranking_model | [RerankingModel](#rerankingmodel) |  | No |
| score_threshold | number |  | No |
| score_threshold_enabled | boolean |  | Yes |
| search_method | [RetrievalMethod](#retrievalmethod) |  | Yes |
| top_k | integer |  | Yes |
| weights | [WeightModel](#weightmodel) |  | No |

#### RetrieverResource

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | No |
| created_at | integer |  | No |
| data_source_type | string |  | No |
| dataset_id | string |  | No |
| dataset_name | string |  | No |
| document_id | string |  | No |
| document_name | string |  | No |
| hit_count | integer |  | No |
| id | string |  | No |
| index_node_hash | string |  | No |
| message_id | string |  | No |
| position | integer |  | Yes |
| score | number |  | No |
| segment_id | string |  | No |
| segment_position | integer |  | No |
| summary | string |  | No |
| word_count | integer |  | No |

#### Rule

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| parent_mode | string |  | No |
| pre_processing_rules | [ [PreProcessingRule](#preprocessingrule) ] |  | No |
| segmentation | [Segmentation](#segmentation) |  | No |
| subchunk_segmentation | [Segmentation](#segmentation) |  | No |

#### SegmentAttachmentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| extension | string |  | Yes |
| id | string |  | Yes |
| mime_type | string |  | Yes |
| name | string |  | Yes |
| size | integer |  | Yes |
| source_url | string |  | Yes |

#### SegmentCreateItemPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | No |
| attachment_ids | [ string ] |  | No |
| content | string |  | Yes |
| keywords | [ string ] |  | No |

#### SegmentCreateListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [SegmentResponse](#segmentresponse) ] |  | Yes |
| doc_form | string |  | Yes |

#### SegmentCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| segments | [ [SegmentCreateItemPayload](#segmentcreateitempayload) ] |  | Yes |

#### SegmentDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [SegmentResponse](#segmentresponse) |  | Yes |
| doc_form | string |  | Yes |

#### SegmentListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |
| status | [ string ] |  | No |

#### SegmentListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [SegmentResponse](#segmentresponse) ] |  | Yes |
| doc_form | string |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### SegmentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | Yes |
| attachments | [ [SegmentAttachmentResponse](#segmentattachmentresponse) ] |  | Yes |
| child_chunks | [ [ChildChunkResponse](#childchunkresponse) ] |  | Yes |
| completed_at | integer |  | Yes |
| content | string |  | Yes |
| created_at | integer |  | Yes |
| created_by | string |  | Yes |
| disabled_at | integer |  | Yes |
| disabled_by | string |  | Yes |
| document_id | string |  | Yes |
| enabled | boolean |  | Yes |
| error | string |  | Yes |
| hit_count | integer |  | Yes |
| id | string |  | Yes |
| index_node_hash | string |  | Yes |
| index_node_id | string |  | Yes |
| indexing_at | integer |  | Yes |
| keywords | [ string ] |  | Yes |
| position | integer |  | Yes |
| sign_content | string |  | Yes |
| status | string |  | Yes |
| stopped_at | integer |  | Yes |
| summary | string |  | Yes |
| tokens | integer |  | Yes |
| updated_at | integer |  | Yes |
| updated_by | string |  | Yes |
| word_count | integer |  | Yes |

#### SegmentUpdateArgs

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | No |
| attachment_ids | [ string ] |  | No |
| content | string |  | No |
| enabled | boolean |  | No |
| keywords | [ string ] |  | No |
| regenerate_child_chunks | boolean |  | No |
| summary | string |  | No |

#### SegmentUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| segment | [SegmentUpdateArgs](#segmentupdateargs) |  | Yes |

#### Segmentation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chunk_overlap | integer |  | No |
| max_tokens | integer |  | Yes |
| separator | string, <br>**Default:**
 |  | No |

#### SelectInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| option_source | [StringListSource](#stringlistsource) |  | Yes |
| output_variable_name | string |  | Yes |
| type | string |  | No |

#### SimpleAccount

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |

#### SimpleConversation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| id | string |  | Yes |
| inputs | object |  | Yes |
| introduction | string |  | No |
| name | string |  | Yes |
| status | string |  | Yes |
| updated_at | integer |  | No |

#### SimpleEndUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| is_anonymous | boolean |  | Yes |
| session_id | string |  | No |
| type | string |  | Yes |

#### SimpleFeedback

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| rating | string |  | No |

#### SimpleResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |

#### SimpleResultStringListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ string ] |  | Yes |
| result | string |  | Yes |

#### Site

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chat_color_theme | string |  | No |
| chat_color_theme_inverted | boolean |  | Yes |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| default_language | string |  | Yes |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | Yes |
| privacy_policy | string |  | No |
| show_workflow_steps | boolean |  | Yes |
| title | string |  | Yes |
| use_icon_as_answer_icon | boolean |  | Yes |

#### StringListSource

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| selector | [ string ] |  | No |
| type | [ValueSourceType](#valuesourcetype) |  | Yes |
| value | [ string ] |  | No |

#### StringSource

Default configuration for form inputs.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| selector | [ string ] |  | No |
| type | [ValueSourceType](#valuesourcetype) |  | Yes |
| value | string |  | No |

#### SystemParameters

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| audio_file_size_limit | integer |  | Yes |
| file_size_limit | integer |  | Yes |
| image_file_size_limit | integer |  | Yes |
| video_file_size_limit | integer |  | Yes |
| workflow_file_upload_limit | integer |  | Yes |

#### TagBindingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tag_ids | [ string ] |  | Yes |
| target_id | string |  | Yes |

#### TagCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

#### TagDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tag_id | string |  | Yes |

#### TagUnbindingPayload

Accepts either the legacy tag_id payload or the normalized tag_ids payload.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TagUnbindingPayload | object<br>object | Accepts either the legacy tag_id payload or the normalized tag_ids payload. |  |

#### TagUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| tag_id | string |  | Yes |

#### TextToAudioPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string | Message ID | No |
| streaming | boolean | Reserved for compatibility; TTS response streaming is determined by the provider output. | No |
| text | string | Text to convert to audio | No |
| voice | string | Voice to use for TTS | No |

#### TextToAudioPayloadWithUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string | Message ID | No |
| streaming | boolean | Reserved for compatibility; TTS response streaming is determined by the provider output. | No |
| text | string | Text to convert to audio | No |
| user | string | End user identifier | No |
| voice | string | Voice to use for TTS | No |

#### UrlResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string |  | Yes |

#### UserActionConfig

User action configuration.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| button_style | [ButtonStyle](#buttonstyle) |  | No |
| id | string |  | Yes |
| title | string |  | Yes |

#### ValueSourceType

ValueSourceType records whether the value comes from a static setting
in form definiton, or a variable while the workflow is running.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ValueSourceType | string | ValueSourceType records whether the value comes from a static setting in form definiton, or a variable while the workflow is running. |  |

#### WeightKeywordSetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_weight | number |  | Yes |

#### WeightModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_setting | [WeightKeywordSetting](#weightkeywordsetting) |  | No |
| vector_setting | [WeightVectorSetting](#weightvectorsetting) |  | No |
| weight_type | string |  | No |

#### WeightVectorSetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string |  | Yes |
| embedding_provider_name | string |  | Yes |
| vector_weight | number |  | Yes |

#### WorkflowAppLogPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowAppLogPartialResponse](#workflowapplogpartialresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### WorkflowAppLogPartialResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by_account | [SimpleAccount](#simpleaccount) |  | No |
| created_by_end_user | [SimpleEndUser](#simpleenduser) |  | No |
| created_by_role | string |  | No |
| created_from | string |  | No |
| details | object<br>[ object ]<br>string<br>integer<br>number<br>boolean |  | No |
| id | string |  | Yes |
| workflow_run | [WorkflowRunForLogResponse](#workflowrunforlogresponse) |  | No |

#### WorkflowEventsQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| continue_on_pause | boolean | Keep the stream open across workflow_paused events | No |
| include_state_snapshot | boolean | Replay from persisted state snapshot | No |
| user | string | End user identifier | Yes |

#### WorkflowLogQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at__after | string |  | No |
| created_at__before | string |  | No |
| created_by_account | string |  | No |
| created_by_end_user_session_id | string |  | No |
| keyword | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |
| status | string |  | No |

#### WorkflowRunForLogResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| elapsed_time | number<br>integer |  | No |
| error | string |  | No |
| exceptions_count | integer |  | No |
| finished_at | integer |  | No |
| id | string |  | Yes |
| status | string |  | No |
| total_steps | integer |  | No |
| total_tokens | integer |  | No |
| triggered_from | string |  | No |
| version | string |  | No |

#### WorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| response_mode | string |  | No |
| trace_session_id | string | Trace session ID for observability grouping | No |

#### WorkflowRunPayloadWithUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| response_mode | string |  | No |
| trace_session_id | string | Trace session ID for observability grouping | No |
| user | string | End user identifier | Yes |

#### WorkflowRunResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| elapsed_time | number<br>integer |  | No |
| error | string |  | No |
| finished_at | integer |  | No |
| id | string |  | Yes |
| inputs | object<br>[ object ]<br>string<br>integer<br>number<br>boolean |  | No |
| outputs | object |  | No |
| status | string |  | Yes |
| total_steps | integer |  | No |
| total_tokens | integer |  | No |
| workflow_id | string |  | Yes |

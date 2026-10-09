# OpenAPI
User-scoped programmatic API (bearer auth)

## Version: 1.0

### Available authorizations
#### Bearer (HTTP, bearer)
Use the Service API key as a Bearer token in the Authorization header.
Bearer format: API_KEY

---
## openapi
User-scoped operations

### [GET] /_catalog
Machine-readable catalog of every op on this surface

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [GET] /_health
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Health check | **application/json**: [HealthResponse](#healthresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /_version
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Server version | **application/json**: [ServerVersionResponse](#serverversionresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /account
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Account info | **application/json**: [AccountResponse](#accountresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /account/sessions
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer, <br>**Default:** 100 |
| page | query |  | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Session list | **application/json**: [SessionListResponse](#sessionlistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [DELETE] /account/sessions/self
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Session revoked | **application/json**: [RevokeResponse](#revokeresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [DELETE] /account/sessions/{session_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| session_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Session revoked | **application/json**: [RevokeResponse](#revokeresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer, <br>**Default:** 20 |
| mode | query | App types the ``app`` usage face (``get app``) lists and filters.  A curated subset of :class:`AppMode`: the real, user-facing app categories. Excludes runtime-only mode tags that are not standalone apps (``rag-pipeline`` is a knowledge ``Pipeline``; ``channel`` is unused) and the roster-owned ``agent`` type (surfaced through the roster, not this list).  Members reference ``AppMode.*.value`` so the subset relationship is type-checked: dropping a member from ``AppMode`` breaks this at import. This is the single source for the listable set — params, filters, and the generated CLI whitelist all derive from it. | No | string, <br>**Available values:** "advanced-chat", "agent-chat", "chat", "completion", "workflow" |
| name | query |  | No | string |
| page | query |  | No | integer, <br>**Default:** 1 |
| workspace_id | query |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App list | **application/json**: [AppListResponse](#applistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| fields | query |  | No | string |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App description | **application/json**: [AppDescribeResponse](#appdescriberesponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/advanced-chat:run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
| Yes | **application/json**: [AdvancedChatRunPayload](#advancedchatrunpayload)<br>**multipart/form-data**: [AdvancedChatRunPayload](#advancedchatrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Run result (SSE stream) | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/app-info/advanced-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [ChatAppInfo](#chatappinfo)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/app-info/advanced-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatAppInfoPatch](#chatappinfopatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [ChatAppInfo](#chatappinfo)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/app-info/agent
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [AgentAppInfo](#agentappinfo)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/app-info/agent
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentAppInfoPatch](#agentappinfopatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [AgentAppInfo](#agentappinfo)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/app-info/agent-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [ChatAppInfo](#chatappinfo)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/app-info/agent-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatAppInfoPatch](#chatappinfopatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [ChatAppInfo](#chatappinfo)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/app-info/chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [ChatAppInfo](#chatappinfo)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/app-info/chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatAppInfoPatch](#chatappinfopatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [ChatAppInfo](#chatappinfo)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/app-info/completion
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [AppSettingsInfo](#appsettingsinfo)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/app-info/completion
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppInfoPatch](#appinfopatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [AppSettingsInfo](#appsettingsinfo)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/app-info/workflow
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [AppSettingsInfo](#appsettingsinfo)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/app-info/workflow
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppInfoPatch](#appinfopatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App info | **application/json**: [AppSettingsInfo](#appsettingsinfo)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/chat:run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
| Yes | **application/json**: [ChatRunPayload](#chatrunpayload)<br>**multipart/form-data**: [ChatRunPayload](#chatrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Run result (SSE stream) | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/completion:run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
| Yes | **application/json**: [CompletionRunPayload](#completionrunpayload)<br>**multipart/form-data**: [CompletionRunPayload](#completionrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Run result (SSE stream) | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/dependencies:check
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dependencies checked | **application/json**: [CheckDependenciesResponse](#checkdependenciesresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/draft/advanced-chat/nodes/{node_id}:run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| node_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AdvancedChatNodeRunPayload](#advancedchatnoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node execution | **application/json**: [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/draft/advanced-chat:run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
| Yes | **application/json**: [ChatRunPayload](#chatrunpayload)<br>**multipart/form-data**: [ChatRunPayload](#chatrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Run result (SSE stream) | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/draft/workflow/nodes/{node_id}:run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| node_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [NodeRunPayload](#noderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node execution | **application/json**: [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/draft/workflow:run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
| Yes | **application/json**: [DraftWorkflowRunPayload](#draftworkflowrunpayload)<br>**multipart/form-data**: [DraftWorkflowRunPayload](#draftworkflowrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Run result (SSE stream) | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/dsl
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| include_secret | query | Include encrypted secret values in the exported DSL | No | boolean |
| workflow_id | query | Export a specific workflow version instead of the current draft | No | string (uuid) |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Export successful | **application/json**: [AppDslExportResponse](#appdslexportresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/env
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Environment variables | **application/json**: [EnvVariableListResponse](#envvariablelistresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [DELETE] /apps/{app_id}/env/{env_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| env_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable removed | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PUT] /apps/{app_id}/env/{env_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| env_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EnvVariableSetPayload](#envvariablesetpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable set | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/files
Upload a file to use as an input variable when running the app

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: [FileUploadPayload](#fileuploadpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileResponse](#fileresponse)<br> |
| 400 | Bad request — invalid filename or blocked extension |  |
| 401 | Unauthorized — invalid or expired bearer token |  |
| 413 | File too large |  |
| 415 | Unsupported file type |  |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/human-input-forms/{form_token}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| form_token | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Form definition | **application/json**: [HumanInputFormDefinitionResponse](#humaninputformdefinitionresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/human-input-forms/{form_token}:submit
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| form_token | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
| Yes | **application/json**: [OpenApiFormSubmitPayload](#openapiformsubmitpayload)<br>**multipart/form-data**: [OpenApiFormSubmitPayload](#openapiformsubmitpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Form submitted | **application/json**: [FormSubmitResponse](#formsubmitresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/runs
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query | Cursor: id of the last run on the previous page | No | string (uuid) |
| limit | query |  | No | integer, <br>**Default:** 20 |
| status | query |  | No | string, <br>**Available values:** "failed", "partial-succeeded", "running", "stopped", "succeeded" |
| triggered_from | query | debugging: draft test runs; app-run: real use. Omitted: debugging, as in the console | No | string, <br>**Available values:** "app-run", "debugging" |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Run list | **application/json**: [RunListResponse](#runlistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/runs/{run_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| run_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Run detail | **application/json**: [WorkflowRunDetailResponse](#workflowrundetailresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/runs/{run_id}/nodes
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| run_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node steps | **application/json**: [WorkflowRunNodeExecutionListResponse](#workflowrunnodeexecutionlistresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/service-api/advanced-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/service-api/advanced-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ServiceApiPatch](#serviceapipatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/service-api/agent
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [AgentServiceApi](#agentserviceapi)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/service-api/agent
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ServiceApiPatch](#serviceapipatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [AgentServiceApi](#agentserviceapi)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/service-api/agent-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/service-api/agent-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ServiceApiPatch](#serviceapipatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/service-api/chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/service-api/chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ServiceApiPatch](#serviceapipatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/service-api/completion
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/service-api/completion
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ServiceApiPatch](#serviceapipatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/service-api/workflow
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/service-api/workflow
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ServiceApiPatch](#serviceapipatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Service API | **application/json**: [ServiceApi](#serviceapi)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/tasks/{task_id}/events
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| continue_on_pause | query | Whether to keep the event stream open on pause | No | boolean |
| include_state_snapshot | query | Whether to include workflow state snapshots | No | boolean |
| app_id | path |  | Yes | string |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | SSE event stream | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/tasks/{task_id}:stop
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped | **application/json**: [TaskStopResponse](#taskstopresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/versions
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer, <br>**Default:** 20 |
| named_only | query | Only versions that have a name | No | boolean |
| page | query |  | No | integer, <br>**Default:** 1 |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Version list | **application/json**: [VersionListResponse](#versionlistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/versions/{version_id}:restore
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| version_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Restored into the draft | **application/json**: [RestoreResponse](#restoreresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp-access/advanced-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PUT] /apps/{app_id}/webapp-access/advanced-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WebAppAccessPayload](#webappaccesspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp-access/agent
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PUT] /apps/{app_id}/webapp-access/agent
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WebAppAccessPayload](#webappaccesspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp-access/agent-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PUT] /apps/{app_id}/webapp-access/agent-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WebAppAccessPayload](#webappaccesspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp-access/chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PUT] /apps/{app_id}/webapp-access/chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WebAppAccessPayload](#webappaccesspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp-access/completion
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PUT] /apps/{app_id}/webapp-access/completion
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WebAppAccessPayload](#webappaccesspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp-access/workflow
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PUT] /apps/{app_id}/webapp-access/workflow
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WebAppAccessPayload](#webappaccesspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web-app access | **application/json**: [WebAppAccess](#webappaccess)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp/advanced-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [AdvancedChatWebApp](#advancedchatwebapp)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/webapp/advanced-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AdvancedChatWebAppPatch](#advancedchatwebapppatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [AdvancedChatWebApp](#advancedchatwebapp)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/webapp/advanced-chat:reset
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | New URL token | **application/json**: [WebAppToken](#webapptoken)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp/agent
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [AgentWebApp](#agentwebapp)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/webapp/agent
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatWebAppPatch](#chatwebapppatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [AgentWebApp](#agentwebapp)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp/agent-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [ChatWebApp](#chatwebapp)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/webapp/agent-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatWebAppPatch](#chatwebapppatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [ChatWebApp](#chatwebapp)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/webapp/agent-chat:reset
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | New URL token | **application/json**: [WebAppToken](#webapptoken)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/webapp/agent:reset
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | New URL token | **application/json**: [WebAppToken](#webapptoken)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp/chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [ChatWebApp](#chatwebapp)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/webapp/chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatWebAppPatch](#chatwebapppatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [ChatWebApp](#chatwebapp)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/webapp/chat:reset
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | New URL token | **application/json**: [WebAppToken](#webapptoken)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp/completion
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [WebApp](#webapp)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/webapp/completion
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WebAppPatch](#webapppatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [WebApp](#webapp)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/webapp/completion:reset
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | New URL token | **application/json**: [WebAppToken](#webapptoken)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/webapp/workflow
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [WorkflowWebApp](#workflowwebapp)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /apps/{app_id}/webapp/workflow
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowWebAppPatch](#workflowwebapppatch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web app | **application/json**: [WorkflowWebApp](#workflowwebapp)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/webapp/workflow:reset
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | New URL token | **application/json**: [WebAppToken](#webapptoken)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/workflow:run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
| Yes | **application/json**: [WorkflowRunPayload](#workflowrunpayload)<br>**multipart/form-data**: [WorkflowRunPayload](#workflowrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Run result (SSE stream) | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}:publish
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [PublishPayload](#publishpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Published | **application/json**: [PublishResponse](#publishresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /node-types
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node types | **application/json**: [NodeTypeListResponse](#nodetypelistresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /node-types/{node_type}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_type | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node type | **application/json**: [NodeTypeDetailResponse](#nodetypedetailresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /oauth/device/approve
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DeviceMutateRequest](#devicemutaterequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Approved | **application/json**: [DeviceMutateResponse](#devicemutateresponse)<br> |

### [POST] /oauth/device/code
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DeviceCodeRequest](#devicecoderequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Device code created | **application/json**: [DeviceCodeResponse](#devicecoderesponse)<br> |

### [POST] /oauth/device/deny
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DeviceMutateRequest](#devicemutaterequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Denied | **application/json**: [DeviceMutateResponse](#devicemutateresponse)<br> |

### [GET] /oauth/device/lookup
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| user_code | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Device lookup result | **application/json**: [DeviceLookupResponse](#devicelookupresponse)<br> |

### [POST] /oauth/device/token
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DevicePollRequest](#devicepollrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Device token | **application/json**: [DeviceTokenResponse](#devicetokenresponse)<br> |

### [GET] /permitted-external-apps
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer, <br>**Default:** 20 |
| mode | query | App types the ``app`` usage face (``get app``) lists and filters.  A curated subset of :class:`AppMode`: the real, user-facing app categories. Excludes runtime-only mode tags that are not standalone apps (``rag-pipeline`` is a knowledge ``Pipeline``; ``channel`` is unused) and the roster-owned ``agent`` type (surfaced through the roster, not this list).  Members reference ``AppMode.*.value`` so the subset relationship is type-checked: dropping a member from ``AppMode`` breaks this at import. This is the single source for the listable set — params, filters, and the generated CLI whitelist all derive from it. | No | string, <br>**Available values:** "advanced-chat", "agent-chat", "chat", "completion", "workflow" |
| name | query |  | No | string |
| page | query |  | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Permitted external apps list | **application/json**: [PermittedExternalAppsListResponse](#permittedexternalappslistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /permitted-external-apps/{app_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| fields | query |  | No | string |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Permitted external app description | **application/json**: [AppDescribeResponse](#appdescriberesponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workspace list | **application/json**: [WorkspaceListResponse](#workspacelistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workspace detail | **application/json**: [WorkspaceDetailResponse](#workspacedetailresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/apps/advanced-chat
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CreateAppPayload](#createapppayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Created | **application/json**: [CreatedAppResponse](#createdappresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/apps/imports
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppDslImportPayload](#appdslimportpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Import completed | **application/json**: [AppDslImportResponse](#appdslimportresponse)<br> |
| 202 | Import pending confirmation | **application/json**: [AppDslImportResponse](#appdslimportresponse)<br> |
| 400 | Import failed | **application/json**: [AppDslImportResponse](#appdslimportresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/apps/imports/{import_id}:confirm
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| import_id | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Import confirmed | **application/json**: [Import](#import)<br> |
| 400 | Import failed | **application/json**: [Import](#import)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/apps/workflow
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CreateAppPayload](#createapppayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Created | **application/json**: [CreatedAppResponse](#createdappresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/default-models
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Default models | **application/json**: [DefaultModelListResponse](#defaultmodellistresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PUT] /workspaces/{workspace_id}/default-models/{model_type}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DefaultModelPayload](#defaultmodelpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Default model set | **application/json**: [DefaultModelResponse](#defaultmodelresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/marketplace/plugins
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| category | query | Only plugins of this category | No | string, <br>**Available values:** "agent-strategy", "datasource", "extension", "model", "tool", "trigger" |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |
| query | query | Words to search for; empty lists the most installed plugins | No | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Marketplace plugins | **application/json**: [MarketplacePluginListResponse](#marketplacepluginlistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/members
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Member list | **application/json**: [MemberListResponse](#memberlistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/members
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MemberInvitePayload](#memberinvitepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Member invited | **application/json**: [MemberInviteResponse](#memberinviteresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [DELETE] /workspaces/{workspace_id}/members/{member_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Member removed | **application/json**: [MemberActionResponse](#memberactionresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /workspaces/{workspace_id}/members/{member_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MemberRoleUpdatePayload](#memberroleupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Role updated | **application/json**: [MemberActionResponse](#memberactionresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/model-providers
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | query | Only providers that serve this model type | No | string, <br>**Available values:** "llm", "moderation", "rerank", "speech2text", "text-embedding", "tts" |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Model providers | **application/json**: [ModelProviderListResponse](#modelproviderlistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/model-providers/{provider}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Model provider | **application/json**: [ModelProviderDetailResponse](#modelproviderdetailresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/model-providers/{provider}/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ProviderCredentialCreatePayload](#providercredentialcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Credential saved | **application/json**: [CredentialWriteResponse](#credentialwriteresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [DELETE] /workspaces/{workspace_id}/model-providers/{provider}/credentials/{credential_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential deleted | **application/json**: [CredentialRef](#credentialref)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /workspaces/{workspace_id}/model-providers/{provider}/credentials/{credential_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ProviderCredentialUpdatePayload](#providercredentialupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential replaced | **application/json**: [CredentialWriteResponse](#credentialwriteresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/model-providers/{provider}/credentials/{credential_id}:switch
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential active | **application/json**: [CredentialWriteResponse](#credentialwriteresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/model-providers/{provider}/models
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Models | **application/json**: [ModelListResponse](#modellistresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/model-providers/{provider}/models/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ModelCredentialCreatePayload](#modelcredentialcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Credential saved | **application/json**: [CredentialWriteResponse](#credentialwriteresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [DELETE] /workspaces/{workspace_id}/model-providers/{provider}/models/credentials/{credential_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model | query | Model name, as in get.model | Yes | string |
| model_type | query | Enum class for model type. | Yes | string, <br>**Available values:** "llm", "moderation", "rerank", "speech2text", "text-embedding", "tts" |
| credential_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential deleted | **application/json**: [CredentialRef](#credentialref)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /workspaces/{workspace_id}/model-providers/{provider}/models/credentials/{credential_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ModelCredentialUpdatePayload](#modelcredentialupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential replaced | **application/json**: [CredentialWriteResponse](#credentialwriteresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/model-providers/{provider}/models/credentials/{credential_id}:switch
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ModelRef](#modelref)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential active | **application/json**: [CredentialWriteResponse](#credentialwriteresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/plugin-tasks/{task_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Install task | **application/json**: [PluginTaskResponse](#plugintaskresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/plugins
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| category | query | Only plugins of this category | No | string, <br>**Available values:** "agent-strategy", "datasource", "extension", "model", "tool", "trigger" |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Installed plugins | **application/json**: [PluginListResponse](#pluginlistresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [DELETE] /workspaces/{workspace_id}/plugins/{plugin_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| plugin_id | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Plugin uninstalled | **application/json**: [PluginDeleteResponse](#plugindeleteresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/plugins:install
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [PluginInstallPayload](#plugininstallpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Install started | **application/json**: [PluginTaskStartResponse](#plugintaskstartresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/plugins:upgrade
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [PluginUpgradePayload](#pluginupgradepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Upgrade started | **application/json**: [PluginTaskStartResponse](#plugintaskstartresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/tool-providers
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tool providers | **application/json**: [ToolProviderListResponse](#toolproviderlistresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /workspaces/{workspace_id}/tool-providers/{provider}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tool provider | **application/json**: [ToolProviderDetailResponse](#toolproviderdetailresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/tool-providers/{provider}/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ToolCredentialCreatePayload](#toolcredentialcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Credential saved | **application/json**: [CredentialWriteResponse](#credentialwriteresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [DELETE] /workspaces/{workspace_id}/tool-providers/{provider}/credentials/{credential_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential deleted | **application/json**: [CredentialRef](#credentialref)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [PATCH] /workspaces/{workspace_id}/tool-providers/{provider}/credentials/{credential_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ToolCredentialUpdatePayload](#toolcredentialupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential replaced | **application/json**: [CredentialWriteResponse](#credentialwriteresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}/tool-providers/{provider}/credentials/{credential_id}:switch
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential is the default | **application/json**: [CredentialWriteResponse](#credentialwriteresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /workspaces/{workspace_id}:switch
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workspace detail | **application/json**: [WorkspaceDetailResponse](#workspacedetailresponse)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

---
### Schemas

#### AccountPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |

#### AccountResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account | [AccountPayload](#accountpayload) |  | No |
| default_workspace_id | string |  | No |
| subject_email | string |  | No |
| subject_issuer | string |  | No |
| subject_type | [SubjectType](#subjecttype) |  | Yes |
| workspaces | [ [WorkspacePayload](#workspacepayload) ], <br>**Default:**  |  | No |

#### AdvancedChatNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object | Overrides for what the last draft run saved, keyed by variable reference such as #llm.text# | No |
| query | string | The user message the node sees as sys.query | No |

#### AdvancedChatRunPayload

A chat run against an advanced-chat (chatflow) app, which can also pin a workflow version.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachments | [ string ] | Local file paths attached to the run itself (the app's `sys.files`), not to a variable | No |
| auto_generate_name | boolean, <br>**Default:** true | Let the server name a new conversation | No |
| conversation_id | string | Continue an existing conversation | No |
| files | object | Local file paths keyed by the app's file variable name; each file is uploaded and becomes that variable's value. Give a list of paths for a file-list variable | No |
| inputs | object | Variables declared by the app. The exact shape is per app: read `input_schema` from describe.console_app. A file variable takes a Dify file mapping (remote url or upload id) here, or a local path in `files`, not both. | No |
| query | string | User message | Yes |
| workflow_id | string | Pin a published workflow version | No |
| workspace_id | string | Workspace that owns the app | No |

#### AdvancedChatWebApp

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | No |
| app_base_url | string |  | Yes |
| chat_color_theme | string |  | No |
| chat_color_theme_inverted | boolean |  | No |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| default_language | string |  | No |
| description | string |  | No |
| enabled | boolean |  | Yes |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| input_placeholder | string |  | No |
| privacy_policy | string |  | No |
| show_workflow_steps | boolean |  | No |
| title | string |  | No |
| url | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |

#### AdvancedChatWebAppPatch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chat_color_theme | string | Chat colour, e.g. #1C64F2 | No |
| chat_color_theme_inverted | boolean | Invert the chat colours | No |
| copyright | string | Footer copyright text | No |
| custom_disclaimer | string | Disclaimer shown on the page | No |
| default_language | string | Language code, e.g. en-US | No |
| description | string | Page description | No |
| enabled | boolean | Turn the web app on or off | No |
| icon | string | Emoji, file id or URL, per icon_type | No |
| icon_background | string | Background colour for an emoji icon | No |
| icon_type | string, <br>**Available values:** "emoji", "image", "link" | emoji, image or link | No |
| input_placeholder | string | Placeholder of the chat input | No |
| privacy_policy | string | Privacy policy URL | No |
| show_workflow_steps | boolean | Show each node step to users | No |
| title | string | Page title | No |
| use_icon_as_answer_icon | boolean | Show the app icon on answers | No |

#### AgentAppInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| max_active_requests | integer |  | No |
| name | string |  | Yes |
| role | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |

#### AgentAppInfoPatch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Pass an empty string to clear | No |
| icon | string | Emoji, file id or URL, per icon_type | No |
| icon_background | string | Background colour for an emoji icon | No |
| icon_type | string, <br>**Available values:** "emoji", "image", "link" | emoji, image or link | No |
| max_active_requests | integer | Concurrent run cap; 0 means no cap | No |
| name | string | App name | No |
| role | string | The agent's role; empty string clears it | No |
| use_icon_as_answer_icon | boolean | Show the app icon on answers | No |

#### AgentServiceApi

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_ready | boolean |  | Yes |
| api_rph | integer |  | No |
| api_rpm | integer |  | No |
| base_url | string |  | Yes |
| enabled | boolean |  | Yes |

#### AgentWebApp

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_ready | boolean |  | Yes |
| access_token | string |  | No |
| app_base_url | string |  | Yes |
| chat_color_theme | string |  | No |
| chat_color_theme_inverted | boolean |  | No |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| default_language | string |  | No |
| description | string |  | No |
| enabled | boolean |  | Yes |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| input_placeholder | string |  | No |
| privacy_policy | string |  | No |
| title | string |  | No |
| url | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |

#### AppDescribeInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | Yes |
| is_agent | boolean |  | No |
| mode | string |  | Yes |
| name | string |  | Yes |
| service_api_enabled | boolean |  | Yes |
| updated_at | string |  | No |

#### AppDescribeQuery

`?fields=` allow-list for GET /apps/<id>.

Empty / omitted → all blocks. Unknown member → ValidationError → 422.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| fields | string |  | No |

#### AppDescribeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| info | [AppDescribeInfo](#appdescribeinfo) |  | No |
| input_schema | object |  | No |
| parameters | object |  | No |

#### AppDslExportQuery

Query parameters for GET /apps/<app_id>/dsl.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| include_secret | boolean | Include encrypted secret values in the exported DSL | No |
| workflow_id | string | Export a specific workflow version instead of the current draft | No |

#### AppDslExportResponse

Export DSL response.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string | DSL YAML string | Yes |
| draft_hash | string | Hash of the draft's graph, features, environment variables and conversation variables; pass it to the import to refuse overwriting newer edits | No |

#### AppDslImportPayload

Request body for POST /workspaces/<workspace_id>/apps/imports.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string | Existing app ID to overwrite (workflow/advanced-chat apps only) | No |
| description | string | Override the app description from the DSL | No |
| draft_hash | string | draft_hash from the export or restore this import is based on. The import fails if the draft's graph, features, environment variables or conversation variables changed since. Requires app_id | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| mode | string, <br>**Available values:** "yaml-content", "yaml-url" | Import mode: yaml-content or yaml-url<br>*Enum:* `"yaml-content"`, `"yaml-url"` | Yes |
| name | string | Override the app name from the DSL | No |
| yaml_content | string | Inline YAML DSL string (required when mode is yaml-content) | No |
| yaml_url | string | Remote URL to fetch YAML from (required when mode is yaml-url) | No |

#### AppDslImportResponse

`Import` plus the server-built next step for a pending import.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | No |
| app_mode | [AppMode](#appmode) |  | No |
| current_dsl_version | string, <br>**Default:** 0.7.0 |  | No |
| error | string |  | No |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| id | string |  | Yes |
| imported_dsl_version | string |  | No |
| permission_keys | [ string ] |  | No |
| status | [ImportStatus](#importstatus) |  | Yes |
| warnings | [ [DslImportWarning](#dslimportwarning) ] |  | No |

#### AppInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | Yes |
| mode | string |  | Yes |
| name | string |  | Yes |

#### AppInfoPatch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Pass an empty string to clear | No |
| icon | string | Emoji, file id or URL, per icon_type | No |
| icon_background | string | Background colour for an emoji icon | No |
| icon_type | string, <br>**Available values:** "emoji", "image", "link" | emoji, image or link | No |
| max_active_requests | integer | Concurrent run cap; 0 means no cap | No |
| name | string | App name | No |

#### AppListQuery

mode is a closed enum of listable app types.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 |  | No |
| mode | [SupportedAppType](#supportedapptype) |  | No |
| name | string |  | No |
| page | integer, <br>**Default:** 1 |  | No |
| workspace_id | string (uuid) |  | Yes |

#### AppListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AppListRow](#applistrow) ] |  | Yes |
| has_more | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### AppListRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | Yes |
| mode | [AppMode](#appmode) |  | Yes |
| name | string |  | Yes |
| updated_at | string |  | No |
| workspace_id | string |  | No |
| workspace_name | string |  | No |

#### AppMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AppMode | string |  |  |

#### AppSettingsInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| max_active_requests | integer |  | No |
| name | string |  | Yes |

#### ChatAppInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| max_active_requests | integer |  | No |
| name | string |  | Yes |
| use_icon_as_answer_icon | boolean |  | No |

#### ChatAppInfoPatch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Pass an empty string to clear | No |
| icon | string | Emoji, file id or URL, per icon_type | No |
| icon_background | string | Background colour for an emoji icon | No |
| icon_type | string, <br>**Available values:** "emoji", "image", "link" | emoji, image or link | No |
| max_active_requests | integer | Concurrent run cap; 0 means no cap | No |
| name | string | App name | No |
| use_icon_as_answer_icon | boolean | Show the app icon on answers | No |

#### ChatRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachments | [ string ] | Local file paths attached to the run itself (the app's `sys.files`), not to a variable | No |
| auto_generate_name | boolean, <br>**Default:** true | Let the server name a new conversation | No |
| conversation_id | string | Continue an existing conversation | No |
| files | object | Local file paths keyed by the app's file variable name; each file is uploaded and becomes that variable's value. Give a list of paths for a file-list variable | No |
| inputs | object | Variables declared by the app. The exact shape is per app: read `input_schema` from describe.console_app. A file variable takes a Dify file mapping (remote url or upload id) here, or a local path in `files`, not both. | No |
| query | string | User message | Yes |
| workspace_id | string | Workspace that owns the app | No |

#### ChatWebApp

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | No |
| app_base_url | string |  | Yes |
| chat_color_theme | string |  | No |
| chat_color_theme_inverted | boolean |  | No |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| default_language | string |  | No |
| description | string |  | No |
| enabled | boolean |  | Yes |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| input_placeholder | string |  | No |
| privacy_policy | string |  | No |
| title | string |  | No |
| url | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |

#### ChatWebAppPatch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chat_color_theme | string | Chat colour, e.g. #1C64F2 | No |
| chat_color_theme_inverted | boolean | Invert the chat colours | No |
| copyright | string | Footer copyright text | No |
| custom_disclaimer | string | Disclaimer shown on the page | No |
| default_language | string | Language code, e.g. en-US | No |
| description | string | Page description | No |
| enabled | boolean | Turn the web app on or off | No |
| icon | string | Emoji, file id or URL, per icon_type | No |
| icon_background | string | Background colour for an emoji icon | No |
| icon_type | string, <br>**Available values:** "emoji", "image", "link" | emoji, image or link | No |
| input_placeholder | string | Placeholder of the chat input | No |
| privacy_policy | string | Privacy policy URL | No |
| title | string | Page title | No |
| use_icon_as_answer_icon | boolean | Show the app icon on answers | No |

#### CheckDependenciesResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| leaked_dependencies | [ [PluginDependency](#plugindependency) ] |  | No |

#### CheckDependenciesResult

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| leaked_dependencies | [ [PluginDependency](#plugindependency) ] |  | No |

#### CompletionRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachments | [ string ] | Local file paths attached to the run itself (the app's `sys.files`), not to a variable | No |
| files | object | Local file paths keyed by the app's file variable name; each file is uploaded and becomes that variable's value. Give a list of paths for a file-list variable | No |
| inputs | object | Variables declared by the app. The exact shape is per app: read `input_schema` from describe.console_app. A file variable takes a Dify file mapping (remote url or upload id) here, or a local path in `files`, not both. | No |
| query | string | Prompt text; most completion apps take their input through `inputs` | No |
| workspace_id | string | Workspace that owns the app | No |

#### CreateAppPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | App description | No |
| icon | string | Emoji, file id or URL, per icon_type | No |
| icon_background | string | Background colour for an emoji icon | No |
| icon_type | string, <br>**Available values:** "emoji", "image", "link" | emoji, image or link | No |
| name | string | App name | Yes |

#### CreatedAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |
| mode | string |  | Yes |
| name | string |  | Yes |

#### CredentialFormField

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| label | string |  | Yes |
| name | string |  | Yes |
| options | [ string ] | Allowed values, when the field is a choice | Yes |
| placeholder | string |  | Yes |
| required | boolean |  | Yes |
| show_on | [ object ] | Show this field only when these other fields have these values | Yes |
| type | string |  | Yes |

#### CredentialRef

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |

#### CredentialWriteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| id | string |  | Yes |
| name | string |  | Yes |

#### CustomModelRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_credential | [CredentialRef](#credentialref) |  | Yes |
| model | string |  | Yes |
| model_type | string |  | Yes |

#### DefaultModelListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DefaultModelRow](#defaultmodelrow) ] |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |

#### DefaultModelPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string | Model name, as in get.model | Yes |
| provider | string | Provider id such as langgenius/openai/openai | Yes |

#### DefaultModelResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| model | string |  | Yes |
| model_type | string |  | Yes |
| provider | string |  | Yes |

#### DefaultModelRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string |  | Yes |
| model_type | string |  | Yes |
| provider | string |  | Yes |

#### DeploymentEdition

Enum representing the deployment edition of the platform.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| DeploymentEdition | string | Enum representing the deployment edition of the platform. |  |

#### DeviceCodeRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_id | string |  | Yes |
| device_label | string |  | Yes |

#### DeviceCodeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| device_code | string |  | Yes |
| expires_in | integer |  | Yes |
| interval | integer |  | Yes |
| user_code | string |  | Yes |
| verification_uri | string |  | Yes |

#### DeviceLookupQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| user_code | string |  | Yes |

#### DeviceLookupResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_id | string |  | No |
| expires_in_remaining | integer |  | No |
| valid | boolean |  | Yes |

#### DeviceMutateRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| user_code | string |  | Yes |

#### DeviceMutateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| status | string |  | Yes |

#### DevicePollRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_id | string |  | Yes |
| device_code | string |  | Yes |

#### DeviceTokenResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account | [AccountPayload](#accountpayload) |  | No |
| default_workspace_id | string |  | No |
| expires_at | string |  | Yes |
| subject_email | string |  | No |
| subject_issuer | string |  | No |
| subject_type | [SubjectType](#subjecttype) |  | Yes |
| token | string |  | Yes |
| token_id | string |  | Yes |
| workspaces | [ [WorkspacePayload](#workspacepayload) ], <br>**Default:**  |  | No |

#### DraftWorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachments | [ string ] | Local file paths attached to the run itself (the app's `sys.files`), not to a variable | No |
| files | object | Local file paths keyed by the app's file variable name; each file is uploaded and becomes that variable's value. Give a list of paths for a file-list variable | No |
| inputs | object | Variables declared by the app. The exact shape is per app: read `input_schema` from describe.console_app. A file variable takes a Dify file mapping (remote url or upload id) here, or a local path in `files`, not both. | No |
| workspace_id | string | Workspace that owns the app | No |

#### DslImportWarning

Portable DSL reference that could not be restored in the target workspace.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| details | object |  | No |
| message | string |  | Yes |
| path | string |  | Yes |

#### EnvVariableListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [EnvVariableRow](#envvariablerow) ] |  | Yes |

#### EnvVariableRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string | What set and delete take to address this variable | Yes |
| name | string | What nodes use to refer to this variable | Yes |
| value |  | The value; a secret with a value is masked, an empty one reads as empty | Yes |
| value_type | string |  | Yes |

#### EnvVariableSetPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | What the variable is for | No |
| name | string | Variable name | Yes |
| value |  | The value; sending the masked value of an existing secret keeps the stored one | Yes |
| value_type | [EnvVariableValueType](#envvariablevaluetype) | string, number or secret | Yes |

#### EnvVariableValueType

Value types the draft environment-variable ``set`` op accepts.

A curated subset of ``SegmentType``: what the console's environment-variable editor
allows (``ENVIRONMENT_VARIABLE_SUPPORTED_TYPES`` in controllers/console/app/workflow.py).
Members reference ``SegmentType.*.value`` so the subset relationship is type-checked.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EnvVariableValueType | string | Value types the draft environment-variable ``set`` op accepts.  A curated subset of ``SegmentType``: what the console's environment-variable editor allows (``ENVIRONMENT_VARIABLE_SUPPORTED_TYPES`` in controllers/console/app/workflow.py). Members reference ``SegmentType.*.value`` so the subset relationship is type-checked. |  |

#### ErrorBody

Canonical non-2xx body. ``code`` is typed ``str`` (not the enum) so the
generated client schema stays an open enum — old CLIs keep parsing when a
future server adds a code. Formatter tests pin emitted values to the enum.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| details | [ [ErrorDetail](#errordetail) ] |  | No |
| hint | string |  | No |
| message | string |  | Yes |
| status | integer |  | Yes |

#### ErrorDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| loc | [ string<br>integer ] |  | No |
| msg | string |  | Yes |
| type | string |  | Yes |

#### EventStreamResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EventStreamResponse | string |  |  |

#### FileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| extension | string |  | No |
| file_key | string |  | No |
| id | string (uuid) |  | Yes |
| mime_type | string |  | No |
| name | string |  | Yes |
| original_url | string |  | No |
| preview_url | string |  | No |
| reference | string |  | No |
| size | integer |  | Yes |
| source_url | string |  | No |
| tenant_id | string |  | No |
| user_id | string |  | No |

#### FileUploadPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file | binary | The file to upload; its id can then be used in an app run's file variables | Yes |

#### FormSubmitResponse

Empty 200 body for POST /apps/<id>/human-input-forms/<token>:submit. `extra='forbid'`
pins `additionalProperties: false` so the generated contract is an exact `{}` rather
than an under-annotated open object.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |

#### Github

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| github_plugin_unique_identifier | string |  | Yes |
| package | string |  | Yes |
| repo | string |  | Yes |
| version | string |  | Yes |

#### HealthResponse

Liveness payload for `GET /openapi/v1/_health` — no auth required.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ok | boolean |  | Yes |

#### Hint

A next step the caller can hand straight to `call <op> --input <input>`.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| form | [ object ] | Form fields behind the hint's input: a paused run's form inputs, or credentials | No |
| input | object | Ready-to-send input for `op`; unknown values are null | Yes |
| op | string |  | Yes |
| summary | string |  | Yes |

#### HumanInputFormDefinitionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| expiration_time | integer |  | No |
| form_content | string |  | Yes |
| inputs | [ object ] |  | No |
| resolved_default_values | object |  | Yes |
| user_actions | [ object ] |  | No |

#### Import

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | No |
| app_mode | [AppMode](#appmode) |  | No |
| current_dsl_version | string, <br>**Default:** 0.7.0 |  | No |
| error | string |  | No |
| id | string |  | Yes |
| imported_dsl_version | string |  | No |
| permission_keys | [ string ] |  | No |
| status | [ImportStatus](#importstatus) |  | Yes |
| warnings | [ [DslImportWarning](#dslimportwarning) ] |  | No |

#### ImportStatus

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ImportStatus | string |  |  |

#### JsonValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JsonValue |  |  |  |

#### Marketplace

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| marketplace_plugin_unique_identifier | string |  | Yes |
| version | string |  | No |

#### MarketplacePluginListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [MarketplacePluginRow](#marketplacepluginrow) ] |  | Yes |
| has_more | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### MarketplacePluginQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| category | [PluginCategory](#plugincategory) | Only plugins of this category | No |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |
| query | string | Words to search for; empty lists the most installed plugins | No |

#### MarketplacePluginRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| authorized_category | string | Who vouches for the plugin: langgenius (official), partner or community; workspace install-scope rules check this | Yes |
| brief | string |  | Yes |
| category | string |  | Yes |
| identifier | string | Latest versioned id; pass it to install.plugin | Yes |
| install_count | integer |  | Yes |
| installed | boolean |  | Yes |
| installed_version | string |  | Yes |
| label | string |  | Yes |
| plugin_id | string |  | Yes |
| version | string |  | Yes |

#### MemberActionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string, <br>**Default:** success |  | No |

#### MemberInvitePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| role | string, <br>**Available values:** "admin", "normal" | *Enum:* `"admin"`, `"normal"` | Yes |

#### MemberInviteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| invite_url | string |  | Yes |
| member_id | string |  | Yes |
| result | string, <br>**Default:** success |  | No |
| role | string |  | Yes |
| tenant_id | string |  | Yes |

#### MemberListQuery

Strict (extra='forbid').

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### MemberListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [MemberResponse](#memberresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### MemberResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar | string |  | No |
| email | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| role | string |  | Yes |
| status | string |  | Yes |

#### MemberRoleUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| role | string, <br>**Available values:** "admin", "normal" | *Enum:* `"admin"`, `"normal"` | Yes |

#### MessageMetadata

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| retriever_resources | [ object ], <br>**Default:**  |  | No |
| usage | [UsageInfo](#usageinfo) |  | No |

#### ModelCredentialCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object | Secret values. Pass with --credentials @- (stdin) or @file, never inline. Field names come from credential_form in the describe op. | Yes |
| model | string | Model name, as in get.model | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |
| name | string |  | No |

#### ModelCredentialUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object | Secret values. Pass with --credentials @- (stdin) or @file, never inline. Field names come from credential_form in the describe op. Send [__HIDDEN__] for a secret you keep unchanged. | Yes |
| model | string | Model name, as in get.model | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |
| name | string |  | No |

#### ModelListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ModelRow](#modelrow) ] |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |

#### ModelProviderDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_credential | [CredentialRef](#credentialref) |  | Yes |
| configured | boolean |  | Yes |
| credential_form | [ [CredentialFormField](#credentialformfield) ] |  | Yes |
| credentials | [ [CredentialRef](#credentialref) ] |  | Yes |
| custom_model_form | [ [CredentialFormField](#credentialformfield) ] |  | Yes |
| custom_models | [ [CustomModelRow](#custommodelrow) ] |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| label | string |  | Yes |
| model_types | [ string ] |  | Yes |
| provider | string | Provider id such as langgenius/openai/openai | Yes |

#### ModelProviderListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model_type | [ModelType](#modeltype) | Only providers that serve this model type | No |

#### ModelProviderListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ModelProviderRow](#modelproviderrow) ] |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |

#### ModelProviderRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_credential | [CredentialRef](#credentialref) |  | Yes |
| configured | boolean |  | Yes |
| label | string |  | Yes |
| model_types | [ string ] |  | Yes |
| provider | string | Provider id such as langgenius/openai/openai | Yes |

#### ModelRef

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string | Model name, as in get.model | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### ModelRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| features | [ string ] |  | Yes |
| label | string |  | Yes |
| model | string |  | Yes |
| model_type | string |  | Yes |
| status | string |  | Yes |

#### ModelType

Enum class for model type.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelType | string | Enum class for model type. |  |

#### NodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object | Overrides for what the last draft run saved, keyed by variable reference such as #llm.text# | No |

#### NodeTypeDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default_config | object |  | Yes |
| schema | object |  | Yes |
| type | string |  | Yes |
| version | string |  | Yes |

#### NodeTypeListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [NodeTypeRow](#nodetyperow) ] |  | Yes |

#### NodeTypeRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| type | string |  | Yes |
| version | string |  | Yes |

#### OpenApiErrorCode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| OpenApiErrorCode | string |  |  |

#### OpenApiFormSubmitPayload

The console payload plus local file parts; `_files.merge_files` sets them on `inputs`.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string | ID of the action button the recipient selected. Must match one of the `id` values from the form's `user_actions` list. | Yes |
| files | object | Local file paths keyed by the form's file input name, same convention as the run ops' `files` | No |
| inputs | object | Submitted human input values keyed by output variable name. Use a string for paragraph or select input values, a file mapping for file inputs, and a list of file mappings for file-list inputs. Local file mappings use `transfer_method=local_file` with `upload_file_id`; remote file mappings use `transfer_method=remote_url` with `url` or `remote_url`. | Yes |

#### Package

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_unique_identifier | string |  | Yes |
| version | string |  | No |

#### PermittedExternalAppsListQuery

Strict (extra='forbid').

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 |  | No |
| mode | [SupportedAppType](#supportedapptype) |  | No |
| name | string |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### PermittedExternalAppsListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AppListRow](#applistrow) ] |  | Yes |
| has_more | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### PluginCategory

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PluginCategory | string |  |  |

#### PluginDeleteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| deleted | boolean |  | Yes |
| plugin_id | string |  | Yes |

#### PluginDependency

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current_identifier | string |  | No |
| type | [PluginDependencyType](#plugindependencytype) |  | Yes |
| value | [Github](#github)<br>[Marketplace](#marketplace)<br>[Package](#package) |  | Yes |

#### PluginDependencyType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PluginDependencyType | string |  |  |

#### PluginInstallPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| identifiers | [ string ] | Versioned plugin ids such as langgenius/openai:0.2.1@sha256…, from get.marketplace.plugin (identifier) or check.console_app.dependency | Yes |

#### PluginListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| category | [PluginCategory](#plugincategory) | Only plugins of this category | No |

#### PluginListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [PluginRow](#pluginrow) ] |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |

#### PluginProvides

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model_provider | string | Model provider id this plugin adds, for describe.model_provider | Yes |
| tool_provider | string | Tool provider id this plugin adds, for describe.tool_provider | Yes |

#### PluginRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| category | string |  | Yes |
| identifier | string |  | Yes |
| label | string |  | Yes |
| latest_version | string |  | Yes |
| plugin_id | string |  | Yes |
| provides | [PluginProvides](#pluginprovides) |  | Yes |
| source | string |  | Yes |
| version | string |  | Yes |

#### PluginTaskItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| identifier | string |  | Yes |
| message | string |  | Yes |
| plugin_id | string |  | Yes |
| status | string |  | Yes |

#### PluginTaskResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| plugins | [ [PluginTaskItem](#plugintaskitem) ] |  | Yes |
| status | string | pending, running, success or failed | Yes |
| task_id | string |  | Yes |

#### PluginTaskStartResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| all_installed | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| task_id | string |  | Yes |

#### PluginUpgradePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| identifier | string | Versioned id to upgrade to, from get.marketplace.plugin | Yes |
| plugin_id | string | Installed plugin id such as langgenius/openai | Yes |

#### ProviderCredentialCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object | Secret values. Pass with --credentials @- (stdin) or @file, never inline. Field names come from credential_form in the describe op. | Yes |
| name | string | Credential name; the server makes one when absent | No |

#### ProviderCredentialUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object | Secret values. Pass with --credentials @- (stdin) or @file, never inline. Field names come from credential_form in the describe op. Send [__HIDDEN__] for a secret you keep unchanged. | Yes |
| name | string |  | No |

#### PublishPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| marked_comment | string | Version note | No |
| marked_name | string | Version name | No |

#### PublishResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | Yes |
| version_id | string |  | Yes |
| warning | string | Variable references that may read a skipped branch | No |

#### RestoreResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| draft_hash | string | Hash of the restored draft's graph, features, environment variables and conversation variables; pass it to a DSL import as draft_hash | Yes |
| result | string |  | Yes |

#### RevokeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| status | string |  | Yes |

#### RunListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string | Cursor: id of the last run on the previous page | No |
| limit | integer, <br>**Default:** 20 |  | No |
| status | string, <br>**Available values:** "failed", "partial-succeeded", "running", "stopped", "succeeded" |  | No |
| triggered_from | string, <br>**Available values:** "app-run", "debugging" | debugging: draft test runs; app-run: real use. Omitted: debugging, as in the console | No |

#### RunListResponse

Cursor page of runs; `hints` carries the next page.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowRunForListResponse](#workflowrunforlistresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| limit | integer |  | Yes |

#### ServerVersionResponse

Meta endpoint payload for `GET /openapi/v1/_version` — no auth required.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| edition | [DeploymentEdition](#deploymentedition) |  | Yes |
| version | string |  | Yes |

#### ServiceApi

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| base_url | string |  | Yes |
| enabled | boolean |  | Yes |

#### ServiceApiPatch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean | Turn the app's Service API on or off | Yes |

#### SessionListQuery

Pagination for GET /account/sessions. Strict (extra='forbid').

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 100 |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### SessionListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [SessionRow](#sessionrow) ] |  | Yes |
| has_more | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### SessionRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_id | string |  | Yes |
| created_at | string |  | No |
| device_label | string |  | Yes |
| expires_at | string |  | No |
| id | string |  | Yes |
| last_used_at | string |  | No |
| prefix | string |  | Yes |

#### SimpleAccountResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |

#### SimpleEndUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| is_anonymous | boolean |  | Yes |
| session_id | string |  | No |
| type | string |  | Yes |

#### SimpleResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Operation result. | Yes |

#### SubjectType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| SubjectType | string |  |  |

#### SupportedAppType

App types the ``app`` usage face (``get app``) lists and filters.

A curated subset of :class:`AppMode`: the real, user-facing app categories.
Excludes runtime-only mode tags that are not standalone apps
(``rag-pipeline`` is a knowledge ``Pipeline``; ``channel`` is unused) and the
roster-owned ``agent`` type (surfaced through the roster, not this list).

Members reference ``AppMode.*.value`` so the subset relationship is
type-checked: dropping a member from ``AppMode`` breaks this at import.
This is the single source for the listable set — params, filters, and the
generated CLI whitelist all derive from it.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| SupportedAppType | string | App types the ``app`` usage face (``get app``) lists and filters.  A curated subset of :class:`AppMode`: the real, user-facing app categories. Excludes runtime-only mode tags that are not standalone apps (``rag-pipeline`` is a knowledge ``Pipeline``; ``channel`` is unused) and the roster-owned ``agent`` type (surfaced through the roster, not this list).  Members reference ``AppMode.*.value`` so the subset relationship is type-checked: dropping a member from ``AppMode`` breaks this at import. This is the single source for the listable set — params, filters, and the generated CLI whitelist all derive from it. |  |

#### TaskStopResponse

200 body for POST /apps/<id>/tasks/<task_id>:stop. The handler always returns
{"result": "success"}, so `result` is required (no default) — the generated contract
types it as a required `'success'` rather than an optional field.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |

#### ToolCredentialCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object | Secret values. Pass with --credentials @- (stdin) or @file, never inline. Field names come from credential_form in the describe op. | Yes |
| name | string |  | No |

#### ToolCredentialUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object | Secret values. Pass with --credentials @- (stdin) or @file, never inline. Field names come from credential_form in the describe op. Send [__HIDDEN__] for a secret you keep unchanged. | Yes |
| name | string |  | No |

#### ToolProviderDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| configured | boolean | Ready to use: needs no credential, or the workspace has one | Yes |
| credential_form | [ [CredentialFormField](#credentialformfield) ] | Fields of an api-key credential | Yes |
| credential_types | [ string ] | api-key can be set here; oauth2 needs the console | Yes |
| credentials | [ [CredentialRef](#credentialref) ] |  | Yes |
| default_credential | [CredentialRef](#credentialref) |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| label | string |  | Yes |
| provider | string | Tool provider id such as langgenius/tavily/tavily | Yes |

#### ToolProviderListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ToolProviderRow](#toolproviderrow) ] |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |

#### ToolProviderRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| configured | boolean | Ready to use: needs no credential, or the workspace has one | Yes |
| credential_types | [ string ] | api-key can be set here; oauth2 needs the console | Yes |
| label | string |  | Yes |
| provider | string | Tool provider id such as langgenius/tavily/tavily | Yes |

#### UsageInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| completion_tokens | integer |  | No |
| prompt_tokens | integer |  | No |
| total_tokens | integer |  | No |

#### VersionListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 |  | No |
| named_only | boolean | Only versions that have a name | No |
| page | integer, <br>**Default:** 1 |  | No |

#### VersionListResponse

Page of published versions, newest first; there is no total, `hints` carries the next page.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [VersionRow](#versionrow) ] |  | Yes |
| has_more | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| limit | integer |  | Yes |
| page | integer |  | Yes |

#### VersionRow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | Yes |
| created_by | string |  | No |
| current | boolean |  | No |
| id | string |  | Yes |
| marked_comment | string |  | Yes |
| marked_name | string |  | Yes |

#### WebApp

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | No |
| app_base_url | string |  | Yes |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| default_language | string |  | No |
| description | string |  | No |
| enabled | boolean |  | Yes |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| privacy_policy | string |  | No |
| title | string |  | No |
| url | string |  | No |

#### WebAppAccess

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode | string |  | Yes |

#### WebAppAccessMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| WebAppAccessMode | string |  |  |

#### WebAppAccessPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode | [WebAppAccessMode](#webappaccessmode) | public, private_all or sso_verified. Choose specific members (private) in the Dify console | Yes |

#### WebAppPatch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| copyright | string | Footer copyright text | No |
| custom_disclaimer | string | Disclaimer shown on the page | No |
| default_language | string | Language code, e.g. en-US | No |
| description | string | Page description | No |
| enabled | boolean | Turn the web app on or off | No |
| icon | string | Emoji, file id or URL, per icon_type | No |
| icon_background | string | Background colour for an emoji icon | No |
| icon_type | string, <br>**Available values:** "emoji", "image", "link" | emoji, image or link | No |
| privacy_policy | string | Privacy policy URL | No |
| title | string | Page title | No |

#### WebAppToken

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | No |
| app_base_url | string |  | Yes |
| url | string |  | No |

#### WorkflowRunData

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| elapsed_time | number |  | No |
| error | string |  | No |
| finished_at | integer |  | No |
| id | string |  | Yes |
| outputs | object |  | No |
| status | string |  | Yes |
| total_steps | integer |  | No |
| total_tokens | integer |  | No |
| workflow_id | string |  | Yes |

#### WorkflowRunDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by_account | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| created_by_end_user | [SimpleEndUser](#simpleenduser) |  | No |
| created_by_role | string |  | No |
| elapsed_time | number |  | No |
| error | string |  | No |
| exceptions_count | integer |  | No |
| finished_at | integer |  | No |
| graph |  |  | Yes |
| id | string |  | Yes |
| inputs |  |  | Yes |
| outputs |  |  | Yes |
| status | string |  | No |
| total_steps | integer |  | No |
| total_tokens | integer |  | No |
| version | string |  | No |

#### WorkflowRunForListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by_account | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| elapsed_time | number |  | No |
| exceptions_count | integer |  | No |
| finished_at | integer |  | No |
| id | string |  | Yes |
| retry_index | integer |  | No |
| status | string |  | No |
| total_steps | integer |  | No |
| total_tokens | integer |  | No |
| version | string |  | No |

#### WorkflowRunNodeExecutionListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse) ] |  | Yes |

#### WorkflowRunNodeExecutionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by_account | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| created_by_end_user | [SimpleEndUser](#simpleenduser) |  | No |
| created_by_role | string |  | No |
| elapsed_time | number |  | No |
| error | string |  | No |
| execution_metadata |  |  | No |
| extras |  |  | No |
| finished_at | integer |  | No |
| id | string |  | Yes |
| index | integer |  | No |
| inputs |  |  | No |
| inputs_truncated | boolean |  | No |
| node_id | string |  | No |
| node_type | string |  | No |
| outputs |  |  | No |
| outputs_truncated | boolean |  | No |
| predecessor_node_id | string |  | No |
| process_data |  |  | No |
| process_data_truncated | boolean |  | No |
| retry_index | integer |  | No |
| status | string |  | No |
| title | string |  | No |

#### WorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachments | [ string ] | Local file paths attached to the run itself (the app's `sys.files`), not to a variable | No |
| files | object | Local file paths keyed by the app's file variable name; each file is uploaded and becomes that variable's value. Give a list of paths for a file-list variable | No |
| inputs | object | Variables declared by the app. The exact shape is per app: read `input_schema` from describe.console_app. A file variable takes a Dify file mapping (remote url or upload id) here, or a local path in `files`, not both. | No |
| workflow_id | string | Pin a published workflow version | No |
| workspace_id | string | Workspace that owns the app | No |

#### WorkflowWebApp

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | No |
| app_base_url | string |  | Yes |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| default_language | string |  | No |
| description | string |  | No |
| enabled | boolean |  | Yes |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| privacy_policy | string |  | No |
| show_workflow_steps | boolean |  | No |
| title | string |  | No |
| url | string |  | No |

#### WorkflowWebAppPatch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| copyright | string | Footer copyright text | No |
| custom_disclaimer | string | Disclaimer shown on the page | No |
| default_language | string | Language code, e.g. en-US | No |
| description | string | Page description | No |
| enabled | boolean | Turn the web app on or off | No |
| icon | string | Emoji, file id or URL, per icon_type | No |
| icon_background | string | Background colour for an emoji icon | No |
| icon_type | string, <br>**Available values:** "emoji", "image", "link" | emoji, image or link | No |
| privacy_policy | string | Privacy policy URL | No |
| show_workflow_steps | boolean | Show each node step to users | No |
| title | string | Page title | No |

#### WorkspaceDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | string |  | No |
| current | boolean |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| role | string |  | Yes |
| status | string |  | Yes |

#### WorkspaceListQuery

Strict (extra='forbid').

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### WorkspaceListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkspaceSummaryResponse](#workspacesummaryresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| hints | [ [Hint](#hint) ] | Next steps the caller can take | No |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### WorkspacePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| role | string |  | Yes |

#### WorkspaceSummaryResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current | boolean |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| role | string |  | Yes |
| status | string |  | Yes |

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
| workspace_id | query |  | Yes | string |

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

### [GET] /apps/{app_id}/dependencies:check
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dependencies checked | **application/json**: [CheckDependenciesResult](#checkdependenciesresult)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [GET] /apps/{app_id}/dsl
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| include_secret | query | Include encrypted secret values in the exported DSL | No | boolean |
| workflow_id | query | Export a specific workflow version instead of the current draft | No | string |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Export successful | **application/json**: [AppDslExportResponse](#appdslexportresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |
| default | Error | **application/json**: [ErrorBody](#errorbody)<br> |

### [POST] /apps/{app_id}/files
Upload a file to use as an input variable when running the app

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileResponse](#fileresponse)<br> |
| 400 | Bad request — no file or filename missing |  |
| 401 | Unauthorized — invalid or expired bearer token |  |
| 413 | File too large |  |
| 415 | Unsupported file type or blocked extension |  |
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

### [POST] /apps/{app_id}/human-input-forms/{form_token}:submit
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| form_token | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputFormSubmitPayload](#humaninputformsubmitpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Form submitted | **application/json**: [FormSubmitResponse](#formsubmitresponse)<br> |
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

### [POST] /apps/{app_id}:run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppRunRequest](#apprunrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Run result (SSE stream) | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 422 | Validation error | **application/json**: [ErrorBody](#errorbody)<br> |

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
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workspace list | **application/json**: [WorkspaceListResponse](#workspacelistresponse)<br> |
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
| 200 | Import completed | **application/json**: [Import](#import)<br> |
| 202 | Import pending confirmation | **application/json**: [Import](#import)<br> |
| 400 | Import failed | **application/json**: [Import](#import)<br> |
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
| subject_type | string |  | Yes |
| workspaces | [ [WorkspacePayload](#workspacepayload) ], <br>**Default:**  |  | No |

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

#### AppDslImportPayload

Request body for POST /workspaces/<workspace_id>/apps/imports.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string | Existing app ID to overwrite (workflow/advanced-chat apps only) | No |
| description | string | Override the app description from the DSL | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| mode | string, <br>**Available values:** "yaml-content", "yaml-url" | Import mode: yaml-content or yaml-url<br>*Enum:* `"yaml-content"`, `"yaml-url"` | Yes |
| name | string | Override the app name from the DSL | No |
| yaml_content | string | Inline YAML DSL string (required when mode is yaml-content) | No |
| yaml_url | string | Remote URL to fetch YAML from (required when mode is yaml-url) | No |

#### AppInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | Yes |
| mode | string |  | Yes |
| name | string |  | Yes |

#### AppListQuery

mode is a closed enum of listable app types.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 |  | No |
| mode | [SupportedAppType](#supportedapptype) |  | No |
| name | string |  | No |
| page | integer, <br>**Default:** 1 |  | No |
| workspace_id | string |  | Yes |

#### AppListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AppListRow](#applistrow) ] |  | Yes |
| has_more | boolean |  | Yes |
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

#### AppRunRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate_name | boolean, <br>**Default:** true |  | No |
| conversation_id | string |  | No |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| query | string |  | No |
| workflow_id | string |  | No |
| workspace_id | string |  | No |

#### CheckDependenciesResult

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| leaked_dependencies | [ [PluginDependency](#plugindependency) ] |  | No |

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
| subject_type | string, <br>**Available values:** "account", "external_sso" | *Enum:* `"account"`, `"external_sso"` | Yes |
| token | string |  | Yes |
| token_id | string |  | Yes |
| workspaces | [ [WorkspacePayload](#workspacepayload) ], <br>**Default:**  |  | No |

#### DslImportWarning

Portable DSL reference that could not be restored in the target workspace.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| details | object |  | No |
| message | string |  | Yes |
| path | string |  | Yes |

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

#### HumanInputFormDefinitionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| expiration_time | integer |  | No |
| form_content | string |  | Yes |
| inputs | [ object ] |  | No |
| resolved_default_values | object |  | Yes |
| user_actions | [ object ] |  | No |

#### HumanInputFormSubmitPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string | ID of the action button the recipient selected. Must match one of the `id` values from the form's `user_actions` list. | Yes |
| inputs | object | Submitted human input values keyed by output variable name. Use a string for paragraph or select input values, a file mapping for file inputs, and a list of file mappings for file-list inputs. Local file mappings use `transfer_method=local_file` with `upload_file_id`; remote file mappings use `transfer_method=remote_url` with `url` or `remote_url`. | Yes |

#### Import

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | No |
| app_mode | string |  | No |
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

#### OpenApiErrorCode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| OpenApiErrorCode | string |  |  |

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
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

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

#### RevokeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| status | string |  | Yes |

#### ServerVersionResponse

Meta endpoint payload for `GET /openapi/v1/_version` — no auth required.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| edition | string, <br>**Available values:** "CLOUD", "SELF_HOSTED" | *Enum:* `"CLOUD"`, `"SELF_HOSTED"` | Yes |
| version | string |  | Yes |

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

#### SimpleResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |

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

#### UsageInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| completion_tokens | integer |  | No |
| prompt_tokens | integer |  | No |
| total_tokens | integer |  | No |

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

#### WorkspaceDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | string |  | No |
| current | boolean |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| role | string |  | Yes |
| status | string |  | Yes |

#### WorkspaceListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| workspaces | [ [WorkspaceSummaryResponse](#workspacesummaryresponse) ] |  | Yes |

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

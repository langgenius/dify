# OpenAPI
User-scoped programmatic API (bearer auth)

## Version: 1.0

### Security
**Bearer**  

| apiKey | *API Key* |
| ------ | --------- |
| Description | Type: Bearer {your-api-key} |
| In | header |
| Name | Authorization |

---
## openapi
User-scoped operations

### /_health

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /account

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Account info | [AccountResponse](#accountresponse) |

### /account/sessions

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Session list | [SessionListResponse](#sessionlistresponse) |

### /account/sessions/self

#### DELETE
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Session revoked | [RevokeResponse](#revokeresponse) |

### /account/sessions/{session_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| session_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Session revoked | [RevokeResponse](#revokeresponse) |

### /apps

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer |
| mode | query |  | No | string |
| name | query |  | No | string |
| page | query |  | No | integer |
| tag | query |  | No | string |
| workspace_id | query |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App list | [AppListResponse](#applistresponse) |

### /apps/{app_id}/describe

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| fields | query |  | No | [ string ] |
| workspace_id | query |  | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App description | [AppDescribeResponse](#appdescriberesponse) |

### /apps/{app_id}/form/human_input/{form_token}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| form_token | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Form definition |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| form_token | path |  | Yes | string |
| payload | body |  | Yes | [HumanInputFormSubmitPayload](#humaninputformsubmitpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Form submitted |

### /apps/{app_id}/run

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| payload | body |  | Yes | [AppRunRequest](#apprunrequest) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Run result (SSE stream) |

### /apps/{app_id}/tasks/{task_id}/events

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | SSE event stream |

### /apps/{app_id}/tasks/{task_id}/stop

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Task stopped |

### /oauth/device/approve

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DeviceMutateRequest](#devicemutaterequest) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Approved | [DeviceMutateResponse](#devicemutateresponse) |

### /oauth/device/code

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DeviceCodeRequest](#devicecoderequest) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Device code created | [DeviceCodeResponse](#devicecoderesponse) |

### /oauth/device/deny

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DeviceMutateRequest](#devicemutaterequest) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Denied | [DeviceMutateResponse](#devicemutateresponse) |

### /oauth/device/lookup

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| user_code | query |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Device lookup result | [DeviceLookupResponse](#devicelookupresponse) |

### /oauth/device/token

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DevicePollRequest](#devicepollrequest) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /permitted-external-apps

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Permitted external apps list | [PermittedExternalAppsListResponse](#permittedexternalappslistresponse) |

### /workspaces

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workspace list | [WorkspaceListResponse](#workspacelistresponse) |

### /workspaces/{workspace_id}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workspace_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workspace detail | [WorkspaceDetailResponse](#workspacedetailresponse) |

---
### Models

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
| workspaces | [ [WorkspacePayload](#workspacepayload) ] |  | No |

#### AppDescribeInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| author | string |  | No |
| description | string |  | No |
| id | string |  | Yes |
| is_agent | boolean |  | No |
| mode | string |  | Yes |
| name | string |  | Yes |
| service_api_enabled | boolean |  | Yes |
| tags | [ [TagItem](#tagitem) ] |  | No |
| updated_at | string |  | No |

#### AppDescribeQuery

`?fields=` allow-list for GET /apps/<id>/describe.

Empty / omitted → all blocks. Unknown member → ValidationError → 422.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| fields | [ string ] |  | No |
| workspace_id | string |  | No |

#### AppDescribeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| info | [AppDescribeInfo](#appdescribeinfo) |  | No |
| input_schema | object |  | No |
| parameters | object |  | No |

#### AppInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| author | string |  | No |
| description | string |  | No |
| id | string |  | Yes |
| mode | string |  | Yes |
| name | string |  | Yes |
| tags | [ [TagItem](#tagitem) ] |  | No |

#### AppListQuery

mode is a closed enum.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer |  | No |
| mode | [AppMode](#appmode) |  | No |
| name | string |  | No |
| page | integer |  | No |
| tag | string |  | No |
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
| created_by_name | string |  | No |
| description | string |  | No |
| id | string |  | Yes |
| mode | [AppMode](#appmode) |  | Yes |
| name | string |  | Yes |
| tags | [ [TagItem](#tagitem) ] |  | No |
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
| auto_generate_name | boolean |  | No |
| conversation_id | string |  | No |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| query | string |  | No |
| workflow_id | string |  | No |
| workspace_id | string |  | No |

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

#### HumanInputFormSubmitPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string |  | Yes |
| inputs | object |  | Yes |

#### JsonValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JsonValue |  |  |  |

#### MessageMetadata

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| retriever_resources | [ object ] |  | No |
| usage | [UsageInfo](#usageinfo) |  | No |

#### PermittedExternalAppsListQuery

Strict (extra='forbid').

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer |  | No |
| mode | [AppMode](#appmode) |  | No |
| name | string |  | No |
| page | integer |  | No |

#### PermittedExternalAppsListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AppListRow](#applistrow) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### RevokeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| status | string |  | Yes |

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

#### TagItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

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

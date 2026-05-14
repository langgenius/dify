# Console API
Console management APIs for app configuration, monitoring, and administration

## Version: 1.0

### Security
**Bearer**  

| apiKey | *API Key* |
| ------ | --------- |
| Description | Type: Bearer {your-api-key} |
| In | header |
| Name | Authorization |

---
## console
Console management API operations

### /account/avatar

#### GET
##### Description

Get account avatar url

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountAvatarQuery](#accountavatarquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountAvatarPayload](#accountavatarpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [Account](#account) |

### /account/change-email

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChangeEmailSendPayload](#changeemailsendpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /account/change-email/check-email-unique

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [CheckEmailUniquePayload](#checkemailuniquepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /account/change-email/reset

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChangeEmailResetPayload](#changeemailresetpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [Account](#account) |

### /account/change-email/validity

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChangeEmailValidityPayload](#changeemailvaliditypayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /account/delete

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountDeletePayload](#accountdeletepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /account/delete/feedback

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountDeletionFeedbackPayload](#accountdeletionfeedbackpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /account/delete/verify

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /account/education

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [EducationStatusResponse](#educationstatusresponse) |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EducationActivatePayload](#educationactivatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /account/education/autocomplete

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EducationAutocompleteQuery](#educationautocompletequery) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [EducationAutocompleteResponse](#educationautocompleteresponse) |

### /account/education/verify

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [EducationVerifyResponse](#educationverifyresponse) |

### /account/init

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountInitPayload](#accountinitpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /account/integrates

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [AccountIntegrateListResponse](#accountintegratelistresponse) |

### /account/interface-language

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountInterfaceLanguagePayload](#accountinterfacelanguagepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [Account](#account) |

### /account/interface-theme

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountInterfaceThemePayload](#accountinterfacethemepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [Account](#account) |

### /account/name

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountNamePayload](#accountnamepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [Account](#account) |

### /account/password

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountPasswordPayload](#accountpasswordpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [Account](#account) |

### /account/profile

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [Account](#account) |

### /account/timezone

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AccountTimezonePayload](#accounttimezonepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [Account](#account) |

### /activate

#### POST
##### Description

Activate account with invitation token

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ActivatePayload](#activatepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Account activated successfully | [ActivationResponse](#activationresponse) |
| 400 | Already activated or invalid token |  |

### /activate/check

#### GET
##### Description

Check if activation token is valid

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ActivateCheckQuery](#activatecheckquery) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [ActivationCheckResponse](#activationcheckresponse) |

### /all-workspaces

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkspaceListQuery](#workspacelistquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /api-based-extension

#### GET
##### Description

Get all API-based extensions for current tenant

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [APIBasedExtensionListResponse](#apibasedextensionlistresponse) |

#### POST
##### Description

Create a new API-based extension

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [APIBasedExtensionPayload](#apibasedextensionpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Extension created successfully | [APIBasedExtensionResponse](#apibasedextensionresponse) |

### /api-based-extension/{id}

#### DELETE
##### Description

Delete API-based extension

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| id | path | Extension ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Extension deleted successfully |

#### GET
##### Description

Get API-based extension by ID

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| id | path | Extension ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [APIBasedExtensionResponse](#apibasedextensionresponse) |

#### POST
##### Description

Update API-based extension

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [APIBasedExtensionPayload](#apibasedextensionpayload) |
| id | path | Extension ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Extension updated successfully | [APIBasedExtensionResponse](#apibasedextensionresponse) |

### /api-key-auth/data-source

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /api-key-auth/data-source/binding

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ApiKeyAuthBindingPayload](#apikeyauthbindingpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /api-key-auth/data-source/{binding_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| binding_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /app/prompt-templates

#### GET
##### Description

Get advanced prompt templates based on app mode and model configuration

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AdvancedPromptTemplateQuery](#advancedprompttemplatequery) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Prompt templates retrieved successfully | [ object ] |
| 400 | Invalid request parameters |  |

### /apps

#### GET
##### Summary

Get app list

##### Description

Get list of applications with pagination and filtering

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AppListQuery](#applistquery) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [AppPagination](#apppagination) |

#### POST
##### Summary

Create app

##### Description

Create a new application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [CreateAppPayload](#createapppayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | App created successfully | [AppDetail](#appdetail) |
| 400 | Invalid request parameters |  |
| 403 | Insufficient permissions |  |

### /apps/imports

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AppImportPayload](#appimportpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Import completed | [Import](#import) |
| 202 | Import pending confirmation | [Import](#import) |
| 400 | Import failed | [Import](#import) |

### /apps/imports/{app_id}/check-dependencies

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dependencies checked | [CheckDependenciesResult](#checkdependenciesresult) |

### /apps/imports/{import_id}/confirm

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| import_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Import confirmed | [Import](#import) |
| 400 | Import failed | [Import](#import) |

### /apps/workflows/online-users

#### POST
##### Description

Get workflow online users

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowOnlineUsersPayload](#workflowonlineuserspayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /apps/{app_id}

#### DELETE
##### Summary

Delete app

##### Description

Delete application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | App deleted successfully |
| 403 | Insufficient permissions |

#### GET
##### Summary

Get app detail

##### Description

Get application details

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [AppDetailWithSite](#appdetailwithsite) |

#### PUT
##### Summary

Update app

##### Description

Update application details

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [UpdateAppPayload](#updateapppayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App updated successfully | [AppDetailWithSite](#appdetailwithsite) |
| 400 | Invalid request parameters |  |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/advanced-chat/workflow-runs

#### GET
##### Summary

Get advanced chat app workflow run list

##### Description

Get advanced chat workflow run list

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| last_id | query | Last run ID for pagination | No | string |
| limit | query | Number of items per page (1-100) | No | integer |
| status | query | Workflow run status filter | No | string |
| triggered_from | query | Filter by trigger source: debugging or app-run. Default: debugging | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs retrieved successfully | [AdvancedChatWorkflowRunPaginationResponse](#advancedchatworkflowrunpaginationresponse) |

### /apps/{app_id}/advanced-chat/workflow-runs/count

#### GET
##### Summary

Get advanced chat workflow runs count statistics

##### Description

Get advanced chat workflow runs count statistics

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| status | query | Workflow run status filter | No | string |
| time_range | query | Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), 30m (30 minutes), 30s (30 seconds). Filters by created_at field. | No | string |
| triggered_from | query | Filter by trigger source: debugging or app-run. Default: debugging | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs count retrieved successfully | [WorkflowRunCountResponse](#workflowruncountresponse) |

### /apps/{app_id}/advanced-chat/workflows/draft/human-input/nodes/{node_id}/form/preview

#### POST
##### Summary

Preview human input form content and placeholders

##### Description

Get human input form preview for advanced chat workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [HumanInputFormPreviewPayload](#humaninputformpreviewpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /apps/{app_id}/advanced-chat/workflows/draft/human-input/nodes/{node_id}/form/run

#### POST
##### Summary

Submit human input form preview

##### Description

Submit human input form preview for advanced chat workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [HumanInputFormSubmitPayload](#humaninputformsubmitpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /apps/{app_id}/advanced-chat/workflows/draft/iteration/nodes/{node_id}/run

#### POST
##### Summary

Run draft workflow iteration node

##### Description

Run draft workflow iteration node for advanced chat

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [IterationNodeRunPayload](#iterationnoderunpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Iteration node run started successfully |
| 403 | Permission denied |
| 404 | Node not found |

### /apps/{app_id}/advanced-chat/workflows/draft/loop/nodes/{node_id}/run

#### POST
##### Summary

Run draft workflow loop node

##### Description

Run draft workflow loop node for advanced chat

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [LoopNodeRunPayload](#loopnoderunpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Loop node run started successfully |
| 403 | Permission denied |
| 404 | Node not found |

### /apps/{app_id}/advanced-chat/workflows/draft/run

#### POST
##### Summary

Run draft workflow

##### Description

Run draft workflow for advanced chat application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AdvancedChatWorkflowRunPayload](#advancedchatworkflowrunpayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow run started successfully |
| 400 | Invalid request parameters |
| 403 | Permission denied |

### /apps/{app_id}/agent/logs

#### GET
##### Summary

Get agent logs

##### Description

Get agent execution logs for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AgentLogQuery](#agentlogquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent logs retrieved successfully | [ object ] |
| 400 | Invalid request parameters |  |

### /apps/{app_id}/annotation-reply/{action}

#### POST
##### Description

Enable or disable annotation reply for an app

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AnnotationReplyPayload](#annotationreplypayload) |
| action | path | Action to perform (enable/disable) | Yes | string |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Action completed successfully |
| 403 | Insufficient permissions |

### /apps/{app_id}/annotation-reply/{action}/status/{job_id}

#### GET
##### Description

Get status of annotation reply action job

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action type | Yes | string |
| app_id | path | Application ID | Yes | string |
| job_id | path | Job ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Job status retrieved successfully |
| 403 | Insufficient permissions |

### /apps/{app_id}/annotation-setting

#### GET
##### Description

Get annotation settings for an app

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Annotation settings retrieved successfully |
| 403 | Insufficient permissions |

### /apps/{app_id}/annotation-settings/{annotation_setting_id}

#### POST
##### Description

Update annotation settings for an app

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AnnotationSettingUpdatePayload](#annotationsettingupdatepayload) |
| annotation_setting_id | path | Annotation setting ID | Yes | string |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Settings updated successfully |
| 403 | Insufficient permissions |

### /apps/{app_id}/annotations

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Description

Get annotations for an app with pagination

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AnnotationListQuery](#annotationlistquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Annotations retrieved successfully |
| 403 | Insufficient permissions |

#### POST
##### Description

Create a new annotation for an app

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [CreateAnnotationPayload](#createannotationpayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Annotation created successfully | [Annotation](#annotation) |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/annotations/batch-import

#### POST
##### Description

Batch import annotations from CSV file with rate limiting and security checks

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Batch import started successfully |
| 400 | No file uploaded or too many files |
| 403 | Insufficient permissions |
| 413 | File too large |
| 429 | Too many requests or concurrent imports |

### /apps/{app_id}/annotations/batch-import-status/{job_id}

#### GET
##### Description

Get status of batch import job

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| job_id | path | Job ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Job status retrieved successfully |
| 403 | Insufficient permissions |

### /apps/{app_id}/annotations/count

#### GET
##### Description

Get count of message annotations for the app

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotation count retrieved successfully | [AnnotationCountResponse](#annotationcountresponse) |

### /apps/{app_id}/annotations/export

#### GET
##### Description

Export all annotations for an app with CSV injection protection

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotations exported successfully | [AnnotationExportList](#annotationexportlist) |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/annotations/{annotation_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path |  | Yes | string |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Description

Update or delete an annotation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [UpdateAnnotationPayload](#updateannotationpayload) |
| annotation_id | path | Annotation ID | Yes | string |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotation updated successfully | [Annotation](#annotation) |
| 204 | Annotation deleted successfully |  |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/annotations/{annotation_id}/hit-histories

#### GET
##### Description

Get hit histories for an annotation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path | Annotation ID | Yes | string |
| app_id | path | Application ID | Yes | string |
| limit | query | Page size | No | integer |
| page | query | Page number | No | integer |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Hit histories retrieved successfully | [AnnotationHitHistoryList](#annotationhithistorylist) |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/api-enable

#### POST
##### Description

Enable or disable app API

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AppApiStatusPayload](#appapistatuspayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API status updated successfully | [AppDetail](#appdetail) |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/audio-to-text

#### POST
##### Description

Transcript audio to text for chat messages

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | App ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Audio transcription successful | [AudioTranscriptResponse](#audiotranscriptresponse) |
| 400 | Bad request - No audio uploaded or unsupported type |  |
| 413 | Audio file too large |  |

### /apps/{app_id}/chat-conversations

#### GET
##### Description

Get chat conversations with pagination, filtering and summary

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChatConversationQuery](#chatconversationquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [ConversationWithSummaryPagination](#conversationwithsummarypagination) |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/chat-conversations/{conversation_id}

#### DELETE
##### Description

Delete a chat conversation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| conversation_id | path | Conversation ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully |
| 403 | Insufficient permissions |
| 404 | Conversation not found |

#### GET
##### Description

Get chat conversation details

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| conversation_id | path | Conversation ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [ConversationDetail](#conversationdetail) |
| 403 | Insufficient permissions |  |
| 404 | Conversation not found |  |

### /apps/{app_id}/chat-messages

#### GET
##### Description

Get chat messages for a conversation with pagination

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChatMessagesQuery](#chatmessagesquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [MessageInfiniteScrollPaginationResponse](#messageinfinitescrollpaginationresponse) |
| 404 | Conversation not found |  |

### /apps/{app_id}/chat-messages/{message_id}/suggested-questions

#### GET
##### Description

Get suggested questions for a message

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| message_id | path | Message ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Suggested questions retrieved successfully | [SuggestedQuestionsResponse](#suggestedquestionsresponse) |
| 404 | Message or conversation not found |  |

### /apps/{app_id}/chat-messages/{task_id}/stop

#### POST
##### Description

Stop a running chat message generation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| task_id | path | Task ID to stop | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Task stopped successfully |

### /apps/{app_id}/completion-conversations

#### GET
##### Description

Get completion conversations with pagination and filtering

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [CompletionConversationQuery](#completionconversationquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [ConversationPagination](#conversationpagination) |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/completion-conversations/{conversation_id}

#### DELETE
##### Description

Delete a completion conversation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| conversation_id | path | Conversation ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully |
| 403 | Insufficient permissions |
| 404 | Conversation not found |

#### GET
##### Description

Get completion conversation details with messages

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| conversation_id | path | Conversation ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [ConversationMessageDetail](#conversationmessagedetail) |
| 403 | Insufficient permissions |  |
| 404 | Conversation not found |  |

### /apps/{app_id}/completion-messages

#### POST
##### Description

Generate completion message for debugging

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [CompletionMessagePayload](#completionmessagepayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Completion generated successfully |
| 400 | Invalid request parameters |
| 404 | App not found |

### /apps/{app_id}/completion-messages/{task_id}/stop

#### POST
##### Description

Stop a running completion message generation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| task_id | path | Task ID to stop | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Task stopped successfully |

### /apps/{app_id}/conversation-variables

#### GET
##### Description

Get conversation variables for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ConversationVariablesQuery](#conversationvariablesquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation variables retrieved successfully | [PaginatedConversationVariableResponse](#paginatedconversationvariableresponse) |

### /apps/{app_id}/convert-to-workflow

#### POST
##### Summary

Convert basic mode of chatbot app to workflow mode

##### Description

Convert application to workflow mode
Convert expert mode of chatbot app to workflow mode
Convert Completion App to Workflow App

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ConvertToWorkflowPayload](#converttoworkflowpayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Application converted to workflow successfully |
| 400 | Application cannot be converted |
| 403 | Permission denied |

### /apps/{app_id}/copy

#### POST
##### Summary

Copy app

##### Description

Create a copy of an existing application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [CopyAppPayload](#copyapppayload) |
| app_id | path | Application ID to copy | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | App copied successfully | [AppDetailWithSite](#appdetailwithsite) |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/export

#### GET
##### Summary

Export app

##### Description

Export application configuration as DSL

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AppExportQuery](#appexportquery) |
| app_id | path | Application ID to export | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App exported successfully | [AppExportResponse](#appexportresponse) |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/feedbacks

#### POST
##### Description

Create or update message feedback (like/dislike)

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MessageFeedbackPayload](#messagefeedbackpayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Feedback updated successfully |
| 403 | Insufficient permissions |
| 404 | Message not found |

### /apps/{app_id}/feedbacks/export

#### GET
##### Description

Export user feedback data for Google Sheets

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [FeedbackExportQuery](#feedbackexportquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Feedback data exported successfully |
| 400 | Invalid parameters |
| 500 | Internal server error |

### /apps/{app_id}/icon

#### POST
##### Description

Update application icon

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AppIconPayload](#appiconpayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Icon updated successfully |
| 403 | Insufficient permissions |

### /apps/{app_id}/messages/{message_id}

#### GET
##### Description

Get message details by ID

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| message_id | path | Message ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Message retrieved successfully | [MessageDetailResponse](#messagedetailresponse) |
| 404 | Message not found |  |

### /apps/{app_id}/model-config

#### POST
##### Summary

Modify app model config

##### Description

Update application model configuration

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ModelConfigRequest](#modelconfigrequest) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Model configuration updated successfully |
| 400 | Invalid configuration |
| 404 | App not found |

### /apps/{app_id}/name

#### POST
##### Description

Check if app name is available

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AppNamePayload](#appnamepayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Name availability checked | [AppDetail](#appdetail) |

### /apps/{app_id}/publish-to-creators-platform

#### POST
##### Summary

Publish app to Creators Platform

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /apps/{app_id}/server

#### GET
##### Description

Get MCP server configuration for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | MCP server configuration retrieved successfully | [AppMCPServerResponse](#appmcpserverresponse) |

#### POST
##### Description

Create MCP server configuration for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MCPServerCreatePayload](#mcpservercreatepayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | MCP server configuration created successfully | [AppMCPServerResponse](#appmcpserverresponse) |
| 403 | Insufficient permissions |  |

#### PUT
##### Description

Update MCP server configuration for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MCPServerUpdatePayload](#mcpserverupdatepayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | MCP server configuration updated successfully | [AppMCPServerResponse](#appmcpserverresponse) |
| 403 | Insufficient permissions |  |
| 404 | Server not found |  |

### /apps/{app_id}/site

#### POST
##### Description

Update application site configuration

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AppSiteUpdatePayload](#appsiteupdatepayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Site configuration updated successfully | [AppSiteResponse](#appsiteresponse) |
| 403 | Insufficient permissions |  |
| 404 | App not found |  |

### /apps/{app_id}/site-enable

#### POST
##### Description

Enable or disable app site

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AppSiteStatusPayload](#appsitestatuspayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Site status updated successfully | [AppDetail](#appdetail) |
| 403 | Insufficient permissions |  |

### /apps/{app_id}/site/access-token-reset

#### POST
##### Description

Reset access token for application site

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Access token reset successfully | [AppSiteResponse](#appsiteresponse) |
| 403 | Insufficient permissions (admin/owner required) |  |
| 404 | App or site not found |  |

### /apps/{app_id}/statistics/average-response-time

#### GET
##### Description

Get average response time statistics for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [StatisticTimeRangeQuery](#statistictimerangequery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Average response time statistics retrieved successfully | [ object ] |

### /apps/{app_id}/statistics/average-session-interactions

#### GET
##### Description

Get average session interaction statistics for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [StatisticTimeRangeQuery](#statistictimerangequery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Average session interaction statistics retrieved successfully | [ object ] |

### /apps/{app_id}/statistics/daily-conversations

#### GET
##### Description

Get daily conversation statistics for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [StatisticTimeRangeQuery](#statistictimerangequery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily conversation statistics retrieved successfully | [ object ] |

### /apps/{app_id}/statistics/daily-end-users

#### GET
##### Description

Get daily terminal/end-user statistics for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [StatisticTimeRangeQuery](#statistictimerangequery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily terminal statistics retrieved successfully | [ object ] |

### /apps/{app_id}/statistics/daily-messages

#### GET
##### Description

Get daily message statistics for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [StatisticTimeRangeQuery](#statistictimerangequery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily message statistics retrieved successfully | [ object ] |

### /apps/{app_id}/statistics/token-costs

#### GET
##### Description

Get daily token cost statistics for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [StatisticTimeRangeQuery](#statistictimerangequery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily token cost statistics retrieved successfully | [ object ] |

### /apps/{app_id}/statistics/tokens-per-second

#### GET
##### Description

Get tokens per second statistics for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [StatisticTimeRangeQuery](#statistictimerangequery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tokens per second statistics retrieved successfully | [ object ] |

### /apps/{app_id}/statistics/user-satisfaction-rate

#### GET
##### Description

Get user satisfaction rate statistics for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [StatisticTimeRangeQuery](#statistictimerangequery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | User satisfaction rate statistics retrieved successfully | [ object ] |

### /apps/{app_id}/text-to-audio

#### POST
##### Description

Convert text to speech for chat messages

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TextToSpeechPayload](#texttospeechpayload) |
| app_id | path | App ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Text to speech conversion successful |
| 400 | Bad request - Invalid parameters |

### /apps/{app_id}/text-to-audio/voices

#### GET
##### Description

Get available TTS voices for a specific language

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TextToSpeechVoiceQuery](#texttospeechvoicequery) |
| app_id | path | App ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | TTS voices retrieved successfully | [ object ] |
| 400 | Invalid language parameter |  |

### /apps/{app_id}/trace

#### GET
##### Summary

Get app trace

##### Description

Get app tracing configuration

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Trace configuration retrieved successfully |

#### POST
##### Description

Update app tracing configuration

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AppTracePayload](#apptracepayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Trace configuration updated successfully |
| 403 | Insufficient permissions |

### /apps/{app_id}/trace-config

#### DELETE
##### Summary

Delete an existing trace app configuration

##### Description

Delete an existing tracing configuration for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TraceProviderQuery](#traceproviderquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Tracing configuration deleted successfully |
| 400 | Invalid request parameters or configuration not found |

#### GET
##### Description

Get tracing configuration for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TraceProviderQuery](#traceproviderquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tracing configuration retrieved successfully | object |
| 400 | Invalid request parameters |  |

#### PATCH
##### Summary

Update an existing trace app configuration

##### Description

Update an existing tracing configuration for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TraceConfigPayload](#traceconfigpayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tracing configuration updated successfully | object |
| 400 | Invalid request parameters or configuration not found |  |

#### POST
##### Summary

Create a new trace app configuration

##### Description

Create a new tracing configuration for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TraceConfigPayload](#traceconfigpayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Tracing configuration created successfully | object |
| 400 | Invalid request parameters or configuration already exists |  |

### /apps/{app_id}/trigger-enable

#### POST
##### Summary

Update app trigger (enable/disable)

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| payload | body |  | Yes | [ParserEnable](#parserenable) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [WorkflowTriggerResponse](#workflowtriggerresponse) |

### /apps/{app_id}/triggers

#### GET
##### Summary

Get app triggers list

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [WorkflowTriggerListResponse](#workflowtriggerlistresponse) |

### /apps/{app_id}/workflow-app-logs

#### GET
##### Summary

Get workflow app logs

##### Description

Get workflow application execution logs

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowAppLogQuery](#workflowapplogquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow app logs retrieved successfully | [WorkflowAppLogPaginationResponse](#workflowapplogpaginationresponse) |

### /apps/{app_id}/workflow-archived-logs

#### GET
##### Summary

Get workflow archived logs

##### Description

Get workflow archived execution logs

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowAppLogQuery](#workflowapplogquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow archived logs retrieved successfully | [WorkflowArchivedLogPaginationResponse](#workflowarchivedlogpaginationresponse) |

### /apps/{app_id}/workflow-runs

#### GET
##### Summary

Get workflow run list

##### Description

Get workflow run list

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| last_id | query | Last run ID for pagination | No | string |
| limit | query | Number of items per page (1-100) | No | integer |
| status | query | Workflow run status filter | No | string |
| triggered_from | query | Filter by trigger source: debugging or app-run. Default: debugging | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs retrieved successfully | [WorkflowRunPaginationResponse](#workflowrunpaginationresponse) |

### /apps/{app_id}/workflow-runs/count

#### GET
##### Summary

Get workflow runs count statistics

##### Description

Get workflow runs count statistics

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| status | query | Workflow run status filter | No | string |
| time_range | query | Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), 30m (30 minutes), 30s (30 seconds). Filters by created_at field. | No | string |
| triggered_from | query | Filter by trigger source: debugging or app-run. Default: debugging | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs count retrieved successfully | [WorkflowRunCountResponse](#workflowruncountresponse) |

### /apps/{app_id}/workflow-runs/tasks/{task_id}/stop

#### POST
##### Summary

Stop workflow task

##### Description

Stop running workflow task

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| task_id | path | Task ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Task stopped successfully |
| 403 | Permission denied |
| 404 | Task not found |

### /apps/{app_id}/workflow-runs/{run_id}

#### GET
##### Summary

Get workflow run detail

##### Description

Get workflow run detail

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| run_id | path | Workflow run ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run detail retrieved successfully | [WorkflowRunDetailResponse](#workflowrundetailresponse) |
| 404 | Workflow run not found |  |

### /apps/{app_id}/workflow-runs/{run_id}/export

#### GET
##### Description

Generate a download URL for an archived workflow run.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| run_id | path | Workflow run ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Export URL generated | [WorkflowRunExportResponse](#workflowrunexportresponse) |

### /apps/{app_id}/workflow-runs/{run_id}/node-executions

#### GET
##### Summary

Get workflow run node execution list

##### Description

Get workflow run node execution list

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| run_id | path | Workflow run ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node executions retrieved successfully | [WorkflowRunNodeExecutionListResponse](#workflowrunnodeexecutionlistresponse) |
| 404 | Workflow run not found |  |

### /apps/{app_id}/workflow/comments

#### GET
##### Summary

Get all comments for a workflow

##### Description

Get all comments for a workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Comments retrieved successfully | [WorkflowCommentBasicList](#workflowcommentbasiclist) |

#### POST
##### Summary

Create a new workflow comment

##### Description

Create a new workflow comment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowCommentCreatePayload](#workflowcommentcreatepayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Comment created successfully | [WorkflowCommentCreate](#workflowcommentcreate) |

### /apps/{app_id}/workflow/comments/mention-users

#### GET
##### Summary

Get all users in current tenant for mentions

##### Description

Get all users in current tenant for mentions

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Mentionable users retrieved successfully | [WorkflowCommentMentionUsersPayload](#workflowcommentmentionuserspayload) |

### /apps/{app_id}/workflow/comments/{comment_id}

#### DELETE
##### Summary

Delete a workflow comment

##### Description

Delete a workflow comment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| comment_id | path | Comment ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Comment deleted successfully |

#### GET
##### Summary

Get a specific workflow comment

##### Description

Get a specific workflow comment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| comment_id | path | Comment ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Comment retrieved successfully | [WorkflowCommentDetail](#workflowcommentdetail) |

#### PUT
##### Summary

Update a workflow comment

##### Description

Update a workflow comment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowCommentUpdatePayload](#workflowcommentupdatepayload) |
| app_id | path | Application ID | Yes | string |
| comment_id | path | Comment ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Comment updated successfully | [WorkflowCommentUpdate](#workflowcommentupdate) |

### /apps/{app_id}/workflow/comments/{comment_id}/replies

#### POST
##### Summary

Add a reply to a workflow comment

##### Description

Add a reply to a workflow comment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowCommentReplyPayload](#workflowcommentreplypayload) |
| app_id | path | Application ID | Yes | string |
| comment_id | path | Comment ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Reply created successfully | [WorkflowCommentReplyCreate](#workflowcommentreplycreate) |

### /apps/{app_id}/workflow/comments/{comment_id}/replies/{reply_id}

#### DELETE
##### Summary

Delete a comment reply

##### Description

Delete a comment reply

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| comment_id | path | Comment ID | Yes | string |
| reply_id | path | Reply ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Reply deleted successfully |

#### PUT
##### Summary

Update a comment reply

##### Description

Update a comment reply

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowCommentReplyPayload](#workflowcommentreplypayload) |
| app_id | path | Application ID | Yes | string |
| comment_id | path | Comment ID | Yes | string |
| reply_id | path | Reply ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Reply updated successfully | [WorkflowCommentReplyUpdate](#workflowcommentreplyupdate) |

### /apps/{app_id}/workflow/comments/{comment_id}/resolve

#### POST
##### Summary

Resolve a workflow comment

##### Description

Resolve a workflow comment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| comment_id | path | Comment ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Comment resolved successfully | [WorkflowCommentResolve](#workflowcommentresolve) |

### /apps/{app_id}/workflow/statistics/average-app-interactions

#### GET
##### Description

Get workflow average app interaction statistics

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowStatisticQuery](#workflowstatisticquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Average app interaction statistics retrieved successfully |

### /apps/{app_id}/workflow/statistics/daily-conversations

#### GET
##### Description

Get workflow daily runs statistics

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowStatisticQuery](#workflowstatisticquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Daily runs statistics retrieved successfully |

### /apps/{app_id}/workflow/statistics/daily-terminals

#### GET
##### Description

Get workflow daily terminals statistics

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowStatisticQuery](#workflowstatisticquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Daily terminals statistics retrieved successfully |

### /apps/{app_id}/workflow/statistics/token-costs

#### GET
##### Description

Get workflow daily token cost statistics

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowStatisticQuery](#workflowstatisticquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Daily token cost statistics retrieved successfully |

### /apps/{app_id}/workflows

#### GET
##### Summary

Get published workflows

##### Description

Get all published workflows for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowListQuery](#workflowlistquery) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Published workflows retrieved successfully | [WorkflowPagination](#workflowpagination) |

### /apps/{app_id}/workflows/default-workflow-block-configs

#### GET
##### Summary

Get default block config

##### Description

Get default block configurations for workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Default block configurations retrieved successfully |

### /apps/{app_id}/workflows/default-workflow-block-configs/{block_type}

#### GET
##### Summary

Get default block config

##### Description

Get default block configuration by type

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DefaultBlockConfigQuery](#defaultblockconfigquery) |
| app_id | path | Application ID | Yes | string |
| block_type | path | Block type | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Default block configuration retrieved successfully |
| 404 | Block type not found |

### /apps/{app_id}/workflows/draft

#### GET
##### Summary

Get draft workflow

##### Description

Get draft workflow for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft workflow retrieved successfully | [Workflow](#workflow) |
| 404 | Draft workflow not found |  |

#### POST
##### Summary

Sync draft workflow

##### Description

Sync draft workflow configuration

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [SyncDraftWorkflowPayload](#syncdraftworkflowpayload) |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft workflow synced successfully | [SyncDraftWorkflowResponse](#syncdraftworkflowresponse) |
| 400 | Invalid workflow configuration |  |
| 403 | Permission denied |  |

### /apps/{app_id}/workflows/draft/conversation-variables

#### GET
##### Description

Get conversation variables for workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation variables retrieved successfully | [WorkflowDraftVariableList](#workflowdraftvariablelist) |
| 404 | Draft workflow not found |  |

#### POST
##### Description

Update conversation variables for workflow draft

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ConversationVariableUpdatePayload](#conversationvariableupdatepayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Conversation variables updated successfully |

### /apps/{app_id}/workflows/draft/environment-variables

#### GET
##### Summary

Get draft workflow

##### Description

Get environment variables for workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Environment variables retrieved successfully |
| 404 | Draft workflow not found |

#### POST
##### Description

Update environment variables for workflow draft

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EnvironmentVariableUpdatePayload](#environmentvariableupdatepayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Environment variables updated successfully |

### /apps/{app_id}/workflows/draft/features

#### POST
##### Description

Update draft workflow features

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowFeaturesPayload](#workflowfeaturespayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow features updated successfully |

### /apps/{app_id}/workflows/draft/human-input/nodes/{node_id}/delivery-test

#### POST
##### Summary

Test human input delivery

##### Description

Test human input delivery for workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [HumanInputDeliveryTestPayload](#humaninputdeliverytestpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /apps/{app_id}/workflows/draft/human-input/nodes/{node_id}/form/preview

#### POST
##### Summary

Preview human input form content and placeholders

##### Description

Get human input form preview for workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [HumanInputFormPreviewPayload](#humaninputformpreviewpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /apps/{app_id}/workflows/draft/human-input/nodes/{node_id}/form/run

#### POST
##### Summary

Submit human input form preview

##### Description

Submit human input form preview for workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [HumanInputFormSubmitPayload](#humaninputformsubmitpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /apps/{app_id}/workflows/draft/iteration/nodes/{node_id}/run

#### POST
##### Summary

Run draft workflow iteration node

##### Description

Run draft workflow iteration node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [IterationNodeRunPayload](#iterationnoderunpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow iteration node run started successfully |
| 403 | Permission denied |
| 404 | Node not found |

### /apps/{app_id}/workflows/draft/loop/nodes/{node_id}/run

#### POST
##### Summary

Run draft workflow loop node

##### Description

Run draft workflow loop node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [LoopNodeRunPayload](#loopnoderunpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow loop node run started successfully |
| 403 | Permission denied |
| 404 | Node not found |

### /apps/{app_id}/workflows/draft/nodes/{node_id}/last-run

#### GET
##### Description

Get last run result for draft workflow node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node last run retrieved successfully | [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse) |
| 403 | Permission denied |  |
| 404 | Node last run not found |  |

### /apps/{app_id}/workflows/draft/nodes/{node_id}/run

#### POST
##### Summary

Run draft workflow node

##### Description

Run draft workflow node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DraftWorkflowNodeRunPayload](#draftworkflownoderunpayload) |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node run started successfully | [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse) |
| 403 | Permission denied |  |
| 404 | Node not found |  |

### /apps/{app_id}/workflows/draft/nodes/{node_id}/trigger/run

#### POST
##### Summary

Poll for trigger events and execute single node when event arrives

##### Description

Poll for trigger events and execute single node when event arrives

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Trigger event received and node executed successfully |
| 403 | Permission denied |
| 500 | Internal server error |

### /apps/{app_id}/workflows/draft/nodes/{node_id}/variables

#### DELETE
##### Description

Delete all variables for a specific node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| node_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Node variables deleted successfully |

#### GET
##### Description

Get variables for a specific node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| node_id | path | Node ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node variables retrieved successfully | [WorkflowDraftVariableList](#workflowdraftvariablelist) |

### /apps/{app_id}/workflows/draft/run

#### POST
##### Summary

Run draft workflow

##### Description

Run draft workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DraftWorkflowRunPayload](#draftworkflowrunpayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Draft workflow run started successfully |
| 403 | Permission denied |

### /apps/{app_id}/workflows/draft/system-variables

#### GET
##### Description

Get system variables for workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | System variables retrieved successfully | [WorkflowDraftVariableList](#workflowdraftvariablelist) |

### /apps/{app_id}/workflows/draft/trigger/run

#### POST
##### Summary

Poll for trigger events and execute full workflow when event arrives

##### Description

Poll for trigger events and execute full workflow when event arrives

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DraftWorkflowTriggerRunRequest](#draftworkflowtriggerrunrequest) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Trigger event received and workflow executed successfully |
| 403 | Permission denied |
| 500 | Internal server error |

### /apps/{app_id}/workflows/draft/trigger/run-all

#### POST
##### Summary

Full workflow debug when the start node is a trigger

##### Description

Full workflow debug when the start node is a trigger

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DraftWorkflowTriggerRunAllPayload](#draftworkflowtriggerrunallpayload) |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow executed successfully |
| 403 | Permission denied |
| 500 | Internal server error |

### /apps/{app_id}/workflows/draft/variables

#### DELETE
##### Description

Delete all draft workflow variables

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Workflow variables deleted successfully |

#### GET
##### Summary

Get draft workflow

##### Description

Get draft workflow variables

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowDraftVariableListQuery](#workflowdraftvariablelistquery) |
| app_id | path | Application ID | Yes | string |
| limit | query | Number of items per page (1-100) | No | string |
| page | query | Page number (1-100000) | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow variables retrieved successfully | [WorkflowDraftVariableListWithoutValue](#workflowdraftvariablelistwithoutvalue) |

### /apps/{app_id}/workflows/draft/variables/{variable_id}

#### DELETE
##### Description

Delete a workflow variable

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| variable_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Variable deleted successfully |
| 404 | Variable not found |

#### GET
##### Description

Get a specific workflow variable

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| variable_id | path | Variable ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable retrieved successfully | [WorkflowDraftVariable](#workflowdraftvariable) |
| 404 | Variable not found |  |

#### PATCH
##### Description

Update a workflow variable

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowDraftVariableUpdatePayload](#workflowdraftvariableupdatepayload) |
| app_id | path |  | Yes | string |
| variable_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable updated successfully | [WorkflowDraftVariable](#workflowdraftvariable) |
| 404 | Variable not found |  |

### /apps/{app_id}/workflows/draft/variables/{variable_id}/reset

#### PUT
##### Description

Reset a workflow variable to its default value

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| variable_id | path | Variable ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable reset successfully | [WorkflowDraftVariable](#workflowdraftvariable) |
| 204 | Variable reset (no content) |  |
| 404 | Variable not found |  |

### /apps/{app_id}/workflows/publish

#### GET
##### Summary

Get published workflow

##### Description

Get published workflow for an application

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Published workflow retrieved successfully | [Workflow](#workflow) |
| 404 | Published workflow not found |  |

#### POST
##### Summary

Publish workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [PublishWorkflowPayload](#publishworkflowpayload) |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /apps/{app_id}/workflows/triggers/webhook

#### GET
##### Summary

Get webhook trigger for a node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| payload | body |  | Yes | [Parser](#parser) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [WebhookTriggerResponse](#webhooktriggerresponse) |

### /apps/{app_id}/workflows/{workflow_id}

#### DELETE
##### Summary

Delete workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| workflow_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Summary

Update workflow attributes

##### Description

Update workflow by ID

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowUpdatePayload](#workflowupdatepayload) |
| app_id | path | Application ID | Yes | string |
| workflow_id | path | Workflow ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow updated successfully | [Workflow](#workflow) |
| 403 | Permission denied |  |
| 404 | Workflow not found |  |

### /apps/{app_id}/workflows/{workflow_id}/restore

#### POST
##### Description

Restore a published workflow version into the draft workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string |
| workflow_id | path | Published workflow ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow restored successfully |
| 400 | Source workflow must be published |
| 404 | Workflow not found |

### /apps/{resource_id}/api-keys

#### GET
##### Summary

Get all API keys for an app

##### Description

Get all API keys for an app

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| resource_id | path | App ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API keys retrieved successfully | [ApiKeyList](#apikeylist) |

#### POST
##### Summary

Create a new API key for an app

##### Description

Create a new API key for an app

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| resource_id | path | App ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | API key created successfully | [ApiKeyItem](#apikeyitem) |
| 400 | Maximum keys exceeded |  |

### /apps/{resource_id}/api-keys/{api_key_id}

#### DELETE
##### Summary

Delete an API key for an app

##### Description

Delete an API key for an app

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| api_key_id | path | API key ID | Yes | string |
| resource_id | path | App ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | API key deleted successfully |

### /apps/{server_id}/server/refresh

#### GET
##### Description

Refresh MCP server configuration and regenerate server code

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| server_id | path | Server ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | MCP server refreshed successfully | [AppMCPServerResponse](#appmcpserverresponse) |
| 403 | Insufficient permissions |  |
| 404 | Server not found |  |

### /auth/plugin/datasource/default-list

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /auth/plugin/datasource/list

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /auth/plugin/datasource/{provider_id}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |
| payload | body |  | Yes | [DatasourceCredentialPayload](#datasourcecredentialpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /auth/plugin/datasource/{provider_id}/custom-client

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |
| payload | body |  | Yes | [DatasourceCustomClientPayload](#datasourcecustomclientpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /auth/plugin/datasource/{provider_id}/default

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |
| payload | body |  | Yes | [DatasourceDefaultPayload](#datasourcedefaultpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /auth/plugin/datasource/{provider_id}/delete

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |
| payload | body |  | Yes | [DatasourceCredentialDeletePayload](#datasourcecredentialdeletepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /auth/plugin/datasource/{provider_id}/update

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |
| payload | body |  | Yes | [DatasourceCredentialUpdatePayload](#datasourcecredentialupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /auth/plugin/datasource/{provider_id}/update-name

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |
| payload | body |  | Yes | [DatasourceUpdateNamePayload](#datasourceupdatenamepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /billing/invoices

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /billing/partners/{partner_key}/tenants

#### PUT
##### Description

Sync partner tenants bindings

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [PartnerTenantsPayload](#partnertenantspayload) |
| partner_key | path | Partner key | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Tenants synced to partner successfully |
| 400 | Invalid partner information |

### /billing/subscription

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /code-based-extension

#### GET
##### Description

Get code-based extension data by module name

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| module | query | Extension module name | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [CodeBasedExtensionResponse](#codebasedextensionresponse) |

### /compliance/download

#### GET
##### Description

Get compliance document download link

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ComplianceDownloadQuery](#compliancedownloadquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /data-source/integrates

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /data-source/integrates/{binding_id}/{action}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path |  | Yes | string |
| binding_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path |  | Yes | string |
| binding_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets

#### GET
##### Description

Get list of datasets

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| ids | query | Filter by dataset IDs (list) | No | string |
| include_all | query | Include all datasets (default: false) | No | string |
| keyword | query | Search keyword | No | string |
| limit | query | Number of items per page (default: 20) | No | string |
| page | query | Page number (default: 1) | No | string |
| tag_ids | query | Filter by tag IDs (list) | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Datasets retrieved successfully |

#### POST
##### Description

Create a new dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DatasetCreatePayload](#datasetcreatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 201 | Dataset created successfully |
| 400 | Invalid request parameters |

### /datasets/api-base-info

#### GET
##### Description

Get dataset API base information

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | API base info retrieved successfully |

### /datasets/api-keys

#### GET
##### Description

Get dataset API keys

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API keys retrieved successfully | [ApiKeyList](#apikeylist) |

#### POST
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API key created successfully | [ApiKeyItem](#apikeyitem) |
| 400 | Maximum keys exceeded |  |

### /datasets/api-keys/{api_key_id}

#### DELETE
##### Description

Delete dataset API key

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| api_key_id | path | API key ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | API key deleted successfully |

### /datasets/batch_import_status/{job_id}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| job_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| job_id | path |  | Yes | string |
| payload | body |  | Yes | [BatchImportPayload](#batchimportpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/external

#### POST
##### Description

Create external knowledge dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ExternalDatasetCreatePayload](#externaldatasetcreatepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | External dataset created successfully | [DatasetDetail](#datasetdetail) |
| 400 | Invalid parameters |  |
| 403 | Permission denied |  |

### /datasets/external-knowledge-api

#### GET
##### Description

Get external knowledge API templates

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| keyword | query | Search keyword | No | string |
| limit | query | Number of items per page (default: 20) | No | string |
| page | query | Page number (default: 1) | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | External API templates retrieved successfully |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ExternalKnowledgeApiPayload](#externalknowledgeapipayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/external-knowledge-api/{external_knowledge_api_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| external_knowledge_api_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Description

Get external knowledge API template details

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| external_knowledge_api_id | path | External knowledge API ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | External API template retrieved successfully |
| 404 | Template not found |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ExternalKnowledgeApiPayload](#externalknowledgeapipayload) |
| external_knowledge_api_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/external-knowledge-api/{external_knowledge_api_id}/use-check

#### GET
##### Description

Check if external knowledge API is being used

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| external_knowledge_api_id | path | External knowledge API ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Usage check completed successfully |

### /datasets/indexing-estimate

#### POST
##### Description

Estimate dataset indexing cost

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [IndexingEstimatePayload](#indexingestimatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Indexing estimate calculated successfully |

### /datasets/init

#### POST
##### Description

Initialize dataset with documents

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [KnowledgeConfig](#knowledgeconfig) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Dataset initialized successfully | [DatasetAndDocumentResponse](#datasetanddocumentresponse) |
| 400 | Invalid request parameters |  |

### /datasets/metadata/built-in

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/notion-indexing-estimate

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [NotionEstimatePayload](#notionestimatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/process-rule

#### GET
##### Description

Get dataset document processing rules

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| document_id | query | Document ID (optional) | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Process rules retrieved successfully |

### /datasets/retrieval-setting

#### GET
##### Description

Get dataset retrieval settings

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Retrieval settings retrieved successfully |

### /datasets/retrieval-setting/{vector_type}

#### GET
##### Description

Get mock dataset retrieval settings by vector type

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| vector_type | path | Vector store type | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Mock retrieval settings retrieved successfully |

### /datasets/{dataset_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Description

Get dataset details

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dataset retrieved successfully | [DatasetDetail](#datasetdetail) |
| 403 | Permission denied |  |
| 404 | Dataset not found |  |

#### PATCH
##### Description

Update dataset details

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DatasetUpdatePayload](#datasetupdatepayload) |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dataset updated successfully | [DatasetDetail](#datasetdetail) |
| 403 | Permission denied |  |
| 404 | Dataset not found |  |

### /datasets/{dataset_id}/api-keys/{status}

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| status | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/auto-disable-logs

#### GET
##### Description

Get dataset auto disable logs

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Auto disable logs retrieved successfully |
| 404 | Dataset not found |

### /datasets/{dataset_id}/batch/{batch}/indexing-estimate

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| batch | path |  | Yes | string |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/batch/{batch}/indexing-status

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| batch | path |  | Yes | string |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Description

Get documents in a dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| fetch | query | Fetch full details (default: false) | No | string |
| keyword | query | Search keyword | No | string |
| limit | query | Number of items per page (default: 20) | No | string |
| page | query | Page number (default: 1) | No | string |
| sort | query | Sort order (default: -created_at) | No | string |
| status | query | Filter documents by display status | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Documents retrieved successfully |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [KnowledgeConfig](#knowledgeconfig) |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Documents created successfully | [DatasetAndDocumentResponse](#datasetanddocumentresponse) |

### /datasets/{dataset_id}/documents/download-zip

#### POST
##### Summary

Stream a ZIP archive containing the requested uploaded documents

##### Description

Download selected dataset documents as a single ZIP archive (upload-file only)

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| payload | body |  | Yes | [DocumentBatchDownloadZipPayload](#documentbatchdownloadzippayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/generate-summary

#### POST
##### Summary

Generate summary index for specified documents

##### Description

Generate summary index for documents
This endpoint checks if the dataset configuration supports summary generation
(indexing_technique must be 'high_quality' and summary_index_setting.enable must be true),
then asynchronously generates summary indexes for the provided documents.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [GenerateSummaryPayload](#generatesummarypayload) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Summary generation started successfully |
| 400 | Invalid request or dataset configuration |
| 403 | Permission denied |
| 404 | Dataset not found |

### /datasets/{dataset_id}/documents/metadata

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| payload | body |  | Yes | [MetadataOperationData](#metadataoperationdata) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/status/{action}/batch

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path |  | Yes | string |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Description

Get document details

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| metadata | query | Metadata inclusion (all/only/without) | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document retrieved successfully |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/download

#### GET
##### Description

Get a signed download URL for a dataset document's original uploaded file

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/indexing-estimate

#### GET
##### Description

Estimate document indexing cost

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Indexing estimate calculated successfully |
| 400 | Document already finished |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/indexing-status

#### GET
##### Description

Get document indexing status

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Indexing status retrieved successfully |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/metadata

#### PUT
##### Description

Update document metadata

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DocumentMetadataUpdatePayload](#documentmetadataupdatepayload) |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document metadata updated successfully |
| 403 | Permission denied |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/notion/sync

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/pipeline-execution-log

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/processing/pause

#### PATCH
##### Summary

pause document

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/processing/resume

#### PATCH
##### Summary

recover document

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/processing/{action}

#### PATCH
##### Description

Update document processing status (pause/resume)

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform (pause/resume) | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Processing status updated successfully |
| 400 | Invalid action |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/rename

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| payload | body |  | Yes | [DocumentRenamePayload](#documentrenamepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document renamed successfully | [DocumentResponse](#documentresponse) |

### /datasets/{dataset_id}/documents/{document_id}/segment

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| payload | body |  | Yes | [SegmentCreatePayload](#segmentcreatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/segment/{action}

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path |  | Yes | string |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/segments

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/segments/batch_import

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| payload | body |  | Yes | [BatchImportPayload](#batchimportpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| segment_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| segment_id | path |  | Yes | string |
| payload | body |  | Yes | [SegmentUpdatePayload](#segmentupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| segment_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| segment_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| segment_id | path |  | Yes | string |
| payload | body |  | Yes | [ChildChunkCreatePayload](#childchunkcreatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| child_chunk_id | path |  | Yes | string |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| segment_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| child_chunk_id | path |  | Yes | string |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| segment_id | path |  | Yes | string |
| payload | body |  | Yes | [ChildChunkUpdatePayload](#childchunkupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/documents/{document_id}/summary-status

#### GET
##### Summary

Get summary index generation status for a document

##### Description

Get summary index generation status for a document
Returns:
- total_segments: Total number of segments in the document
- summary_status: Dictionary with status counts
  - completed: Number of summaries completed
  - generating: Number of summaries being generated
  - error: Number of summaries with errors
  - not_started: Number of segments without summary records
- summaries: List of summary records with status and content preview

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Summary status retrieved successfully |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/website-sync

#### GET
##### Summary

sync website document

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/error-docs

#### GET
##### Description

Get dataset error documents

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Error documents retrieved successfully |
| 404 | Dataset not found |

### /datasets/{dataset_id}/external-hit-testing

#### POST
##### Description

Test external knowledge retrieval for dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ExternalHitTestingPayload](#externalhittestingpayload) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | External hit testing completed successfully |
| 400 | Invalid parameters |
| 404 | Dataset not found |

### /datasets/{dataset_id}/hit-testing

#### POST
##### Description

Test dataset knowledge retrieval

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [HitTestingPayload](#hittestingpayload) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Hit testing completed successfully | [HitTestingResponse](#hittestingresponse) |
| 400 | Invalid parameters |  |
| 404 | Dataset not found |  |

### /datasets/{dataset_id}/indexing-status

#### GET
##### Description

Get dataset indexing status

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Indexing status retrieved successfully |

### /datasets/{dataset_id}/metadata

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| payload | body |  | Yes | [MetadataArgs](#metadataargs) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/metadata/built-in/{action}

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path |  | Yes | string |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/metadata/{metadata_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| metadata_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| metadata_id | path |  | Yes | string |
| payload | body |  | Yes | [MetadataUpdatePayload](#metadataupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/notion/sync

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/permission-part-users

#### GET
##### Description

Get dataset permission user list

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Permission users retrieved successfully |
| 403 | Permission denied |
| 404 | Dataset not found |

### /datasets/{dataset_id}/queries

#### GET
##### Description

Get dataset query history

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Query history retrieved successfully | [DatasetQueryDetail](#datasetquerydetail) |

### /datasets/{dataset_id}/related-apps

#### GET
##### Description

Get applications related to dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Related apps retrieved successfully | [RelatedAppList](#relatedapplist) |

### /datasets/{dataset_id}/retry

#### POST
##### Summary

retry document

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| payload | body |  | Yes | [DocumentRetryPayload](#documentretrypayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /datasets/{dataset_id}/use-check

#### GET
##### Description

Check if dataset is in use

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Dataset use status retrieved successfully |

### /datasets/{resource_id}/api-keys

#### GET
##### Summary

Get all API keys for a dataset

##### Description

Get all API keys for a dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| resource_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API keys retrieved successfully | [ApiKeyList](#apikeylist) |

#### POST
##### Summary

Create a new API key for a dataset

##### Description

Create a new API key for a dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| resource_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | API key created successfully | [ApiKeyItem](#apikeyitem) |
| 400 | Maximum keys exceeded |  |

### /datasets/{resource_id}/api-keys/{api_key_id}

#### DELETE
##### Summary

Delete an API key for a dataset

##### Description

Delete an API key for a dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| api_key_id | path | API key ID | Yes | string |
| resource_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | API key deleted successfully |

### /email-code-login

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EmailPayload](#emailpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /email-code-login/validity

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EmailCodeLoginPayload](#emailcodeloginpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /email-register

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /email-register/send-email

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /email-register/validity

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /explore/apps

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query | Language code for recommended app localization | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [RecommendedAppListResponse](#recommendedapplistresponse) |

### /explore/apps/{app_id}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /features

#### GET
##### Summary

Get feature configuration for current tenant

##### Description

Get feature configuration for current tenant

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [FeatureResponse](#featureresponse) |

### /files/support-type

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /files/upload

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [UploadConfig](#uploadconfig) |

#### POST
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | [FileResponse](#fileresponse) |

### /files/{file_id}/preview

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| file_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /forgot-password

#### POST
##### Description

Send password reset email

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ForgotPasswordSendPayload](#forgotpasswordsendpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Email sent successfully | [ForgotPasswordEmailResponse](#forgotpasswordemailresponse) |
| 400 | Invalid email or rate limit exceeded |  |

### /forgot-password/resets

#### POST
##### Description

Reset password with verification token

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ForgotPasswordResetPayload](#forgotpasswordresetpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Password reset successfully | [ForgotPasswordResetResponse](#forgotpasswordresetresponse) |
| 400 | Invalid token or password mismatch |  |

### /forgot-password/validity

#### POST
##### Description

Verify password reset code

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ForgotPasswordCheckPayload](#forgotpasswordcheckpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Code verified successfully | [ForgotPasswordCheckResponse](#forgotpasswordcheckresponse) |
| 400 | Invalid code or token |  |

### /form/human_input/{form_token}

#### GET
##### Summary

Get human input form definition by form token

##### Description

GET /console/api/form/human_input/<form_token>

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Summary

Submit human input form by form token

##### Description

POST /console/api/form/human_input/<form_token>

Request body:
{
    "inputs": {
        "content": "User input content"
    },
    "action": "Approve"
}

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /info

#### POST
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [TenantInfoResponse](#tenantinforesponse) |

### /installed-apps

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [InstalledAppListResponse](#installedapplistresponse) |

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/audio-to-text

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/chat-messages

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| payload | body |  | Yes | [ChatMessagePayload](#chatmessagepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/chat-messages/{task_id}/stop

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/completion-messages

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| payload | body |  | Yes | [CompletionMessageExplorePayload](#completionmessageexplorepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/completion-messages/{task_id}/stop

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/conversations

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| payload | body |  | Yes | [ConversationListQuery](#conversationlistquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/conversations/{c_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path |  | Yes | string |
| installed_app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/conversations/{c_id}/name

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path |  | Yes | string |
| installed_app_id | path |  | Yes | string |
| payload | body |  | Yes | [ConversationRenamePayload](#conversationrenamepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/conversations/{c_id}/pin

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path |  | Yes | string |
| installed_app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/conversations/{c_id}/unpin

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path |  | Yes | string |
| installed_app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/messages

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| payload | body |  | Yes | [MessageListQuery](#messagelistquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/messages/{message_id}/feedbacks

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| message_id | path |  | Yes | string |
| payload | body |  | Yes | [MessageFeedbackPayload](#messagefeedbackpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/messages/{message_id}/more-like-this

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| message_id | path |  | Yes | string |
| payload | body |  | Yes | [MoreLikeThisQuery](#morelikethisquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/messages/{message_id}/suggested-questions

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| message_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/meta

#### GET
##### Summary

Get app meta

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/parameters

#### GET
##### Summary

Retrieve app parameters

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/saved-messages

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| payload | body |  | Yes | [SavedMessageListQuery](#savedmessagelistquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| payload | body |  | Yes | [SavedMessageCreatePayload](#savedmessagecreatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/saved-messages/{message_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| message_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/text-to-audio

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| payload | body |  | Yes | [TextToAudioPayload](#texttoaudiopayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/workflows/run

#### POST
##### Summary

Run workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| payload | body |  | Yes | [WorkflowRunPayload](#workflowrunpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /installed-apps/{installed_app_id}/workflows/tasks/{task_id}/stop

#### POST
##### Summary

Stop workflow task

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /instruction-generate

#### POST
##### Description

Generate instruction for workflow nodes or general use

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [InstructionGeneratePayload](#instructiongeneratepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Instruction generated successfully |
| 400 | Invalid request parameters or flow/workflow not found |
| 402 | Provider quota exceeded |

### /instruction-generate/template

#### POST
##### Description

Get instruction generation template

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [InstructionTemplatePayload](#instructiontemplatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Template retrieved successfully |
| 400 | Invalid request parameters |

### /login

#### POST
##### Summary

Authenticate user and login

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [LoginPayload](#loginpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /logout

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /mcp/oauth/callback

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /notification

#### GET
##### Description

Return the active in-product notification for the current user in their interface language (falls back to English if unavailable). The notification is NOT marked as seen here; call POST /notification/dismiss when the user explicitly closes the modal.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success — inspect should_show to decide whether to render the modal |
| 401 | Unauthorized |

### /notification/dismiss

#### POST
##### Description

Mark a notification as dismissed for the current user.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 401 | Unauthorized |

### /notion/pages/{page_id}/{page_type}/preview

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| page_id | path |  | Yes | string |
| page_type | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| page_id | path |  | Yes | string |
| page_type | path |  | Yes | string |
| payload | body |  | Yes | [NotionEstimatePayload](#notionestimatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /notion/pre-import/pages

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /oauth/authorize/{provider}

#### GET
##### Description

Handle OAuth callback and complete login process

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | OAuth provider name (github/google) | Yes | string |
| code | query | Authorization code from OAuth provider | No | string |
| state | query | Optional state parameter (used for invite token) | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 302 | Redirect to console with access token |
| 400 | OAuth process failed |

### /oauth/data-source/binding/{provider}

#### GET
##### Description

Bind OAuth data source with authorization code

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | Data source provider name (notion) | Yes | string |
| code | query | Authorization code from OAuth provider | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Data source binding success | [OAuthDataSourceBindingResponse](#oauthdatasourcebindingresponse) |
| 400 | Invalid provider or code |  |

### /oauth/data-source/callback/{provider}

#### GET
##### Description

Handle OAuth callback from data source provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | Data source provider name (notion) | Yes | string |
| code | query | Authorization code from OAuth provider | No | string |
| error | query | Error message from OAuth provider | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 302 | Redirect to console with result |
| 400 | Invalid provider |

### /oauth/data-source/{provider}

#### GET
##### Description

Get OAuth authorization URL for data source provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | Data source provider name (notion) | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Authorization URL or internal setup success | [OAuthDataSourceResponse](#oauthdatasourceresponse) |
| 400 | Invalid provider |  |
| 403 | Admin privileges required |  |

### /oauth/data-source/{provider}/{binding_id}/sync

#### GET
##### Description

Sync data from OAuth data source

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| binding_id | path | Data source binding ID | Yes | string |
| provider | path | Data source provider name (notion) | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Data source sync success | [OAuthDataSourceSyncResponse](#oauthdatasourcesyncresponse) |
| 400 | Invalid provider or sync failed |  |

### /oauth/login/{provider}

#### GET
##### Description

Initiate OAuth login process

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | OAuth provider name (github/google) | Yes | string |
| invite_token | query | Optional invitation token | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 302 | Redirect to OAuth authorization URL |
| 400 | Invalid provider |

### /oauth/plugin/{provider_id}/datasource/callback

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /oauth/plugin/{provider_id}/datasource/get-authorization-url

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /oauth/plugin/{provider}/tool/authorization-url

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /oauth/plugin/{provider}/tool/callback

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /oauth/plugin/{provider}/trigger/callback

#### GET
##### Summary

Handle OAuth callback for trigger provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /oauth/provider

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /oauth/provider/account

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /oauth/provider/authorize

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /oauth/provider/token

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipeline/customized/templates/{template_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| template_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| template_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| template_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipeline/dataset

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [RagPipelineDatasetImportPayload](#ragpipelinedatasetimportpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipeline/empty-dataset

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipeline/templates

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipeline/templates/{template_id}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| template_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/datasource-plugins

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/imports

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [RagPipelineImportPayload](#ragpipelineimportpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/imports/{import_id}/confirm

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| import_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/imports/{pipeline_id}/check-dependencies

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/recommended-plugins

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/transform/datasets/{dataset_id}

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/customized/publish

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [Payload](#payload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/exports

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflow-runs

#### GET
##### Summary

Get workflow run list

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs retrieved successfully | [WorkflowRunPaginationResponse](#workflowrunpaginationresponse) |

### /rag/pipelines/{pipeline_id}/workflow-runs/tasks/{task_id}/stop

#### POST
##### Summary

Stop workflow task

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflow-runs/{run_id}

#### GET
##### Summary

Get workflow run detail

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| run_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run detail retrieved successfully | [WorkflowRunDetailResponse](#workflowrundetailresponse) |

### /rag/pipelines/{pipeline_id}/workflow-runs/{run_id}/node-executions

#### GET
##### Summary

Get workflow run node execution list

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| run_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node executions retrieved successfully | [WorkflowRunNodeExecutionListResponse](#workflowrunnodeexecutionlistresponse) |

### /rag/pipelines/{pipeline_id}/workflows

#### GET
##### Summary

Get published workflows

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/default-workflow-block-configs

#### GET
##### Summary

Get default block config

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/default-workflow-block-configs/{block_type}

#### GET
##### Summary

Get default block config

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| block_type | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft

#### GET
##### Summary

Get draft rag pipeline's workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Summary

Sync draft workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/datasource/nodes/{node_id}/run

#### POST
##### Summary

Run rag pipeline datasource

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [DatasourceNodeRunPayload](#datasourcenoderunpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/datasource/variables-inspect

#### POST
##### Summary

Set datasource variables

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [DatasourceVariablesPayload](#datasourcevariablespayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Datasource variables set successfully | [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse) |

### /rag/pipelines/{pipeline_id}/workflows/draft/environment-variables

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/iteration/nodes/{node_id}/run

#### POST
##### Summary

Run draft workflow iteration node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [NodeRunPayload](#noderunpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/loop/nodes/{node_id}/run

#### POST
##### Summary

Run draft workflow loop node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [NodeRunPayload](#noderunpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/nodes/{node_id}/last-run

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node last run retrieved successfully | [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse) |

### /rag/pipelines/{pipeline_id}/workflows/draft/nodes/{node_id}/run

#### POST
##### Summary

Run draft workflow node

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [NodeRunRequiredPayload](#noderunrequiredpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node run started successfully | [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse) |

### /rag/pipelines/{pipeline_id}/workflows/draft/nodes/{node_id}/variables

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/pre-processing/parameters

#### GET
##### Summary

Get first step parameters of rag pipeline

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/processing/parameters

#### GET
##### Summary

Get second step parameters of rag pipeline

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/run

#### POST
##### Summary

Run draft workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [DraftWorkflowRunPayload](#draftworkflowrunpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/system-variables

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/variables

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/variables/{variable_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| variable_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| variable_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| variable_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/draft/variables/{variable_id}/reset

#### PUT
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| variable_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/publish

#### GET
##### Summary

Get published pipeline

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Summary

Publish workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/published/datasource/nodes/{node_id}/preview

#### POST
##### Summary

Run datasource content preview

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [Parser](#parser) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/published/datasource/nodes/{node_id}/run

#### POST
##### Summary

Run rag pipeline datasource

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [DatasourceNodeRunPayload](#datasourcenoderunpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/published/pre-processing/parameters

#### GET
##### Summary

Get first step parameters of rag pipeline

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/published/processing/parameters

#### GET
##### Summary

Get second step parameters of rag pipeline

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/published/run

#### POST
##### Summary

Run published workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| payload | body |  | Yes | [PublishedWorkflowRunPayload](#publishedworkflowrunpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/{workflow_id}

#### DELETE
##### Summary

Delete a published workflow version that is not currently active on the pipeline

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| workflow_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Summary

Update workflow attributes

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| workflow_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rag/pipelines/{pipeline_id}/workflows/{workflow_id}/restore

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |
| workflow_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /refresh-token

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /remote-files/upload

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /remote-files/{url}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| url | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /reset-password

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EmailPayload](#emailpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /rule-code-generate

#### POST
##### Description

Generate code rules using LLM

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [RuleCodeGeneratePayload](#rulecodegeneratepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Code rules generated successfully |
| 400 | Invalid request parameters |
| 402 | Provider quota exceeded |

### /rule-generate

#### POST
##### Description

Generate rule configuration using LLM

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [RuleGeneratePayload](#rulegeneratepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Rule configuration generated successfully |
| 400 | Invalid request parameters |
| 402 | Provider quota exceeded |

### /rule-structured-output-generate

#### POST
##### Description

Generate structured output rules using LLM

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [RuleStructuredOutputPayload](#rulestructuredoutputpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Structured output generated successfully |
| 400 | Invalid request parameters |
| 402 | Provider quota exceeded |

### /spec/schema-definitions

#### GET
##### Summary

Get system JSON Schema definitions specification

##### Description

Used for frontend component type mapping

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /system-features

#### GET
##### Summary

Get system-wide feature configuration

##### Description

Get system-wide feature configuration
NOTE: This endpoint is unauthenticated by design, as it provides system features
data required for dashboard initialization.

Authentication would create circular dependency (can't login without dashboard loading).

Only non-sensitive configuration data should be returned by this endpoint.

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [SystemFeatureResponse](#systemfeatureresponse) |

### /tag-bindings

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TagBindingPayload](#tagbindingpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /tag-bindings/remove

#### POST
##### Description

Remove one or more tag bindings from a target.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TagBindingRemovePayload](#tagbindingremovepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /tags

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| keyword | query | Search keyword for tag name. | No | string |
| type | query | Tag type filter. Can be "knowledge" or "app". | No | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [ [TagResponse](#tagresponse) ] |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TagBasePayload](#tagbasepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /tags/{tag_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| tag_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| tag_id | path |  | Yes | string |
| payload | body |  | Yes | [TagBasePayload](#tagbasepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /test/retrieval

#### POST
##### Description

Bedrock retrieval test (internal use only)

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [BedrockRetrievalPayload](#bedrockretrievalpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Bedrock retrieval test completed |

### /trial-apps/{app_id}

#### GET
##### Summary

Get app detail

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/audio-to-text

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/chat-messages

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| payload | body |  | Yes | [ChatRequest](#chatrequest) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/completion-messages

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| payload | body |  | Yes | [CompletionRequest](#completionrequest) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/datasets

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/messages/{message_id}/suggested-questions

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| message_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/parameters

#### GET
##### Summary

Retrieve app parameters

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/site

#### GET
##### Summary

Retrieve app site info

##### Description

Returns the site configuration for the application including theme, icons, and text.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/text-to-audio

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| payload | body |  | Yes | [TextToSpeechRequest](#texttospeechrequest) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/workflows

#### GET
##### Summary

Get workflow detail

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/workflows/run

#### POST
##### Summary

Run workflow

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| payload | body |  | Yes | [WorkflowRunRequest](#workflowrunrequest) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /trial-apps/{app_id}/workflows/tasks/{task_id}/stop

#### POST
##### Summary

Stop workflow task

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /website/crawl

#### POST
##### Description

Crawl website content

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WebsiteCrawlPayload](#websitecrawlpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Website crawl initiated successfully |
| 400 | Invalid crawl parameters |

### /website/crawl/status/{job_id}

#### GET
##### Description

Get website crawl status

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WebsiteCrawlStatusQuery](#websitecrawlstatusquery) |
| job_id | path | Crawl job ID | Yes | string |
| provider | query | Crawl provider (firecrawl/watercrawl/jinareader) | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Crawl status retrieved successfully |
| 400 | Invalid provider |
| 404 | Crawl job not found |

### /workflow/{workflow_run_id}/events

#### GET
##### Summary

Get workflow execution events stream after resume

##### Description

GET /console/api/workflow/<workflow_run_id>/events

Returns Server-Sent Events stream.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_run_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workflow/{workflow_run_id}/pause-details

#### GET
##### Summary

Get workflow pause details

##### Description

Get workflow pause details
GET /console/api/workflow/<workflow_run_id>/pause-details

Returns information about why and where the workflow is paused.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_run_id | path | Workflow run ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow pause details retrieved successfully | [WorkflowPauseDetailsResponse](#workflowpausedetailsresponse) |
| 404 | Workflow run not found |  |

### /workspaces

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current

#### POST
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [TenantInfoResponse](#tenantinforesponse) |

### /workspaces/current/agent-provider/{provider_name}

#### GET
##### Description

Get specific agent provider details

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_name | path | Agent provider name | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | object |

### /workspaces/current/agent-providers

#### GET
##### Description

Get list of available agent providers

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [ object ] |

### /workspaces/current/dataset-operators

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [AccountWithRoleList](#accountwithrolelist) |

### /workspaces/current/default-model

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserGetDefault](#parsergetdefault) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserPostDefault](#parserpostdefault) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/endpoints

#### POST
##### Description

Create a new plugin endpoint

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EndpointCreatePayload](#endpointcreatepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint created successfully | [EndpointCreateResponse](#endpointcreateresponse) |
| 403 | Admin privileges required |  |

### /workspaces/current/endpoints/create

#### POST
***DEPRECATED***
##### Description

Deprecated legacy alias for creating a plugin endpoint. Use POST /workspaces/current/endpoints instead.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EndpointCreatePayload](#endpointcreatepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint created successfully | [EndpointCreateResponse](#endpointcreateresponse) |
| 403 | Admin privileges required |  |

### /workspaces/current/endpoints/delete

#### POST
***DEPRECATED***
##### Description

Deprecated legacy alias for deleting a plugin endpoint. Use DELETE /workspaces/current/endpoints/{id} instead.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EndpointIdPayload](#endpointidpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint deleted successfully | [EndpointDeleteResponse](#endpointdeleteresponse) |
| 403 | Admin privileges required |  |

### /workspaces/current/endpoints/disable

#### POST
##### Description

Disable a plugin endpoint

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EndpointIdPayload](#endpointidpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint disabled successfully | [EndpointDisableResponse](#endpointdisableresponse) |
| 403 | Admin privileges required |  |

### /workspaces/current/endpoints/enable

#### POST
##### Description

Enable a plugin endpoint

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EndpointIdPayload](#endpointidpayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint enabled successfully | [EndpointEnableResponse](#endpointenableresponse) |
| 403 | Admin privileges required |  |

### /workspaces/current/endpoints/list

#### GET
##### Description

List plugin endpoints with pagination

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EndpointListQuery](#endpointlistquery) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [EndpointListResponse](#endpointlistresponse) |

### /workspaces/current/endpoints/list/plugin

#### GET
##### Description

List endpoints for a specific plugin

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EndpointListForPluginQuery](#endpointlistforpluginquery) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [PluginEndpointListResponse](#pluginendpointlistresponse) |

### /workspaces/current/endpoints/update

#### POST
***DEPRECATED***
##### Description

Deprecated legacy alias for updating a plugin endpoint. Use PATCH /workspaces/current/endpoints/{id} instead.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [LegacyEndpointUpdatePayload](#legacyendpointupdatepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint updated successfully | [EndpointUpdateResponse](#endpointupdateresponse) |
| 403 | Admin privileges required |  |

### /workspaces/current/endpoints/{id}

#### DELETE
##### Description

Delete a plugin endpoint

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| id | path | Endpoint ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint deleted successfully | [EndpointDeleteResponse](#endpointdeleteresponse) |
| 403 | Admin privileges required |  |

#### PATCH
##### Description

Update a plugin endpoint

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EndpointUpdatePayload](#endpointupdatepayload) |
| id | path | Endpoint ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint updated successfully | [EndpointUpdateResponse](#endpointupdateresponse) |
| 403 | Admin privileges required |  |

### /workspaces/current/members

#### GET
##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | [AccountWithRoleList](#accountwithrolelist) |

### /workspaces/current/members/invite-email

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MemberInvitePayload](#memberinvitepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/members/owner-transfer-check

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [OwnerTransferCheckPayload](#ownertransfercheckpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/members/send-owner-transfer-confirm-email

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [OwnerTransferEmailPayload](#ownertransferemailpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/members/{member_id}

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/members/{member_id}/owner-transfer

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string |
| payload | body |  | Yes | [OwnerTransferPayload](#ownertransferpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/members/{member_id}/update-role

#### PUT
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string |
| payload | body |  | Yes | [MemberRoleUpdatePayload](#memberroleupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserModelList](#parsermodellist) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/checkout-url

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/credentials

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserCredentialDelete](#parsercredentialdelete) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserCredentialId](#parsercredentialid) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserCredentialCreate](#parsercredentialcreate) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PUT
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserCredentialUpdate](#parsercredentialupdate) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/credentials/switch

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserCredentialSwitch](#parsercredentialswitch) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/credentials/validate

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserCredentialValidate](#parsercredentialvalidate) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/models

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserDeleteModels](#parserdeletemodels) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserPostModels](#parserpostmodels) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/models/credentials

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserDeleteCredential](#parserdeletecredential) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserGetCredentials](#parsergetcredentials) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserCreateCredential](#parsercreatecredential) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PUT
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserUpdateCredential](#parserupdatecredential) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/models/credentials/switch

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserSwitch](#parserswitch) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/models/credentials/validate

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserValidate](#parservalidate) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/models/disable

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserDeleteModels](#parserdeletemodels) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/models/enable

#### PATCH
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserDeleteModels](#parserdeletemodels) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [LoadBalancingCredentialPayload](#loadbalancingcredentialpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/models/load-balancing-configs/{config_id}/credentials-validate

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| config_id | path |  | Yes | string |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [LoadBalancingCredentialPayload](#loadbalancingcredentialpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/models/parameter-rules

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserParameter](#parserparameter) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/model-providers/{provider}/preferred-provider-type

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ParserPreferredProviderType](#parserpreferredprovidertype) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/models/model-types/{model_type}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/permission

#### GET
##### Summary

Get workspace permission settings

##### Description

Returns permission flags that control workspace features like member invitations and owner transfer.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/asset

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserAsset](#parserasset) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/debugging-key

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/fetch-manifest

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserPluginIdentifierQuery](#parserpluginidentifierquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/icon

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserIcon](#parsericon) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/install/github

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserGithubInstall](#parsergithubinstall) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/install/marketplace

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserPluginIdentifiers](#parserpluginidentifiers) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/install/pkg

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserPluginIdentifiers](#parserpluginidentifiers) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/list

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserList](#parserlist) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/list/installations/ids

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserLatest](#parserlatest) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/list/latest-versions

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserLatest](#parserlatest) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/marketplace/pkg

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserPluginIdentifierQuery](#parserpluginidentifierquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/parameters/dynamic-options

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserDynamicOptions](#parserdynamicoptions) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/parameters/dynamic-options-with-credentials

#### POST
##### Summary

Fetch dynamic options using credentials directly (for edit mode)

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserDynamicOptionsWithCredentials](#parserdynamicoptionswithcredentials) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/permission/change

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserPermissionChange](#parserpermissionchange) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/permission/fetch

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/preferences/autoupgrade/exclude

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserExcludePlugin](#parserexcludeplugin) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/preferences/change

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserPreferencesChange](#parserpreferenceschange) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/preferences/fetch

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/readme

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserReadme](#parserreadme) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/tasks

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserTasks](#parsertasks) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/tasks/delete_all

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/tasks/{task_id}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/tasks/{task_id}/delete

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/tasks/{task_id}/delete/{identifier}

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| identifier | path |  | Yes | string |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/uninstall

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserUninstall](#parseruninstall) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/upgrade/github

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserGithubUpgrade](#parsergithubupgrade) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/upgrade/marketplace

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserMarketplaceUpgrade](#parsermarketplaceupgrade) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/upload/bundle

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/upload/github

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ParserGithubUpload](#parsergithubupload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/plugin/upload/pkg

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-labels

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/api/add

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ApiToolProviderAddPayload](#apitoolprovideraddpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/api/delete

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ApiToolProviderDeletePayload](#apitoolproviderdeletepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/api/get

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/api/remote

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/api/schema

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ApiToolSchemaPayload](#apitoolschemapayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/api/test/pre

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ApiToolTestPayload](#apitooltestpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/api/tools

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/api/update

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ApiToolProviderUpdatePayload](#apitoolproviderupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/add

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [BuiltinToolAddPayload](#builtintooladdpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/credential/info

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/credential/schema/{credential_type}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_type | path |  | Yes | string |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/credentials

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/default-credential

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [BuiltinProviderDefaultCredentialPayload](#builtinproviderdefaultcredentialpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/delete

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [BuiltinToolCredentialDeletePayload](#builtintoolcredentialdeletepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/icon

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/info

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/oauth/client-schema

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/oauth/custom-client

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [ToolOAuthCustomClientPayload](#tooloauthcustomclientpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/tools

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/builtin/{provider}/update

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [BuiltinToolUpdatePayload](#builtintoolupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/mcp

#### DELETE
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MCPProviderDeletePayload](#mcpproviderdeletepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MCPProviderCreatePayload](#mcpprovidercreatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### PUT
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MCPProviderUpdatePayload](#mcpproviderupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/mcp/auth

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MCPAuthPayload](#mcpauthpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/mcp/tools/{provider_id}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/mcp/update/{provider_id}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/workflow/create

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowToolCreatePayload](#workflowtoolcreatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/workflow/delete

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowToolDeletePayload](#workflowtooldeletepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/workflow/get

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/workflow/tools

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-provider/workflow/update

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowToolUpdatePayload](#workflowtoolupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tool-providers

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tools/api

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tools/builtin

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tools/mcp

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/tools/workflow

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/icon

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/info

#### GET
##### Summary

Get info for a trigger provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/oauth/client

#### DELETE
##### Summary

Remove custom OAuth client configuration

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### GET
##### Summary

Get OAuth client configuration for a provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

#### POST
##### Summary

Configure custom OAuth client for a provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [TriggerOAuthClientPayload](#triggeroauthclientpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/subscriptions/builder/build/{subscription_builder_id}

#### POST
##### Summary

Build a subscription instance for a trigger provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |
| payload | body |  | Yes | [TriggerSubscriptionBuilderUpdatePayload](#triggersubscriptionbuilderupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/subscriptions/builder/create

#### POST
##### Summary

Add a new subscription instance for a trigger provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| payload | body |  | Yes | [TriggerSubscriptionBuilderCreatePayload](#triggersubscriptionbuildercreatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/subscriptions/builder/logs/{subscription_builder_id}

#### GET
##### Summary

Get the request logs for a subscription instance for a trigger provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/subscriptions/builder/update/{subscription_builder_id}

#### POST
##### Summary

Update a subscription instance for a trigger provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |
| payload | body |  | Yes | [TriggerSubscriptionBuilderUpdatePayload](#triggersubscriptionbuilderupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/subscriptions/builder/verify-and-update/{subscription_builder_id}

#### POST
##### Summary

Verify and update a subscription instance for a trigger provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |
| payload | body |  | Yes | [TriggerSubscriptionBuilderVerifyPayload](#triggersubscriptionbuilderverifypayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/subscriptions/builder/{subscription_builder_id}

#### GET
##### Summary

Get a subscription instance for a trigger provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/subscriptions/list

#### GET
##### Summary

List all trigger subscriptions for the current tenant's provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/subscriptions/oauth/authorize

#### GET
##### Summary

Initiate OAuth authorization flow for a trigger provider

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{provider}/subscriptions/verify/{subscription_id}

#### POST
##### Summary

Verify credentials for an existing subscription (edit mode only)

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_id | path |  | Yes | string |
| payload | body |  | Yes | [TriggerSubscriptionBuilderVerifyPayload](#triggersubscriptionbuilderverifypayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{subscription_id}/subscriptions/delete

#### POST
##### Summary

Delete a subscription instance

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| subscription_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/trigger-provider/{subscription_id}/subscriptions/update

#### POST
##### Summary

Update a subscription instance

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| subscription_id | path |  | Yes | string |
| payload | body |  | Yes | [TriggerSubscriptionBuilderUpdatePayload](#triggersubscriptionbuilderupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/current/triggers

#### GET
##### Summary

List all trigger providers for the current tenant

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/custom-config

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkspaceCustomConfigPayload](#workspacecustomconfigpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/custom-config/webapp-logo/upload

#### POST
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/info

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkspaceInfoPayload](#workspaceinfopayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/switch

#### POST
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [SwitchWorkspacePayload](#switchworkspacepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /workspaces/{tenant_id}/model-providers/{provider}/{icon_type}/{lang}

#### GET
##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| icon_type | path |  | Yes | string |
| lang | path |  | Yes | string |
| provider | path |  | Yes | string |
| tenant_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

---
## default
Default namespace

### /explore/banners

#### GET
##### Summary

Get banner list

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

---
### Models

#### APIBasedExtensionListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| APIBasedExtensionListResponse | array |  |  |

#### APIBasedExtensionPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| api_endpoint | string | API endpoint URL | Yes |
| api_key | string | API key for authentication | Yes |
| name | string | Extension name | Yes |

#### APIBasedExtensionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| api_endpoint | string |  | Yes |
| api_key | string |  | Yes |
| created_at |  |  | No |
| id | string |  | Yes |
| name | string |  | Yes |

#### Account

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar |  |  | No |
| created_at |  |  | No |
| email | string |  | Yes |
| id | string |  | Yes |
| interface_language |  |  | No |
| interface_theme |  |  | No |
| is_password_set | boolean |  | Yes |
| last_login_at |  |  | No |
| last_login_ip |  |  | No |
| name | string |  | Yes |
| timezone |  |  | No |

#### AccountAvatarPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar | string |  | Yes |

#### AccountAvatarQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar | string | Avatar file ID | Yes |

#### AccountDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| token | string |  | Yes |

#### AccountDeletionFeedbackPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| feedback | string |  | Yes |

#### AccountInitPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| interface_language | string |  | Yes |
| invitation_code |  |  | No |
| timezone | string |  | Yes |

#### AccountIntegrateListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AccountIntegrateResponse](#accountintegrateresponse) ] |  | Yes |

#### AccountIntegrateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| is_bound | boolean |  | Yes |
| link |  |  | No |
| provider | string |  | Yes |

#### AccountInterfaceLanguagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| interface_language | string |  | Yes |

#### AccountInterfaceThemePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| interface_theme | string | *Enum:* `"dark"`, `"light"` | Yes |

#### AccountNamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

#### AccountPasswordPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_password | string |  | Yes |
| password |  |  | No |
| repeat_new_password | string |  | Yes |

#### AccountTimezonePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| timezone | string |  | Yes |

#### AccountWithRole

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar |  |  | No |
| created_at |  |  | No |
| email | string |  | Yes |
| id | string |  | Yes |
| last_active_at |  |  | No |
| last_login_at |  |  | No |
| name | string |  | Yes |
| role | string |  | Yes |
| status | string |  | Yes |

#### AccountWithRoleList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| accounts | [ [AccountWithRole](#accountwithrole) ] |  | Yes |

#### ActivateCheckQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email |  |  | No |
| token | string |  | Yes |
| workspace_id |  |  | No |

#### ActivatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email |  |  | No |
| interface_language | string |  | Yes |
| name | string |  | Yes |
| timezone | string |  | Yes |
| token | string |  | Yes |
| workspace_id |  |  | No |

#### ActivationCheckResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data |  | Activation data if valid | No |
| is_valid | boolean | Whether token is valid | Yes |

#### ActivationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Operation result | Yes |

#### AdvancedChatWorkflowRunForListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id |  |  | No |
| created_at |  |  | No |
| created_by_account |  |  | No |
| elapsed_time |  |  | No |
| exceptions_count |  |  | No |
| finished_at |  |  | No |
| id | string |  | Yes |
| message_id |  |  | No |
| retry_index |  |  | No |
| status |  |  | No |
| total_steps |  |  | No |
| total_tokens |  |  | No |
| version |  |  | No |

#### AdvancedChatWorkflowRunPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AdvancedChatWorkflowRunForListResponse](#advancedchatworkflowrunforlistresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### AdvancedChatWorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id |  |  | No |
| files |  |  | No |
| inputs |  |  | No |
| parent_message_id |  |  | No |
| query | string |  | No |

#### AdvancedPromptTemplateQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_mode | string | Application mode | Yes |
| has_context | string | Whether has context | No |
| model_mode | string | Model mode | Yes |
| model_name | string | Model name | Yes |

#### AgentLogQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation UUID | Yes |
| message_id | string | Message UUID | Yes |

#### AgentThought

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chain_id |  |  | No |
| created_at |  |  | No |
| files | [ string ] |  | Yes |
| id | string |  | Yes |
| message_chain_id |  |  | No |
| message_id | string |  | Yes |
| observation |  |  | No |
| position | integer |  | Yes |
| thought |  |  | No |
| tool |  |  | No |
| tool_input |  |  | No |
| tool_labels | [JSONValue](#jsonvalue) |  | Yes |

#### Annotation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content |  |  | No |
| created_at |  |  | No |
| hit_count |  |  | No |
| id | string |  | Yes |
| question |  |  | No |

#### AnnotationCountResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| count | integer | Number of annotations | Yes |

#### AnnotationExportList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [Annotation](#annotation) ] |  | Yes |

#### AnnotationFilePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string | Message ID | Yes |

#### AnnotationHitHistory

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_content |  |  | No |
| annotation_question |  |  | No |
| created_at |  |  | No |
| id | string |  | Yes |
| question |  |  | No |
| score |  |  | No |
| source |  |  | No |

#### AnnotationHitHistoryList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AnnotationHitHistory](#annotationhithistory) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

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
| keyword | string | Search keyword | No |
| limit | integer | Page size | No |
| page | integer | Page number | No |

#### AnnotationReplyPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string | Embedding model name | Yes |
| embedding_provider_name | string | Embedding provider name | Yes |
| score_threshold | number | Score threshold for annotation matching | Yes |

#### AnnotationReplyStatusQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string | *Enum:* `"disable"`, `"enable"` | Yes |

#### AnnotationSettingUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| score_threshold | number | Score threshold | Yes |

#### ApiKeyAuthBindingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| category | string |  | Yes |
| credentials | object |  | Yes |
| provider | string |  | Yes |

#### ApiKeyItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| id | string |  | Yes |
| last_used_at |  |  | No |
| token | string |  | Yes |
| type | string |  | Yes |

#### ApiKeyList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ApiKeyItem](#apikeyitem) ] |  | Yes |

#### ApiProviderSchemaType

Enum class for api provider schema type.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ApiProviderSchemaType | string | Enum class for api provider schema type. |  |

#### ApiToolProviderAddPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| custom_disclaimer | string |  | No |
| icon | object |  | Yes |
| labels |  |  | No |
| privacy_policy |  |  | No |
| provider | string |  | Yes |
| schema | string |  | Yes |
| schema_type | [ApiProviderSchemaType](#apiproviderschematype) |  | Yes |

#### ApiToolProviderDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| provider | string |  | Yes |

#### ApiToolProviderUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| custom_disclaimer | string |  | No |
| icon | object |  | Yes |
| labels |  |  | No |
| original_provider | string |  | Yes |
| privacy_policy |  |  | No |
| provider | string |  | Yes |
| schema | string |  | Yes |
| schema_type | [ApiProviderSchemaType](#apiproviderschematype) |  | Yes |

#### ApiToolSchemaPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| schema | string |  | Yes |

#### ApiToolTestPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| parameters | object |  | Yes |
| provider_name |  |  | No |
| schema | string |  | Yes |
| schema_type | [ApiProviderSchemaType](#apiproviderschematype) |  | Yes |
| tool_name | string |  | Yes |

#### AppApiStatusPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enable_api | boolean | Enable or disable API | Yes |

#### AppDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode |  |  | No |
| app_model_config |  |  | No |
| created_at |  |  | No |
| created_by |  |  | No |
| description |  |  | No |
| enable_api | boolean |  | Yes |
| enable_site | boolean |  | Yes |
| icon |  |  | No |
| icon_background |  |  | No |
| id | string |  | Yes |
| mode_compatible_with_agent | string |  | Yes |
| name | string |  | Yes |
| tags | [ [Tag](#tag) ] |  | No |
| tracing |  |  | No |
| updated_at |  |  | No |
| updated_by |  |  | No |
| use_icon_as_answer_icon |  |  | No |
| workflow |  |  | No |

#### AppDetailKernel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | object |  | No |
| id | string |  | No |
| mode | string |  | No |
| name | string |  | No |

#### AppDetailWithSite

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode |  |  | No |
| api_base_url |  |  | No |
| app_model_config |  |  | No |
| created_at |  |  | No |
| created_by |  |  | No |
| deleted_tools | [ [DeletedTool](#deletedtool) ] |  | No |
| description |  |  | No |
| enable_api | boolean |  | Yes |
| enable_site | boolean |  | Yes |
| icon |  |  | No |
| icon_background |  |  | No |
| icon_type |  |  | No |
| id | string |  | Yes |
| max_active_requests |  |  | No |
| mode_compatible_with_agent | string |  | Yes |
| name | string |  | Yes |
| site |  |  | No |
| tags | [ [Tag](#tag) ] |  | No |
| tracing |  |  | No |
| updated_at |  |  | No |
| updated_by |  |  | No |
| use_icon_as_answer_icon |  |  | No |
| workflow |  |  | No |

#### AppExportQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| include_secret | boolean | Include secrets in export | No |
| workflow_id |  | Specific workflow ID to export | No |

#### AppExportResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string |  | Yes |

#### AppIconPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon |  | Icon data | No |
| icon_background |  | Icon background color | No |
| icon_type |  | Icon type | No |

#### AppImportPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id |  |  | No |
| description |  |  | No |
| icon |  |  | No |
| icon_background |  |  | No |
| icon_type |  |  | No |
| mode | string | Import mode | Yes |
| name |  |  | No |
| yaml_content |  |  | No |
| yaml_url |  |  | No |

#### AppListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| is_created_by_me |  | Filter by creator | No |
| limit | integer | Page size (1-100) | No |
| mode | string | App mode filter<br>*Enum:* `"advanced-chat"`, `"agent-chat"`, `"all"`, `"channel"`, `"chat"`, `"completion"`, `"workflow"` | No |
| name |  | Filter by app name | No |
| page | integer | Page number (1-99999) | No |
| tag_ids |  | Filter by tag IDs | No |

#### AppMCPServerResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| description | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| parameters |  |  | Yes |
| server_code | string |  | Yes |
| status | [AppMCPServerStatus](#appmcpserverstatus) |  | Yes |
| updated_at |  |  | No |

#### AppMCPServerStatus

AppMCPServer Status Enum

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AppMCPServerStatus | string | AppMCPServer Status Enum |  |

#### AppNamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string | Name to check | Yes |

#### AppPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| has_next | boolean |  | Yes |
| items | [ [AppPartial](#apppartial) ] |  | Yes |
| page | integer |  | Yes |
| per_page | integer |  | Yes |
| total | integer |  | Yes |

#### AppPartial

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode |  |  | No |
| app_model_config |  |  | No |
| author_name |  |  | No |
| create_user_name |  |  | No |
| created_at |  |  | No |
| created_by |  |  | No |
| desc_or_prompt |  |  | No |
| has_draft_trigger |  |  | No |
| icon |  |  | No |
| icon_background |  |  | No |
| icon_type |  |  | No |
| id | string |  | Yes |
| max_active_requests |  |  | No |
| mode_compatible_with_agent | string |  | Yes |
| name | string |  | Yes |
| tags | [ [Tag](#tag) ] |  | No |
| updated_at |  |  | No |
| updated_by |  |  | No |
| use_icon_as_answer_icon |  |  | No |
| workflow |  |  | No |

#### AppSiteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |
| code |  |  | No |
| copyright |  |  | No |
| custom_disclaimer |  |  | No |
| customize_domain |  |  | No |
| customize_token_strategy | string |  | Yes |
| default_language | string |  | Yes |
| description |  |  | No |
| icon |  |  | No |
| icon_background |  |  | No |
| privacy_policy |  |  | No |
| prompt_public | boolean |  | Yes |
| show_workflow_steps | boolean |  | Yes |
| title | string |  | Yes |
| use_icon_as_answer_icon | boolean |  | Yes |

#### AppSiteStatusPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enable_site | boolean | Enable or disable site | Yes |

#### AppSiteUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chat_color_theme |  |  | No |
| chat_color_theme_inverted |  |  | No |
| copyright |  |  | No |
| custom_disclaimer |  |  | No |
| customize_domain |  |  | No |
| customize_token_strategy |  |  | No |
| default_language |  |  | No |
| description |  |  | No |
| icon |  |  | No |
| icon_background |  |  | No |
| icon_type |  |  | No |
| privacy_policy |  |  | No |
| prompt_public |  |  | No |
| show_workflow_steps |  |  | No |
| title |  |  | No |
| use_icon_as_answer_icon |  |  | No |

#### AppTracePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean | Enable or disable tracing | Yes |
| tracing_provider |  | Tracing provider | No |

#### AudioTranscriptResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| text | string | Transcribed text from audio | Yes |

#### BatchImportPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| upload_file_id | string |  | Yes |

#### BedrockRetrievalPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| knowledge_id | string |  | Yes |
| query | string |  | Yes |
| retrieval_setting | [BedrockRetrievalSetting](#bedrockretrievalsetting) |  | Yes |

#### BedrockRetrievalSetting

Retrieval settings for Amazon Bedrock knowledge base queries.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| score_threshold | number | Minimum relevance score threshold | No |
| top_k |  | Maximum number of results to retrieve | No |

#### BuiltinProviderDefaultCredentialPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |

#### BuiltinToolAddPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| name |  |  | No |
| type | [CredentialType](#credentialtype) |  | Yes |

#### BuiltinToolCredentialDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |

#### BuiltinToolUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| credentials |  |  | No |
| name |  |  | No |

#### ButtonStyle

Button styles for user actions.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ButtonStyle | string | Button styles for user actions. |  |

#### ChangeEmailResetPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_email | string |  | Yes |
| token | string |  | Yes |

#### ChangeEmailSendPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| language |  |  | No |
| phase |  |  | No |
| token |  |  | No |

#### ChangeEmailValidityPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| email | string |  | Yes |
| token | string |  | Yes |

#### ChatConversationQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_status | string | Annotation status filter<br>*Enum:* `"all"`, `"annotated"`, `"not_annotated"` | No |
| end |  | End date (YYYY-MM-DD HH:MM) | No |
| keyword |  | Search keyword | No |
| limit | integer | Page size (1-100) | No |
| page | integer | Page number | No |
| sort_by | string | Sort field and direction<br>*Enum:* `"-created_at"`, `"-updated_at"`, `"created_at"`, `"updated_at"` | No |
| start |  | Start date (YYYY-MM-DD HH:MM) | No |

#### ChatMessagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id |  | Conversation ID | No |
| files |  | Uploaded files | No |
| inputs | object |  | Yes |
| model_config | object |  | Yes |
| parent_message_id |  | Parent message ID | No |
| query | string | User query | Yes |
| response_mode | string | Response mode<br>*Enum:* `"blocking"`, `"streaming"` | No |
| retriever_from | string | Retriever source | No |

#### ChatMessagesQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation ID | Yes |
| first_id |  | First message ID for pagination | No |
| limit | integer | Number of messages to return (1-100) | No |

#### ChatRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id |  |  | No |
| files |  |  | No |
| inputs | object |  | Yes |
| parent_message_id |  |  | No |
| query | string |  | Yes |
| retriever_from | string |  | No |

#### CheckDependenciesResult

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| leaked_dependencies | [ [PluginDependency](#plugindependency) ] |  | No |

#### CheckEmailUniquePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |

#### ChildChunkBatchUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chunks | [ [ChildChunkUpdateArgs](#childchunkupdateargs) ] |  | Yes |

#### ChildChunkCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |

#### ChildChunkUpdateArgs

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |
| id |  |  | No |

#### ChildChunkUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |

#### CodeBasedExtensionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data |  | Extension data | Yes |
| module | string | Module name | Yes |

#### CompletionConversationQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_status | string | Annotation status filter<br>*Enum:* `"all"`, `"annotated"`, `"not_annotated"` | No |
| end |  | End date (YYYY-MM-DD HH:MM) | No |
| keyword |  | Search keyword | No |
| limit | integer | Page size (1-100) | No |
| page | integer | Page number | No |
| start |  | Start date (YYYY-MM-DD HH:MM) | No |

#### CompletionMessageExplorePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files |  |  | No |
| inputs | object |  | Yes |
| query | string |  | No |
| response_mode |  |  | No |
| retriever_from | string |  | No |

#### CompletionMessagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files |  | Uploaded files | No |
| inputs | object |  | Yes |
| model_config | object |  | Yes |
| query | string | Query text | No |
| response_mode | string | Response mode<br>*Enum:* `"blocking"`, `"streaming"` | No |
| retriever_from | string | Retriever source | No |

#### CompletionRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files |  |  | No |
| inputs | object |  | Yes |
| query | string |  | No |
| response_mode |  |  | No |
| retriever_from | string |  | No |

#### ComplianceDownloadQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_name | string | Compliance document name | Yes |

#### Condition

Condition detail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| comparison_operator | string | *Enum:* `"<"`, `"="`, `">"`, `"after"`, `"before"`, `"contains"`, `"empty"`, `"end with"`, `"in"`, `"is"`, `"is not"`, `"not contains"`, `"not empty"`, `"not in"`, `"start with"`, `"≠"`, `"≤"`, `"≥"` | Yes |
| name | string |  | Yes |
| value |  |  | No |

#### ConsoleDatasetListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ids | [ string ] | Filter by dataset IDs | No |
| include_all | boolean | Include all datasets | No |
| keyword |  | Search keyword | No |
| limit | integer | Number of items per page | No |
| page | integer | Page number | No |
| tag_ids | [ string ] | Filter by tag IDs | No |

#### Conversation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| admin_feedback_stats |  |  | No |
| annotation |  |  | No |
| created_at |  |  | No |
| first_message |  |  | No |
| from_account_id |  |  | No |
| from_account_name |  |  | No |
| from_end_user_id |  |  | No |
| from_end_user_session_id |  |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| model_config |  |  | No |
| read_at |  |  | No |
| status | string |  | Yes |
| updated_at |  |  | No |
| user_feedback_stats |  |  | No |

#### ConversationAnnotation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account |  |  | No |
| content | string |  | Yes |
| created_at |  |  | No |
| id | string |  | Yes |
| question |  |  | No |

#### ConversationAnnotationHitHistory

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_create_account |  |  | No |
| created_at |  |  | No |
| id | string |  | Yes |

#### ConversationDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| admin_feedback_stats |  |  | No |
| annotated | boolean |  | Yes |
| created_at |  |  | No |
| from_account_id |  |  | No |
| from_end_user_id |  |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| introduction |  |  | No |
| message_count | integer |  | Yes |
| model_config |  |  | No |
| status | string |  | Yes |
| updated_at |  |  | No |
| user_feedback_stats |  |  | No |

#### ConversationListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id |  |  | No |
| limit | integer |  | No |
| pinned |  |  | No |

#### ConversationMessageDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| first_message |  |  | No |
| from_account_id |  |  | No |
| from_end_user_id |  |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| model_config |  |  | No |
| status | string |  | Yes |

#### ConversationPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| has_next | boolean |  | Yes |
| items | [ [Conversation](#conversation) ] |  | Yes |
| page | integer |  | Yes |
| per_page | integer |  | Yes |
| total | integer |  | Yes |

#### ConversationRenamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate | boolean |  | No |
| name |  |  | No |

#### ConversationVariable

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | No |
| name | string |  | No |
| value | object |  | No |
| value_type | string |  | No |

#### ConversationVariableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| description |  |  | No |
| id | string |  | Yes |
| name | string |  | Yes |
| updated_at |  |  | No |
| value |  |  | No |
| value_type | string |  | Yes |

#### ConversationVariableUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables | [ object ] | Conversation variables for the draft workflow | Yes |

#### ConversationVariablesQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation ID to filter variables | Yes |

#### ConversationWithSummary

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| admin_feedback_stats |  |  | No |
| annotated | boolean |  | Yes |
| created_at |  |  | No |
| from_account_id |  |  | No |
| from_account_name |  |  | No |
| from_end_user_id |  |  | No |
| from_end_user_session_id |  |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| message_count | integer |  | Yes |
| model_config |  |  | No |
| name | string |  | Yes |
| read_at |  |  | No |
| status | string |  | Yes |
| status_count |  |  | No |
| summary_or_query | string |  | Yes |
| updated_at |  |  | No |
| user_feedback_stats |  |  | No |

#### ConversationWithSummaryPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| has_next | boolean |  | Yes |
| items | [ [ConversationWithSummary](#conversationwithsummary) ] |  | Yes |
| page | integer |  | Yes |
| per_page | integer |  | Yes |
| total | integer |  | Yes |

#### ConvertToWorkflowPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon |  |  | No |
| icon_background |  |  | No |
| icon_type |  |  | No |
| name |  |  | No |

#### CopyAppPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description |  | Description for the copied app | No |
| icon |  | Icon | No |
| icon_background |  | Icon background color | No |
| icon_type |  | Icon type | No |
| name |  | Name for the copied app | No |

#### CreateAnnotationPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_reply |  | Annotation reply data | No |
| answer |  | Answer text | No |
| content |  | Content text | No |
| message_id |  | Message ID | No |
| question |  | Question text | No |

#### CreateAppPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description |  | App description (max 400 chars) | No |
| icon |  | Icon | No |
| icon_background |  | Icon background color | No |
| icon_type |  | Icon type | No |
| mode | string | App mode<br>*Enum:* `"advanced-chat"`, `"agent-chat"`, `"chat"`, `"completion"`, `"workflow"` | Yes |
| name | string | App name | Yes |

#### CredentialType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| CredentialType | string |  |  |

#### DataSource

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| info_list | [InfoList](#infolist) |  | Yes |

#### DataSourceIntegrate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | object |  | No |
| disabled | boolean |  | No |
| id | string |  | No |
| is_bound | boolean |  | No |
| link | string |  | No |
| provider | string |  | No |
| source_info | [DataSourceIntegrateWorkspace](#datasourceintegrateworkspace) |  | No |

#### DataSourceIntegrateIcon

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| emoji | string |  | No |
| type | string |  | No |
| url | string |  | No |

#### DataSourceIntegrateList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DataSourceIntegrate](#datasourceintegrate) ] |  | No |

#### DataSourceIntegratePage

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page_icon | [DataSourceIntegrateIcon](#datasourceintegrateicon) |  | No |
| page_id | string |  | No |
| page_name | string |  | No |
| parent_id | string |  | No |
| type | string |  | No |

#### DataSourceIntegrateWorkspace

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| pages | [ [DataSourceIntegratePage](#datasourceintegratepage) ] |  | No |
| total | integer |  | No |
| workspace_icon | string |  | No |
| workspace_id | string |  | No |
| workspace_name | string |  | No |

#### DatasetAndDocumentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| batch | string |  | Yes |
| dataset | [DatasetResponse](#datasetresponse) |  | Yes |
| documents | [ [DocumentResponse](#documentresponse) ] |  | Yes |

#### DatasetBase

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | object |  | No |
| created_by | string |  | No |
| data_source_type | string |  | No |
| description | string |  | No |
| id | string |  | No |
| indexing_technique | string |  | No |
| name | string |  | No |
| permission | string |  | No |

#### DatasetContent

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | No |
| content_type | string |  | No |
| file_info | [DatasetFileInfo](#datasetfileinfo) |  | No |

#### DatasetCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| external_knowledge_api_id |  |  | No |
| external_knowledge_id |  |  | No |
| indexing_technique |  |  | No |
| name | string |  | Yes |
| permission |  |  | No |
| provider | string |  | No |

#### DatasetDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_count | integer |  | No |
| author_name | string |  | No |
| built_in_field_enabled | boolean |  | No |
| chunk_structure | string |  | No |
| created_at | object |  | No |
| created_by | string |  | No |
| data_source_type | string |  | No |
| description | string |  | No |
| doc_form | string |  | No |
| doc_metadata | [ [DatasetDocMetadata](#datasetdocmetadata) ] |  | No |
| document_count | integer |  | No |
| embedding_available | boolean |  | No |
| embedding_model | string |  | No |
| embedding_model_provider | string |  | No |
| enable_api | boolean |  | No |
| external_knowledge_info | [ExternalKnowledgeInfo](#externalknowledgeinfo) |  | No |
| external_retrieval_model | [ExternalRetrievalModel](#externalretrievalmodel) |  | No |
| icon_info | [DatasetIconInfo](#dataseticoninfo) |  | No |
| id | string |  | No |
| indexing_technique | string |  | No |
| is_multimodal | boolean |  | No |
| is_published | boolean |  | No |
| name | string |  | No |
| permission | string |  | No |
| pipeline_id | string |  | No |
| provider | string |  | No |
| retrieval_model_dict | [DatasetRetrievalModel](#datasetretrievalmodel) |  | No |
| runtime_mode | string |  | No |
| summary_index_setting | [_AnonymousInlineModel_b1954337d565](#_anonymousinlinemodel_b1954337d565) |  | No |
| tags | [ [Tag](#tag) ] |  | No |
| total_available_documents | integer |  | No |
| total_documents | integer |  | No |
| updated_at | object |  | No |
| updated_by | string |  | No |
| word_count | integer |  | No |

#### DatasetDocMetadata

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | No |
| name | string |  | No |
| type | string |  | No |

#### DatasetFileInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| extension | string |  | No |
| id | string |  | No |
| mime_type | string |  | No |
| name | string |  | No |
| size | integer |  | No |
| source_url | string |  | No |

#### DatasetIconInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | No |

#### DatasetKeywordSetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_weight | number |  | No |

#### DatasetPermissionEnum

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| DatasetPermissionEnum | string |  |  |

#### DatasetQueryDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | object |  | No |
| created_by | string |  | No |
| created_by_role | string |  | No |
| id | string |  | No |
| queries | [DatasetContent](#datasetcontent) |  | No |
| source | string |  | No |
| source_app_id | string |  | No |

#### DatasetRerankingModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_model_name | string |  | No |
| reranking_provider_name | string |  | No |

#### DatasetResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| created_by |  |  | No |
| data_source_type |  |  | No |
| description |  |  | No |
| id | string |  | Yes |
| indexing_technique |  |  | No |
| name | string |  | Yes |
| permission |  |  | No |

#### DatasetRetrievalModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_enable | boolean |  | No |
| reranking_mode | string |  | No |
| reranking_model | [DatasetRerankingModel](#datasetrerankingmodel) |  | No |
| score_threshold | number |  | No |
| score_threshold_enabled | boolean |  | No |
| search_method | string |  | No |
| top_k | integer |  | No |
| weights | [DatasetWeightedScore](#datasetweightedscore) |  | No |

#### DatasetUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description |  |  | No |
| embedding_model |  |  | No |
| embedding_model_provider |  |  | No |
| external_knowledge_api_id |  |  | No |
| external_knowledge_id |  |  | No |
| external_retrieval_model |  |  | No |
| icon_info |  |  | No |
| indexing_technique |  |  | No |
| is_multimodal |  |  | No |
| name |  |  | No |
| partial_member_list |  |  | No |
| permission |  |  | No |
| retrieval_model |  |  | No |
| summary_index_setting |  |  | No |

#### DatasetVectorSetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string |  | No |
| embedding_provider_name | string |  | No |
| vector_weight | number |  | No |

#### DatasetWeightedScore

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_setting | [DatasetKeywordSetting](#datasetkeywordsetting) |  | No |
| vector_setting | [DatasetVectorSetting](#datasetvectorsetting) |  | No |
| weight_type | string |  | No |

#### DatasourceCredentialDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |

#### DatasourceCredentialPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| name |  |  | No |

#### DatasourceCredentialUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| credentials |  |  | No |
| name |  |  | No |

#### DatasourceCustomClientPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_params |  |  | No |
| enable_oauth_custom_client |  |  | No |

#### DatasourceDefaultPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |

#### DatasourceNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id |  |  | No |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |

#### DatasourceUpdateNamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| name | string |  | Yes |

#### DatasourceVariablesPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| datasource_info | object |  | Yes |
| datasource_type | string |  | Yes |
| start_node_id | string |  | Yes |
| start_node_title | string |  | Yes |

#### DebugPermission

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| DebugPermission | string |  |  |

#### DefaultBlockConfigQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| q |  |  | No |

#### DeletedTool

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| provider_id | string |  | Yes |
| tool_name | string |  | Yes |
| type | string |  | Yes |

#### DocumentBatchDownloadZipPayload

Request payload for bulk downloading documents as a zip archive.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_ids | [ string (uuid) ] |  | Yes |

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
| value |  |  | No |

#### DocumentMetadataUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_metadata |  |  | No |
| doc_type |  |  | No |

#### DocumentRenamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

#### DocumentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| archived |  |  | No |
| created_at |  |  | No |
| created_by |  |  | No |
| created_from |  |  | No |
| data_source_detail_dict |  |  | No |
| data_source_info_dict |  |  | No |
| data_source_type |  |  | No |
| dataset_process_rule_id |  |  | No |
| disabled_at |  |  | No |
| disabled_by |  |  | No |
| display_status |  |  | No |
| doc_form |  |  | No |
| doc_metadata_details | [ [DocumentMetadataResponse](#documentmetadataresponse) ] |  | No |
| enabled |  |  | No |
| error |  |  | No |
| hit_count |  |  | No |
| id | string |  | Yes |
| indexing_status |  |  | No |
| name | string |  | Yes |
| need_summary |  |  | No |
| position |  |  | No |
| summary_index_status |  |  | No |
| tokens |  |  | No |
| word_count |  |  | No |

#### DocumentRetryPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_ids | [ string ] |  | Yes |

#### DocumentWithSegmentsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| archived |  |  | No |
| completed_segments |  |  | No |
| created_at |  |  | No |
| created_by |  |  | No |
| created_from |  |  | No |
| data_source_detail_dict |  |  | No |
| data_source_info_dict |  |  | No |
| data_source_type |  |  | No |
| dataset_process_rule_id |  |  | No |
| disabled_at |  |  | No |
| disabled_by |  |  | No |
| display_status |  |  | No |
| doc_form |  |  | No |
| doc_metadata_details | [ [DocumentMetadataResponse](#documentmetadataresponse) ] |  | No |
| enabled |  |  | No |
| error |  |  | No |
| hit_count |  |  | No |
| id | string |  | Yes |
| indexing_status |  |  | No |
| name | string |  | Yes |
| need_summary |  |  | No |
| position |  |  | No |
| process_rule_dict |  |  | No |
| summary_index_status |  |  | No |
| tokens |  |  | No |
| total_segments |  |  | No |
| word_count |  |  | No |

#### DraftWorkflowNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files |  |  | No |
| inputs | object |  | Yes |
| query | string |  | No |

#### DraftWorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| datasource_info_list | [ object ] |  | Yes |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |
| start_node_id | string |  | Yes |

#### DraftWorkflowSyncPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables |  |  | No |
| environment_variables |  |  | No |
| features |  |  | No |
| graph | object |  | Yes |
| hash |  |  | No |
| rag_pipeline_variables |  |  | No |

#### DraftWorkflowTriggerRunAllPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_ids | [ string ] |  | Yes |

#### DraftWorkflowTriggerRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_id | string |  | Yes |

#### DraftWorkflowTriggerRunRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_id | string | Node ID | Yes |

#### EducationActivatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| institution | string |  | Yes |
| role | string |  | Yes |
| token | string |  | Yes |

#### EducationAutocompleteQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keywords | string |  | Yes |
| limit | integer |  | No |
| page | integer |  | No |

#### EducationAutocompleteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| curr_page |  |  | No |
| data | [ string ] |  | No |
| has_next |  |  | No |

#### EducationStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allow_refresh |  |  | No |
| expire_at |  |  | No |
| is_student |  |  | No |
| result |  |  | No |

#### EducationVerifyResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| token |  |  | No |

#### EmailCodeLoginPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| email | string |  | Yes |
| language |  |  | No |
| token | string |  | Yes |

#### EmailPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| language |  |  | No |

#### EmailRegisterResetPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_password | string |  | Yes |
| password_confirm | string |  | Yes |
| token | string |  | Yes |

#### EmailRegisterSendPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string | Email address | Yes |
| language |  | Language code | No |

#### EmailRegisterValidityPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| email | string |  | Yes |
| token | string |  | Yes |

#### EndpointCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| plugin_unique_identifier | string |  | Yes |
| settings | object |  | Yes |

#### EndpointCreateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| success | boolean | Operation success | Yes |

#### EndpointDeleteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| success | boolean | Operation success | Yes |

#### EndpointDisableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| success | boolean | Operation success | Yes |

#### EndpointEnableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| success | boolean | Operation success | Yes |

#### EndpointIdPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| endpoint_id | string |  | Yes |

#### EndpointListForPluginQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page | integer |  | Yes |
| page_size | integer |  | Yes |
| plugin_id | string |  | Yes |

#### EndpointListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page | integer |  | Yes |
| page_size | integer |  | Yes |

#### EndpointListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| endpoints | [ object ] | Endpoint information | Yes |

#### EndpointUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| settings | object |  | Yes |

#### EndpointUpdateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| success | boolean | Operation success | Yes |

#### EnvironmentVariableUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| environment_variables | [ object ] | Environment variables for the draft workflow | Yes |

#### ExecutionContentType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ExecutionContentType | string |  |  |

#### ExternalApiTemplateListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword |  | Search keyword | No |
| limit | integer | Number of items per page | No |
| page | integer | Page number | No |

#### ExternalDatasetCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description |  |  | No |
| external_knowledge_api_id | string |  | Yes |
| external_knowledge_id | string |  | Yes |
| external_retrieval_model |  |  | No |
| name | string |  | Yes |

#### ExternalHitTestingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| external_retrieval_model |  |  | No |
| metadata_filtering_conditions |  |  | No |
| query | string |  | Yes |

#### ExternalKnowledgeApiPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| settings | object |  | Yes |

#### ExternalKnowledgeInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| external_knowledge_api_endpoint | string |  | No |
| external_knowledge_api_id | string |  | No |
| external_knowledge_api_name | string |  | No |
| external_knowledge_id | string |  | No |

#### ExternalRetrievalModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| score_threshold | number |  | No |
| score_threshold_enabled | boolean |  | No |
| top_k | integer |  | No |

#### FeatureResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| features | object | Feature configuration object | No |

#### Feedback

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content |  |  | No |
| from_account |  |  | No |
| from_end_user_id |  |  | No |
| from_source | string |  | Yes |
| rating | string |  | Yes |

#### FeedbackExportQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| end_date |  | End date (YYYY-MM-DD) | No |
| format | string | Export format<br>*Enum:* `"csv"`, `"json"` | No |
| from_source |  | Filter by feedback source | No |
| has_comment |  | Only include feedback with comments | No |
| rating |  | Filter by rating | No |
| start_date |  | Start date (YYYY-MM-DD) | No |

#### FeedbackStat

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| dislike | integer |  | Yes |
| like | integer |  | Yes |

#### FileInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_ids | [ string ] |  | Yes |

#### FileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id |  |  | No |
| created_at |  |  | No |
| created_by |  |  | No |
| extension |  |  | No |
| file_key |  |  | No |
| id | string |  | Yes |
| mime_type |  |  | No |
| name | string |  | Yes |
| original_url |  |  | No |
| preview_url |  |  | No |
| size | integer |  | Yes |
| source_url |  |  | No |
| tenant_id |  |  | No |
| user_id |  |  | No |

#### ForgotPasswordCheckPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| email | string |  | Yes |
| token | string |  | Yes |

#### ForgotPasswordCheckResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string | Email address | Yes |
| is_valid | boolean | Whether code is valid | Yes |
| token | string | New reset token | Yes |

#### ForgotPasswordEmailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code |  | Error code if account not found | No |
| data |  | Reset token | No |
| result | string | Operation result | Yes |

#### ForgotPasswordResetPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_password | string |  | Yes |
| password_confirm | string |  | Yes |
| token | string |  | Yes |

#### ForgotPasswordResetResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Operation result | Yes |

#### ForgotPasswordSendPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| language |  |  | No |

#### FormInput

Form input definition.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default |  |  | No |
| output_variable_name | string |  | Yes |
| type | [FormInputType](#forminputtype) |  | Yes |

#### FormInputDefault

Default configuration for form inputs.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| selector | [ string ] |  | No |
| type | [PlaceholderType](#placeholdertype) |  | Yes |
| value | string |  | No |

#### FormInputType

Form input types.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FormInputType | string | Form input types. |  |

#### GenerateSummaryPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_list | [ string ] |  | Yes |

#### Github

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| github_plugin_unique_identifier | string |  | Yes |
| package | string |  | Yes |
| repo | string |  | Yes |
| version | string |  | Yes |

#### HitTestingChildChunk

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content |  |  | No |
| id |  |  | No |
| position |  |  | No |
| score |  |  | No |

#### HitTestingDocument

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data_source_type |  |  | No |
| doc_metadata |  |  | No |
| doc_type |  |  | No |
| id |  |  | No |
| name |  |  | No |

#### HitTestingFile

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| extension |  |  | No |
| id |  |  | No |
| mime_type |  |  | No |
| name |  |  | No |
| size |  |  | No |
| source_url |  |  | No |

#### HitTestingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachment_ids |  |  | No |
| external_retrieval_model |  |  | No |
| query | string |  | Yes |
| retrieval_model |  |  | No |

#### HitTestingRecord

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| child_chunks | [ [HitTestingChildChunk](#hittestingchildchunk) ] |  | No |
| files | [ [HitTestingFile](#hittestingfile) ] |  | No |
| score |  |  | No |
| segment |  |  | No |
| summary |  |  | No |
| tsne_position |  |  | No |

#### HitTestingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| query | string |  | Yes |
| records | [ [HitTestingRecord](#hittestingrecord) ] |  | No |

#### HitTestingSegment

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer |  |  | No |
| completed_at |  |  | No |
| content |  |  | No |
| created_at |  |  | No |
| created_by |  |  | No |
| disabled_at |  |  | No |
| disabled_by |  |  | No |
| document |  |  | No |
| document_id |  |  | No |
| enabled |  |  | No |
| error |  |  | No |
| hit_count |  |  | No |
| id |  |  | No |
| index_node_hash |  |  | No |
| index_node_id |  |  | No |
| indexing_at |  |  | No |
| keywords | [ string ] |  | No |
| position |  |  | No |
| sign_content |  |  | No |
| status |  |  | No |
| stopped_at |  |  | No |
| tokens |  |  | No |
| word_count |  |  | No |

#### HumanInputContent

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| form_definition |  |  | No |
| form_submission_data |  |  | No |
| submitted | boolean |  | Yes |
| type | [ExecutionContentType](#executioncontenttype) |  | No |
| workflow_run_id | string |  | Yes |

#### HumanInputDeliveryTestPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| delivery_method_id | string | Delivery method ID | Yes |
| inputs | object | Values used to fill missing upstream variables referenced in form_content | No |

#### HumanInputFormDefinition

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| actions | [ [UserAction](#useraction) ] |  | No |
| display_in_ui | boolean |  | No |
| expiration_time | integer |  | Yes |
| form_content | string |  | Yes |
| form_id | string |  | Yes |
| form_token |  |  | No |
| inputs | [ [FormInput](#forminput) ] |  | No |
| node_id | string |  | Yes |
| node_title | string |  | Yes |
| resolved_default_values | object |  | No |

#### HumanInputFormPreviewPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object | Values used to fill missing upstream variables referenced in form_content | No |

#### HumanInputFormSubmissionData

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action_id | string |  | Yes |
| action_text | string |  | Yes |
| node_id | string |  | Yes |
| node_title | string |  | Yes |
| rendered_content | string |  | Yes |

#### HumanInputFormSubmitPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string | Selected action ID | Yes |
| form_inputs | object | Values the user provides for the form's own fields | Yes |
| inputs | object | Values used to fill missing upstream variables referenced in form_content | Yes |

#### HumanInputPauseTypeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| backstage_input_url |  |  | No |
| form_id | string |  | Yes |
| type | string |  | Yes |

#### IconType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| IconType | string |  |  |

#### Import

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id |  |  | No |
| app_mode |  |  | No |
| current_dsl_version | string |  | No |
| error | string |  | No |
| id | string |  | Yes |
| imported_dsl_version | string |  | No |
| status | [ImportStatus](#importstatus) |  | Yes |

#### ImportStatus

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ImportStatus | string |  |  |

#### IncludeSecretQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| include_secret | string |  | No |

#### IndexingEstimatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| dataset_id |  |  | No |
| doc_form | string |  | No |
| doc_language | string |  | No |
| indexing_technique | string |  | Yes |
| info_list | object |  | Yes |
| process_rule | object |  | Yes |

#### InfoList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data_source_type | string | *Enum:* `"notion_import"`, `"upload_file"`, `"website_crawl"` | Yes |
| file_info_list |  |  | No |
| notion_info_list |  |  | No |
| website_info_list |  |  | No |

#### Inner

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model |  |  | No |
| model_type | [ModelType](#modeltype) |  | Yes |
| provider |  |  | No |

#### InstallPermission

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| InstallPermission | string |  |  |

#### InstalledAppCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |

#### InstalledAppInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon |  |  | No |
| icon_background |  |  | No |
| icon_type |  |  | No |
| id | string |  | Yes |
| mode |  |  | No |
| name |  |  | No |
| use_icon_as_answer_icon |  |  | No |

#### InstalledAppListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| installed_apps | [ [InstalledAppResponse](#installedappresponse) ] |  | Yes |

#### InstalledAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app | [InstalledAppInfoResponse](#installedappinforesponse) |  | Yes |
| app_owner_tenant_id | string |  | Yes |
| editable | boolean |  | Yes |
| id | string |  | Yes |
| is_pinned | boolean |  | Yes |
| last_used_at |  |  | No |
| uninstallable | boolean |  | Yes |

#### InstalledAppUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| is_pinned |  |  | No |

#### InstalledAppsListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id |  | App ID to filter by | No |

#### InstructionGeneratePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current | string | Current instruction text | No |
| flow_id | string | Workflow/Flow ID | Yes |
| ideal_output | string | Expected ideal output | No |
| instruction | string | Instruction for generation | Yes |
| language | string | Programming language (javascript/python) | No |
| model_config | [ModelConfig](#modelconfig) | Model configuration | Yes |
| node_id | string | Node ID for workflow context | No |

#### InstructionTemplatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| type | string | Instruction template type | Yes |

#### IterationNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs |  |  | No |

#### JSONValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JSONValue |  |  |  |

#### KnowledgeConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data_source |  |  | No |
| doc_form | string |  | No |
| doc_language | string |  | No |
| duplicate | boolean |  | No |
| embedding_model |  |  | No |
| embedding_model_provider |  |  | No |
| indexing_technique | string | *Enum:* `"economy"`, `"high_quality"` | Yes |
| is_multimodal | boolean |  | No |
| name |  |  | No |
| original_document_id |  |  | No |
| process_rule |  |  | No |
| retrieval_model |  |  | No |
| summary_index_setting |  |  | No |

#### LLMMode

Enum class for large language model mode.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| LLMMode | string | Enum class for large language model mode. |  |

#### LegacyEndpointUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| endpoint_id | string |  | Yes |
| name | string |  | Yes |
| settings | object |  | Yes |

#### LoadBalancingCredentialPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### LoadBalancingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| configs |  |  | No |
| enabled |  |  | No |

#### LoginPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| invite_token |  | Invitation token | No |
| password | string |  | Yes |
| remember_me | boolean | Remember me flag | No |

#### LoopNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs |  |  | No |

#### MCPAuthPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| authorization_code |  |  | No |
| provider_id | string |  | Yes |

#### MCPProviderCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| authentication |  |  | No |
| configuration |  |  | No |
| headers |  |  | No |
| icon | string |  | Yes |
| icon_background | string |  | No |
| icon_type | string |  | Yes |
| name | string |  | Yes |
| server_identifier | string |  | Yes |
| server_url | string |  | Yes |

#### MCPProviderDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| provider_id | string |  | Yes |

#### MCPProviderUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| authentication |  |  | No |
| configuration |  |  | No |
| headers |  |  | No |
| icon | string |  | Yes |
| icon_background | string |  | No |
| icon_type | string |  | Yes |
| name | string |  | Yes |
| provider_id | string |  | Yes |
| server_identifier | string |  | Yes |
| server_url | string |  | Yes |

#### MCPServerCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description |  | Server description | No |
| parameters | object | Server parameters configuration | Yes |

#### MCPServerUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description |  | Server description | No |
| id | string | Server ID | Yes |
| parameters | object | Server parameters configuration | Yes |
| status |  | Server status | No |

#### Marketplace

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| marketplace_plugin_unique_identifier | string |  | Yes |
| version |  |  | No |

#### MemberInvitePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| emails | [ string ] |  | No |
| language |  |  | No |
| role | [TenantAccountRole](#tenantaccountrole) |  | Yes |

#### MemberRoleUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| role | string |  | Yes |

#### MessageDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_thoughts | [ [AgentThought](#agentthought) ] |  | Yes |
| annotation |  |  | No |
| annotation_hit_history |  |  | No |
| answer_tokens | integer |  | Yes |
| conversation_id | string |  | Yes |
| created_at |  |  | No |
| error |  |  | No |
| feedbacks | [ [Feedback](#feedback) ] |  | Yes |
| from_account_id |  |  | No |
| from_end_user_id |  |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| inputs | object |  | Yes |
| message | [JSONValue](#jsonvalue) |  | Yes |
| message_files | [ [MessageFile](#messagefile) ] |  | Yes |
| message_metadata_dict | [JSONValue](#jsonvalue) |  | Yes |
| message_tokens | integer |  | Yes |
| parent_message_id |  |  | No |
| provider_response_latency | number |  | Yes |
| query | string |  | Yes |
| re_sign_file_url_answer | string |  | Yes |
| status | string |  | Yes |
| workflow_run_id |  |  | No |

#### MessageDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_thoughts | [ [AgentThought](#agentthought) ] |  | No |
| annotation |  |  | No |
| annotation_hit_history |  |  | No |
| answer_tokens |  |  | No |
| conversation_id | string |  | Yes |
| created_at |  |  | No |
| error |  |  | No |
| extra_contents | [ [HumanInputContent](#humaninputcontent) ] |  | No |
| feedbacks | [ [Feedback](#feedback) ] |  | No |
| from_account_id |  |  | No |
| from_end_user_id |  |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| inputs | object |  | Yes |
| message |  |  | No |
| message_files | [ [MessageFile](#messagefile) ] |  | No |
| message_metadata_dict |  |  | No |
| message_tokens |  |  | No |
| parent_message_id |  |  | No |
| provider_response_latency |  |  | No |
| query | string |  | Yes |
| re_sign_file_url_answer | string |  | Yes |
| status | string |  | Yes |
| workflow_run_id |  |  | No |

#### MessageFeedbackPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content |  |  | No |
| message_id | string | Message ID | Yes |
| rating |  |  | No |

#### MessageFile

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| belongs_to |  |  | No |
| filename | string |  | Yes |
| id | string |  | Yes |
| mime_type |  |  | No |
| size |  |  | No |
| transfer_method | string |  | Yes |
| type | string |  | Yes |
| upload_file_id |  |  | No |
| url |  |  | No |

#### MessageInfiniteScrollPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [MessageDetailResponse](#messagedetailresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### MessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation UUID | Yes |
| first_id |  | First message ID for pagination | No |
| limit | integer | Number of messages to return (1-100) | No |

#### MetadataArgs

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| type | string | *Enum:* `"number"`, `"string"`, `"time"` | Yes |

#### MetadataDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| value |  |  | No |

#### MetadataFilteringCondition

Metadata Filtering Condition.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conditions |  |  | No |
| logical_operator |  |  | No |

#### MetadataOperationData

Metadata operation data

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| operation_data | [ [DocumentMetadataOperation](#documentmetadataoperation) ] |  | Yes |

#### MetadataUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

#### ModelConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| completion_params | object |  | No |
| mode | [LLMMode](#llmmode) |  | Yes |
| name | string |  | Yes |
| provider | string |  | Yes |

#### ModelConfigPartial

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| created_by |  |  | No |
| model_dict |  |  | No |
| pre_prompt |  |  | No |
| updated_at |  |  | No |
| updated_by |  |  | No |

#### ModelConfigRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_mode |  | Agent mode configuration | No |
| configs |  | Model configuration parameters | No |
| dataset_configs |  | Dataset configurations | No |
| model |  | Model name | No |
| more_like_this |  | More like this configuration | No |
| opening_statement |  | Opening statement | No |
| provider |  | Model provider | No |
| retrieval_model |  | Retrieval model configuration | No |
| speech_to_text |  | Speech to text configuration | No |
| suggested_questions |  | Suggested questions | No |
| text_to_speech |  | Text to speech configuration | No |
| tools |  | Available tools | No |

#### ModelType

Enum class for model type.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelType | string | Enum class for model type. |  |

#### MoreLikeThisQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| response_mode | string | *Enum:* `"blocking"`, `"streaming"` | Yes |

#### NodeIdQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_id | string |  | Yes |

#### NodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs |  |  | No |

#### NodeRunRequiredPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object |  | Yes |

#### NotionEstimatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_form | string |  | No |
| doc_language | string |  | No |
| notion_info_list | [ object ] |  | Yes |
| process_rule | object |  | Yes |

#### NotionIcon

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| emoji |  |  | No |
| type | string |  | Yes |
| url |  |  | No |

#### NotionInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| pages | [ [NotionPage](#notionpage) ] |  | Yes |
| workspace_id | string |  | Yes |

#### NotionIntegrateInfoList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| notion_info | [ [NotionIntegrateWorkspace](#notionintegrateworkspace) ] |  | No |

#### NotionIntegratePage

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| is_bound | boolean |  | No |
| page_icon | [DataSourceIntegrateIcon](#datasourceintegrateicon) |  | No |
| page_id | string |  | No |
| page_name | string |  | No |
| parent_id | string |  | No |
| type | string |  | No |

#### NotionIntegrateWorkspace

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| pages | [ [NotionIntegratePage](#notionintegratepage) ] |  | No |
| workspace_icon | string |  | No |
| workspace_id | string |  | No |
| workspace_name | string |  | No |

#### NotionPage

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page_icon |  |  | No |
| page_id | string |  | Yes |
| page_name | string |  | Yes |
| type | string |  | Yes |

#### OAuthDataSourceBindingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Operation result | Yes |

#### OAuthDataSourceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string | Authorization URL or 'internal' for internal setup | Yes |

#### OAuthDataSourceSyncResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Operation result | Yes |

#### OwnerTransferCheckPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| token | string |  | Yes |

#### OwnerTransferEmailPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language |  |  | No |

#### OwnerTransferPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| token | string |  | Yes |

#### Package

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_unique_identifier | string |  | Yes |
| version |  |  | No |

#### PaginatedConversationVariableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ConversationVariableResponse](#conversationvariableresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### Parser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id |  |  | No |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |

#### ParserAsset

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_name | string |  | Yes |
| plugin_unique_identifier | string |  | Yes |

#### ParserCreateCredential

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |
| name |  |  | No |

#### ParserCredentialCreate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| name |  |  | No |

#### ParserCredentialDelete

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |

#### ParserCredentialId

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id |  |  | No |

#### ParserCredentialSwitch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |

#### ParserCredentialUpdate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| credentials | object |  | Yes |
| name |  |  | No |

#### ParserCredentialValidate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |

#### ParserDeleteCredential

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### ParserDeleteModels

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### ParserDynamicOptions

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string |  | Yes |
| credential_id |  |  | No |
| parameter | string |  | Yes |
| plugin_id | string |  | Yes |
| provider | string |  | Yes |
| provider_type | string | *Enum:* `"tool"`, `"trigger"` | Yes |

#### ParserDynamicOptionsWithCredentials

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string |  | Yes |
| credential_id | string |  | Yes |
| credentials | object |  | Yes |
| parameter | string |  | Yes |
| plugin_id | string |  | Yes |
| provider | string |  | Yes |

#### ParserEnable

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enable_trigger | boolean |  | Yes |
| trigger_id | string |  | Yes |

#### ParserExcludePlugin

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_id | string |  | Yes |

#### ParserGetCredentials

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| config_from |  |  | No |
| credential_id |  |  | No |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### ParserGetDefault

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model_type | [ModelType](#modeltype) |  | Yes |

#### ParserGithubInstall

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| package | string |  | Yes |
| plugin_unique_identifier | string |  | Yes |
| repo | string |  | Yes |
| version | string |  | Yes |

#### ParserGithubUpgrade

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_plugin_unique_identifier | string |  | Yes |
| original_plugin_unique_identifier | string |  | Yes |
| package | string |  | Yes |
| repo | string |  | Yes |
| version | string |  | Yes |

#### ParserGithubUpload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| package | string |  | Yes |
| repo | string |  | Yes |
| version | string |  | Yes |

#### ParserIcon

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| filename | string |  | Yes |
| tenant_id | string |  | Yes |

#### ParserLatest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_ids | [ string ] |  | Yes |

#### ParserList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page | integer | Page number | No |
| page_size | integer | Page size (1-256) | No |

#### ParserMarketplaceUpgrade

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_plugin_unique_identifier | string |  | Yes |
| original_plugin_unique_identifier | string |  | Yes |

#### ParserModelList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model_type |  |  | No |

#### ParserParameter

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string |  | Yes |

#### ParserPermissionChange

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| debug_permission | [DebugPermission](#debugpermission) |  | Yes |
| install_permission | [InstallPermission](#installpermission) |  | Yes |

#### ParserPluginIdentifierQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_unique_identifier | string |  | Yes |

#### ParserPluginIdentifiers

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_unique_identifiers | [ string ] |  | Yes |

#### ParserPostDefault

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model_settings | [ [Inner](#inner) ] |  | Yes |

#### ParserPostModels

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| config_from |  |  | No |
| credential_id |  |  | No |
| load_balancing |  |  | No |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### ParserPreferencesChange

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_upgrade | [PluginAutoUpgradeSettingsPayload](#pluginautoupgradesettingspayload) |  | Yes |
| permission | [PluginPermissionSettingsPayload](#pluginpermissionsettingspayload) |  | Yes |

#### ParserPreferredProviderType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| preferred_provider_type | string | *Enum:* `"custom"`, `"system"` | Yes |

#### ParserReadme

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language | string |  | No |
| plugin_unique_identifier | string |  | Yes |

#### ParserSwitch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### ParserTasks

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page | integer | Page number | No |
| page_size | integer | Page size (1-256) | No |

#### ParserUninstall

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_installation_id | string |  | Yes |

#### ParserUpdateCredential

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| credentials | object |  | Yes |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |
| name |  |  | No |

#### ParserValidate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### PartnerTenantsPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| click_id | string | Click Id from partner referral link | Yes |

#### PausedNodeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_id | string |  | Yes |
| node_title | string |  | Yes |
| pause_type | [HumanInputPauseTypeResponse](#humaninputpausetyperesponse) |  | Yes |

#### Payload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| icon_info |  |  | No |
| name | string |  | Yes |

#### PipelineVariable

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allow_file_extension | [ string ] |  | No |
| allow_file_upload_methods | [ string ] |  | No |
| allowed_file_types | [ string ] |  | No |
| belong_to_node_id | string |  | No |
| default_value | object |  | No |
| label | string |  | No |
| max_length | integer |  | No |
| options | [ string ] |  | No |
| placeholder | string |  | No |
| required | boolean |  | No |
| tooltips | string |  | No |
| type | string |  | No |
| unit | string |  | No |
| variable | string |  | No |

#### PlaceholderType

Default value types for form inputs.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PlaceholderType | string | Default value types for form inputs. |  |

#### PluginAutoUpgradeSettingsPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| exclude_plugins | [ string ] |  | No |
| include_plugins | [ string ] |  | No |
| strategy_setting | [StrategySetting](#strategysetting) |  | No |
| upgrade_mode | [UpgradeMode](#upgrademode) |  | No |
| upgrade_time_of_day | integer |  | No |

#### PluginDependency

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current_identifier |  |  | No |
| type | [Type](#type) |  | Yes |
| value |  |  | Yes |

#### PluginEndpointListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| endpoints | [ object ] | Endpoint information | Yes |

#### PluginPermissionSettingsPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| debug_permission | [DebugPermission](#debugpermission) |  | No |
| install_permission | [InstallPermission](#installpermission) |  | No |

#### PreProcessingRule

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | Yes |
| id | string |  | Yes |

#### ProcessRule

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| mode | string | *Enum:* `"automatic"`, `"custom"`, `"hierarchical"` | Yes |
| rules |  |  | No |

#### PublishWorkflowPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| marked_comment |  |  | No |
| marked_name |  |  | No |

#### PublishedWorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| datasource_info_list | [ object ] |  | Yes |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |
| is_preview | boolean |  | No |
| original_document_id |  |  | No |
| response_mode | string | *Enum:* `"blocking"`, `"streaming"` | No |
| start_node_id | string |  | Yes |

#### RagPipelineDatasetImportPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| yaml_content | string |  | Yes |

#### RagPipelineImport

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current_dsl_version | string |  | No |
| dataset_id | string |  | No |
| error | string |  | No |
| id | string |  | No |
| imported_dsl_version | string |  | No |
| pipeline_id | string |  | No |
| status | string |  | No |

#### RagPipelineImportCheckDependencies

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| leaked_dependencies | [ [RagPipelineLeakedDependency](#ragpipelineleakeddependency) ] |  | No |

#### RagPipelineImportPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description |  |  | No |
| icon |  |  | No |
| icon_background |  |  | No |
| icon_type |  |  | No |
| mode | string |  | Yes |
| name |  |  | No |
| pipeline_id |  |  | No |
| yaml_content |  |  | No |
| yaml_url |  |  | No |

#### RagPipelineLeakedDependency

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current_identifier | string |  | No |
| type | string |  | No |
| value | object |  | No |

#### RagPipelineRecommendedPluginQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| type | string |  | No |

#### RecommendedAppInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon |  |  | No |
| icon_background |  |  | No |
| icon_type |  |  | No |
| id | string |  | Yes |
| mode |  |  | No |
| name |  |  | No |

#### RecommendedAppListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| categories | [ string ] |  | Yes |
| recommended_apps | [ [RecommendedAppResponse](#recommendedappresponse) ] |  | Yes |

#### RecommendedAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app |  |  | No |
| app_id | string |  | Yes |
| can_trial |  |  | No |
| categories | [ string ] |  | No |
| copyright |  |  | No |
| custom_disclaimer |  |  | No |
| description |  |  | No |
| is_listed |  |  | No |
| position |  |  | No |
| privacy_policy |  |  | No |

#### RecommendedAppsQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language |  | Language code for recommended app localization | No |

#### RelatedAppList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AppDetailKernel](#appdetailkernel) ] |  | No |
| total | integer |  | No |

#### RerankingModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_model_name |  |  | No |
| reranking_provider_name |  |  | No |

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
| metadata_filtering_conditions |  |  | No |
| reranking_enable | boolean |  | Yes |
| reranking_mode |  |  | No |
| reranking_model |  |  | No |
| score_threshold |  |  | No |
| score_threshold_enabled | boolean |  | Yes |
| search_method | [RetrievalMethod](#retrievalmethod) |  | Yes |
| top_k | integer |  | Yes |
| weights |  |  | No |

#### Rule

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| parent_mode |  |  | No |
| pre_processing_rules |  |  | No |
| segmentation |  |  | No |
| subchunk_segmentation |  |  | No |

#### RuleCodeGeneratePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code_language | string | Programming language for code generation | No |
| instruction | string | Rule generation instruction | Yes |
| model_config | [ModelConfig](#modelconfig) | Model configuration | Yes |
| no_variable | boolean | Whether to exclude variables | No |

#### RuleGeneratePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| instruction | string | Rule generation instruction | Yes |
| model_config | [ModelConfig](#modelconfig) | Model configuration | Yes |
| no_variable | boolean | Whether to exclude variables | No |

#### RuleStructuredOutputPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| instruction | string | Structured output generation instruction | Yes |
| model_config | [ModelConfig](#modelconfig) | Model configuration | Yes |

#### SavedMessageCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string |  | Yes |

#### SavedMessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id |  |  | No |
| limit | integer |  | No |

#### SegmentCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer |  |  | No |
| attachment_ids |  |  | No |
| content | string |  | Yes |
| keywords |  |  | No |

#### SegmentListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | string |  | No |
| hit_count_gte |  |  | No |
| keyword |  |  | No |
| limit | integer |  | No |
| page | integer |  | No |
| status | [ string ] |  | No |

#### SegmentUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer |  |  | No |
| attachment_ids |  |  | No |
| content | string |  | Yes |
| keywords |  |  | No |
| regenerate_child_chunks | boolean |  | No |
| summary |  |  | No |

#### Segmentation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chunk_overlap | integer |  | No |
| max_tokens | integer |  | Yes |
| separator | string |  | No |

#### SimpleAccount

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
| session_id |  |  | No |
| type | string |  | Yes |

#### SimpleMessageDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | Yes |
| inputs | object |  | Yes |
| message | string |  | Yes |
| query | string |  | Yes |

#### SimpleModelConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model_dict |  |  | No |
| pre_prompt |  |  | No |

#### Site

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_base_url |  |  | No |
| chat_color_theme |  |  | No |
| chat_color_theme_inverted |  |  | No |
| code |  |  | No |
| copyright |  |  | No |
| created_at |  |  | No |
| created_by |  |  | No |
| custom_disclaimer |  |  | No |
| customize_domain |  |  | No |
| customize_token_strategy |  |  | No |
| default_language |  |  | No |
| description |  |  | No |
| icon |  |  | No |
| icon_background |  |  | No |
| icon_type |  |  | No |
| privacy_policy |  |  | No |
| prompt_public |  |  | No |
| show_workflow_steps |  |  | No |
| title |  |  | No |
| updated_at |  |  | No |
| updated_by |  |  | No |
| use_icon_as_answer_icon |  |  | No |

#### StatisticTimeRangeQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| end |  | End date (YYYY-MM-DD HH:MM) | No |
| start |  | Start date (YYYY-MM-DD HH:MM) | No |

#### StatusCount

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| failed | integer |  | Yes |
| partial_success | integer |  | Yes |
| paused | integer |  | Yes |
| success | integer |  | Yes |

#### StrategySetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| StrategySetting | string |  |  |

#### SubscriptionQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| interval | string | Billing interval<br>*Enum:* `"month"`, `"year"` | Yes |
| plan | string | Subscription plan<br>*Enum:* `"professional"`, `"team"` | Yes |

#### SuggestedQuestionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ string ] | Suggested question | Yes |

#### SwitchWorkspacePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tenant_id | string |  | Yes |

#### SyncDraftWorkflowPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables | [ object ] |  | No |
| environment_variables | [ object ] |  | No |
| features | object |  | Yes |
| graph | object |  | Yes |
| hash |  |  | No |

#### SyncDraftWorkflowResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| hash | string |  | No |
| result | string |  | No |
| updated_at | string |  | No |

#### SystemFeatureResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| features | object | System feature configuration object | No |

#### Tag

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### TagBasePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string | Tag name | Yes |
| type | [TagType](#tagtype) |  | Yes |

#### TagBindingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tag_ids | [ string ] | Tag IDs to bind | Yes |
| target_id | string | Target ID to bind tags to | Yes |
| type | [TagType](#tagtype) |  | Yes |

#### TagBindingRemovePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tag_ids | [ string ] | Tag IDs to remove | Yes |
| target_id | string | Target ID to unbind tag from | Yes |
| type | [TagType](#tagtype) |  | Yes |

#### TagListQueryParam

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword |  | Search keyword | No |
| type | string | Tag type filter<br>*Enum:* `""`, `"app"`, `"knowledge"` | No |

#### TagResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binding_count |  |  | No |
| id | string |  | Yes |
| name | string |  | Yes |
| type |  |  | No |

#### TagType

Tag type

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TagType | string | Tag type |  |

#### TenantAccountRole

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TenantAccountRole | string |  |  |

#### TenantInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| custom_config |  |  | No |
| id | string |  | Yes |
| in_trial |  |  | No |
| name |  |  | No |
| next_credit_reset_date |  |  | No |
| plan |  |  | No |
| role |  |  | No |
| status |  |  | No |
| trial_credits |  |  | No |
| trial_credits_used |  |  | No |
| trial_end_reason |  |  | No |

#### TextToAudioPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id |  | Message ID | No |
| streaming |  | Enable streaming response | No |
| text |  | Text to convert to audio | No |
| voice |  | Voice to use for TTS | No |

#### TextToSpeechPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id |  | Message ID | No |
| streaming |  | Whether to stream audio | No |
| text | string | Text to convert | Yes |
| voice |  | Voice name | No |

#### TextToSpeechRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id |  |  | No |
| streaming |  |  | No |
| text |  |  | No |
| voice |  |  | No |

#### TextToSpeechVoiceQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language | string | Language code | Yes |

#### ToolOAuthCustomClientPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_params |  |  | No |
| enable_oauth_custom_client |  |  | No |

#### ToolParameterForm

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ToolParameterForm | string |  |  |

#### TraceConfigPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tracing_config | object | Tracing configuration data | Yes |
| tracing_provider | string | Tracing provider name | Yes |

#### TraceProviderQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tracing_provider | string | Tracing provider name | Yes |

#### TrialAppDetailWithSite

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode | string |  | No |
| api_base_url | string |  | No |
| created_at | object |  | No |
| created_by | string |  | No |
| deleted_tools | [ [TrialDeletedTool](#trialdeletedtool) ] |  | No |
| description | string |  | No |
| enable_api | boolean |  | No |
| enable_site | boolean |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | object |  | No |
| id | string |  | No |
| max_active_requests | integer |  | No |
| mode | string |  | No |
| model_config | [TrialAppModelConfig](#trialappmodelconfig) |  | No |
| name | string |  | No |
| site | [TrialSite](#trialsite) |  | No |
| tags | [ [TrialTag](#trialtag) ] |  | No |
| updated_at | object |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |
| workflow | [TrialWorkflowPartial](#trialworkflowpartial) |  | No |

#### TrialAppModelConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_mode | object |  | No |
| annotation_reply | object |  | No |
| chat_prompt_config | object |  | No |
| completion_prompt_config | object |  | No |
| created_at | object |  | No |
| created_by | string |  | No |
| dataset_configs | object |  | No |
| dataset_query_variable | string |  | No |
| external_data_tools | object |  | No |
| file_upload | object |  | No |
| model | object |  | No |
| more_like_this | object |  | No |
| opening_statement | string |  | No |
| pre_prompt | string |  | No |
| prompt_type | string |  | No |
| retriever_resource | object |  | No |
| sensitive_word_avoidance | object |  | No |
| speech_to_text | object |  | No |
| suggested_questions | object |  | No |
| suggested_questions_after_answer | object |  | No |
| text_to_speech | object |  | No |
| updated_at | object |  | No |
| updated_by | string |  | No |
| user_input_form | object |  | No |

#### TrialConversationVariable

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | No |
| name | string |  | No |
| value | object |  | No |
| value_type | string |  | No |

#### TrialDeletedTool

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| provider_id | string |  | No |
| tool_name | string |  | No |
| type | string |  | No |

#### TrialPipelineVariable

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allow_file_extension | [ string ] |  | No |
| allow_file_upload_methods | [ string ] |  | No |
| allowed_file_types | [ string ] |  | No |
| belong_to_node_id | string |  | No |
| default_value | object |  | No |
| label | string |  | No |
| max_length | integer |  | No |
| options | [ string ] |  | No |
| placeholder | string |  | No |
| required | boolean |  | No |
| tooltips | string |  | No |
| type | string |  | No |
| unit | string |  | No |
| variable | string |  | No |

#### TrialSimpleAccount

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | No |
| id | string |  | No |
| name | string |  | No |

#### TrialSite

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | No |
| app_base_url | string |  | No |
| chat_color_theme | string |  | No |
| chat_color_theme_inverted | boolean |  | No |
| code | string |  | No |
| copyright | string |  | No |
| created_at | object |  | No |
| created_by | string |  | No |
| custom_disclaimer | string |  | No |
| customize_domain | string |  | No |
| customize_token_strategy | string |  | No |
| default_language | string |  | No |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | object |  | No |
| privacy_policy | string |  | No |
| prompt_public | boolean |  | No |
| show_workflow_steps | boolean |  | No |
| title | string |  | No |
| updated_at | object |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |

#### TrialTag

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | No |
| name | string |  | No |
| type | string |  | No |

#### TrialWorkflow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables | [ [TrialConversationVariable](#trialconversationvariable) ] |  | No |
| created_at | object |  | No |
| created_by | [TrialSimpleAccount](#trialsimpleaccount) |  | No |
| environment_variables | [ object ] |  | No |
| features | object |  | No |
| graph | object |  | No |
| hash | string |  | No |
| id | string |  | No |
| marked_comment | string |  | No |
| marked_name | string |  | No |
| rag_pipeline_variables | [ [TrialPipelineVariable](#trialpipelinevariable) ] |  | No |
| tool_published | boolean |  | No |
| updated_at | object |  | No |
| updated_by | [TrialSimpleAccount](#trialsimpleaccount) |  | No |
| version | string |  | No |

#### TrialWorkflowPartial

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | object |  | No |
| created_by | string |  | No |
| id | string |  | No |
| updated_at | object |  | No |
| updated_by | string |  | No |

#### TriggerOAuthClientPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_params |  |  | No |
| enabled |  |  | No |

#### TriggerSubscriptionBuilderCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_type | string |  | No |

#### TriggerSubscriptionBuilderUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials |  |  | No |
| name |  |  | No |
| parameters |  |  | No |
| properties |  |  | No |

#### TriggerSubscriptionBuilderVerifyPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |

#### Type

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| Type | string |  |  |

#### UpdateAnnotationPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_reply |  |  | No |
| answer |  |  | No |
| content |  |  | No |
| question |  |  | No |

#### UpdateAppPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description |  | App description (max 400 chars) | No |
| icon |  | Icon | No |
| icon_background |  | Icon background color | No |
| icon_type |  | Icon type | No |
| max_active_requests |  | Maximum active requests | No |
| name | string | App name | Yes |
| use_icon_as_answer_icon |  | Use icon as answer icon | No |

#### UpgradeMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| UpgradeMode | string |  |  |

#### UploadConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachment_image_file_size_limit |  |  | No |
| audio_file_size_limit | integer |  | Yes |
| batch_count_limit | integer |  | Yes |
| file_size_limit | integer |  | Yes |
| file_upload_limit |  |  | No |
| image_file_batch_limit | integer |  | Yes |
| image_file_size_limit | integer |  | Yes |
| single_chunk_attachment_limit | integer |  | Yes |
| video_file_size_limit | integer |  | Yes |
| workflow_file_upload_limit | integer |  | Yes |

#### UserAction

User action configuration.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| button_style | [ButtonStyle](#buttonstyle) |  | No |
| id | string |  | Yes |
| title | string |  | Yes |

#### WebhookTriggerResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| id | string |  | Yes |
| node_id | string |  | Yes |
| webhook_debug_url | string |  | Yes |
| webhook_id | string |  | Yes |
| webhook_url | string |  | Yes |

#### WebsiteCrawlPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| options | object |  | Yes |
| provider | string | *Enum:* `"firecrawl"`, `"jinareader"`, `"watercrawl"` | Yes |
| url | string |  | Yes |

#### WebsiteCrawlStatusQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| provider | string | *Enum:* `"firecrawl"`, `"jinareader"`, `"watercrawl"` | Yes |

#### WebsiteInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| job_id | string |  | Yes |
| only_main_content | boolean |  | No |
| provider | string |  | Yes |
| urls | [ string ] |  | Yes |

#### WeightKeywordSetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_weight | number |  | Yes |

#### WeightModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_setting |  |  | No |
| vector_setting |  |  | No |
| weight_type |  |  | No |

#### WeightVectorSetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string |  | Yes |
| embedding_provider_name | string |  | Yes |
| vector_weight | number |  | Yes |

#### Workflow

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables | [ [ConversationVariable](#conversationvariable) ] |  | No |
| created_at | object |  | No |
| created_by | [SimpleAccount](#simpleaccount) |  | No |
| environment_variables | [ object ] |  | No |
| features | object |  | No |
| graph | object |  | No |
| hash | string |  | No |
| id | string |  | No |
| marked_comment | string |  | No |
| marked_name | string |  | No |
| rag_pipeline_variables | [ [PipelineVariable](#pipelinevariable) ] |  | No |
| tool_published | boolean |  | No |
| updated_at | object |  | No |
| updated_by | [SimpleAccount](#simpleaccount) |  | No |
| version | string |  | No |

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
| created_at |  |  | No |
| created_by_account |  |  | No |
| created_by_end_user |  |  | No |
| created_by_role |  |  | No |
| created_from |  |  | No |
| details |  |  | No |
| id | string |  | Yes |
| workflow_run |  |  | No |

#### WorkflowAppLogQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at__after |  | Filter logs created after this timestamp | No |
| created_at__before |  | Filter logs created before this timestamp | No |
| created_by_account |  | Filter by account | No |
| created_by_end_user_session_id |  | Filter by end user session ID | No |
| detail | boolean | Whether to return detailed logs | No |
| keyword |  | Search keyword for filtering logs | No |
| limit | integer | Number of items per page (1-100) | No |
| page | integer | Page number (1-99999) | No |
| status |  | Execution status filter (succeeded, failed, stopped, partial-succeeded) | No |

#### WorkflowArchivedLogPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowArchivedLogPartialResponse](#workflowarchivedlogpartialresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### WorkflowArchivedLogPartialResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| created_by_account |  |  | No |
| created_by_end_user |  |  | No |
| id | string |  | Yes |
| trigger_metadata |  |  | No |
| workflow_run |  |  | No |

#### WorkflowCommentAccount

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar_url |  |  | Yes |
| email | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |

#### WorkflowCommentBasic

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |
| created_at |  |  | No |
| created_by | string |  | Yes |
| created_by_account |  |  | No |
| id | string |  | Yes |
| mention_count | integer |  | Yes |
| participants | [ [WorkflowCommentAccount](#workflowcommentaccount) ] |  | Yes |
| position_x | number |  | Yes |
| position_y | number |  | Yes |
| reply_count | integer |  | Yes |
| resolved | boolean |  | Yes |
| resolved_at |  |  | No |
| resolved_by |  |  | No |
| resolved_by_account |  |  | No |
| updated_at |  |  | No |

#### WorkflowCommentBasicList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowCommentBasic](#workflowcommentbasic) ] |  | Yes |

#### WorkflowCommentCreate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| id | string |  | Yes |

#### WorkflowCommentCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Comment content | Yes |
| mentioned_user_ids | [ string ] | Mentioned user IDs | No |
| position_x | number | Comment X position | Yes |
| position_y | number | Comment Y position | Yes |

#### WorkflowCommentDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |
| created_at |  |  | No |
| created_by | string |  | Yes |
| created_by_account |  |  | No |
| id | string |  | Yes |
| mentions | [ [WorkflowCommentMention](#workflowcommentmention) ] |  | Yes |
| position_x | number |  | Yes |
| position_y | number |  | Yes |
| replies | [ [WorkflowCommentReply](#workflowcommentreply) ] |  | Yes |
| resolved | boolean |  | Yes |
| resolved_at |  |  | No |
| resolved_by |  |  | No |
| resolved_by_account |  |  | No |
| updated_at |  |  | No |

#### WorkflowCommentMention

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| mentioned_user_account |  |  | No |
| mentioned_user_id | string |  | Yes |
| reply_id |  |  | No |

#### WorkflowCommentMentionUsersPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| users | [ [AccountWithRole](#accountwithrole) ] |  | Yes |

#### WorkflowCommentReply

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |
| created_at |  |  | No |
| created_by | string |  | Yes |
| created_by_account |  |  | No |
| id | string |  | Yes |

#### WorkflowCommentReplyCreate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| id | string |  | Yes |

#### WorkflowCommentReplyPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Reply content | Yes |
| mentioned_user_ids | [ string ] | Mentioned user IDs | No |

#### WorkflowCommentReplyUpdate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| updated_at |  |  | No |

#### WorkflowCommentResolve

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| resolved | boolean |  | Yes |
| resolved_at |  |  | No |
| resolved_by |  |  | No |

#### WorkflowCommentUpdate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| updated_at |  |  | No |

#### WorkflowCommentUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Comment content | Yes |
| mentioned_user_ids |  | Mentioned user IDs. Omit to keep existing mentions. | No |
| position_x |  | Comment X position | No |
| position_y |  | Comment Y position | No |

#### WorkflowDraftEnvVariable

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| edited | boolean |  | No |
| id | string |  | No |
| name | string |  | No |
| selector | [ string ] |  | No |
| type | string |  | No |
| value_type | string |  | No |
| visible | boolean |  | No |

#### WorkflowDraftEnvVariableList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [WorkflowDraftEnvVariable](#workflowdraftenvvariable) ] |  | No |

#### WorkflowDraftVariable

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| edited | boolean |  | No |
| full_content | object |  | No |
| id | string |  | No |
| is_truncated | boolean |  | No |
| name | string |  | No |
| selector | [ string ] |  | No |
| type | string |  | No |
| value | object |  | No |
| value_type | string |  | No |
| visible | boolean |  | No |

#### WorkflowDraftVariableList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [WorkflowDraftVariable](#workflowdraftvariable) ] |  | No |

#### WorkflowDraftVariableListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer | Items per page | No |
| page | integer | Page number | No |

#### WorkflowDraftVariableListWithoutValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [WorkflowDraftVariableWithoutValue](#workflowdraftvariablewithoutvalue) ] |  | No |
| total | object |  | No |

#### WorkflowDraftVariablePatchPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name |  |  | No |
| value |  |  | No |

#### WorkflowDraftVariableUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name |  | Variable name | No |
| value |  | Variable value | No |

#### WorkflowDraftVariableWithoutValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| edited | boolean |  | No |
| id | string |  | No |
| is_truncated | boolean |  | No |
| name | string |  | No |
| selector | [ string ] |  | No |
| type | string |  | No |
| value_type | string |  | No |
| visible | boolean |  | No |

#### WorkflowExecutionStatus

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| WorkflowExecutionStatus | string |  |  |

#### WorkflowFeaturesPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| features | object | Workflow feature configuration | Yes |

#### WorkflowListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer |  | No |
| named_only | boolean |  | No |
| page | integer |  | No |
| user_id |  |  | No |

#### WorkflowOnlineUsersPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_ids | [ string ] | App IDs | No |

#### WorkflowPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| has_more | boolean |  | No |
| items | [ [Workflow](#workflow) ] |  | No |
| limit | integer |  | No |
| page | integer |  | No |

#### WorkflowPartial

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| created_by |  |  | No |
| id | string |  | Yes |
| updated_at |  |  | No |
| updated_by |  |  | No |

#### WorkflowPauseDetailsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| paused_at |  |  | No |
| paused_nodes | [ [PausedNodeResponse](#pausednoderesponse) ] |  | Yes |

#### WorkflowRunCountQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| status |  | Workflow run status filter | No |
| time_range |  | Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), 30m (30 minutes), 30s (30 seconds). Filters by created_at field. | No |
| triggered_from |  | Filter by trigger source: debugging or app-run. Default: debugging | No |

#### WorkflowRunCountResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| failed | integer |  | Yes |
| partial_succeeded | integer |  | Yes |
| running | integer |  | Yes |
| stopped | integer |  | Yes |
| succeeded | integer |  | Yes |
| total | integer |  | Yes |

#### WorkflowRunDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| created_by_account |  |  | No |
| created_by_end_user |  |  | No |
| created_by_role |  |  | No |
| elapsed_time |  |  | No |
| error |  |  | No |
| exceptions_count |  |  | No |
| finished_at |  |  | No |
| graph |  |  | Yes |
| id | string |  | Yes |
| inputs |  |  | Yes |
| outputs |  |  | Yes |
| status |  |  | No |
| total_steps |  |  | No |
| total_tokens |  |  | No |
| version |  |  | No |

#### WorkflowRunExportResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| presigned_url |  | Pre-signed URL for download | No |
| presigned_url_expires_at |  | Pre-signed URL expiration time | No |
| status | string | Export status: success/failed | Yes |

#### WorkflowRunForArchivedLogResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| elapsed_time |  |  | No |
| id | string |  | Yes |
| status |  |  | No |
| total_tokens |  |  | No |
| triggered_from |  |  | No |

#### WorkflowRunForListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| created_by_account |  |  | No |
| elapsed_time |  |  | No |
| exceptions_count |  |  | No |
| finished_at |  |  | No |
| id | string |  | Yes |
| retry_index |  |  | No |
| status |  |  | No |
| total_steps |  |  | No |
| total_tokens |  |  | No |
| version |  |  | No |

#### WorkflowRunForLogResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| elapsed_time |  |  | No |
| error |  |  | No |
| exceptions_count |  |  | No |
| finished_at |  |  | No |
| id | string |  | Yes |
| status |  |  | No |
| total_steps |  |  | No |
| total_tokens |  |  | No |
| triggered_from |  |  | No |
| version |  |  | No |

#### WorkflowRunListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id |  | Last run ID for pagination | No |
| limit | integer | Number of items per page (1-100) | No |
| status |  | Workflow run status filter | No |
| triggered_from |  | Filter by trigger source: debugging or app-run. Default: debugging | No |

#### WorkflowRunNodeExecutionListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse) ] |  | Yes |

#### WorkflowRunNodeExecutionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| created_by_account |  |  | No |
| created_by_end_user |  |  | No |
| created_by_role |  |  | No |
| elapsed_time |  |  | No |
| error |  |  | No |
| execution_metadata |  |  | No |
| extras |  |  | No |
| finished_at |  |  | No |
| id | string |  | Yes |
| index |  |  | No |
| inputs |  |  | No |
| inputs_truncated |  |  | No |
| node_id |  |  | No |
| node_type |  |  | No |
| outputs |  |  | No |
| outputs_truncated |  |  | No |
| predecessor_node_id |  |  | No |
| process_data |  |  | No |
| process_data_truncated |  |  | No |
| status |  |  | No |
| title |  |  | No |

#### WorkflowRunPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowRunForListResponse](#workflowrunforlistresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### WorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files |  |  | No |
| inputs | object |  | Yes |

#### WorkflowRunQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id |  |  | No |
| limit | integer |  | No |

#### WorkflowRunRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files |  |  | No |
| inputs | object |  | Yes |

#### WorkflowStatisticQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| end |  | End date and time (YYYY-MM-DD HH:MM) | No |
| start |  | Start date and time (YYYY-MM-DD HH:MM) | No |

#### WorkflowToolCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | Yes |
| icon | object |  | Yes |
| label | string |  | Yes |
| labels |  |  | No |
| name | string |  | Yes |
| parameters | [ [WorkflowToolParameterConfiguration](#workflowtoolparameterconfiguration) ] |  | No |
| privacy_policy |  |  | No |
| workflow_app_id | string |  | Yes |

#### WorkflowToolDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| workflow_tool_id | string |  | Yes |

#### WorkflowToolParameterConfiguration

Workflow tool configuration

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | The description of the parameter | Yes |
| form | [ToolParameterForm](#toolparameterform) | The form of the parameter | Yes |
| name | string | The name of the parameter | Yes |

#### WorkflowToolUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | Yes |
| icon | object |  | Yes |
| label | string |  | Yes |
| labels |  |  | No |
| name | string |  | Yes |
| parameters | [ [WorkflowToolParameterConfiguration](#workflowtoolparameterconfiguration) ] |  | No |
| privacy_policy |  |  | No |
| workflow_tool_id | string |  | Yes |

#### WorkflowTriggerListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowTriggerResponse](#workflowtriggerresponse) ] |  | Yes |

#### WorkflowTriggerResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| icon | string |  | Yes |
| id | string |  | Yes |
| node_id | string |  | Yes |
| provider_name | string |  | Yes |
| status | string |  | Yes |
| title | string |  | Yes |
| trigger_type | string |  | Yes |
| updated_at |  |  | No |

#### WorkflowUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| marked_comment |  |  | No |
| marked_name |  |  | No |

#### WorkspaceCustomConfigPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| remove_webapp_brand |  |  | No |
| replace_webapp_logo |  |  | No |

#### WorkspaceInfoPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

#### WorkspaceListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer |  | No |
| page | integer |  | No |

#### _AnonymousInlineModel_b1954337d565

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enable | boolean |  | No |
| model_name | string |  | No |
| model_provider_name | string |  | No |
| summary_prompt | string |  | No |

## FastOpenAPI Preview (OpenAPI 3.0)

### Dify API (FastOpenAPI PoC)
FastOpenAPI proof of concept for Dify API

#### Version: 1.0

---

##### [GET] /console/api/init
**Get initialization validation status.**

###### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | OK | **application/json**: [InitStatusResponse](#initstatusresponse)<br> |

##### [POST] /console/api/init
**Validate initialization password.**

###### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [InitValidatePayload](#initvalidatepayload)<br> |

###### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Created | **application/json**: [InitValidateResponse](#initvalidateresponse)<br> |

##### [GET] /console/api/ping
**Health check endpoint for connection testing.**

###### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | OK | **application/json**: [PingResponse](#pingresponse)<br> |

##### [GET] /console/api/setup
**Get system setup status.

    NOTE: This endpoint is unauthenticated by design.

    During first-time bootstrap there is no admin account yet, so frontend initialization must be
    able to query setup progress before any login flow exists.

    Only bootstrap-safe status information should be returned by this endpoint.
    **

###### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | OK | **application/json**: [SetupStatusResponse](#setupstatusresponse)<br> |

##### [POST] /console/api/setup
**Initialize system setup with admin account.

    NOTE: This endpoint is unauthenticated by design for first-time bootstrap.
    Access is restricted by deployment mode (`SELF_HOSTED`), one-time setup guards,
    and init-password validation rather than user session authentication.
    **

###### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SetupRequestPayload](#setuprequestpayload)<br> |

###### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Created | **application/json**: [SetupResponse](#setupresponse)<br> |

##### [GET] /console/api/version
**Check for application version updates.**

###### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| current_version | query |  | Yes | string |

###### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | OK | **application/json**: [VersionResponse](#versionresponse)<br> |

---
##### Schemas

###### ErrorSchema

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| error | { **"details"**: string, **"message"**: string, **"status"**: integer, **"type"**: string } |  | Yes |

###### InitStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| status | string, <br>**Available values:** "finished", "not_started" | Initialization status<br>*Enum:* `"finished"`, `"not_started"` | Yes |

###### InitValidatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| password | string | Initialization password | Yes |

###### InitValidateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Operation result | Yes |

###### PingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Health check result | Yes |

###### SetupRequestPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string | Admin email address | Yes |
| language |  | Admin language | No |
| name | string | Admin name (max 30 characters) | Yes |
| password | string | Admin password | Yes |

###### SetupResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Setup result | Yes |

###### SetupStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| setup_at |  | Setup completion time (ISO format) | No |
| step | string, <br>**Available values:** "finished", "not_started" | Setup step status<br>*Enum:* `"finished"`, `"not_started"` | Yes |

###### VersionFeatures

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| can_replace_logo | boolean | Whether logo replacement is supported | Yes |
| model_load_balancing_enabled | boolean | Whether model load balancing is enabled | Yes |

###### VersionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| can_auto_update | boolean | Whether auto-update is supported | Yes |
| features | [VersionFeatures](#versionfeatures) | Feature flags and capabilities | Yes |
| release_date | string | Release date of latest version | Yes |
| release_notes | string | Release notes for latest version | Yes |
| version | string | Latest version number | Yes |

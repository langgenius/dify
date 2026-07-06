# Console API
Console management APIs for app configuration, monitoring, and administration

## Version: 1.0

### Available authorizations
#### Bearer (HTTP, bearer)
Use the Service API key as a Bearer token in the Authorization header.
Bearer format: API_KEY

---
## console
Console management API operations

### [GET] /account/avatar
Get account avatar url

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| avatar | query | Avatar file ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AvatarUrlResponse](#avatarurlresponse)<br> |

### [POST] /account/avatar
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AccountAvatarPayload](#accountavatarpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountResponse](#accountresponse)<br> |

### [POST] /account/change-email
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChangeEmailSendPayload](#changeemailsendpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultDataResponse](#simpleresultdataresponse)<br> |

### [POST] /account/change-email/check-email-unique
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CheckEmailUniquePayload](#checkemailuniquepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /account/change-email/reset
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChangeEmailResetPayload](#changeemailresetpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountResponse](#accountresponse)<br> |

### [POST] /account/change-email/validity
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChangeEmailValidityPayload](#changeemailvaliditypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [VerificationTokenResponse](#verificationtokenresponse)<br> |

### [POST] /account/delete
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AccountDeletePayload](#accountdeletepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /account/delete/feedback
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AccountDeletionFeedbackPayload](#accountdeletionfeedbackpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /account/delete/verify
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultDataResponse](#simpleresultdataresponse)<br> |

### [GET] /account/education
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [EducationStatusResponse](#educationstatusresponse)<br> |

### [POST] /account/education
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EducationActivatePayload](#educationactivatepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [GET] /account/education/autocomplete
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| keywords | query |  | Yes | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [EducationAutocompleteResponse](#educationautocompleteresponse)<br> |

### [GET] /account/education/verify
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [EducationVerifyResponse](#educationverifyresponse)<br> |

### [POST] /account/init
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AccountInitPayload](#accountinitpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /account/integrates
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountIntegrateListResponse](#accountintegratelistresponse)<br> |

### [POST] /account/interface-language
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AccountInterfaceLanguagePayload](#accountinterfacelanguagepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountResponse](#accountresponse)<br> |

### [POST] /account/interface-theme
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AccountInterfaceThemePayload](#accountinterfacethemepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountResponse](#accountresponse)<br> |

### [POST] /account/name
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AccountNamePayload](#accountnamepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountResponse](#accountresponse)<br> |

### [POST] /account/password
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AccountPasswordPayload](#accountpasswordpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountResponse](#accountresponse)<br> |

### [GET] /account/profile
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountResponse](#accountresponse)<br> |

### [POST] /account/timezone
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AccountTimezonePayload](#accounttimezonepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountResponse](#accountresponse)<br> |

### [POST] /activate
Activate account with invitation token

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ActivatePayload](#activatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Account activated successfully | **application/json**: [ActivationResponse](#activationresponse)<br> |
| 400 | Already activated or invalid token |  |

### [GET] /activate/check
Check if activation token is valid

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| email | query |  | No | string |
| token | query |  | Yes | string |
| workspace_id | query |  | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ActivationCheckResponse](#activationcheckresponse)<br> |

### [GET] /agent
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| creator_ids | query | Filter by creator account IDs | No | [ string ] |
| is_created_by_me | query | Filter by creator | No | boolean |
| limit | query | Page size (1-100) | No | integer, <br>**Default:** 20 |
| mode | query | App mode filter | No | string, <br>**Available values:** "advanced-chat", "agent", "agent-chat", "all", "channel", "chat", "completion", "workflow", <br>**Default:** all |
| name | query | Filter by app name | No | string |
| page | query | Page number (1-99999) | No | integer, <br>**Default:** 1 |
| sort_by | query | Sort apps by last modified, recently created, or earliest created | No | string, <br>**Available values:** "earliest_created", "last_modified", "recently_created", <br>**Default:** last_modified |
| tag_ids | query | Filter by tag IDs | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent app list | **application/json**: [AgentAppPagination](#agentapppagination)<br> |

### [POST] /agent
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentAppCreatePayload](#agentappcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Agent app created successfully | **application/json**: [AgentAppDetailWithSite](#agentappdetailwithsite)<br> |
| 400 | Invalid request parameters |  |
| 403 | Insufficient permissions |  |

### [GET] /agent/invite-options
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | query | Workflow app id for in-current-workflow markers | No | string |
| keyword | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent invite options | **application/json**: [AgentInviteOptionsResponse](#agentinviteoptionsresponse)<br> |

### [DELETE] /agent/{agent_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Agent app deleted successfully |
| 403 | Insufficient permissions |

### [GET] /agent/{agent_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent app detail | **application/json**: [AgentAppDetailWithSite](#agentappdetailwithsite)<br> |

### [PUT] /agent/{agent_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentAppUpdatePayload](#agentappupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent app updated successfully | **application/json**: [AgentAppDetailWithSite](#agentappdetailwithsite)<br> |
| 400 | Invalid request parameters |  |
| 403 | Insufficient permissions |  |

### [GET] /agent/{agent_id}/api-access
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent service API access | **application/json**: [AgentApiAccessResponse](#agentapiaccessresponse)<br> |

### [POST] /agent/{agent_id}/api-enable
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentApiStatusPayload](#agentapistatuspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent service API status updated | **application/json**: [AgentApiAccessResponse](#agentapiaccessresponse)<br> |
| 403 | Insufficient permissions |  |

### [GET] /agent/{agent_id}/api-keys
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent service API keys | **application/json**: [ApiKeyList](#apikeylist)<br> |

### [POST] /agent/{agent_id}/api-keys
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Agent service API key created | **application/json**: [ApiKeyItem](#apikeyitem)<br> |
| 400 | Maximum keys exceeded |  |

### [DELETE] /agent/{agent_id}/api-keys/{api_key_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |
| api_key_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Agent service API key deleted |

### [POST] /agent/{agent_id}/build-chat/finalize
Run a build-draft Agent App turn that asks the agent to push config updates

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | Invalid request parameters |  |
| 404 | Agent, build draft, or conversation not found |  |

### [DELETE] /agent/{agent_id}/build-draft
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent build draft discarded | **application/json**: [AgentSimpleResultResponse](#agentsimpleresultresponse)<br> |

### [GET] /agent/{agent_id}/build-draft
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent build draft | **application/json**: [AgentBuildDraftResponse](#agentbuilddraftresponse)<br> |

### [PUT] /agent/{agent_id}/build-draft
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ComposerSavePayload](#composersavepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent build draft saved | **application/json**: [AgentBuildDraftResponse](#agentbuilddraftresponse)<br> |

### [POST] /agent/{agent_id}/build-draft/apply
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent build draft applied | **application/json**: [AgentBuildDraftApplyResponse](#agentbuilddraftapplyresponse)<br> |

### [POST] /agent/{agent_id}/build-draft/checkout
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentBuildDraftCheckoutPayload](#agentbuilddraftcheckoutpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent build draft checked out | **application/json**: [AgentBuildDraftResponse](#agentbuilddraftresponse)<br> |

### [GET] /agent/{agent_id}/chat-messages
Get Agent App chat messages for a conversation with pagination

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| conversation_id | query | Conversation ID | Yes | string |
| first_id | query | First message ID for pagination | No | string |
| limit | query | Number of messages to return (1-100) | No | integer, <br>**Default:** 20 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MessageInfiniteScrollPaginationResponse](#messageinfinitescrollpaginationresponse)<br> |
| 404 | Agent or conversation not found |  |

### [GET] /agent/{agent_id}/chat-messages/{message_id}/suggested-questions
Get suggested questions for an Agent App message

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| message_id | path | Message ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Suggested questions retrieved successfully | **application/json**: [SuggestedQuestionsResponse](#suggestedquestionsresponse)<br> |
| 404 | Agent, message, or conversation not found |  |

### [POST] /agent/{agent_id}/chat-messages/{task_id}/stop
Stop a running Agent App chat message generation

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| task_id | path | Task ID to stop | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /agent/{agent_id}/composer
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent app composer state | **application/json**: [AgentAppComposerResponse](#agentappcomposerresponse)<br> |

### [PUT] /agent/{agent_id}/composer
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ComposerSavePayload](#composersavepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent app composer saved | **application/json**: [AgentAppComposerResponse](#agentappcomposerresponse)<br> |

### [GET] /agent/{agent_id}/composer/candidates
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent app composer candidates | **application/json**: [AgentComposerCandidatesResponse](#agentcomposercandidatesresponse)<br> |

### [POST] /agent/{agent_id}/composer/validate
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ComposerSavePayload](#composersavepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent app composer validation result | **application/json**: [AgentComposerValidateResponse](#agentcomposervalidateresponse)<br> |

### [GET] /agent/{agent_id}/config/files
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config files | **application/json**: [AgentConfigFileListResponse](#agentconfigfilelistresponse)<br> |

### [POST] /agent/{agent_id}/config/files
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentConfigFileUploadPayload](#agentconfigfileuploadpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Uploaded config file | **application/json**: [AgentConfigFileUploadResponse](#agentconfigfileuploadresponse)<br> |

### [DELETE] /agent/{agent_id}/config/files/{name}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| name | path | Config file name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config file deleted | **application/json**: [AgentConfigDeleteResponse](#agentconfigdeleteresponse)<br> |

### [GET] /agent/{agent_id}/config/files/{name}/download
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| name | path | Config file name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config file download URL | **application/json**: [AgentConfigDownloadResponse](#agentconfigdownloadresponse)<br> |

### [GET] /agent/{agent_id}/config/files/{name}/preview
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| name | path | Config file name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Preview | **application/json**: [AgentConfigFilePreviewResponse](#agentconfigfilepreviewresponse)<br> |

### [GET] /agent/{agent_id}/config/manifest
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent config manifest | **application/json**: [AgentConfigManifestResponse](#agentconfigmanifestresponse)<br> |

### [GET] /agent/{agent_id}/config/skills
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skills | **application/json**: [AgentConfigSkillListResponse](#agentconfigskilllistresponse)<br> |

### [POST] /agent/{agent_id}/config/skills/upload
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Uploaded config skill | **application/json**: [AgentConfigSkillUploadResponse](#agentconfigskilluploadresponse)<br> |

### [DELETE] /agent/{agent_id}/config/skills/{name}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill deleted | **application/json**: [AgentConfigDeleteResponse](#agentconfigdeleteresponse)<br> |

### [GET] /agent/{agent_id}/config/skills/{name}/download
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill download URL | **application/json**: [AgentConfigDownloadResponse](#agentconfigdownloadresponse)<br> |

### [GET] /agent/{agent_id}/config/skills/{name}/files/content
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |
| name | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [GET] /agent/{agent_id}/config/skills/{name}/files/download
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| path | query | Normalized zip member path inside the skill package | Yes | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill file download URL | **application/json**: [AgentConfigDownloadResponse](#agentconfigdownloadresponse)<br> |

### [GET] /agent/{agent_id}/config/skills/{name}/files/preview
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| path | query | Normalized zip member path inside the skill package | Yes | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill file preview | **application/json**: [AgentConfigSkillFilePreviewResponse](#agentconfigskillfilepreviewresponse)<br> |

### [GET] /agent/{agent_id}/config/skills/{name}/inspect
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill inspect view | **application/json**: [AgentConfigSkillInspectResponse](#agentconfigskillinspectresponse)<br> |

### [POST] /agent/{agent_id}/copy
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentAppCopyPayload](#agentappcopypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Agent app copied successfully | **application/json**: [AgentAppDetailWithSite](#agentappdetailwithsite)<br> |
| 400 | Invalid request parameters |  |
| 403 | Insufficient permissions |  |

### [POST] /agent/{agent_id}/debug-conversation/refresh
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent debug conversation refreshed | **application/json**: [AgentDebugConversationRefreshResponse](#agentdebugconversationrefreshresponse)<br> |
| 403 | Insufficient permissions |  |

### [GET] /agent/{agent_id}/drive/files
List agent drive entries for an Agent App

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| prefix | query | Key prefix filter: '<slug>/' for one skill, 'files/' for files | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Drive entries | **application/json**: [AgentDriveListResponse](#agentdrivelistresponse)<br> |

### [GET] /agent/{agent_id}/drive/files/download
Time-limited external signed URL for one Agent App drive value

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| key | query | Drive key, e.g. tender-analyzer/SKILL.md | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Signed URL | **application/json**: [AgentDriveDownloadResponse](#agentdrivedownloadresponse)<br> |

### [GET] /agent/{agent_id}/drive/files/preview
Truncated text preview of one Agent App drive value

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| key | query | Drive key, e.g. tender-analyzer/SKILL.md | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Preview | **application/json**: [AgentDrivePreviewResponse](#agentdrivepreviewresponse)<br> |

### [GET] /agent/{agent_id}/drive/skills
List drive-backed skills for an Agent App

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Drive skills | **application/json**: [AgentDriveSkillListResponse](#agentdriveskilllistresponse)<br> |

### [GET] /agent/{agent_id}/drive/skills/{skill_path}/inspect
Inspect one drive-backed skill for slash-menu hover/detail UI

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| skill_path | path | Skill path/slug, e.g. tender-analyzer | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Drive skill inspect view | **application/json**: [AgentDriveSkillInspectResponse](#agentdriveskillinspectresponse)<br> |

### [POST] /agent/{agent_id}/features
Update an Agent App's presentation features (opener, follow-up, citations, ...)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentAppFeaturesPayload](#agentappfeaturespayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Features updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | Invalid configuration |  |
| 404 | Agent not found |  |

### [POST] /agent/{agent_id}/feedbacks
Create or update Agent App message feedback

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MessageFeedbackPayload](#messagefeedbackpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Feedback updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 404 | Agent or message not found |  |

### [DELETE] /agent/{agent_id}/files
Delete one Agent App drive file by key

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| key | query | Drive key, e.g. files/sample.pdf | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | File removed | **application/json**: [AgentDriveDeleteResponse](#agentdrivedeleteresponse)<br> |

### [POST] /agent/{agent_id}/files
Commit an uploaded file into the Agent App drive under files/<name>

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentDriveFilePayload](#agentdrivefilepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File committed into the agent drive | **application/json**: [AgentDriveFileCommitResponse](#agentdrivefilecommitresponse)<br> |

### [GET] /agent/{agent_id}/log-sources
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent log sources | **application/json**: [AgentLogSourceListResponse](#agentlogsourcelistresponse)<br> |

### [GET] /agent/{agent_id}/logs
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| keyword | query | Search query, answer, or conversation name | No | string |
| limit | query | Page size | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| sort_by | query | Sort by created_at or updated_at | No | string, <br>**Default:** updated_at |
| sort_order | query | Sort order: asc or desc | No | string, <br>**Default:** desc |
| source | query | Deprecated single source filter | No | string |
| sources | query | Filter by one or more source IDs, e.g. webapp:<app_id> or workflow:<app_id>:<workflow_id>:<version>:<node_id> | No | [ string ] |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |
| status | query | Deprecated single status filter | No | string |
| statuses | query | Filter by one or more of success, failed, paused | No | [ string ] |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent logs | **application/json**: [AgentLogListResponse](#agentloglistresponse)<br> |

### [GET] /agent/{agent_id}/logs/{conversation_id}/messages
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| keyword | query | Search query, answer, or conversation name | No | string |
| limit | query | Page size | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| sort_by | query | Sort by created_at or updated_at | No | string, <br>**Default:** updated_at |
| sort_order | query | Sort order: asc or desc | No | string, <br>**Default:** desc |
| source | query | Deprecated single source filter | No | string |
| sources | query | Filter by one or more source IDs, e.g. webapp:<app_id> or workflow:<app_id>:<workflow_id>:<version>:<node_id> | No | [ string ] |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |
| status | query | Deprecated single status filter | No | string |
| statuses | query | Filter by one or more of success, failed, paused | No | [ string ] |
| agent_id | path |  | Yes | string (uuid) |
| conversation_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent log messages | **application/json**: [AgentLogMessageListResponse](#agentlogmessagelistresponse)<br> |

### [GET] /agent/{agent_id}/messages/{message_id}
Get Agent App message details by ID

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| message_id | path | Message ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Message retrieved successfully | **application/json**: [MessageDetailResponse](#messagedetailresponse)<br> |
| 404 | Agent or message not found |  |

### [POST] /agent/{agent_id}/publish
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentPublishPayload](#agentpublishpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent draft published | **application/json**: [AgentPublishResponse](#agentpublishresponse)<br> |
| 403 | Insufficient permissions |  |

### [GET] /agent/{agent_id}/referencing-workflows
List workflow apps that reference this Agent App's bound Agent (read-only)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Referencing workflows listed successfully | **application/json**: [AgentReferencingWorkflowsResponse](#agentreferencingworkflowsresponse)<br> |
| 404 | Agent not found |  |

### [GET] /agent/{agent_id}/sandbox
Get basic information for an Agent App conversation sandbox

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| conversation_id | query | Agent App conversation ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Sandbox information returned | **application/json**: [SandboxInfoResponse](#sandboxinforesponse)<br> |

### [GET] /agent/{agent_id}/sandbox/files
List a directory in an Agent App conversation sandbox

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| conversation_id | query | Agent App conversation ID | Yes | string |
| path | query | Directory path relative to the sandbox workspace | No | string, <br>**Default:** . |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Listing returned | **application/json**: [SandboxListResponse](#sandboxlistresponse)<br> |

### [GET] /agent/{agent_id}/sandbox/files/read
Read a text/binary preview file in an Agent App conversation sandbox

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| conversation_id | query | Agent App conversation ID | Yes | string |
| path | query | File path relative to the sandbox workspace | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Preview returned | **application/json**: [SandboxReadResponse](#sandboxreadresponse)<br> |

### [POST] /agent/{agent_id}/sandbox/files/upload
Upload one Agent App sandbox file as a Dify ToolFile mapping

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentSandboxUploadPayload](#agentsandboxuploadpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Uploaded | **application/json**: [SandboxUploadResponse](#sandboxuploadresponse)<br> |

### [POST] /agent/{agent_id}/skills/upload
Upload + standardize a Skill into an Agent App drive

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Skill uploaded into drive | **application/json**: [AgentSkillUploadResponse](#agentskilluploadresponse)<br> |
| 400 | Invalid skill package or no bound agent |  |

### [DELETE] /agent/{agent_id}/skills/{slug}
Delete a standardized skill from an Agent App drive

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| slug | path | Skill slug (single path segment) | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Skill removed | **application/json**: [AgentDriveDeleteResponse](#agentdrivedeleteresponse)<br> |

### [POST] /agent/{agent_id}/skills/{slug}/infer-tools
Infer CLI tool + ENV suggestions from a standardized Agent App skill

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path | Agent ID | Yes | string (uuid) |
| slug | path | Skill slug (single path segment) | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Inference result (draft suggestions, nothing persisted) | **application/json**: [SkillToolInferenceResult](#skilltoolinferenceresult)<br> |

### [GET] /agent/{agent_id}/statistics/summary
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| source | query | Filter by all, console/explore, api/service-api, web-app, debugger, openapi, or trigger | No | string |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent monitoring summary and chart data | **application/json**: [AgentStatisticSummaryEnvelopeResponse](#agentstatisticsummaryenveloperesponse)<br> |

### [GET] /agent/{agent_id}/versions
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent versions | **application/json**: [AgentConfigSnapshotListResponse](#agentconfigsnapshotlistresponse)<br> |

### [GET] /agent/{agent_id}/versions/{version_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |
| version_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent version detail | **application/json**: [AgentConfigSnapshotDetailResponse](#agentconfigsnapshotdetailresponse)<br> |

### [POST] /agent/{agent_id}/versions/{version_id}/restore
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| agent_id | path |  | Yes | string (uuid) |
| version_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent version restored | **application/json**: [AgentConfigSnapshotRestoreResponse](#agentconfigsnapshotrestoreresponse)<br> |

### [GET] /all-workspaces
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WorkspacePaginationResponse](#workspacepaginationresponse)<br> |

### [GET] /api-based-extension
Get all API-based extensions for current tenant

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [APIBasedExtensionListResponse](#apibasedextensionlistresponse)<br> |

### [POST] /api-based-extension
Create a new API-based extension

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [APIBasedExtensionPayload](#apibasedextensionpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Extension created successfully | **application/json**: [APIBasedExtensionResponse](#apibasedextensionresponse)<br> |

### [DELETE] /api-based-extension/{id}
Delete API-based extension

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| id | path | Extension ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Extension deleted successfully |

### [GET] /api-based-extension/{id}
Get API-based extension by ID

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| id | path | Extension ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [APIBasedExtensionResponse](#apibasedextensionresponse)<br> |

### [POST] /api-based-extension/{id}
Update API-based extension

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| id | path | Extension ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [APIBasedExtensionPayload](#apibasedextensionpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Extension updated successfully | **application/json**: [APIBasedExtensionResponse](#apibasedextensionresponse)<br> |

### [GET] /api-key-auth/data-source
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ApiKeyAuthDataSourceListResponse](#apikeyauthdatasourcelistresponse)<br> |

### [POST] /api-key-auth/data-source/binding
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ApiKeyAuthBindingPayload](#apikeyauthbindingpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [DELETE] /api-key-auth/data-source/{binding_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| binding_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Binding deleted successfully |

### [GET] /app-dsl-version
**Get current app DSL version for workflow clipboard compatibility**

Get current app DSL version

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AppDslVersionResponse](#appdslversionresponse)<br> |

### [GET] /app/prompt-templates
Get advanced prompt templates based on app mode and model configuration

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_mode | query | Application mode | Yes | string |
| has_context | query | Whether has context | No | string, <br>**Default:** true |
| model_mode | query | Model mode | Yes | string |
| model_name | query | Model name | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Prompt templates retrieved successfully | **application/json**: [AdvancedPromptTemplateResponse](#advancedprompttemplateresponse)<br> |
| 400 | Invalid request parameters |  |

### [GET] /apps
**Get app list**

Get list of applications with pagination and filtering

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| creator_ids | query | Filter by creator account IDs | No | [ string ] |
| is_created_by_me | query | Filter by creator | No | boolean |
| limit | query | Page size (1-100) | No | integer, <br>**Default:** 20 |
| mode | query | App mode filter | No | string, <br>**Available values:** "advanced-chat", "agent", "agent-chat", "all", "channel", "chat", "completion", "workflow", <br>**Default:** all |
| name | query | Filter by app name | No | string |
| page | query | Page number (1-99999) | No | integer, <br>**Default:** 1 |
| sort_by | query | Sort apps by last modified, recently created, or earliest created | No | string, <br>**Available values:** "earliest_created", "last_modified", "recently_created", <br>**Default:** last_modified |
| tag_ids | query | Filter by tag IDs | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AppPagination](#apppagination)<br> |

### [POST] /apps
**Create app**

Create a new application

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CreateAppPayload](#createapppayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | App created successfully | **application/json**: [AppDetailWithSite](#appdetailwithsite)<br> |
| 400 | Invalid request parameters |  |
| 403 | Insufficient permissions |  |

### [POST] /apps/imports
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppImportPayload](#appimportpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Import completed | **application/json**: [Import](#import)<br> |
| 202 | Import pending confirmation | **application/json**: [Import](#import)<br> |
| 400 | Import failed | **application/json**: [Import](#import)<br> |

### [GET] /apps/imports/{app_id}/check-dependencies
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dependencies checked | **application/json**: [CheckDependenciesResult](#checkdependenciesresult)<br> |

### [POST] /apps/imports/{import_id}/confirm
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| import_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Import confirmed | **application/json**: [Import](#import)<br> |
| 400 | Import failed | **application/json**: [Import](#import)<br> |

### [GET] /apps/starred
Get applications starred by the current account

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| creator_ids | query | Filter by creator account IDs | No | [ string ] |
| is_created_by_me | query | Filter by creator | No | boolean |
| limit | query | Page size (1-100) | No | integer, <br>**Default:** 20 |
| mode | query | App mode filter | No | string, <br>**Available values:** "advanced-chat", "agent", "agent-chat", "all", "channel", "chat", "completion", "workflow", <br>**Default:** all |
| name | query | Filter by app name | No | string |
| page | query | Page number (1-99999) | No | integer, <br>**Default:** 1 |
| sort_by | query | Sort apps by last modified, recently created, or earliest created | No | string, <br>**Available values:** "earliest_created", "last_modified", "recently_created", <br>**Default:** last_modified |
| tag_ids | query | Filter by tag IDs | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AppPagination](#apppagination)<br> |

### [POST] /apps/workflows/online-users
Get workflow online users

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowOnlineUsersPayload](#workflowonlineuserspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow online users retrieved successfully | **application/json**: [WorkflowOnlineUsersResponse](#workflowonlineusersresponse)<br> |

### [DELETE] /apps/{app_id}
**Delete app**

Delete application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | App deleted successfully |
| 403 | Insufficient permissions |

### [GET] /apps/{app_id}
**Get app detail**

Get application details

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AppDetailWithSite](#appdetailwithsite)<br> |

### [PUT] /apps/{app_id}
**Update app**

Update application details

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [UpdateAppPayload](#updateapppayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App updated successfully | **application/json**: [AppDetailWithSite](#appdetailwithsite)<br> |
| 400 | Invalid request parameters |  |
| 403 | Insufficient permissions |  |

### [GET] /apps/{app_id}/advanced-chat/workflow-runs
**Get advanced chat app workflow run list**

Get advanced chat workflow run list

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| last_id | query | Last run ID for pagination | No | string |
| limit | query | Number of items per page (1-100) | No | integer, <br>**Default:** 20 |
| status | query | Workflow run status filter | No | string, <br>**Available values:** "failed", "partial-succeeded", "running", "stopped", "succeeded" |
| triggered_from | query | Filter by trigger source: debugging or app-run. Default: debugging | No | string, <br>**Available values:** "app-run", "debugging" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs retrieved successfully | **application/json**: [AdvancedChatWorkflowRunPaginationResponse](#advancedchatworkflowrunpaginationresponse)<br> |

### [GET] /apps/{app_id}/advanced-chat/workflow-runs/count
**Get advanced chat workflow runs count statistics**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| status | query | Workflow run status filter | No | string, <br>**Available values:** "failed", "partial-succeeded", "running", "stopped", "succeeded" |
| time_range | query | Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), 30m (30 minutes), 30s (30 seconds). Filters by created_at field. | No | string |
| triggered_from | query | Filter by trigger source: debugging or app-run. Default: debugging | No | string, <br>**Available values:** "app-run", "debugging" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs count retrieved successfully | **application/json**: [WorkflowRunCountResponse](#workflowruncountresponse)<br> |

### [POST] /apps/{app_id}/advanced-chat/workflows/draft/human-input/nodes/{node_id}/form/preview
**Preview human input form content and placeholders**

Get human input form preview for advanced chat workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputFormPreviewPayload](#humaninputformpreviewpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Human input form preview | **application/json**: [HumanInputFormPreviewResponse](#humaninputformpreviewresponse)<br> |

### [POST] /apps/{app_id}/advanced-chat/workflows/draft/human-input/nodes/{node_id}/form/run
**Submit human input form preview**

Submit human input form preview for advanced chat workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputFormSubmitPayload](#humaninputformsubmitpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Human input form submission result | **application/json**: [HumanInputFormSubmitResponse](#humaninputformsubmitresponse)<br> |

### [POST] /apps/{app_id}/advanced-chat/workflows/draft/iteration/nodes/{node_id}/run
**Run draft workflow iteration node**

Run draft workflow iteration node for advanced chat

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [IterationNodeRunPayload](#iterationnoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Iteration node run started successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 403 | Permission denied |  |
| 404 | Node not found |  |

### [POST] /apps/{app_id}/advanced-chat/workflows/draft/loop/nodes/{node_id}/run
**Run draft workflow loop node**

Run draft workflow loop node for advanced chat

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [LoopNodeRunPayload](#loopnoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Loop node run started successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 403 | Permission denied |  |
| 404 | Node not found |  |

### [POST] /apps/{app_id}/advanced-chat/workflows/draft/run
**Run draft workflow**

Run draft workflow for advanced chat application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AdvancedChatWorkflowRunPayload](#advancedchatworkflowrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run started successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | Invalid request parameters |  |
| 403 | Permission denied |  |

### [GET] /apps/{app_id}/agent/config/files
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config files | **application/json**: [AgentConfigFileListResponse](#agentconfigfilelistresponse)<br> |

### [POST] /apps/{app_id}/agent/config/files
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentConfigFileUploadPayload](#agentconfigfileuploadpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Uploaded config file | **application/json**: [AgentConfigFileUploadResponse](#agentconfigfileuploadresponse)<br> |

### [DELETE] /apps/{app_id}/agent/config/files/{name}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| name | path | Config file name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config file deleted | **application/json**: [AgentConfigDeleteResponse](#agentconfigdeleteresponse)<br> |

### [GET] /apps/{app_id}/agent/config/files/{name}/download
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| name | path | Config file name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config file download URL | **application/json**: [AgentConfigDownloadResponse](#agentconfigdownloadresponse)<br> |

### [GET] /apps/{app_id}/agent/config/files/{name}/preview
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| name | path | Config file name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Preview | **application/json**: [AgentConfigFilePreviewResponse](#agentconfigfilepreviewresponse)<br> |

### [GET] /apps/{app_id}/agent/config/manifest
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent config manifest | **application/json**: [AgentConfigManifestResponse](#agentconfigmanifestresponse)<br> |

### [GET] /apps/{app_id}/agent/config/skills
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skills | **application/json**: [AgentConfigSkillListResponse](#agentconfigskilllistresponse)<br> |

### [POST] /apps/{app_id}/agent/config/skills/upload
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Uploaded config skill | **application/json**: [AgentConfigSkillUploadResponse](#agentconfigskilluploadresponse)<br> |

### [DELETE] /apps/{app_id}/agent/config/skills/{name}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill deleted | **application/json**: [AgentConfigDeleteResponse](#agentconfigdeleteresponse)<br> |

### [GET] /apps/{app_id}/agent/config/skills/{name}/download
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill download URL | **application/json**: [AgentConfigDownloadResponse](#agentconfigdownloadresponse)<br> |

### [GET] /apps/{app_id}/agent/config/skills/{name}/files/content
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| name | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [GET] /apps/{app_id}/agent/config/skills/{name}/files/download
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| path | query | Normalized zip member path inside the skill package | Yes | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill file download URL | **application/json**: [AgentConfigDownloadResponse](#agentconfigdownloadresponse)<br> |

### [GET] /apps/{app_id}/agent/config/skills/{name}/files/preview
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| path | query | Normalized zip member path inside the skill package | Yes | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill file preview | **application/json**: [AgentConfigSkillFilePreviewResponse](#agentconfigskillfilepreviewresponse)<br> |

### [GET] /apps/{app_id}/agent/config/skills/{name}/inspect
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| name | path | Config skill name | Yes | string |
| draft_type | query | Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft | No | string, <br>**Available values:** "debug_build", "draft" |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| version_id | query | Published snapshot ID for read-only version view | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Config skill inspect view | **application/json**: [AgentConfigSkillInspectResponse](#agentconfigskillinspectresponse)<br> |

### [GET] /apps/{app_id}/agent/drive/files
List agent drive entries (read-only inspector; one endpoint for both tabs)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| prefix | query | Key prefix filter: '<slug>/' for one skill, 'files/' for files | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Drive entries | **application/json**: [AgentDriveListResponse](#agentdrivelistresponse)<br> |

### [GET] /apps/{app_id}/agent/drive/files/download
Time-limited external signed URL for one drive value (no streaming proxy)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| key | query | Drive key, e.g. tender-analyzer/SKILL.md | Yes | string |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Signed URL | **application/json**: [AgentDriveDownloadResponse](#agentdrivedownloadresponse)<br> |

### [GET] /apps/{app_id}/agent/drive/files/preview
Truncated text preview of one drive value (binary-safe; SKILL.md is the main case)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| key | query | Drive key, e.g. tender-analyzer/SKILL.md | Yes | string |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Preview | **application/json**: [AgentDrivePreviewResponse](#agentdrivepreviewresponse)<br> |

### [GET] /apps/{app_id}/agent/drive/skills
List drive-backed skills for the bound agent

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |
| prefix | query | Key prefix filter: '<slug>/' for one skill, 'files/' for files | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Drive skills | **application/json**: [AgentDriveSkillListResponse](#agentdriveskilllistresponse)<br> |

### [GET] /apps/{app_id}/agent/drive/skills/{skill_path}/inspect
Inspect one drive-backed skill for slash-menu hover/detail UI

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| skill_path | path | Skill path/slug, e.g. tender-analyzer | Yes | string |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Drive skill inspect view | **application/json**: [AgentDriveSkillInspectResponse](#agentdriveskillinspectresponse)<br> |

### [DELETE] /apps/{app_id}/agent/files
Delete one drive file by key via drive commit-null semantics

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| key | query | Drive key, e.g. files/sample.pdf | Yes | string |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | File removed | **application/json**: [AgentDriveDeleteResponse](#agentdrivedeleteresponse)<br> |

### [POST] /apps/{app_id}/agent/files
**ADD FILE: commit one uploaded file into the bound agent's drive**

Commit an uploaded file into the agent drive under files/<name> (ENG-625 D3)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AgentDriveFilePayload](#agentdrivefilepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File committed into the agent drive | **application/json**: [AgentDriveFileCommitResponse](#agentdrivefilecommitresponse)<br> |

### [GET] /apps/{app_id}/agent/logs
**Get agent logs**

Get agent execution logs for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| conversation_id | query | Conversation UUID | Yes | string |
| message_id | query | Message UUID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Agent logs retrieved successfully | **application/json**: [AgentLogResponse](#agentlogresponse)<br> |
| 400 | Invalid request parameters |  |

### [POST] /apps/{app_id}/agent/skills/upload
**Upload a Skill, validate it, and commit drive-backed skill files**

Upload + standardize a Skill into the agent drive

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Skill uploaded into drive | **application/json**: [AgentSkillUploadResponse](#agentskilluploadresponse)<br> |
| 400 | Invalid skill package or no bound agent |  |

### [DELETE] /apps/{app_id}/agent/skills/{slug}
Delete a standardized skill by removing its known drive keys via commit-null

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| slug | path | Skill slug (single path segment) | Yes | string |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Skill removed | **application/json**: [AgentDriveDeleteResponse](#agentdrivedeleteresponse)<br> |

### [POST] /apps/{app_id}/agent/skills/{slug}/infer-tools
**Suggest CLI tools/env for a skill**

Infer CLI tool + ENV suggestions from a standardized skill's SKILL.md (draft only, ENG-371)
Saving still goes through composer validation.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| slug | path | Skill slug (single path segment) | Yes | string |
| node_id | query | Workflow node ID (workflow composer variant) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Inference result (draft suggestions, nothing persisted) | **application/json**: [SkillToolInferenceResult](#skilltoolinferenceresult)<br> |

### [POST] /apps/{app_id}/annotation-reply/{action}
Enable or disable annotation reply for an app

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform (enable/disable) | Yes | string |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AnnotationReplyPayload](#annotationreplypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Action completed successfully | **application/json**: [AnnotationJobStatusResponse](#annotationjobstatusresponse)<br> |
| 403 | Insufficient permissions |  |

### [GET] /apps/{app_id}/annotation-reply/{action}/status/{job_id}
Get status of annotation reply action job

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action type | Yes | string |
| app_id | path | Application ID | Yes | string (uuid) |
| job_id | path | Job ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Job status retrieved successfully | **application/json**: [AnnotationJobStatusDetailResponse](#annotationjobstatusdetailresponse)<br> |
| 403 | Insufficient permissions |  |

### [GET] /apps/{app_id}/annotation-setting
Get annotation settings for an app

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotation settings retrieved successfully | **application/json**: [AnnotationSettingResponse](#annotationsettingresponse)<br> |
| 403 | Insufficient permissions |  |

### [POST] /apps/{app_id}/annotation-settings/{annotation_setting_id}
Update annotation settings for an app

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_setting_id | path | Annotation setting ID | Yes | string (uuid) |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AnnotationSettingUpdatePayload](#annotationsettingupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Settings updated successfully | **application/json**: [AnnotationSettingResponse](#annotationsettingresponse)<br> |
| 403 | Insufficient permissions |  |

### [DELETE] /apps/{app_id}/annotations
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Annotations deleted successfully |

### [GET] /apps/{app_id}/annotations
Get annotations for an app with pagination

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| keyword | query | Search keyword | No | string |
| limit | query | Page size | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotations retrieved successfully | **application/json**: [AnnotationList](#annotationlist)<br> |
| 403 | Insufficient permissions |  |

### [POST] /apps/{app_id}/annotations
Create a new annotation for an app

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CreateAnnotationPayload](#createannotationpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Annotation created successfully | **application/json**: [Annotation](#annotation)<br> |
| 403 | Insufficient permissions |  |

### [POST] /apps/{app_id}/annotations/batch-import
Batch import annotations from CSV file with rate limiting and security checks

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Batch import started successfully | **application/json**: [AnnotationBatchImportResponse](#annotationbatchimportresponse)<br> |
| 400 | No file uploaded or too many files |  |
| 403 | Insufficient permissions |  |
| 413 | File too large |  |
| 429 | Too many requests or concurrent imports |  |

### [GET] /apps/{app_id}/annotations/batch-import-status/{job_id}
Get status of batch import job

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| job_id | path | Job ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Job status retrieved successfully | **application/json**: [AnnotationJobStatusDetailResponse](#annotationjobstatusdetailresponse)<br> |
| 403 | Insufficient permissions |  |

### [GET] /apps/{app_id}/annotations/count
Get count of message annotations for the app

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotation count retrieved successfully | **application/json**: [AnnotationCountResponse](#annotationcountresponse)<br> |

### [GET] /apps/{app_id}/annotations/export
Export all annotations for an app with CSV injection protection

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotations exported successfully | **application/json**: [AnnotationExportList](#annotationexportlist)<br> |
| 403 | Insufficient permissions |  |

### [DELETE] /apps/{app_id}/annotations/{annotation_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path |  | Yes | string (uuid) |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Annotation deleted successfully |

### [POST] /apps/{app_id}/annotations/{annotation_id}
Update or delete an annotation

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path | Annotation ID | Yes | string (uuid) |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [UpdateAnnotationPayload](#updateannotationpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotation updated successfully | **application/json**: [Annotation](#annotation)<br> |
| 204 | Annotation deleted successfully |  |
| 403 | Insufficient permissions |  |

### [GET] /apps/{app_id}/annotations/{annotation_id}/hit-histories
Get hit histories for an annotation

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path | Annotation ID | Yes | string (uuid) |
| app_id | path | Application ID | Yes | string (uuid) |
| limit | query | Page size | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Hit histories retrieved successfully | **application/json**: [AnnotationHitHistoryList](#annotationhithistorylist)<br> |
| 403 | Insufficient permissions |  |

### [POST] /apps/{app_id}/api-enable
Enable or disable app API

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppApiStatusPayload](#appapistatuspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API status updated successfully | **application/json**: [AppDetail](#appdetail)<br> |
| 403 | Insufficient permissions |  |

### [POST] /apps/{app_id}/audio-to-text
Transcript audio to text for chat messages

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | App ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Audio transcription successful | **application/json**: [AudioTranscriptResponse](#audiotranscriptresponse)<br> |
| 400 | Bad request - No audio uploaded or unsupported type |  |
| 413 | Audio file too large |  |

### [GET] /apps/{app_id}/chat-conversations
Get chat conversations with pagination, filtering and summary

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| annotation_status | query | Annotation status filter | No | string, <br>**Available values:** "all", "annotated", "not_annotated", <br>**Default:** all |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| keyword | query | Search keyword | No | string |
| limit | query | Page size (1-100) | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| sort_by | query | Sort field and direction | No | string, <br>**Available values:** "-created_at", "-updated_at", "created_at", "updated_at", <br>**Default:** -updated_at |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ConversationWithSummaryPagination](#conversationwithsummarypagination)<br> |
| 403 | Insufficient permissions |  |

### [DELETE] /apps/{app_id}/chat-conversations/{conversation_id}
Delete a chat conversation

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| conversation_id | path | Conversation ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully |
| 403 | Insufficient permissions |
| 404 | Conversation not found |

### [GET] /apps/{app_id}/chat-conversations/{conversation_id}
Get chat conversation details

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| conversation_id | path | Conversation ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ConversationDetail](#conversationdetail)<br> |
| 403 | Insufficient permissions |  |
| 404 | Conversation not found |  |

### [GET] /apps/{app_id}/chat-messages
Get chat messages for a conversation with pagination

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| conversation_id | query | Conversation ID | Yes | string |
| first_id | query | First message ID for pagination | No | string |
| limit | query | Number of messages to return (1-100) | No | integer, <br>**Default:** 20 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MessageInfiniteScrollPaginationResponse](#messageinfinitescrollpaginationresponse)<br> |
| 404 | Conversation not found |  |

### [GET] /apps/{app_id}/chat-messages/{message_id}/suggested-questions
Get suggested questions for a message

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| message_id | path | Message ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Suggested questions retrieved successfully | **application/json**: [SuggestedQuestionsResponse](#suggestedquestionsresponse)<br> |
| 404 | Message or conversation not found |  |

### [POST] /apps/{app_id}/chat-messages/{task_id}/stop
Stop a running chat message generation

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| task_id | path | Task ID to stop | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /apps/{app_id}/completion-conversations
Get completion conversations with pagination and filtering

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| annotation_status | query | Annotation status filter | No | string, <br>**Available values:** "all", "annotated", "not_annotated", <br>**Default:** all |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| keyword | query | Search keyword | No | string |
| limit | query | Page size (1-100) | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ConversationPagination](#conversationpagination)<br> |
| 403 | Insufficient permissions |  |

### [DELETE] /apps/{app_id}/completion-conversations/{conversation_id}
Delete a completion conversation

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| conversation_id | path | Conversation ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully |
| 403 | Insufficient permissions |
| 404 | Conversation not found |

### [GET] /apps/{app_id}/completion-conversations/{conversation_id}
Get completion conversation details with messages

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| conversation_id | path | Conversation ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ConversationMessageDetail](#conversationmessagedetail)<br> |
| 403 | Insufficient permissions |  |
| 404 | Conversation not found |  |

### [POST] /apps/{app_id}/completion-messages
Generate completion message for debugging

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CompletionMessagePayload](#completionmessagepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Completion generated successfully |
| 400 | Invalid request parameters |
| 404 | App not found |

### [POST] /apps/{app_id}/completion-messages/{task_id}/stop
Stop a running completion message generation

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| task_id | path | Task ID to stop | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /apps/{app_id}/conversation-variables
Get conversation variables for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| conversation_id | query | Conversation ID to filter variables | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation variables retrieved successfully | **application/json**: [PaginatedConversationVariableResponse](#paginatedconversationvariableresponse)<br> |

### [POST] /apps/{app_id}/convert-to-workflow
**Convert basic mode of chatbot app to workflow mode**

Convert application to workflow mode
Convert expert mode of chatbot app to workflow mode
Convert Completion App to Workflow App

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ConvertToWorkflowPayload](#converttoworkflowpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Application converted to workflow successfully | **application/json**: [NewAppResponse](#newappresponse)<br> |
| 400 | Application cannot be converted |  |
| 403 | Permission denied |  |

### [POST] /apps/{app_id}/copy
**Copy app**

Create a copy of an existing application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID to copy | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CopyAppPayload](#copyapppayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | App copied successfully | **application/json**: [AppDetailWithSite](#appdetailwithsite)<br> |
| 202 | App copy requires confirmation | **application/json**: [AppImportResponse](#appimportresponse)<br> |
| 403 | Insufficient permissions |  |

### [GET] /apps/{app_id}/export
**Export app**

Export application configuration as DSL

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID to export | Yes | string (uuid) |
| include_secret | query | Include secrets in export | No | boolean |
| workflow_id | query | Specific workflow ID to export | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | App exported successfully | **application/json**: [AppExportResponse](#appexportresponse)<br> |
| 403 | Insufficient permissions |  |

### [POST] /apps/{app_id}/feedbacks
Create or update message feedback (like/dislike)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MessageFeedbackPayload](#messagefeedbackpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Feedback updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 403 | Insufficient permissions |  |
| 404 | Message not found |  |

### [GET] /apps/{app_id}/feedbacks/export
Export user feedback data for Google Sheets

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end_date | query | End date (YYYY-MM-DD) | No | string |
| format | query | Export format | No | string, <br>**Available values:** "csv", "json", <br>**Default:** csv |
| from_source | query | Filter by feedback source | No | string, <br>**Available values:** "admin", "user" |
| has_comment | query | Only include feedback with comments | No | boolean |
| rating | query | Filter by rating | No | string, <br>**Available values:** "dislike", "like" |
| start_date | query | Start date (YYYY-MM-DD) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Feedback data exported successfully | **application/json**: [TextFileResponse](#textfileresponse)<br> |
| 400 | Invalid parameters |  |
| 500 | Internal server error |  |

### [POST] /apps/{app_id}/icon
Update application icon

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppIconPayload](#appiconpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Icon updated successfully | **application/json**: [AppDetail](#appdetail)<br> |
| 403 | Insufficient permissions |  |

### [GET] /apps/{app_id}/messages/{message_id}
Get message details by ID

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| message_id | path | Message ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Message retrieved successfully | **application/json**: [MessageDetailResponse](#messagedetailresponse)<br> |
| 404 | Message not found |  |

### [POST] /apps/{app_id}/model-config
**Modify app model config**

Update application model configuration

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ModelConfigRequest](#modelconfigrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Model configuration updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | Invalid configuration |  |
| 404 | App not found |  |

### [POST] /apps/{app_id}/name
Check if app name is available

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppNamePayload](#appnamepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Name availability checked | **application/json**: [AppDetail](#appdetail)<br> |

### [POST] /apps/{app_id}/publish-to-creators-platform
**Publish app to Creators Platform**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RedirectUrlResponse](#redirecturlresponse)<br> |

### [GET] /apps/{app_id}/server
Get MCP server configuration for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | MCP server configuration retrieved successfully | **application/json**: [AppMCPServerResponse](#appmcpserverresponse)<br> |

### [POST] /apps/{app_id}/server
Create MCP server configuration for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MCPServerCreatePayload](#mcpservercreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | MCP server configuration created successfully | **application/json**: [AppMCPServerResponse](#appmcpserverresponse)<br> |
| 403 | Insufficient permissions |  |

### [PUT] /apps/{app_id}/server
Update MCP server configuration for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MCPServerUpdatePayload](#mcpserverupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | MCP server configuration updated successfully | **application/json**: [AppMCPServerResponse](#appmcpserverresponse)<br> |
| 403 | Insufficient permissions |  |
| 404 | Server not found |  |

### [POST] /apps/{app_id}/site
Update application site configuration

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppSiteUpdatePayload](#appsiteupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Site configuration updated successfully | **application/json**: [AppSiteResponse](#appsiteresponse)<br> |
| 403 | Insufficient permissions |  |
| 404 | App not found |  |

### [POST] /apps/{app_id}/site-enable
Enable or disable app site

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppSiteStatusPayload](#appsitestatuspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Site status updated successfully | **application/json**: [AppDetail](#appdetail)<br> |
| 403 | Insufficient permissions |  |

### [POST] /apps/{app_id}/site/access-token-reset
Reset access token for application site

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Access token reset successfully | **application/json**: [AppSiteResponse](#appsiteresponse)<br> |
| 403 | Insufficient permissions (admin/owner required) |  |
| 404 | App or site not found |  |

### [DELETE] /apps/{app_id}/star
Remove the current account's star from an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 404 | App not found |  |

### [POST] /apps/{app_id}/star
Star an application for the current account

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 404 | App not found |  |

### [GET] /apps/{app_id}/statistics/average-response-time
Get average response time statistics for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Average response time statistics retrieved successfully | **application/json**: [AverageResponseTimeStatisticResponse](#averageresponsetimestatisticresponse)<br> |

### [GET] /apps/{app_id}/statistics/average-session-interactions
Get average session interaction statistics for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Average session interaction statistics retrieved successfully | **application/json**: [AverageSessionInteractionStatisticResponse](#averagesessioninteractionstatisticresponse)<br> |

### [GET] /apps/{app_id}/statistics/daily-conversations
Get daily conversation statistics for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily conversation statistics retrieved successfully | **application/json**: [DailyConversationStatisticResponse](#dailyconversationstatisticresponse)<br> |

### [GET] /apps/{app_id}/statistics/daily-end-users
Get daily terminal/end-user statistics for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily terminal statistics retrieved successfully | **application/json**: [DailyTerminalStatisticResponse](#dailyterminalstatisticresponse)<br> |

### [GET] /apps/{app_id}/statistics/daily-messages
Get daily message statistics for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily message statistics retrieved successfully | **application/json**: [DailyMessageStatisticResponse](#dailymessagestatisticresponse)<br> |

### [GET] /apps/{app_id}/statistics/token-costs
Get daily token cost statistics for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily token cost statistics retrieved successfully | **application/json**: [DailyTokenCostStatisticResponse](#dailytokencoststatisticresponse)<br> |

### [GET] /apps/{app_id}/statistics/tokens-per-second
Get tokens per second statistics for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tokens per second statistics retrieved successfully | **application/json**: [TokensPerSecondStatisticResponse](#tokenspersecondstatisticresponse)<br> |

### [GET] /apps/{app_id}/statistics/user-satisfaction-rate
Get user satisfaction rate statistics for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | User satisfaction rate statistics retrieved successfully | **application/json**: [UserSatisfactionRateStatisticResponse](#usersatisfactionratestatisticresponse)<br> |

### [POST] /apps/{app_id}/text-to-audio
Convert text to speech for chat messages

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | App ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TextToSpeechPayload](#texttospeechpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Text to speech conversion successful |
| 400 | Bad request - Invalid parameters |

### [GET] /apps/{app_id}/text-to-audio/voices
Get available TTS voices for a specific language

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | App ID | Yes | string (uuid) |
| language | query | Language code | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | TTS voices retrieved successfully | **application/json**: [TextToSpeechVoiceListResponse](#texttospeechvoicelistresponse)<br> |
| 400 | Invalid language parameter |  |

### [GET] /apps/{app_id}/trace
**Get app trace**

Get app tracing configuration

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Trace configuration retrieved successfully | **application/json**: [AppTraceResponse](#apptraceresponse)<br> |

### [POST] /apps/{app_id}/trace
Update app tracing configuration

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AppTracePayload](#apptracepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Trace configuration updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 403 | Insufficient permissions |  |

### [DELETE] /apps/{app_id}/trace-config
**Delete an existing trace app configuration**

Delete an existing tracing configuration for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| tracing_provider | query | Tracing provider name | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Tracing configuration deleted successfully |
| 400 | Invalid request parameters or configuration not found |
| 403 | Insufficient permissions |

### [GET] /apps/{app_id}/trace-config
Get tracing configuration for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| tracing_provider | query | Tracing provider name | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tracing configuration retrieved successfully | **application/json**: [TraceAppConfigResponse](#traceappconfigresponse)<br> |
| 400 | Invalid request parameters |  |

### [PATCH] /apps/{app_id}/trace-config
**Update an existing trace app configuration**

Update an existing tracing configuration for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TraceConfigPayload](#traceconfigpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tracing configuration updated successfully | **application/json**: [TraceAppConfigResponse](#traceappconfigresponse)<br> |
| 400 | Invalid request parameters or configuration not found |  |
| 403 | Insufficient permissions |  |

### [POST] /apps/{app_id}/trace-config
**Create a new trace app configuration**

Create a new tracing configuration for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TraceConfigPayload](#traceconfigpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Tracing configuration created successfully | **application/json**: [TraceAppConfigResponse](#traceappconfigresponse)<br> |
| 400 | Invalid request parameters or configuration already exists |  |
| 403 | Insufficient permissions |  |

### [POST] /apps/{app_id}/trigger-enable
**Update app trigger (enable/disable)**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserEnable](#parserenable)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WorkflowTriggerResponse](#workflowtriggerresponse)<br> |

### [GET] /apps/{app_id}/triggers
**Get app triggers list**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WorkflowTriggerListResponse](#workflowtriggerlistresponse)<br> |

### [GET] /apps/{app_id}/workflow-app-logs
**Get workflow app logs**

Get workflow application execution logs

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| created_at__after | query | Filter logs created after this timestamp | No | dateTime |
| created_at__before | query | Filter logs created before this timestamp | No | dateTime |
| created_by_account | query | Filter by account | No | string |
| created_by_end_user_session_id | query | Filter by end user session ID | No | string |
| detail | query | Whether to return detailed logs | No | boolean |
| keyword | query | Search keyword for filtering logs | No | string |
| limit | query | Number of items per page (1-100) | No | integer, <br>**Default:** 20 |
| page | query | Page number (1-99999) | No | integer, <br>**Default:** 1 |
| status | query | Execution status filter (succeeded, failed, stopped, partial-succeeded) | No | string, <br>**Available values:** "failed", "partial-succeeded", "paused", "running", "scheduled", "stopped", "succeeded" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow app logs retrieved successfully | **application/json**: [WorkflowAppLogPaginationResponse](#workflowapplogpaginationresponse)<br> |

### [GET] /apps/{app_id}/workflow-archived-logs
**Get workflow archived logs**

Get workflow archived execution logs

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| created_at__after | query | Filter logs created after this timestamp | No | dateTime |
| created_at__before | query | Filter logs created before this timestamp | No | dateTime |
| created_by_account | query | Filter by account | No | string |
| created_by_end_user_session_id | query | Filter by end user session ID | No | string |
| detail | query | Whether to return detailed logs | No | boolean |
| keyword | query | Search keyword for filtering logs | No | string |
| limit | query | Number of items per page (1-100) | No | integer, <br>**Default:** 20 |
| page | query | Page number (1-99999) | No | integer, <br>**Default:** 1 |
| status | query | Execution status filter (succeeded, failed, stopped, partial-succeeded) | No | string, <br>**Available values:** "failed", "partial-succeeded", "paused", "running", "scheduled", "stopped", "succeeded" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow archived logs retrieved successfully | **application/json**: [WorkflowArchivedLogPaginationResponse](#workflowarchivedlogpaginationresponse)<br> |

### [GET] /apps/{app_id}/workflow-runs
**Get workflow run list**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| last_id | query | Last run ID for pagination | No | string |
| limit | query | Number of items per page (1-100) | No | integer, <br>**Default:** 20 |
| status | query | Workflow run status filter | No | string, <br>**Available values:** "failed", "partial-succeeded", "running", "stopped", "succeeded" |
| triggered_from | query | Filter by trigger source: debugging or app-run. Default: debugging | No | string, <br>**Available values:** "app-run", "debugging" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs retrieved successfully | **application/json**: [WorkflowRunPaginationResponse](#workflowrunpaginationresponse)<br> |

### [GET] /apps/{app_id}/workflow-runs/count
**Get workflow runs count statistics**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| status | query | Workflow run status filter | No | string, <br>**Available values:** "failed", "partial-succeeded", "running", "stopped", "succeeded" |
| time_range | query | Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), 30m (30 minutes), 30s (30 seconds). Filters by created_at field. | No | string |
| triggered_from | query | Filter by trigger source: debugging or app-run. Default: debugging | No | string, <br>**Available values:** "app-run", "debugging" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs count retrieved successfully | **application/json**: [WorkflowRunCountResponse](#workflowruncountresponse)<br> |

### [POST] /apps/{app_id}/workflow-runs/tasks/{task_id}/stop
**Stop workflow task**

Stop running workflow task

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| task_id | path | Task ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 403 | Permission denied |  |
| 404 | Task not found |  |

### [GET] /apps/{app_id}/workflow-runs/{run_id}
**Get workflow run detail**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run detail retrieved successfully | **application/json**: [WorkflowRunDetailResponse](#workflowrundetailresponse)<br> |
| 404 | Workflow run not found |  |

### [GET] /apps/{app_id}/workflow-runs/{run_id}/export
Generate a download URL for an archived workflow run.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Export URL generated | **application/json**: [WorkflowRunExportResponse](#workflowrunexportresponse)<br> |

### [GET] /apps/{app_id}/workflow-runs/{run_id}/node-executions
**Get workflow run node execution list**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node executions retrieved successfully | **application/json**: [WorkflowRunNodeExecutionListResponse](#workflowrunnodeexecutionlistresponse)<br> |
| 404 | Workflow run not found |  |

### [GET] /apps/{app_id}/workflow-runs/{workflow_run_id}/agent-nodes/{node_id}/sandbox/files
List a directory in a workflow Agent node sandbox

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Workflow Agent node ID | Yes | string |
| workflow_run_id | path | Workflow run ID | Yes | string (uuid) |
| node_execution_id | query | Optional workflow node execution ID. When omitted, the latest active session for the node is used. | No | string |
| path | query | Directory path relative to the sandbox workspace | No | string, <br>**Default:** . |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Listing returned | **application/json**: [SandboxListResponse](#sandboxlistresponse)<br> |

### [GET] /apps/{app_id}/workflow-runs/{workflow_run_id}/agent-nodes/{node_id}/sandbox/files/read
Read a text/binary preview file in a workflow Agent node sandbox

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Workflow Agent node ID | Yes | string |
| workflow_run_id | path | Workflow run ID | Yes | string (uuid) |
| node_execution_id | query | Optional workflow node execution ID. When omitted, the latest active session for the node is used. | No | string |
| path | query | File path relative to the sandbox workspace | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Preview returned | **application/json**: [SandboxReadResponse](#sandboxreadresponse)<br> |

### [POST] /apps/{app_id}/workflow-runs/{workflow_run_id}/agent-nodes/{node_id}/sandbox/files/upload
Upload one workflow Agent sandbox file as a Dify ToolFile mapping

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |
| workflow_run_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowAgentSandboxUploadPayload](#workflowagentsandboxuploadpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Uploaded | **application/json**: [SandboxUploadResponse](#sandboxuploadresponse)<br> |

### [GET] /apps/{app_id}/workflow/comments
**Get all comments for a workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Comments retrieved successfully | **application/json**: [WorkflowCommentBasicList](#workflowcommentbasiclist)<br> |

### [POST] /apps/{app_id}/workflow/comments
**Create a new workflow comment**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowCommentCreatePayload](#workflowcommentcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Comment created successfully | **application/json**: [WorkflowCommentCreate](#workflowcommentcreate)<br> |

### [GET] /apps/{app_id}/workflow/comments/mention-users
**Get all users in current tenant for mentions**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Mentionable users retrieved successfully | **application/json**: [WorkflowCommentMentionUsersPayload](#workflowcommentmentionuserspayload)<br> |

### [DELETE] /apps/{app_id}/workflow/comments/{comment_id}
**Delete a workflow comment**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| comment_id | path | Comment ID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Comment deleted successfully |

### [GET] /apps/{app_id}/workflow/comments/{comment_id}
**Get a specific workflow comment**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| comment_id | path | Comment ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Comment retrieved successfully | **application/json**: [WorkflowCommentDetail](#workflowcommentdetail)<br> |

### [PUT] /apps/{app_id}/workflow/comments/{comment_id}
**Update a workflow comment**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| comment_id | path | Comment ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowCommentUpdatePayload](#workflowcommentupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Comment updated successfully | **application/json**: [WorkflowCommentUpdate](#workflowcommentupdate)<br> |

### [POST] /apps/{app_id}/workflow/comments/{comment_id}/replies
**Add a reply to a workflow comment**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| comment_id | path | Comment ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowCommentReplyPayload](#workflowcommentreplypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Reply created successfully | **application/json**: [WorkflowCommentReplyCreate](#workflowcommentreplycreate)<br> |

### [DELETE] /apps/{app_id}/workflow/comments/{comment_id}/replies/{reply_id}
**Delete a comment reply**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| comment_id | path | Comment ID | Yes | string |
| reply_id | path | Reply ID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Reply deleted successfully |

### [PUT] /apps/{app_id}/workflow/comments/{comment_id}/replies/{reply_id}
**Update a comment reply**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| comment_id | path | Comment ID | Yes | string |
| reply_id | path | Reply ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowCommentReplyPayload](#workflowcommentreplypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Reply updated successfully | **application/json**: [WorkflowCommentReplyUpdate](#workflowcommentreplyupdate)<br> |

### [POST] /apps/{app_id}/workflow/comments/{comment_id}/resolve
**Resolve a workflow comment**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| comment_id | path | Comment ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Comment resolved successfully | **application/json**: [WorkflowCommentResolve](#workflowcommentresolve)<br> |

### [GET] /apps/{app_id}/workflow/statistics/average-app-interactions
Get workflow average app interaction statistics

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date and time (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date and time (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Average app interaction statistics retrieved successfully | **application/json**: [WorkflowAverageAppInteractionStatisticResponse](#workflowaverageappinteractionstatisticresponse)<br> |

### [GET] /apps/{app_id}/workflow/statistics/daily-conversations
Get workflow daily runs statistics

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date and time (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date and time (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily runs statistics retrieved successfully | **application/json**: [WorkflowDailyRunsStatisticResponse](#workflowdailyrunsstatisticresponse)<br> |

### [GET] /apps/{app_id}/workflow/statistics/daily-terminals
Get workflow daily terminals statistics

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date and time (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date and time (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily terminals statistics retrieved successfully | **application/json**: [WorkflowDailyTerminalsStatisticResponse](#workflowdailyterminalsstatisticresponse)<br> |

### [GET] /apps/{app_id}/workflow/statistics/token-costs
Get workflow daily token cost statistics

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| end | query | End date and time (YYYY-MM-DD HH:MM) | No | string |
| start | query | Start date and time (YYYY-MM-DD HH:MM) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Daily token cost statistics retrieved successfully | **application/json**: [WorkflowDailyTokenCostStatisticResponse](#workflowdailytokencoststatisticresponse)<br> |

### [GET] /apps/{app_id}/workflows
**Get published workflows**

Get all published workflows for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| limit | query |  | No | integer, <br>**Default:** 10 |
| named_only | query |  | No | boolean |
| page | query |  | No | integer, <br>**Default:** 1 |
| user_id | query |  | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Published workflows retrieved successfully | **application/json**: [WorkflowPaginationResponse](#workflowpaginationresponse)<br> |

### [GET] /apps/{app_id}/workflows/default-workflow-block-configs
**Get default block config**

Get default block configurations for workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Default block configurations retrieved successfully | **application/json**: [DefaultBlockConfigsResponse](#defaultblockconfigsresponse)<br> |

### [GET] /apps/{app_id}/workflows/default-workflow-block-configs/{block_type}
**Get default block config**

Get default block configuration by type

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| block_type | path | Block type | Yes | string |
| q | query |  | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Default block configuration retrieved successfully | **application/json**: [DefaultBlockConfigResponse](#defaultblockconfigresponse)<br> |
| 404 | Block type not found |  |

### [GET] /apps/{app_id}/workflows/draft
**Get draft workflow**

Get draft workflow for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft workflow retrieved successfully | **application/json**: [WorkflowResponse](#workflowresponse)<br> |
| 404 | Draft workflow not found |  |

### [POST] /apps/{app_id}/workflows/draft
**Sync draft workflow**

Sync draft workflow configuration

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SyncDraftWorkflowPayload](#syncdraftworkflowpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft workflow synced successfully | **application/json**: [SyncDraftWorkflowResponse](#syncdraftworkflowresponse)<br> |
| 400 | Invalid workflow configuration |  |
| 403 | Permission denied |  |

### [GET] /apps/{app_id}/workflows/draft/conversation-variables
Get conversation variables for workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation variables retrieved successfully | **application/json**: [WorkflowDraftVariableList](#workflowdraftvariablelist)<br> |
| 404 | Draft workflow not found |  |

### [POST] /apps/{app_id}/workflows/draft/conversation-variables
Update conversation variables for workflow draft

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ConversationVariableUpdatePayload](#conversationvariableupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation variables updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /apps/{app_id}/workflows/draft/environment-variables
**Get draft workflow**

Get environment variables for workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Environment variables retrieved successfully | **application/json**: [EnvironmentVariableListResponse](#environmentvariablelistresponse)<br> |
| 404 | Draft workflow not found |  |

### [POST] /apps/{app_id}/workflows/draft/environment-variables
Update environment variables for workflow draft

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EnvironmentVariableUpdatePayload](#environmentvariableupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Environment variables updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /apps/{app_id}/workflows/draft/features
Update draft workflow features

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowFeaturesPayload](#workflowfeaturespayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow features updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /apps/{app_id}/workflows/draft/human-input/nodes/{node_id}/delivery-test
**Test human input delivery**

Test human input delivery for workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputDeliveryTestPayload](#humaninputdeliverytestpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Human input delivery test result | **application/json**: [EmptyObjectResponse](#emptyobjectresponse)<br> |

### [POST] /apps/{app_id}/workflows/draft/human-input/nodes/{node_id}/form/preview
**Preview human input form content and placeholders**

Get human input form preview for workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputFormPreviewPayload](#humaninputformpreviewpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Human input form preview | **application/json**: [HumanInputFormPreviewResponse](#humaninputformpreviewresponse)<br> |

### [POST] /apps/{app_id}/workflows/draft/human-input/nodes/{node_id}/form/run
**Submit human input form preview**

Submit human input form preview for workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputFormSubmitPayload](#humaninputformsubmitpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Human input form submission result | **application/json**: [HumanInputFormSubmitResponse](#humaninputformsubmitresponse)<br> |

### [POST] /apps/{app_id}/workflows/draft/iteration/nodes/{node_id}/run
**Run draft workflow iteration node**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [IterationNodeRunPayload](#iterationnoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow iteration node run started successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 403 | Permission denied |  |
| 404 | Node not found |  |

### [POST] /apps/{app_id}/workflows/draft/loop/nodes/{node_id}/run
**Run draft workflow loop node**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [LoopNodeRunPayload](#loopnoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow loop node run started successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 403 | Permission denied |  |
| 404 | Node not found |  |

### [GET] /apps/{app_id}/workflows/draft/nodes/{node_id}/agent-composer
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snapshot_id | query |  | No | string |
| app_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow agent composer state | **application/json**: [WorkflowAgentComposerResponse](#workflowagentcomposerresponse)<br> |

### [PUT] /apps/{app_id}/workflows/draft/nodes/{node_id}/agent-composer
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ComposerSavePayload](#composersavepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow agent composer saved | **application/json**: [WorkflowAgentComposerResponse](#workflowagentcomposerresponse)<br> |

### [GET] /apps/{app_id}/workflows/draft/nodes/{node_id}/agent-composer/candidates
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow agent composer candidates | **application/json**: [AgentComposerCandidatesResponse](#agentcomposercandidatesresponse)<br> |

### [POST] /apps/{app_id}/workflows/draft/nodes/{node_id}/agent-composer/copy-from-roster
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowComposerCopyFromRosterPayload](#workflowcomposercopyfromrosterpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow roster agent copied to inline agent | **application/json**: [WorkflowAgentComposerResponse](#workflowagentcomposerresponse)<br> |

### [POST] /apps/{app_id}/workflows/draft/nodes/{node_id}/agent-composer/impact
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ComposerSavePayload](#composersavepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow agent composer impact | **application/json**: [AgentComposerImpactResponse](#agentcomposerimpactresponse)<br> |

### [POST] /apps/{app_id}/workflows/draft/nodes/{node_id}/agent-composer/save-to-roster
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ComposerSavePayload](#composersavepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow agent composer saved to roster | **application/json**: [WorkflowAgentComposerResponse](#workflowagentcomposerresponse)<br> |

### [POST] /apps/{app_id}/workflows/draft/nodes/{node_id}/agent-composer/validate
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ComposerSavePayload](#composersavepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow agent composer validation result | **application/json**: [AgentComposerValidateResponse](#agentcomposervalidateresponse)<br> |

### [GET] /apps/{app_id}/workflows/draft/nodes/{node_id}/last-run
Get last run result for draft workflow node

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node last run retrieved successfully | **application/json**: [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse)<br> |
| 403 | Permission denied |  |
| 404 | Node last run not found |  |

### [POST] /apps/{app_id}/workflows/draft/nodes/{node_id}/run
**Run draft workflow node**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DraftWorkflowNodeRunPayload](#draftworkflownoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node run started successfully | **application/json**: [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse)<br> |
| 403 | Permission denied |  |
| 404 | Node not found |  |

### [POST] /apps/{app_id}/workflows/draft/nodes/{node_id}/trigger/run
**Poll for trigger events and execute single node when event arrives**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Trigger event received and node executed successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 403 | Permission denied |  |
| 500 | Internal server error |  |

### [DELETE] /apps/{app_id}/workflows/draft/nodes/{node_id}/variables
Delete all variables for a specific node

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| node_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Node variables deleted successfully |

### [GET] /apps/{app_id}/workflows/draft/nodes/{node_id}/variables
Get variables for a specific node

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node variables retrieved successfully | **application/json**: [WorkflowDraftVariableList](#workflowdraftvariablelist)<br> |

### [POST] /apps/{app_id}/workflows/draft/run
**Run draft workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DraftWorkflowRunPayload](#draftworkflowrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft workflow run started successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 403 | Permission denied |  |

### [GET] /apps/{app_id}/workflows/draft/runs/{run_id}/node-outputs
Snapshot of every node's declared outputs for a draft workflow run.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run node outputs | **application/json**: [WorkflowRunSnapshotView](#workflowrunsnapshotview)<br> |
| 404 | Workflow run not found |  |

### [GET] /apps/{app_id}/workflows/draft/runs/{run_id}/node-outputs/events
Server-Sent Events stream of inspector deltas for a draft workflow run.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run node output event stream | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 404 | Workflow run not found |  |

### [GET] /apps/{app_id}/workflows/draft/runs/{run_id}/node-outputs/{node_id}
One node's declared outputs for a draft workflow run.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID inside the workflow graph | Yes | string |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run node output detail | **application/json**: [NodeOutputsView](#nodeoutputsview)<br> |
| 404 | Workflow run / node not found |  |

### [GET] /apps/{app_id}/workflows/draft/runs/{run_id}/node-outputs/{node_id}/{output_name}/preview
Full value for one declared output, including signed download URL for files.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID inside the workflow graph | Yes | string |
| output_name | path | Declared output name as exposed by Composer | Yes | string |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run node output preview | **application/json**: [OutputPreviewView](#outputpreviewview)<br> |
| 404 | Workflow run / node / output not found |  |

### [GET] /apps/{app_id}/workflows/draft/system-variables
Get system variables for workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | System variables retrieved successfully | **application/json**: [WorkflowDraftVariableList](#workflowdraftvariablelist)<br> |

### [POST] /apps/{app_id}/workflows/draft/trigger/run
**Poll for trigger events and execute full workflow when event arrives**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DraftWorkflowTriggerRunRequest](#draftworkflowtriggerrunrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Trigger event received and workflow executed successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 403 | Permission denied |  |
| 500 | Internal server error |  |

### [POST] /apps/{app_id}/workflows/draft/trigger/run-all
**Full workflow debug when the start node is a trigger**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DraftWorkflowTriggerRunAllPayload](#draftworkflowtriggerrunallpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow executed successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 403 | Permission denied |  |
| 500 | Internal server error |  |

### [DELETE] /apps/{app_id}/workflows/draft/variables
Delete all draft workflow variables

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Workflow variables deleted successfully |

### [GET] /apps/{app_id}/workflows/draft/variables
**Get draft workflow**

Get draft workflow variables

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| limit | query | Items per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow variables retrieved successfully | **application/json**: [WorkflowDraftVariableListWithoutValue](#workflowdraftvariablelistwithoutvalue)<br> |

### [DELETE] /apps/{app_id}/workflows/draft/variables/{variable_id}
Delete a workflow variable

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Variable deleted successfully |
| 404 | Variable not found |

### [GET] /apps/{app_id}/workflows/draft/variables/{variable_id}
Get a specific workflow variable

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| variable_id | path | Variable ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable retrieved successfully | **application/json**: [WorkflowDraftVariable](#workflowdraftvariable)<br> |
| 404 | Variable not found |  |

### [PATCH] /apps/{app_id}/workflows/draft/variables/{variable_id}
Update a workflow variable

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowDraftVariableUpdatePayload](#workflowdraftvariableupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable updated successfully | **application/json**: [WorkflowDraftVariable](#workflowdraftvariable)<br> |
| 404 | Variable not found |  |

### [PUT] /apps/{app_id}/workflows/draft/variables/{variable_id}/reset
Reset a workflow variable to its default value

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| variable_id | path | Variable ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable reset successfully | **application/json**: [WorkflowDraftVariable](#workflowdraftvariable)<br> |
| 204 | Variable reset (no content) |  |
| 404 | Variable not found |  |

### [GET] /apps/{app_id}/workflows/publish
**Get published workflow**

Get published workflow for an application

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Published workflow retrieved successfully, or null if not found | **application/json**: [WorkflowResponse](#workflowresponse)<br> |

### [POST] /apps/{app_id}/workflows/publish
**Publish workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [PublishWorkflowPayload](#publishworkflowpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow published successfully | **application/json**: [WorkflowPublishResponse](#workflowpublishresponse)<br> |

### [GET] /apps/{app_id}/workflows/published/runs/{run_id}/node-outputs
Snapshot of every node's declared outputs for a published workflow run.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run node outputs | **application/json**: [WorkflowRunSnapshotView](#workflowrunsnapshotview)<br> |
| 404 | Workflow run not found |  |

### [GET] /apps/{app_id}/workflows/published/runs/{run_id}/node-outputs/events
Server-Sent Events stream of inspector deltas for a published workflow run.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run node output event stream | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |
| 404 | Workflow run not found |  |

### [GET] /apps/{app_id}/workflows/published/runs/{run_id}/node-outputs/{node_id}
One node's declared outputs for a published workflow run.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID inside the workflow graph | Yes | string |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run node output detail | **application/json**: [NodeOutputsView](#nodeoutputsview)<br> |
| 404 | Workflow run / node not found |  |

### [GET] /apps/{app_id}/workflows/published/runs/{run_id}/node-outputs/{node_id}/{output_name}/preview
Full value for one declared output of a published run.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| node_id | path | Node ID inside the workflow graph | Yes | string |
| output_name | path | Declared output name as exposed by Composer | Yes | string |
| run_id | path | Workflow run ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run node output preview | **application/json**: [OutputPreviewView](#outputpreviewview)<br> |
| 404 | Workflow run / node / output not found |  |

### [GET] /apps/{app_id}/workflows/triggers/webhook
**Get webhook trigger for a node**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | query |  | Yes | string |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WebhookTriggerResponse](#webhooktriggerresponse)<br> |

### [DELETE] /apps/{app_id}/workflows/{workflow_id}
**Delete workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| workflow_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Workflow deleted successfully |

### [PATCH] /apps/{app_id}/workflows/{workflow_id}
**Update workflow attributes**

Update workflow by ID

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| workflow_id | path | Workflow ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowUpdatePayload](#workflowupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow updated successfully | **application/json**: [WorkflowResponse](#workflowresponse)<br> |
| 403 | Permission denied |  |
| 404 | Workflow not found |  |

### [POST] /apps/{app_id}/workflows/{workflow_id}/restore
Restore a published workflow version into the draft workflow

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path | Application ID | Yes | string (uuid) |
| workflow_id | path | Published workflow ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow restored successfully | **application/json**: [WorkflowRestoreResponse](#workflowrestoreresponse)<br> |
| 400 | Source workflow must be published |  |
| 404 | Workflow not found |  |

### [GET] /apps/{resource_id}/api-keys
**Get all API keys for an app**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| resource_id | path | App ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API keys retrieved successfully | **application/json**: [ApiKeyList](#apikeylist)<br> |

### [POST] /apps/{resource_id}/api-keys
**Create a new API key for an app**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| resource_id | path | App ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | API key created successfully | **application/json**: [ApiKeyItem](#apikeyitem)<br> |
| 400 | Maximum keys exceeded |  |

### [DELETE] /apps/{resource_id}/api-keys/{api_key_id}
**Delete an API key for an app**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| api_key_id | path | API key ID | Yes | string (uuid) |
| resource_id | path | App ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | API key deleted successfully |

### [GET] /apps/{server_id}/server/refresh
Refresh MCP server configuration and regenerate server code

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| server_id | path | Server ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | MCP server refreshed successfully | **application/json**: [AppMCPServerResponse](#appmcpserverresponse)<br> |
| 403 | Insufficient permissions |  |
| 404 | Server not found |  |

### [GET] /auth/plugin/datasource/default-list
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Default datasource credentials retrieved successfully | **application/json**: [DatasourceProviderAuthListResponse](#datasourceproviderauthlistresponse)<br> |

### [GET] /auth/plugin/datasource/list
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Datasource credentials retrieved successfully | **application/json**: [DatasourceProviderAuthListResponse](#datasourceproviderauthlistresponse)<br> |

### [GET] /auth/plugin/datasource/{provider_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Datasource credentials retrieved successfully | **application/json**: [DatasourceCredentialListResponse](#datasourcecredentiallistresponse)<br> |

### [POST] /auth/plugin/datasource/{provider_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceCredentialPayload](#datasourcecredentialpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Datasource credential created successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [DELETE] /auth/plugin/datasource/{provider_id}/custom-client
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /auth/plugin/datasource/{provider_id}/custom-client
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceCustomClientPayload](#datasourcecustomclientpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Datasource OAuth custom client saved successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /auth/plugin/datasource/{provider_id}/default
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceDefaultPayload](#datasourcedefaultpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /auth/plugin/datasource/{provider_id}/delete
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceCredentialDeletePayload](#datasourcecredentialdeletepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /auth/plugin/datasource/{provider_id}/update
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceCredentialUpdatePayload](#datasourcecredentialupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Datasource credential updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /auth/plugin/datasource/{provider_id}/update-name
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceUpdateNamePayload](#datasourceupdatenamepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /billing/invoices
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [BillingInvoiceResponse](#billinginvoiceresponse)<br> |

### [PUT] /billing/partners/{partner_key}/tenants
Sync partner tenants bindings

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| partner_key | path | Partner key | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [PartnerTenantsPayload](#partnertenantspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tenants synced to partner successfully | **application/json**: [BillingResponse](#billingresponse)<br> |
| 400 | Invalid partner information |  |

### [GET] /billing/subscription
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| interval | query | Billing interval | Yes | string, <br>**Available values:** "month", "year" |
| plan | query | Subscription plan | Yes | string, <br>**Available values:** "professional", "team" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [BillingResponse](#billingresponse)<br> |

### [GET] /code-based-extension
Get code-based extension data by module name

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| module | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [CodeBasedExtensionResponse](#codebasedextensionresponse)<br> |

### [GET] /compliance/download
Get compliance document download link

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| doc_name | query | Compliance document name | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ComplianceDownloadResponse](#compliancedownloadresponse)<br> |

### [GET] /data-source/integrates
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [DataSourceIntegrateListResponse](#datasourceintegratelistresponse)<br> |

### [PATCH] /data-source/integrates
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /data-source/integrates/{binding_id}/{action}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path |  | Yes | string |
| binding_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [DataSourceIntegrateListResponse](#datasourceintegratelistresponse)<br> |

### [PATCH] /data-source/integrates/{binding_id}/{action}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path |  | Yes | string |
| binding_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /datasets
Get list of datasets

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| ids | query | Filter by dataset IDs | No | [ string ] |
| include_all | query | Include all datasets | No | boolean |
| keyword | query | Search keyword | No | string |
| limit | query | Number of items per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| tag_ids | query | Filter by tag IDs | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Datasets retrieved successfully | **application/json**: [DatasetListResponse](#datasetlistresponse)<br> |

### [POST] /datasets
Create a new dataset

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasetCreatePayload](#datasetcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Dataset created successfully | **application/json**: [DatasetDetailResponse](#datasetdetailresponse)<br> |
| 400 | Invalid request parameters |  |

### [GET] /datasets/api-base-info
Get dataset API base information

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API base info retrieved successfully | **application/json**: [ApiBaseUrlResponse](#apibaseurlresponse)<br> |

### [GET] /datasets/api-keys
Get dataset API keys

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API keys retrieved successfully | **application/json**: [ApiKeyList](#apikeylist)<br> |

### [POST] /datasets/api-keys
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API key created successfully | **application/json**: [ApiKeyItem](#apikeyitem)<br> |
| 400 | Maximum keys exceeded |  |

### [DELETE] /datasets/api-keys/{api_key_id}
Delete dataset API key

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| api_key_id | path | API key ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | API key deleted successfully |

### [GET] /datasets/batch_import_status/{job_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| job_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Batch import status | **application/json**: [SegmentBatchImportStatusResponse](#segmentbatchimportstatusresponse)<br> |

### [POST] /datasets/batch_import_status/{job_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| job_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [BatchImportPayload](#batchimportpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Batch import started | **application/json**: [SegmentBatchImportStatusResponse](#segmentbatchimportstatusresponse)<br> |

### [POST] /datasets/external
Create external knowledge dataset

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ExternalDatasetCreatePayload](#externaldatasetcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | External dataset created successfully | **application/json**: [DatasetDetail](#datasetdetail)<br> |
| 400 | Invalid parameters |  |
| 403 | Permission denied |  |

### [GET] /datasets/external-knowledge-api
Get external knowledge API templates

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| keyword | query | Search keyword | No | string |
| limit | query | Number of items per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | External API templates retrieved successfully | **application/json**: [ExternalKnowledgeApiListResponse](#externalknowledgeapilistresponse)<br> |

### [POST] /datasets/external-knowledge-api
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ExternalKnowledgeApiPayload](#externalknowledgeapipayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | External API template created successfully | **application/json**: [ExternalKnowledgeApiResponse](#externalknowledgeapiresponse)<br> |

### [DELETE] /datasets/external-knowledge-api/{external_knowledge_api_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| external_knowledge_api_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | External knowledge API deleted successfully |

### [GET] /datasets/external-knowledge-api/{external_knowledge_api_id}
Get external knowledge API template details

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| external_knowledge_api_id | path | External knowledge API ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | External API template retrieved successfully | **application/json**: [ExternalKnowledgeApiResponse](#externalknowledgeapiresponse)<br> |
| 404 | Template not found |  |

### [PATCH] /datasets/external-knowledge-api/{external_knowledge_api_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| external_knowledge_api_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ExternalKnowledgeApiPayload](#externalknowledgeapipayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | External API template updated successfully | **application/json**: [ExternalKnowledgeApiResponse](#externalknowledgeapiresponse)<br> |

### [GET] /datasets/external-knowledge-api/{external_knowledge_api_id}/use-check
Check if external knowledge API is being used

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| external_knowledge_api_id | path | External knowledge API ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Usage check completed successfully | **application/json**: [UsageCountResponse](#usagecountresponse)<br> |

### [POST] /datasets/indexing-estimate
Estimate dataset indexing cost

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [IndexingEstimatePayload](#indexingestimatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Indexing estimate calculated successfully | **application/json**: [IndexingEstimateResponse](#indexingestimateresponse)<br> |

### [POST] /datasets/init
Initialize dataset with documents

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [KnowledgeConfig](#knowledgeconfig)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Dataset initialized successfully | **application/json**: [DatasetAndDocumentResponse](#datasetanddocumentresponse)<br> |
| 400 | Invalid request parameters |  |

### [GET] /datasets/metadata/built-in
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Built-in fields retrieved successfully | **application/json**: [DatasetMetadataBuiltInFieldsResponse](#datasetmetadatabuiltinfieldsresponse)<br> |

### [POST] /datasets/notion-indexing-estimate
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [NotionEstimatePayload](#notionestimatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [IndexingEstimate](#indexingestimate)<br> |

### [GET] /datasets/process-rule
Get dataset document processing rules

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| document_id | query | Document ID (optional) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Process rules retrieved successfully | **application/json**: [OpaqueObjectResponse](#opaqueobjectresponse)<br> |

### [GET] /datasets/retrieval-setting
Get dataset retrieval settings

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Retrieval settings retrieved successfully | **application/json**: [RetrievalSettingResponse](#retrievalsettingresponse)<br> |

### [GET] /datasets/retrieval-setting/{vector_type}
Get mock dataset retrieval settings by vector type

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| vector_type | path | Vector store type | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Mock retrieval settings retrieved successfully | **application/json**: [RetrievalSettingResponse](#retrievalsettingresponse)<br> |

### [DELETE] /datasets/{dataset_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Dataset deleted successfully |

### [GET] /datasets/{dataset_id}
Get dataset details

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dataset retrieved successfully | **application/json**: [DatasetDetailWithPartialMembersResponse](#datasetdetailwithpartialmembersresponse)<br> |
| 403 | Permission denied |  |
| 404 | Dataset not found |  |

### [PATCH] /datasets/{dataset_id}
Update dataset details

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasetUpdatePayload](#datasetupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dataset updated successfully | **application/json**: [DatasetDetailWithPartialMembersResponse](#datasetdetailwithpartialmembersresponse)<br> |
| 403 | Permission denied |  |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/api-keys/{status}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| status | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /datasets/{dataset_id}/auto-disable-logs
Get dataset auto disable logs

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Auto disable logs retrieved successfully | **application/json**: [AutoDisableLogsResponse](#autodisablelogsresponse)<br> |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/batch/{batch}/indexing-estimate
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| batch | path |  | Yes | string |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Batch indexing estimate calculated successfully | **application/json**: [OpaqueObjectResponse](#opaqueobjectresponse)<br> |

### [GET] /datasets/{dataset_id}/batch/{batch}/indexing-status
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| batch | path |  | Yes | string |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Indexing status retrieved successfully | **application/json**: [DocumentStatusListResponse](#documentstatuslistresponse)<br> |

### [DELETE] /datasets/{dataset_id}/documents
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Documents deleted successfully |

### [GET] /datasets/{dataset_id}/documents
Get documents in a dataset

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| fetch | query | Fetch full details (default: false) | No | string |
| keyword | query | Search keyword | No | string |
| limit | query | Number of items per page (default: 20) | No | string |
| page | query | Page number (default: 1) | No | string |
| sort | query | Sort order (default: -created_at) | No | string |
| status | query | Filter documents by display status | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Documents retrieved successfully | **application/json**: [DocumentWithSegmentsListResponse](#documentwithsegmentslistresponse)<br> |

### [POST] /datasets/{dataset_id}/documents
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [KnowledgeConfig](#knowledgeconfig)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Documents created successfully | **application/json**: [DatasetAndDocumentResponse](#datasetanddocumentresponse)<br> |

### [POST] /datasets/{dataset_id}/documents/download-zip
**Stream a ZIP archive containing the requested uploaded documents**

Download selected dataset documents as a single ZIP archive (upload-file only)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentBatchDownloadZipPayload](#documentbatchdownloadzippayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | ZIP archive generated successfully | **application/json**: [BinaryFileResponse](#binaryfileresponse)<br> |

### [POST] /datasets/{dataset_id}/documents/generate-summary
**Generate summary index for specified documents**

Generate summary index for documents
This endpoint checks if the dataset configuration supports summary generation
(indexing_technique must be 'high_quality' and summary_index_setting.enable must be true),
then asynchronously generates summary indexes for the provided documents.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [GenerateSummaryPayload](#generatesummarypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Summary generation started successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | Invalid request or dataset configuration |  |
| 403 | Permission denied |  |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/documents/metadata
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MetadataOperationData](#metadataoperationdata)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Documents metadata updated successfully |

### [PATCH] /datasets/{dataset_id}/documents/status/{action}/batch
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path |  | Yes | string |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Document deleted successfully |

### [GET] /datasets/{dataset_id}/documents/{document_id}
Get document details

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| metadata | query | Metadata inclusion (all/only/without) | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document retrieved successfully | **application/json**: [OpaqueObjectResponse](#opaqueobjectresponse)<br> |
| 404 | Document not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/download
Get a signed download URL for a dataset document's original uploaded file

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Download URL generated successfully | **application/json**: [UrlResponse](#urlresponse)<br> |

### [GET] /datasets/{dataset_id}/documents/{document_id}/indexing-estimate
Estimate document indexing cost

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Indexing estimate calculated successfully | **application/json**: [OpaqueObjectResponse](#opaqueobjectresponse)<br> |
| 400 | Document already finished |  |
| 404 | Document not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/indexing-status
Get document indexing status

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Indexing status retrieved successfully | **application/json**: [DocumentStatusResponse](#documentstatusresponse)<br> |
| 404 | Document not found |  |

### [PUT] /datasets/{dataset_id}/documents/{document_id}/metadata
Update document metadata

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentMetadataUpdatePayload](#documentmetadataupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document metadata updated successfully | **application/json**: [SimpleResultMessageResponse](#simpleresultmessageresponse)<br> |
| 403 | Permission denied |  |
| 404 | Document not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/notion/sync
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /datasets/{dataset_id}/documents/{document_id}/pipeline-execution-log
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document pipeline execution log retrieved successfully | **application/json**: [OpaqueObjectResponse](#opaqueobjectresponse)<br> |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/processing/pause
**pause document**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Document paused successfully |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/processing/resume
**recover document**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Document resumed successfully |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/processing/{action}
Update document processing status (pause/resume)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform (pause/resume) | Yes | string |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Processing status updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | Invalid action |  |
| 404 | Document not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/rename
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentRenamePayload](#documentrenamepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document renamed successfully | **application/json**: [DocumentResponse](#documentresponse)<br> |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segment
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
| 200 | Segment created successfully | **application/json**: [SegmentDetailResponse](#segmentdetailresponse)<br> |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/segment/{action}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action | Yes | string |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | query | Segment IDs | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}/segments
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | query | Segment IDs | No | [ string ] |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Segments deleted successfully |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| enabled | query |  | No | string, <br>**Default:** all |
| hit_count_gte | query |  | No | integer |
| keyword | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |
| status | query |  | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Segments retrieved successfully | **application/json**: [ConsoleSegmentListResponse](#consolesegmentlistresponse)<br> |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments/batch_import
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Batch import status | **application/json**: [SegmentBatchImportStatusResponse](#segmentbatchimportstatusresponse)<br> |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments/batch_import
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [BatchImportPayload](#batchimportpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Batch import started | **application/json**: [SegmentBatchImportStatusResponse](#segmentbatchimportstatusresponse)<br> |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Segment ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Segment deleted successfully |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
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
| 200 | Segment updated successfully | **application/json**: [SegmentDetailResponse](#segmentdetailresponse)<br> |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks
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
| 200 | Child chunks retrieved successfully | **application/json**: [ChildChunkListResponse](#childchunklistresponse)<br> |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Parent segment ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChildChunkBatchUpdatePayload](#childchunkbatchupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Child chunks updated successfully | **application/json**: [ChildChunkBatchUpdateResponse](#childchunkbatchupdateresponse)<br> |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks
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
| 200 | Child chunk created successfully | **application/json**: [ChildChunkDetailResponse](#childchunkdetailresponse)<br> |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}
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
| 204 | Child chunk deleted successfully |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}
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
| 200 | Child chunk updated successfully | **application/json**: [ChildChunkDetailResponse](#childchunkdetailresponse)<br> |

### [GET] /datasets/{dataset_id}/documents/{document_id}/summary-status
**Get summary index generation status for a document**

Get summary index generation status for a document
Returns:
- total_segments: Total number of segments in the document
- summary_status: Dictionary with status counts
  - completed: Number of summaries completed
  - generating: Number of summaries being generated
  - error: Number of summaries with errors
  - not_started: Number of segments without summary records
- summaries: List of summary records with status and content preview

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Summary status retrieved successfully | **application/json**: [OpaqueObjectResponse](#opaqueobjectresponse)<br> |
| 404 | Document not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/website-sync
**sync website document**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| document_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /datasets/{dataset_id}/error-docs
Get dataset error documents

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Error documents retrieved successfully | **application/json**: [ErrorDocsResponse](#errordocsresponse)<br> |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/external-hit-testing
Test external knowledge retrieval for dataset

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ExternalHitTestingPayload](#externalhittestingpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | External hit testing completed successfully | **application/json**: [ExternalRetrievalTestResponse](#externalretrievaltestresponse)<br> |
| 400 | Invalid parameters |  |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/hit-testing
Test dataset knowledge retrieval

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
| 200 | Hit testing completed successfully | **application/json**: [HitTestingResponse](#hittestingresponse)<br> |
| 400 | Invalid parameters |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/indexing-status
Get dataset indexing status

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Indexing status retrieved successfully | **application/json**: [DocumentStatusListResponse](#documentstatuslistresponse)<br> |

### [GET] /datasets/{dataset_id}/metadata
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Metadata retrieved successfully | **application/json**: [DatasetMetadataListResponse](#datasetmetadatalistresponse)<br> |

### [POST] /datasets/{dataset_id}/metadata
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MetadataArgs](#metadataargs)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Metadata created successfully | **application/json**: [DatasetMetadataResponse](#datasetmetadataresponse)<br> |

### [POST] /datasets/{dataset_id}/metadata/built-in/{action}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path |  | Yes | string |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Action completed successfully |

### [DELETE] /datasets/{dataset_id}/metadata/{metadata_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| metadata_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Metadata deleted successfully |

### [PATCH] /datasets/{dataset_id}/metadata/{metadata_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| metadata_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MetadataUpdatePayload](#metadataupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Metadata updated successfully | **application/json**: [DatasetMetadataResponse](#datasetmetadataresponse)<br> |

### [GET] /datasets/{dataset_id}/notion/sync
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /datasets/{dataset_id}/permission-part-users
Get dataset permission user list

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Permission users retrieved successfully | **application/json**: [PartialMemberListResponse](#partialmemberlistresponse)<br> |
| 403 | Permission denied |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/queries
Get dataset query history

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Query history retrieved successfully | **application/json**: [DatasetQueryListResponse](#datasetquerylistresponse)<br> |

### [GET] /datasets/{dataset_id}/related-apps
Get applications related to dataset

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Related apps retrieved successfully | **application/json**: [RelatedAppListResponse](#relatedapplistresponse)<br> |

### [POST] /datasets/{dataset_id}/retry
**retry document**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentRetryPayload](#documentretrypayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Documents retry started successfully |

### [GET] /datasets/{dataset_id}/use-check
Check if dataset is in use

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dataset use status retrieved successfully | **application/json**: [UsageCheckResponse](#usagecheckresponse)<br> |

### [GET] /datasets/{resource_id}/api-keys
**Get all API keys for a dataset**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| resource_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | API keys retrieved successfully | **application/json**: [ApiKeyList](#apikeylist)<br> |

### [POST] /datasets/{resource_id}/api-keys
**Create a new API key for a dataset**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| resource_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | API key created successfully | **application/json**: [ApiKeyItem](#apikeyitem)<br> |
| 400 | Maximum keys exceeded |  |

### [DELETE] /datasets/{resource_id}/api-keys/{api_key_id}
**Delete an API key for a dataset**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| api_key_id | path | API key ID | Yes | string (uuid) |
| resource_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | API key deleted successfully |

### [POST] /email-code-login
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EmailPayload](#emailpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultDataResponse](#simpleresultdataresponse)<br> |

### [POST] /email-code-login/validity
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EmailCodeLoginPayload](#emailcodeloginpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /email-register
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EmailRegisterResetPayload](#emailregisterresetpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [EmailRegisterResetResponse](#emailregisterresetresponse)<br> |

### [POST] /email-register/send-email
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EmailRegisterSendPayload](#emailregistersendpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultDataResponse](#simpleresultdataresponse)<br> |

### [POST] /email-register/validity
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EmailRegisterValidityPayload](#emailregistervaliditypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [VerificationTokenResponse](#verificationtokenresponse)<br> |

### [GET] /explore/apps
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query | Language code for recommended app localization | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RecommendedAppListResponse](#recommendedapplistresponse)<br> |

### [GET] /explore/apps/learn-dify
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query | Language code for recommended app localization | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [LearnDifyAppListResponse](#learndifyapplistresponse)<br> |

### [GET] /explore/apps/{app_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RecommendedAppDetailNullableResponse](#recommendedappdetailnullableresponse)<br> |

### [GET] /features
**Get feature configuration for current tenant**

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [FeatureModel](#featuremodel)<br> |

### [GET] /features/vector-space
**Get vector-space usage and limit for current tenant**

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [LimitationModel](#limitationmodel)<br> |

### [GET] /files/support-type
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AllowedExtensionsResponse](#allowedextensionsresponse)<br> |

### [GET] /files/upload
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [UploadConfig](#uploadconfig)<br> |

### [POST] /files/upload
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary, **"source"**: string, <br>**Available values:** "datasets" }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileResponse](#fileresponse)<br> |

### [GET] /files/{file_id}/preview
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| file_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TextContentResponse](#textcontentresponse)<br> |

### [POST] /forgot-password
Send password reset email

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ForgotPasswordSendPayload](#forgotpasswordsendpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Email sent successfully | **application/json**: [ForgotPasswordEmailResponse](#forgotpasswordemailresponse)<br> |
| 400 | Invalid email or rate limit exceeded |  |

### [POST] /forgot-password/resets
Reset password with verification token

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ForgotPasswordResetPayload](#forgotpasswordresetpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Password reset successfully | **application/json**: [ForgotPasswordResetResponse](#forgotpasswordresetresponse)<br> |
| 400 | Invalid token or password mismatch |  |

### [POST] /forgot-password/validity
Verify password reset code

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ForgotPasswordCheckPayload](#forgotpasswordcheckpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Code verified successfully | **application/json**: [ForgotPasswordCheckResponse](#forgotpasswordcheckresponse)<br> |
| 400 | Invalid code or token |  |

### [GET] /form/human_input/{form_token}
**Get human input form definition by form token**

GET /console/api/form/human_input/<form_token>

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ConsoleHumanInputFormDefinitionResponse](#consolehumaninputformdefinitionresponse)<br> |

### [POST] /form/human_input/{form_token}
**Submit human input form by form token**

POST /console/api/form/human_input/<form_token>

Request body:
{
    "inputs": {
        "content": "User input content"
    },
    "action": "Approve"
}

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputFormSubmitPayload](#humaninputformsubmitpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ConsoleHumanInputFormSubmitResponse](#consolehumaninputformsubmitresponse)<br> |

### [POST] /info
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TenantInfoResponse](#tenantinforesponse)<br> |

### [GET] /installed-apps
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | query | App ID to filter by | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [InstalledAppListResponse](#installedapplistresponse)<br> |

### [POST] /installed-apps
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [InstalledAppCreatePayload](#installedappcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleMessageResponse](#simplemessageresponse)<br> |

### [DELETE] /installed-apps/{installed_app_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | App uninstalled successfully |

### [PATCH] /installed-apps/{installed_app_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [InstalledAppUpdatePayload](#installedappupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultMessageResponse](#simpleresultmessageresponse)<br> |

### [POST] /installed-apps/{installed_app_id}/audio-to-text
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AudioTranscriptResponse](#audiotranscriptresponse)<br> |

### [POST] /installed-apps/{installed_app_id}/chat-messages
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatMessagePayload](#chatmessagepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [POST] /installed-apps/{installed_app_id}/chat-messages/{task_id}/stop
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /installed-apps/{installed_app_id}/completion-messages
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CompletionMessageExplorePayload](#completionmessageexplorepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [POST] /installed-apps/{installed_app_id}/completion-messages/{task_id}/stop
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /installed-apps/{installed_app_id}/conversations
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| pinned | query |  | No | boolean |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ConversationInfiniteScrollPagination](#conversationinfinitescrollpagination)<br> |

### [DELETE] /installed-apps/{installed_app_id}/conversations/{c_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path |  | Yes | string (uuid) |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully |

### [POST] /installed-apps/{installed_app_id}/conversations/{c_id}/name
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path |  | Yes | string (uuid) |
| installed_app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ConversationRenamePayload](#conversationrenamepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation renamed successfully | **application/json**: [SimpleConversation](#simpleconversation)<br> |

### [PATCH] /installed-apps/{installed_app_id}/conversations/{c_id}/pin
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path |  | Yes | string (uuid) |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ResultResponse](#resultresponse)<br> |

### [PATCH] /installed-apps/{installed_app_id}/conversations/{c_id}/unpin
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path |  | Yes | string (uuid) |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ResultResponse](#resultresponse)<br> |

### [GET] /installed-apps/{installed_app_id}/messages
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| conversation_id | query | Conversation ID. | Yes | string |
| first_id | query | The ID of the first chat record on the current page. Omit this value to fetch the latest messages; for subsequent pages, use the first message ID from the current list to fetch older messages. | No | string |
| limit | query | Number of chat history messages to return per request. | No | integer, <br>**Default:** 20 |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ExploreMessageInfiniteScrollPagination](#exploremessageinfinitescrollpagination)<br> |

### [POST] /installed-apps/{installed_app_id}/messages/{message_id}/feedbacks
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |
| message_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MessageFeedbackPayload](#messagefeedbackpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Feedback submitted successfully | **application/json**: [ResultResponse](#resultresponse)<br> |

### [GET] /installed-apps/{installed_app_id}/messages/{message_id}/more-like-this
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| response_mode | query |  | Yes | string, <br>**Available values:** "blocking", "streaming" |
| installed_app_id | path |  | Yes | string (uuid) |
| message_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [GET] /installed-apps/{installed_app_id}/messages/{message_id}/suggested-questions
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |
| message_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SuggestedQuestionsResponse](#suggestedquestionsresponse)<br> |

### [GET] /installed-apps/{installed_app_id}/meta
**Get app meta**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ExploreAppMetaResponse](#exploreappmetaresponse)<br> |

### [GET] /installed-apps/{installed_app_id}/parameters
**Retrieve app parameters**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [Parameters](#parameters)<br> |

### [GET] /installed-apps/{installed_app_id}/saved-messages
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| installed_app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SavedMessageInfiniteScrollPagination](#savedmessageinfinitescrollpagination)<br> |

### [POST] /installed-apps/{installed_app_id}/saved-messages
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SavedMessageCreatePayload](#savedmessagecreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ResultResponse](#resultresponse)<br> |

### [DELETE] /installed-apps/{installed_app_id}/saved-messages/{message_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |
| message_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Saved message deleted successfully |

### [POST] /installed-apps/{installed_app_id}/text-to-audio
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TextToAudioPayload](#texttoaudiopayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AudioBinaryResponse](#audiobinaryresponse)<br> |

### [POST] /installed-apps/{installed_app_id}/workflows/run
**Run workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowRunPayload](#workflowrunpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [POST] /installed-apps/{installed_app_id}/workflows/tasks/{task_id}/stop
**Stop workflow task**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| installed_app_id | path |  | Yes | string (uuid) |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /instruction-generate
Generate instruction for workflow nodes or general use

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [InstructionGeneratePayload](#instructiongeneratepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Instruction generated successfully | **application/json**: [GeneratorResponse](#generatorresponse)<br> |
| 400 | Invalid request parameters or flow/workflow not found |  |
| 402 | Provider quota exceeded |  |

### [POST] /instruction-generate/template
Get instruction generation template

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [InstructionTemplatePayload](#instructiontemplatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Template retrieved successfully | **application/json**: [SimpleDataResponse](#simpledataresponse)<br> |
| 400 | Invalid request parameters |  |

### [POST] /login
**Authenticate user and login**

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [LoginPayload](#loginpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultOptionalDataResponse](#simpleresultoptionaldataresponse)<br> |

### [POST] /logout
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /mcp/oauth/callback
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| code | query |  | Yes | string |
| state | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 302 | Redirect to console OAuth callback page | **application/json**: [RedirectResponse](#redirectresponse)<br> |

### [GET] /notification
Return the active in-product notification for the current user in their interface language (falls back to English if unavailable). The notification is NOT marked as seen here; call POST /notification/dismiss when the user explicitly closes the modal.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success — inspect should_show to decide whether to render the modal | **application/json**: [NotificationResponse](#notificationresponse)<br> |
| 401 | Unauthorized |  |

### [POST] /notification/dismiss
Mark a notification as dismissed for the current user.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DismissNotificationPayload](#dismissnotificationpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 401 | Unauthorized |  |

### [GET] /notion/pages/{page_id}/{page_type}/preview
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | query | Credential ID | Yes | string |
| page_id | path |  | Yes | string (uuid) |
| page_type | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TextContentResponse](#textcontentresponse)<br> |

### [GET] /notion/pre-import/pages
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | query | Credential ID | Yes | string |
| dataset_id | query | Dataset ID | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [NotionIntegrateInfoListResponse](#notionintegrateinfolistresponse)<br> |

### [GET] /oauth/authorize/{provider}
Handle OAuth callback and complete login process

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | OAuth provider name (github/google) | Yes | string |
| code | query | Authorization code from OAuth provider | Yes | string |
| state | query | OAuth state parameter | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 302 | Redirect to console with access token | **application/json**: [RedirectResponse](#redirectresponse)<br> |
| 400 | OAuth process failed |  |

### [GET] /oauth/data-source/binding/{provider}
Bind OAuth data source with authorization code

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | Data source provider name (notion) | Yes | string |
| code | query | Authorization code from OAuth provider | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Data source binding success | **application/json**: [OAuthDataSourceBindingResponse](#oauthdatasourcebindingresponse)<br> |
| 400 | Invalid provider or code |  |

### [GET] /oauth/data-source/callback/{provider}
Handle OAuth callback from data source provider

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | Data source provider name (notion) | Yes | string |
| code | query | Authorization code from OAuth provider | No | string |
| error | query | Error message from OAuth provider | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 302 | Redirect to console with result | **application/json**: [RedirectResponse](#redirectresponse)<br> |
| 400 | Invalid provider |  |

### [GET] /oauth/data-source/{provider}
Get OAuth authorization URL for data source provider

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | Data source provider name (notion) | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Authorization URL or internal setup success | **application/json**: [OAuthDataSourceResponse](#oauthdatasourceresponse)<br> |
| 400 | Invalid provider |  |
| 403 | Admin privileges required |  |

### [GET] /oauth/data-source/{provider}/{binding_id}/sync
Sync data from OAuth data source

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| binding_id | path | Data source binding ID | Yes | string (uuid) |
| provider | path | Data source provider name (notion) | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Data source sync success | **application/json**: [OAuthDataSourceSyncResponse](#oauthdatasourcesyncresponse)<br> |
| 400 | Invalid provider or sync failed |  |

### [GET] /oauth/login/{provider}
Initiate OAuth login process

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path | OAuth provider name (github/google) | Yes | string |
| invite_token | query | Optional invitation token | No | string |
| language | query | Preferred interface language | No | string |
| timezone | query | Preferred timezone | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 302 | Redirect to OAuth authorization URL | **application/json**: [RedirectResponse](#redirectresponse)<br> |
| 400 | Invalid provider |  |

### [GET] /oauth/plugin/{provider_id}/datasource/callback
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| code | query | Authorization code from OAuth provider | No | string |
| context_id | query | OAuth proxy context ID | No | string |
| error | query | Error message from OAuth provider | No | string |
| state | query | OAuth state parameter | No | string |
| provider_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 302 | Redirect to OAuth callback page |

### [GET] /oauth/plugin/{provider_id}/datasource/get-authorization-url
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | query | Credential ID to reauthorize | No | string |
| provider_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Datasource OAuth authorization URL generated successfully | **application/json**: [PluginOAuthAuthorizationUrlResponse](#pluginoauthauthorizationurlresponse)<br> |

### [GET] /oauth/plugin/{provider}/tool/authorization-url
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Authorization URL retrieved successfully | **application/json**: [PluginOAuthAuthorizationUrlResponse](#pluginoauthauthorizationurlresponse)<br> |

### [GET] /oauth/plugin/{provider}/tool/callback
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 302 | Redirect to console OAuth callback page | **application/json**: [RedirectResponse](#redirectresponse)<br> |

### [GET] /oauth/plugin/{provider}/trigger/callback
**Handle OAuth callback for trigger provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 302 | Redirect to console OAuth callback page | **application/json**: [RedirectResponse](#redirectresponse)<br> |

### [POST] /oauth/provider
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [OAuthProviderRequest](#oauthproviderrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [OAuthProviderAppResponse](#oauthproviderappresponse)<br> |

### [POST] /oauth/provider/account
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [OAuthClientPayload](#oauthclientpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [OAuthProviderAccountResponse](#oauthprovideraccountresponse)<br> |

### [POST] /oauth/provider/authorize
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [OAuthClientPayload](#oauthclientpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [OAuthProviderAuthorizeResponse](#oauthproviderauthorizeresponse)<br> |

### [POST] /oauth/provider/token
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [OAuthTokenRequest](#oauthtokenrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [OAuthProviderTokenResponse](#oauthprovidertokenresponse)<br> |

### [DELETE] /rag/pipeline/customized/templates/{template_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| template_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Pipeline template deleted |

### [PATCH] /rag/pipeline/customized/templates/{template_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| template_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CustomizedPipelineTemplatePayload](#customizedpipelinetemplatepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Pipeline template updated |

### [POST] /rag/pipeline/customized/templates/{template_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| template_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleDataResponse](#simpledataresponse)<br> |

### [POST] /rag/pipeline/dataset
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RagPipelineDatasetImportPayload](#ragpipelinedatasetimportpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | RAG pipeline dataset import started | **application/json**: [RagPipelineImportResponse](#ragpipelineimportresponse)<br> |

### [POST] /rag/pipeline/empty-dataset
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | RAG pipeline dataset created | **application/json**: [DatasetDetailResponse](#datasetdetailresponse)<br> |

### [GET] /rag/pipeline/templates
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query | Template language | No | string, <br>**Default:** en-US |
| type | query | Template source: built-in or customized | No | string, <br>**Default:** built-in |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Pipeline templates | **application/json**: [PipelineTemplateListResponse](#pipelinetemplatelistresponse)<br> |

### [GET] /rag/pipeline/templates/{template_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| type | query | Template source: built-in or customized | No | string, <br>**Default:** built-in |
| template_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Pipeline template | **application/json**: [PipelineTemplateDetailResponse](#pipelinetemplatedetailresponse)<br> |

### [GET] /rag/pipelines/datasource-plugins
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineOpaqueResponse](#ragpipelineopaqueresponse)<br> |

### [POST] /rag/pipelines/imports
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RagPipelineImportPayload](#ragpipelineimportpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Import completed | **application/json**: [RagPipelineImportResponse](#ragpipelineimportresponse)<br> |
| 202 | Import pending confirmation | **application/json**: [RagPipelineImportResponse](#ragpipelineimportresponse)<br> |
| 400 | Import failed | **application/json**: [RagPipelineImportResponse](#ragpipelineimportresponse)<br> |

### [POST] /rag/pipelines/imports/{import_id}/confirm
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| import_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Import confirmed | **application/json**: [RagPipelineImportResponse](#ragpipelineimportresponse)<br> |
| 400 | Import failed | **application/json**: [RagPipelineImportResponse](#ragpipelineimportresponse)<br> |

### [GET] /rag/pipelines/imports/{pipeline_id}/check-dependencies
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dependencies checked | **application/json**: [RagPipelineImportCheckDependenciesResponse](#ragpipelineimportcheckdependenciesresponse)<br> |

### [GET] /rag/pipelines/recommended-plugins
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| type | query |  | No | string, <br>**Default:** all |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineOpaqueResponse](#ragpipelineopaqueresponse)<br> |

### [POST] /rag/pipelines/transform/datasets/{dataset_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineOpaqueResponse](#ragpipelineopaqueresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/customized/publish
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CustomizedPipelineTemplatePayload](#customizedpipelinetemplatepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Pipeline template published |

### [GET] /rag/pipelines/{pipeline_id}/exports
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| include_secret | query | Whether to include secret values in the exported DSL | No | string, <br>**Default:** false |
| pipeline_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Pipeline exported | **application/json**: [SimpleDataResponse](#simpledataresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflow-runs
**Get workflow run list**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs retrieved successfully | **application/json**: [WorkflowRunPaginationResponse](#workflowrunpaginationresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflow-runs/tasks/{task_id}/stop
**Stop workflow task**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflow-runs/{run_id}
**Get workflow run detail**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| run_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run detail retrieved successfully | **application/json**: [WorkflowRunDetailResponse](#workflowrundetailresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflow-runs/{run_id}/node-executions
**Get workflow run node execution list**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| run_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node executions retrieved successfully | **application/json**: [WorkflowRunNodeExecutionListResponse](#workflowrunnodeexecutionlistresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows
**Get published workflows**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer, <br>**Default:** 10 |
| named_only | query |  | No | boolean |
| page | query |  | No | integer, <br>**Default:** 1 |
| user_id | query |  | No | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Published workflows retrieved successfully | **application/json**: [WorkflowPaginationResponse](#workflowpaginationresponse)<br> |
| 403 | Permission denied |  |

### [GET] /rag/pipelines/{pipeline_id}/workflows/default-workflow-block-configs
**Get default block config**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Default block configs retrieved successfully | **application/json**: [DefaultBlockConfigsResponse](#defaultblockconfigsresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows/default-workflow-block-configs/{block_type}
**Get default block config**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| q | query |  | No | string |
| block_type | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Default block config retrieved successfully | **application/json**: [DefaultBlockConfigResponse](#defaultblockconfigresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows/draft
**Get draft rag pipeline's workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft workflow retrieved successfully | **application/json**: [WorkflowResponse](#workflowresponse)<br> |
| 404 | Draft workflow not found |  |

### [POST] /rag/pipelines/{pipeline_id}/workflows/draft
**Sync draft workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DraftWorkflowSyncPayload](#draftworkflowsyncpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineWorkflowSyncResponse](#ragpipelineworkflowsyncresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflows/draft/datasource/nodes/{node_id}/run
**Run rag pipeline datasource**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceNodeRunPayload](#datasourcenoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineOpaqueResponse](#ragpipelineopaqueresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflows/draft/datasource/variables-inspect
**Set datasource variables**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceVariablesPayload](#datasourcevariablespayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Datasource variables set successfully | **application/json**: [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows/draft/environment-variables
**Get draft workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Environment variables retrieved successfully | **application/json**: [EnvironmentVariableListResponse](#environmentvariablelistresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflows/draft/iteration/nodes/{node_id}/run
**Run draft workflow iteration node**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [NodeRunPayload](#noderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineOpaqueResponse](#ragpipelineopaqueresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflows/draft/loop/nodes/{node_id}/run
**Run draft workflow loop node**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [NodeRunPayload](#noderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineOpaqueResponse](#ragpipelineopaqueresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows/draft/nodes/{node_id}/last-run
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node last run retrieved successfully | **application/json**: [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflows/draft/nodes/{node_id}/run
**Run draft workflow node**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [NodeRunRequiredPayload](#noderunrequiredpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node run started successfully | **application/json**: [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse)<br> |

### [DELETE] /rag/pipelines/{pipeline_id}/workflows/draft/nodes/{node_id}/variables
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Node variables deleted successfully |

### [GET] /rag/pipelines/{pipeline_id}/workflows/draft/nodes/{node_id}/variables
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node variables retrieved successfully | **application/json**: [WorkflowDraftVariableList](#workflowdraftvariablelist)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows/draft/pre-processing/parameters
**Get first step parameters of rag pipeline**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | query |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineStepParametersResponse](#ragpipelinestepparametersresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows/draft/processing/parameters
**Get second step parameters of rag pipeline**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | query |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineStepParametersResponse](#ragpipelinestepparametersresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflows/draft/run
**Run draft workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DraftWorkflowRunPayload](#draftworkflowrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineOpaqueResponse](#ragpipelineopaqueresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows/draft/system-variables
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | System variables retrieved successfully | **application/json**: [WorkflowDraftVariableList](#workflowdraftvariablelist)<br> |

### [DELETE] /rag/pipelines/{pipeline_id}/workflows/draft/variables
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Workflow variables deleted successfully |

### [GET] /rag/pipelines/{pipeline_id}/workflows/draft/variables
**Get draft workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow variables retrieved successfully | **application/json**: [WorkflowDraftVariableListWithoutValue](#workflowdraftvariablelistwithoutvalue)<br> |

### [DELETE] /rag/pipelines/{pipeline_id}/workflows/draft/variables/{variable_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Variable deleted successfully |

### [GET] /rag/pipelines/{pipeline_id}/workflows/draft/variables/{variable_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable retrieved successfully | **application/json**: [WorkflowDraftVariable](#workflowdraftvariable)<br> |

### [PATCH] /rag/pipelines/{pipeline_id}/workflows/draft/variables/{variable_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowDraftVariablePatchPayload](#workflowdraftvariablepatchpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable updated successfully | **application/json**: [WorkflowDraftVariable](#workflowdraftvariable)<br> |

### [PUT] /rag/pipelines/{pipeline_id}/workflows/draft/variables/{variable_id}/reset
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable reset successfully | **application/json**: [WorkflowDraftVariable](#workflowdraftvariable)<br> |
| 204 | Variable reset (no content) |  |

### [GET] /rag/pipelines/{pipeline_id}/workflows/publish
**Get published pipeline**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Published workflow retrieved successfully, or null if not exist | **application/json**: [WorkflowResponse](#workflowresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflows/publish
**Publish workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineWorkflowPublishResponse](#ragpipelineworkflowpublishresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflows/published/datasource/nodes/{node_id}/preview
**Run datasource content preview**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [Parser](#parser)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [POST] /rag/pipelines/{pipeline_id}/workflows/published/datasource/nodes/{node_id}/run
**Run rag pipeline datasource**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasourceNodeRunPayload](#datasourcenoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineOpaqueResponse](#ragpipelineopaqueresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows/published/pre-processing/parameters
**Get first step parameters of rag pipeline**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | query |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineStepParametersResponse](#ragpipelinestepparametersresponse)<br> |

### [GET] /rag/pipelines/{pipeline_id}/workflows/published/processing/parameters
**Get second step parameters of rag pipeline**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | query |  | Yes | string |
| pipeline_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineStepParametersResponse](#ragpipelinestepparametersresponse)<br> |

### [POST] /rag/pipelines/{pipeline_id}/workflows/published/run
**Run published workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [PublishedWorkflowRunPayload](#publishedworkflowrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineOpaqueResponse](#ragpipelineopaqueresponse)<br> |

### [DELETE] /rag/pipelines/{pipeline_id}/workflows/{workflow_id}
**Delete a published workflow version that is not currently active on the pipeline**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| workflow_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Workflow deleted successfully |

### [PATCH] /rag/pipelines/{pipeline_id}/workflows/{workflow_id}
**Update workflow attributes**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| workflow_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowUpdatePayload](#workflowupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow updated successfully | **application/json**: [WorkflowResponse](#workflowresponse)<br> |
| 400 | No valid fields to update |  |
| 403 | Permission denied |  |
| 404 | Workflow not found |  |

### [POST] /rag/pipelines/{pipeline_id}/workflows/{workflow_id}/restore
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| pipeline_id | path |  | Yes | string (uuid) |
| workflow_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RagPipelineWorkflowSyncResponse](#ragpipelineworkflowsyncresponse)<br> |

### [POST] /refresh-token
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 401 | Unauthorized | **application/json**: [SimpleResultMessageResponse](#simpleresultmessageresponse)<br> |

### [POST] /remote-files/upload
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RemoteFileUploadPayload](#remotefileuploadpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileWithSignedUrl](#filewithsignedurl)<br> |

### [GET] /remote-files/{url}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| url | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RemoteFileInfo](#remotefileinfo)<br> |

### [POST] /reset-password
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EmailPayload](#emailpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultDataResponse](#simpleresultdataresponse)<br> |

### [POST] /rule-code-generate
Generate code rules using LLM

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RuleCodeGeneratePayload](#rulecodegeneratepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Code rules generated successfully | **application/json**: [GeneratorResponse](#generatorresponse)<br> |
| 400 | Invalid request parameters |  |
| 402 | Provider quota exceeded |  |

### [POST] /rule-generate
Generate rule configuration using LLM

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RuleGeneratePayload](#rulegeneratepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Rule configuration generated successfully | **application/json**: [GeneratorResponse](#generatorresponse)<br> |
| 400 | Invalid request parameters |  |
| 402 | Provider quota exceeded |  |

### [POST] /rule-structured-output-generate
Generate structured output rules using LLM

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RuleStructuredOutputPayload](#rulestructuredoutputpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Structured output generated successfully | **application/json**: [GeneratorResponse](#generatorresponse)<br> |
| 400 | Invalid request parameters |  |
| 402 | Provider quota exceeded |  |

### [GET] /snippets/{snippet_id}/workflow-runs
**List workflow runs for snippet**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow runs retrieved successfully | **application/json**: [WorkflowRunPaginationResponse](#workflowrunpaginationresponse)<br> |

### [POST] /snippets/{snippet_id}/workflow-runs/tasks/{task_id}/stop
**Stop a running snippet workflow task**

Uses both the legacy stop flag mechanism and the graph engine
command channel for backward compatibility.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 404 | Snippet not found |  |

### [GET] /snippets/{snippet_id}/workflow-runs/{run_id}
**Get workflow run detail for snippet**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| run_id | path |  | Yes | string (uuid) |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run detail retrieved successfully | **application/json**: [WorkflowRunDetailResponse](#workflowrundetailresponse)<br> |
| 404 | Workflow run not found |  |

### [GET] /snippets/{snippet_id}/workflow-runs/{run_id}/node-executions
**List node executions for a workflow run**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| run_id | path |  | Yes | string (uuid) |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node executions retrieved successfully | **application/json**: [WorkflowRunNodeExecutionListResponse](#workflowrunnodeexecutionlistresponse)<br> |

### [GET] /snippets/{snippet_id}/workflows
**Get all published workflow versions for snippet**

Get all published workflows for a snippet

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path | Snippet ID | Yes | string (uuid) |
| limit | query |  | No | integer, <br>**Default:** 10 |
| page | query |  | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Published workflows retrieved successfully | **application/json**: [SnippetWorkflowPaginationResponse](#snippetworkflowpaginationresponse)<br> |

### [GET] /snippets/{snippet_id}/workflows/default-workflow-block-configs
**Get default block configurations for snippet workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Default block configs retrieved successfully | **application/json**: [DefaultBlockConfigsResponse](#defaultblockconfigsresponse)<br> |

### [GET] /snippets/{snippet_id}/workflows/draft
**Get draft workflow for snippet**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft workflow retrieved successfully | **application/json**: [SnippetWorkflowResponse](#snippetworkflowresponse)<br> |
| 404 | Snippet or draft workflow not found |  |

### [POST] /snippets/{snippet_id}/workflows/draft
**Sync draft workflow for snippet**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SnippetDraftSyncPayload](#snippetdraftsyncpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft workflow synced successfully | **application/json**: [WorkflowRestoreResponse](#workflowrestoreresponse)<br> |
| 400 | Hash mismatch |  |

### [GET] /snippets/{snippet_id}/workflows/draft/config
**Get snippet draft workflow configuration limits**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft config retrieved successfully | **application/json**: [SnippetDraftConfigResponse](#snippetdraftconfigresponse)<br> |

### [GET] /snippets/{snippet_id}/workflows/draft/conversation-variables
Conversation variables are not used in snippet workflows; returns an empty list for API parity

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation variables retrieved successfully | **application/json**: [WorkflowDraftVariableList](#workflowdraftvariablelist)<br> |

### [GET] /snippets/{snippet_id}/workflows/draft/environment-variables
Get environment variables from snippet draft workflow graph

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Environment variables retrieved successfully | **application/json**: [EnvironmentVariableListResponse](#environmentvariablelistresponse)<br> |
| 404 | Draft workflow not found |  |

### [POST] /snippets/{snippet_id}/workflows/draft/iteration/nodes/{node_id}/run
**Run a draft workflow iteration node for snippet**

Run draft workflow iteration node for snippet
Iteration nodes execute their internal sub-graph multiple times over an input list.
Returns an SSE event stream with iteration progress and results.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path | Node ID | Yes | string |
| snippet_id | path | Snippet ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SnippetIterationNodeRunPayload](#snippetiterationnoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Iteration node run started successfully (SSE stream) | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 404 | Snippet or draft workflow not found |  |

### [POST] /snippets/{snippet_id}/workflows/draft/loop/nodes/{node_id}/run
**Run a draft workflow loop node for snippet**

Run draft workflow loop node for snippet
Loop nodes execute their internal sub-graph repeatedly until a condition is met.
Returns an SSE event stream with loop progress and results.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path | Node ID | Yes | string |
| snippet_id | path | Snippet ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SnippetLoopNodeRunPayload](#snippetloopnoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Loop node run started successfully (SSE stream) | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 404 | Snippet or draft workflow not found |  |

### [GET] /snippets/{snippet_id}/workflows/draft/nodes/{node_id}/last-run
**Get the last run result for a specific node in snippet draft workflow**

Get last run result for a node in snippet draft workflow
Returns the most recent execution record for the given node,
including status, inputs, outputs, and timing information.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path | Node ID | Yes | string |
| snippet_id | path | Snippet ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node last run retrieved successfully | **application/json**: [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse)<br> |
| 404 | Snippet, draft workflow, or node last run not found |  |

### [POST] /snippets/{snippet_id}/workflows/draft/nodes/{node_id}/run
**Run a single node in snippet draft workflow**

Run a single node in snippet draft workflow (single-step debugging)
Executes a specific node with provided inputs for single-step debugging.
Returns the node execution result including status, outputs, and timing.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path | Node ID | Yes | string |
| snippet_id | path | Snippet ID | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SnippetDraftNodeRunPayload](#snippetdraftnoderunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node run completed successfully | **application/json**: [WorkflowRunNodeExecutionResponse](#workflowrunnodeexecutionresponse)<br> |
| 404 | Snippet or draft workflow not found |  |

### [DELETE] /snippets/{snippet_id}/workflows/draft/nodes/{node_id}/variables
Delete all variables for a specific node (snippet draft workflow)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Node variables deleted successfully |

### [GET] /snippets/{snippet_id}/workflows/draft/nodes/{node_id}/variables
Get variables for a specific node (snippet draft workflow)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| node_id | path |  | Yes | string |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Node variables retrieved successfully | **application/json**: [WorkflowDraftVariableList](#workflowdraftvariablelist)<br> |

### [POST] /snippets/{snippet_id}/workflows/draft/run
**Run draft workflow for snippet**

Executes the snippet's draft workflow with the provided inputs
and returns an SSE event stream with execution progress and results.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SnippetDraftRunPayload](#snippetdraftrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Draft workflow run started successfully (SSE stream) | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 404 | Snippet or draft workflow not found |  |

### [GET] /snippets/{snippet_id}/workflows/draft/system-variables
System variables are not used in snippet workflows; returns an empty list for API parity

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | System variables retrieved successfully | **application/json**: [WorkflowDraftVariableList](#workflowdraftvariablelist)<br> |

### [DELETE] /snippets/{snippet_id}/workflows/draft/variables
Delete all draft workflow variables for the current user (snippet scope)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Workflow variables deleted successfully |

### [GET] /snippets/{snippet_id}/workflows/draft/variables
List draft workflow variables without values (paginated, snippet scope)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query | Items per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow variables retrieved successfully | **application/json**: [WorkflowDraftVariableListWithoutValue](#workflowdraftvariablelistwithoutvalue)<br> |

### [DELETE] /snippets/{snippet_id}/workflows/draft/variables/{variable_id}
Delete a draft workflow variable (snippet scope)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Variable deleted successfully |
| 404 | Variable not found |

### [GET] /snippets/{snippet_id}/workflows/draft/variables/{variable_id}
Get a specific draft workflow variable (snippet scope)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable retrieved successfully | **application/json**: [WorkflowDraftVariable](#workflowdraftvariable)<br> |
| 404 | Variable not found |  |

### [PATCH] /snippets/{snippet_id}/workflows/draft/variables/{variable_id}
Update a draft workflow variable (snippet scope)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowDraftVariableUpdatePayload](#workflowdraftvariableupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable updated successfully | **application/json**: [WorkflowDraftVariable](#workflowdraftvariable)<br> |
| 404 | Variable not found |  |

### [PUT] /snippets/{snippet_id}/workflows/draft/variables/{variable_id}/reset
Reset a draft workflow variable to its default value (snippet scope)

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |
| variable_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable reset successfully | **application/json**: [WorkflowDraftVariable](#workflowdraftvariable)<br> |
| 204 | Variable reset (no content) |  |
| 404 | Variable not found |  |

### [GET] /snippets/{snippet_id}/workflows/publish
**Get published workflow for snippet**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Published workflow retrieved successfully | **application/json**: [SnippetWorkflowResponse](#snippetworkflowresponse)<br> |
| 404 | Snippet not found |  |

### [POST] /snippets/{snippet_id}/workflows/publish
**Publish snippet workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [PublishWorkflowPayload](#publishworkflowpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow published successfully | **application/json**: [WorkflowPublishResponse](#workflowpublishresponse)<br> |
| 400 | No draft workflow found |  |

### [PATCH] /snippets/{snippet_id}/workflows/{workflow_id}
**Update a published snippet workflow version's display metadata**

Update published snippet workflow attributes

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path | Snippet ID | Yes | string (uuid) |
| workflow_id | path | Workflow ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowUpdatePayload](#workflowupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow updated successfully | **application/json**: [SnippetWorkflowResponse](#snippetworkflowresponse)<br> |
| 400 | No valid fields to update |  |
| 404 | Workflow not found |  |

### [POST] /snippets/{snippet_id}/workflows/{workflow_id}/restore
**Restore a published snippet workflow version into the draft workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path | Snippet ID | Yes | string (uuid) |
| workflow_id | path | Published workflow ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow restored successfully | **application/json**: [WorkflowRestoreResponse](#workflowrestoreresponse)<br> |
| 400 | Source workflow must be published |  |
| 404 | Workflow not found |  |

### [GET] /spec/schema-definitions
**Get system JSON Schema definitions specification**

Used for frontend component type mapping

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SchemaDefinitionsResponse](#schemadefinitionsresponse)<br> |

### [GET] /system-features
**Get system-wide feature configuration**

Get system-wide feature configuration
NOTE: This endpoint is unauthenticated by design, as it provides system features
data required for dashboard initialization.

Authentication would create circular dependency (can't login without dashboard loading).

Only non-sensitive configuration data should be returned by this endpoint.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SystemFeatureModel](#systemfeaturemodel)<br> |

### [POST] /tag-bindings
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagBindingPayload](#tagbindingpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /tag-bindings/remove
Remove one or more tag bindings from a target.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagBindingRemovePayload](#tagbindingremovepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /tags
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| keyword | query | Search keyword | No | string |
| type | query | Tag type filter | No | string, <br>**Available values:** "", "app", "knowledge", "snippet" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TagListResponse](#taglistresponse)<br> |

### [POST] /tags
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagBasePayload](#tagbasepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TagResponse](#tagresponse)<br> |

### [DELETE] /tags/{tag_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| tag_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Tag deleted successfully |

### [PATCH] /tags/{tag_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| tag_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagUpdateRequestPayload](#tagupdaterequestpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TagResponse](#tagresponse)<br> |

### [POST] /test/retrieval
Bedrock retrieval test (internal use only)

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [BedrockRetrievalPayload](#bedrockretrievalpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Bedrock retrieval test completed | **application/json**: [ExternalRetrievalTestResponse](#externalretrievaltestresponse)<br> |

### [GET] /trial-apps/{app_id}
**Get app detail**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TrialAppDetailResponse](#trialappdetailresponse)<br> |

### [POST] /trial-apps/{app_id}/audio-to-text
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AudioTranscriptResponse](#audiotranscriptresponse)<br> |

### [POST] /trial-apps/{app_id}/chat-messages
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatRequest](#chatrequest)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [POST] /trial-apps/{app_id}/completion-messages
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CompletionRequest](#completionrequest)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [GET] /trial-apps/{app_id}/datasets
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| ids | query | Dataset IDs | No | [ string ] |
| limit | query | Number of items per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TrialDatasetListResponse](#trialdatasetlistresponse)<br> |

### [GET] /trial-apps/{app_id}/messages/{message_id}/suggested-questions
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| message_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SuggestedQuestionsResponse](#suggestedquestionsresponse)<br> |

### [GET] /trial-apps/{app_id}/parameters
**Retrieve app parameters**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [Parameters](#parameters)<br> |

### [GET] /trial-apps/{app_id}/site
**Retrieve app site info**

Returns the site configuration for the application including theme, icons, and text.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [Site](#site)<br> |

### [POST] /trial-apps/{app_id}/text-to-audio
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TextToSpeechRequest](#texttospeechrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AudioBinaryResponse](#audiobinaryresponse)<br> |

### [GET] /trial-apps/{app_id}/workflows
**Get workflow detail**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TrialWorkflowResponse](#trialworkflowresponse)<br> |

### [POST] /trial-apps/{app_id}/workflows/run
**Run workflow**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowRunRequest](#workflowrunrequest)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [POST] /trial-apps/{app_id}/workflows/tasks/{task_id}/stop
**Stop workflow task**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /trial-models
**Get hosted trial model provider configuration for model-provider pages**

Get hosted trial model provider configuration

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TrialModelsResponse](#trialmodelsresponse)<br> |

### [POST] /website/crawl
Crawl website content

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WebsiteCrawlPayload](#websitecrawlpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Website crawl initiated successfully | **application/json**: [WebsiteCrawlResponse](#websitecrawlresponse)<br> |
| 400 | Invalid crawl parameters |  |

### [GET] /website/crawl/status/{job_id}
Get website crawl status

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| job_id | path | Crawl job ID | Yes | string |
| provider | query | Crawl provider (firecrawl/watercrawl/jinareader) | Yes | string, <br>**Available values:** "firecrawl", "jinareader", "watercrawl" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Crawl status retrieved successfully | **application/json**: [WebsiteCrawlResponse](#websitecrawlresponse)<br> |
| 400 | Invalid provider |  |
| 404 | Crawl job not found |  |

### [POST] /workflow-generate
Generate a Dify workflow graph from natural language

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowGeneratePayload](#workflowgeneratepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow graph generated successfully | **application/json**: [GeneratorResponse](#generatorresponse)<br> |
| 400 | Invalid request parameters |  |
| 402 | Provider quota exceeded |  |

### [POST] /workflow-generate/stream
Stream a Dify workflow graph (plan then result) via SSE

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowGeneratePayload](#workflowgeneratepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Server-Sent Events stream of plan/result events |
| 400 | Invalid request parameters |

### [POST] /workflow-generate/suggestions
Suggest example workflow-generator instructions for the tenant

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowInstructionSuggestionsPayload](#workflowinstructionsuggestionspayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Suggestions generated successfully | **application/json**: [GeneratorResponse](#generatorresponse)<br> |
| 400 | Invalid request parameters |  |

### [GET] /workflow/{workflow_run_id}/events
**Get workflow execution events stream after resume**

GET /console/api/workflow/<workflow_run_id>/events

Returns Server-Sent Events stream.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_run_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | SSE event stream | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |

### [GET] /workflow/{workflow_run_id}/pause-details
**Get workflow pause details**

Get workflow pause details
GET /console/api/workflow/<workflow_run_id>/pause-details

Returns information about why and where the workflow is paused.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_run_id | path | Workflow run ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow pause details retrieved successfully | **application/json**: [WorkflowPauseDetailsResponse](#workflowpausedetailsresponse)<br> |
| 404 | Workflow run not found |  |

### [GET] /workspaces
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TenantListResponse](#tenantlistresponse)<br> |

### [POST] /workspaces/current
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TenantInfoResponse](#tenantinforesponse)<br> |

### [GET] /workspaces/current/agent-provider/{provider_name}
Get specific agent provider details

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_name | path | Agent provider name | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AgentProviderResponse](#agentproviderresponse)<br> |

### [GET] /workspaces/current/agent-providers
Get list of available agent providers

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AgentProviderListResponse](#agentproviderlistresponse)<br> |

### [GET] /workspaces/current/customized-snippets
**List customized snippets with pagination and search**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| creators | query | Filter by creator account IDs | No | [ string ] |
| is_published | query | Filter by published status | No | boolean |
| keyword | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |
| tag_ids | query | Filter by tag IDs | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Snippets retrieved successfully | **application/json**: [SnippetPaginationResponse](#snippetpaginationresponse)<br> |

### [POST] /workspaces/current/customized-snippets
**Create a new customized snippet**

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CreateSnippetPayload](#createsnippetpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Snippet created successfully | **application/json**: [SnippetResponse](#snippetresponse)<br> |
| 400 | Invalid request |  |

### [POST] /workspaces/current/customized-snippets/imports
**Import snippet from DSL**

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SnippetImportPayload](#snippetimportpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Snippet imported successfully | **application/json**: [SnippetImportResponse](#snippetimportresponse)<br> |
| 202 | Import pending confirmation | **application/json**: [SnippetImportResponse](#snippetimportresponse)<br> |
| 400 | Import failed |  |

### [POST] /workspaces/current/customized-snippets/imports/{import_id}/confirm
**Confirm a pending snippet import**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| import_id | path | Import ID to confirm | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Import confirmed successfully | **application/json**: [SnippetImportResponse](#snippetimportresponse)<br> |
| 400 | Import failed |  |

### [DELETE] /workspaces/current/customized-snippets/{snippet_id}
**Delete customized snippet**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Snippet deleted successfully |
| 404 | Snippet not found |

### [GET] /workspaces/current/customized-snippets/{snippet_id}
**Get customized snippet details**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Snippet retrieved successfully | **application/json**: [SnippetResponse](#snippetresponse)<br> |
| 404 | Snippet not found |  |

### [PATCH] /workspaces/current/customized-snippets/{snippet_id}
**Update customized snippet**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [UpdateSnippetPayload](#updatesnippetpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Snippet updated successfully | **application/json**: [SnippetResponse](#snippetresponse)<br> |
| 400 | Invalid request |  |
| 404 | Snippet not found |  |

### [GET] /workspaces/current/customized-snippets/{snippet_id}/check-dependencies
**Check dependencies for a snippet**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path | Snippet ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dependencies checked successfully | **application/json**: [SnippetDependencyCheckResponse](#snippetdependencycheckresponse)<br> |
| 404 | Snippet not found |  |

### [GET] /workspaces/current/customized-snippets/{snippet_id}/export
**Export snippet as DSL**

Export snippet configuration as DSL

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path | Snippet ID to export | Yes | string (uuid) |
| include_secret | query | Whether to include secret variables | No | string, <br>**Default:** false |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Snippet exported successfully | **application/json**: [TextFileResponse](#textfileresponse)<br> |
| 404 | Snippet not found |  |

### [POST] /workspaces/current/customized-snippets/{snippet_id}/use-count/increment
**Increment snippet use count when it is inserted into a workflow**

Increment snippet use count by 1

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| snippet_id | path | Snippet ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Use count incremented successfully | **application/json**: [SnippetUseCountResponse](#snippetusecountresponse)<br> |
| 404 | Snippet not found |  |

### [GET] /workspaces/current/dataset-operators
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountWithRoleListResponse](#accountwithrolelistresponse)<br> |

### [GET] /workspaces/current/default-model
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | query | Enum class for model type. | Yes | string, <br>**Available values:** "llm", "moderation", "rerank", "speech2text", "text-embedding", "tts" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [DefaultModelDataResponse](#defaultmodeldataresponse)<br> |

### [POST] /workspaces/current/default-model
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserPostDefault](#parserpostdefault)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/endpoints
Create a new plugin endpoint

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndpointCreatePayload](#endpointcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint created successfully | **application/json**: [SuccessResponse](#successresponse)<br> |
| 403 | Admin privileges required |  |

### ~~[POST] /workspaces/current/endpoints/create~~

***DEPRECATED***

Deprecated legacy alias for creating a plugin endpoint. Use POST /workspaces/current/endpoints instead.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndpointCreatePayload](#endpointcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint created successfully | **application/json**: [SuccessResponse](#successresponse)<br> |
| 403 | Admin privileges required |  |

### ~~[POST] /workspaces/current/endpoints/delete~~

***DEPRECATED***

Deprecated legacy alias for deleting a plugin endpoint. Use DELETE /workspaces/current/endpoints/{id} instead.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndpointIdPayload](#endpointidpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint deleted successfully | **application/json**: [SuccessResponse](#successresponse)<br> |
| 403 | Admin privileges required |  |

### [POST] /workspaces/current/endpoints/disable
Disable a plugin endpoint

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndpointIdPayload](#endpointidpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint disabled successfully | **application/json**: [SuccessResponse](#successresponse)<br> |
| 403 | Admin privileges required |  |

### [POST] /workspaces/current/endpoints/enable
Enable a plugin endpoint

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndpointIdPayload](#endpointidpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint enabled successfully | **application/json**: [SuccessResponse](#successresponse)<br> |
| 403 | Admin privileges required |  |

### [GET] /workspaces/current/endpoints/list
List plugin endpoints with pagination

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| page | query |  | Yes | integer |
| page_size | query |  | Yes | integer |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [EndpointListResponse](#endpointlistresponse)<br> |

### [GET] /workspaces/current/endpoints/list/plugin
List endpoints for a specific plugin

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| page | query |  | Yes | integer |
| page_size | query |  | Yes | integer |
| plugin_id | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [EndpointListResponse](#endpointlistresponse)<br> |

### ~~[POST] /workspaces/current/endpoints/update~~

***DEPRECATED***

Deprecated legacy alias for updating a plugin endpoint. Use PATCH /workspaces/current/endpoints/{id} instead.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [LegacyEndpointUpdatePayload](#legacyendpointupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint updated successfully | **application/json**: [SuccessResponse](#successresponse)<br> |
| 403 | Admin privileges required |  |

### [DELETE] /workspaces/current/endpoints/{id}
Delete a plugin endpoint

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| id | path | Endpoint ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint deleted successfully | **application/json**: [SuccessResponse](#successresponse)<br> |
| 403 | Admin privileges required |  |

### [PATCH] /workspaces/current/endpoints/{id}
Update a plugin endpoint

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| id | path | Endpoint ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndpointUpdatePayload](#endpointupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Endpoint updated successfully | **application/json**: [SuccessResponse](#successresponse)<br> |
| 403 | Admin privileges required |  |

### [GET] /workspaces/current/members
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccountWithRoleListResponse](#accountwithrolelistresponse)<br> |

### [POST] /workspaces/current/members/invite-email
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MemberInvitePayload](#memberinvitepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Success | **application/json**: [MemberInviteResponse](#memberinviteresponse)<br> |

### [POST] /workspaces/current/members/owner-transfer-check
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [OwnerTransferCheckPayload](#ownertransfercheckpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [VerificationTokenResponse](#verificationtokenresponse)<br> |

### [POST] /workspaces/current/members/send-owner-transfer-confirm-email
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [OwnerTransferEmailPayload](#ownertransferemailpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultDataResponse](#simpleresultdataresponse)<br> |

### [DELETE] /workspaces/current/members/{member_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MemberActionResponse](#memberactionresponse)<br> |

### [POST] /workspaces/current/members/{member_id}/owner-transfer
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [OwnerTransferPayload](#ownertransferpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [PUT] /workspaces/current/members/{member_id}/update-role
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MemberRoleUpdatePayload](#memberroleupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /workspaces/current/model-providers
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | query | Enum class for model type. | No | string, <br>**Available values:** "llm", "moderation", "rerank", "speech2text", "text-embedding", "tts" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ModelProviderListResponse](#modelproviderlistresponse)<br> |

### [GET] /workspaces/current/model-providers/{provider}/checkout-url
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ModelProviderPaymentCheckoutUrlResponse](#modelproviderpaymentcheckouturlresponse)<br> |

### [DELETE] /workspaces/current/model-providers/{provider}/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserCredentialDelete](#parsercredentialdelete)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Credential deleted successfully |

### [GET] /workspaces/current/model-providers/{provider}/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_id | query |  | No | string |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ProviderCredentialResponse](#providercredentialresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserCredentialCreate](#parsercredentialcreate)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Credential created successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [PUT] /workspaces/current/model-providers/{provider}/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserCredentialUpdate](#parsercredentialupdate)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/credentials/switch
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserCredentialSwitch](#parsercredentialswitch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/credentials/validate
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserCredentialValidate](#parsercredentialvalidate)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential validation result | **application/json**: [ProviderCredentialValidateResponse](#providercredentialvalidateresponse)<br> |

### [DELETE] /workspaces/current/model-providers/{provider}/models
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserDeleteModels](#parserdeletemodels)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Model deleted successfully |

### [GET] /workspaces/current/model-providers/{provider}/models
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ModelWithProviderListResponse](#modelwithproviderlistresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/models
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserPostModels](#parserpostmodels)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [DELETE] /workspaces/current/model-providers/{provider}/models/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserDeleteCredential](#parserdeletecredential)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Credential deleted successfully |

### [GET] /workspaces/current/model-providers/{provider}/models/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| config_from | query |  | No | string |
| credential_id | query |  | No | string |
| model | query |  | Yes | string |
| model_type | query | Enum class for model type. | Yes | string, <br>**Available values:** "llm", "moderation", "rerank", "speech2text", "text-embedding", "tts" |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ModelCredentialResponse](#modelcredentialresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/models/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserCreateCredential](#parsercreatecredential)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Credential created successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [PUT] /workspaces/current/model-providers/{provider}/models/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserUpdateCredential](#parserupdatecredential)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential updated successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/models/credentials/switch
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserSwitch](#parserswitch)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/models/credentials/validate
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserValidate](#parservalidate)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential validation result | **application/json**: [ModelCredentialValidateResponse](#modelcredentialvalidateresponse)<br> |

### [PATCH] /workspaces/current/model-providers/{provider}/models/disable
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserDeleteModels](#parserdeletemodels)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [PATCH] /workspaces/current/model-providers/{provider}/models/enable
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserDeleteModels](#parserdeletemodels)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/models/load-balancing-configs/credentials-validate
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [LoadBalancingCredentialPayload](#loadbalancingcredentialpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential validation result | **application/json**: [LoadBalancingCredentialValidateResponse](#loadbalancingcredentialvalidateresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/models/load-balancing-configs/{config_id}/credentials-validate
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| config_id | path |  | Yes | string |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [LoadBalancingCredentialPayload](#loadbalancingcredentialpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential validation result | **application/json**: [LoadBalancingCredentialValidateResponse](#loadbalancingcredentialvalidateresponse)<br> |

### [GET] /workspaces/current/model-providers/{provider}/models/parameter-rules
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model | query |  | Yes | string |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ModelParameterRulesResponse](#modelparameterrulesresponse)<br> |

### [POST] /workspaces/current/model-providers/{provider}/preferred-provider-type
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserPreferredProviderType](#parserpreferredprovidertype)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /workspaces/current/models/model-types/{model_type}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ProviderWithModelsDataResponse](#providerwithmodelsdataresponse)<br> |

### [GET] /workspaces/current/permission
**Get workspace permission settings**

Returns permission flags that control workspace features like member invitations and owner transfer.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WorkspacePermissionResponse](#workspacepermissionresponse)<br> |

### [GET] /workspaces/current/plugin/asset
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| file_name | query |  | Yes | string |
| plugin_unique_identifier | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [BinaryFileResponse](#binaryfileresponse)<br> |

### [POST] /workspaces/current/plugin/auto-upgrade/change
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserAutoUpgradeChange](#parserautoupgradechange)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginAutoUpgradeChangeResponse](#pluginautoupgradechangeresponse)<br> |

### [POST] /workspaces/current/plugin/auto-upgrade/exclude
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserExcludePlugin](#parserexcludeplugin)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SuccessResponse](#successresponse)<br> |

### [GET] /workspaces/current/plugin/auto-upgrade/fetch
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| category | query |  | Yes | string, <br>**Available values:** "agent-strategy", "datasource", "extension", "model", "tool", "trigger" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginAutoUpgradeFetchResponse](#pluginautoupgradefetchresponse)<br> |

### [GET] /workspaces/current/plugin/debugging-key
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDebuggingKeyResponse](#plugindebuggingkeyresponse)<br> |

### [GET] /workspaces/current/plugin/fetch-manifest
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| plugin_unique_identifier | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginManifestResponse](#pluginmanifestresponse)<br> |

### [GET] /workspaces/current/plugin/icon
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| filename | query |  | Yes | string |
| tenant_id | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [BinaryFileResponse](#binaryfileresponse)<br> |

### [POST] /workspaces/current/plugin/install/github
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserGithubInstall](#parsergithubinstall)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDaemonOperationResponse](#plugindaemonoperationresponse)<br> |

### [POST] /workspaces/current/plugin/install/marketplace
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserPluginIdentifiers](#parserpluginidentifiers)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDaemonOperationResponse](#plugindaemonoperationresponse)<br> |

### [POST] /workspaces/current/plugin/install/pkg
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserPluginIdentifiers](#parserpluginidentifiers)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDaemonOperationResponse](#plugindaemonoperationresponse)<br> |

### [GET] /workspaces/current/plugin/list
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| page_size | query | Page size (1-256) | No | integer, <br>**Default:** 256 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginListResponse](#pluginlistresponse)<br> |

### [POST] /workspaces/current/plugin/list/installations/ids
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserLatest](#parserlatest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginInstallationsResponse](#plugininstallationsresponse)<br> |

### [POST] /workspaces/current/plugin/list/latest-versions
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserLatest](#parserlatest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginVersionsResponse](#pluginversionsresponse)<br> |

### [GET] /workspaces/current/plugin/marketplace/pkg
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| plugin_unique_identifier | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginManifestResponse](#pluginmanifestresponse)<br> |

### [GET] /workspaces/current/plugin/parameters/dynamic-options
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | query |  | Yes | string |
| credential_id | query |  | No | string |
| parameter | query |  | Yes | string |
| plugin_id | query |  | Yes | string |
| provider | query |  | Yes | string |
| provider_type | query |  | Yes | string, <br>**Available values:** "tool", "trigger" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDynamicOptionsResponse](#plugindynamicoptionsresponse)<br> |

### [POST] /workspaces/current/plugin/parameters/dynamic-options-with-credentials
**Fetch dynamic options using credentials directly (for edit mode)**

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserDynamicOptionsWithCredentials](#parserdynamicoptionswithcredentials)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDynamicOptionsResponse](#plugindynamicoptionsresponse)<br> |

### [POST] /workspaces/current/plugin/permission/change
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserPermissionChange](#parserpermissionchange)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SuccessResponse](#successresponse)<br> |

### [GET] /workspaces/current/plugin/permission/fetch
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginPermissionResponse](#pluginpermissionresponse)<br> |

### [GET] /workspaces/current/plugin/readme
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query |  | No | string, <br>**Default:** en-US |
| plugin_unique_identifier | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginReadmeResponse](#pluginreadmeresponse)<br> |

### [GET] /workspaces/current/plugin/tasks
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| page_size | query | Page size (1-256) | No | integer, <br>**Default:** 256 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginTasksResponse](#plugintasksresponse)<br> |

### [POST] /workspaces/current/plugin/tasks/delete_all
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SuccessResponse](#successresponse)<br> |

### [GET] /workspaces/current/plugin/tasks/{task_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginTaskResponse](#plugintaskresponse)<br> |

### [POST] /workspaces/current/plugin/tasks/{task_id}/delete
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SuccessResponse](#successresponse)<br> |

### [POST] /workspaces/current/plugin/tasks/{task_id}/delete/{identifier}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| identifier | path |  | Yes | string |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SuccessResponse](#successresponse)<br> |

### [POST] /workspaces/current/plugin/uninstall
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserUninstall](#parseruninstall)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SuccessResponse](#successresponse)<br> |

### [POST] /workspaces/current/plugin/upgrade/github
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserGithubUpgrade](#parsergithubupgrade)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDaemonOperationResponse](#plugindaemonoperationresponse)<br> |

### [POST] /workspaces/current/plugin/upgrade/marketplace
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserMarketplaceUpgrade](#parsermarketplaceupgrade)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDaemonOperationResponse](#plugindaemonoperationresponse)<br> |

### [POST] /workspaces/current/plugin/upload/bundle
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDaemonOperationResponse](#plugindaemonoperationresponse)<br> |

### [POST] /workspaces/current/plugin/upload/github
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ParserGithubUpload](#parsergithubupload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDaemonOperationResponse](#plugindaemonoperationresponse)<br> |

### [POST] /workspaces/current/plugin/upload/pkg
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginDaemonOperationResponse](#plugindaemonoperationresponse)<br> |

### [GET] /workspaces/current/plugin/{category}/list
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| page_size | query | Page size (1-256) | No | integer, <br>**Default:** 256 |
| category | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PluginCategoryListResponse](#plugincategorylistresponse)<br> |

### [GET] /workspaces/current/rbac/access-policies
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [_AccessPolicyList](#_accesspolicylist)<br> |

### [POST] /workspaces/current/rbac/access-policies
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Policy created | **application/json**: [AccessPolicy](#accesspolicy)<br> |

### [DELETE] /workspaces/current/rbac/access-policies/{policy_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccessPolicy](#accesspolicy)<br> |

### [GET] /workspaces/current/rbac/access-policies/{policy_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccessPolicy](#accesspolicy)<br> |

### [PUT] /workspaces/current/rbac/access-policies/{policy_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccessPolicy](#accesspolicy)<br> |

### [POST] /workspaces/current/rbac/access-policies/{policy_id}/copy
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Policy copied | **application/json**: [AccessPolicy](#accesspolicy)<br> |

### [PUT] /workspaces/current/rbac/access-policy-bindings/{binding_id}/lock
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| binding_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccessPolicyBindingState](#accesspolicybindingstate)<br> |

### [PUT] /workspaces/current/rbac/access-policy-bindings/{binding_id}/unlock
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| binding_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccessPolicyBindingState](#accesspolicybindingstate)<br> |

### [DELETE] /workspaces/current/rbac/apps/{app_id}/access-policies/{policy_id}/member-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| policy_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [_DeleteMemberBindingsRequest](#_deletememberbindingsrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MemberBindingsResponse](#memberbindingsresponse)<br> |

### [GET] /workspaces/current/rbac/apps/{app_id}/access-policies/{policy_id}/member-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| policy_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MemberBindingsResponse](#memberbindingsresponse)<br> |

### [GET] /workspaces/current/rbac/apps/{app_id}/access-policies/{policy_id}/role-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RoleBindingsResponse](#rolebindingsresponse)<br> |

### [GET] /workspaces/current/rbac/apps/{app_id}/access-policy
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query | Localized policy label language | No | string, <br>**Available values:** "en", "ja", "zh" |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AppAccessMatrix](#appaccessmatrix)<br> |

### [GET] /workspaces/current/rbac/apps/{app_id}/user-access-policies
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query | Localized policy label language | No | string, <br>**Available values:** "en", "ja", "zh" |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ResourceUserAccessPoliciesResponse](#resourceuseraccesspoliciesresponse)<br> |

### [PUT] /workspaces/current/rbac/apps/{app_id}/users/{target_account_id}/access-policies
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |
| target_account_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ReplaceUserAccessPolicies](#replaceuseraccesspolicies)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ReplaceUserAccessPoliciesResponse](#replaceuseraccesspoliciesresponse)<br> |

### [GET] /workspaces/current/rbac/apps/{app_id}/whitelist
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ResourceWhitelist](#resourcewhitelist)<br> |

### [PUT] /workspaces/current/rbac/apps/{app_id}/whitelist
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [_ResourceAccessScopeRequest](#_resourceaccessscoperequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ResourceWhitelist](#resourcewhitelist)<br> |

### [DELETE] /workspaces/current/rbac/datasets/{dataset_id}/access-policies/{policy_id}/member-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| policy_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [_DeleteMemberBindingsRequest](#_deletememberbindingsrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MemberBindingsResponse](#memberbindingsresponse)<br> |

### [GET] /workspaces/current/rbac/datasets/{dataset_id}/access-policies/{policy_id}/member-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| policy_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MemberBindingsResponse](#memberbindingsresponse)<br> |

### [GET] /workspaces/current/rbac/datasets/{dataset_id}/access-policies/{policy_id}/role-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RoleBindingsResponse](#rolebindingsresponse)<br> |

### [GET] /workspaces/current/rbac/datasets/{dataset_id}/access-policy
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query | Localized policy label language | No | string, <br>**Available values:** "en", "ja", "zh" |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [DatasetAccessMatrix](#datasetaccessmatrix)<br> |

### [GET] /workspaces/current/rbac/datasets/{dataset_id}/user-access-policies
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query | Localized policy label language | No | string, <br>**Available values:** "en", "ja", "zh" |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ResourceUserAccessPoliciesResponse](#resourceuseraccesspoliciesresponse)<br> |

### [PUT] /workspaces/current/rbac/datasets/{dataset_id}/users/{target_account_id}/access-policies
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |
| target_account_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ReplaceUserAccessPolicies](#replaceuseraccesspolicies)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ReplaceUserAccessPoliciesResponse](#replaceuseraccesspoliciesresponse)<br> |

### [GET] /workspaces/current/rbac/datasets/{dataset_id}/whitelist
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ResourceWhitelist](#resourcewhitelist)<br> |

### [PUT] /workspaces/current/rbac/datasets/{dataset_id}/whitelist
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [_ResourceAccessScopeRequest](#_resourceaccessscoperequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ResourceWhitelist](#resourcewhitelist)<br> |

### [GET] /workspaces/current/rbac/members/{member_id}/rbac-roles
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MemberRolesResponse](#memberrolesresponse)<br> |

### [PUT] /workspaces/current/rbac/members/{member_id}/rbac-roles
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| member_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [_ReplaceMemberRolesRequest](#_replacememberrolesrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MemberRolesResponse](#memberrolesresponse)<br> |

### [GET] /workspaces/current/rbac/my-permissions
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MyPermissionsResponse](#mypermissionsresponse)<br> |

### [GET] /workspaces/current/rbac/role-permissions/catalog
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PermissionCatalogResponse](#permissioncatalogresponse)<br> |

### [GET] /workspaces/current/rbac/role-permissions/catalog/app
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PermissionCatalogResponse](#permissioncatalogresponse)<br> |

### [GET] /workspaces/current/rbac/role-permissions/catalog/dataset
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [PermissionCatalogResponse](#permissioncatalogresponse)<br> |

### [GET] /workspaces/current/rbac/roles
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [_RBACRoleList](#_rbacrolelist)<br> |

### [POST] /workspaces/current/rbac/roles
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Role created | **application/json**: [RBACRole](#rbacrole)<br> |

### [DELETE] /workspaces/current/rbac/roles/{role_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| role_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RBACRole](#rbacrole)<br> |

### [GET] /workspaces/current/rbac/roles/{role_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| role_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RBACRole](#rbacrole)<br> |

### [PUT] /workspaces/current/rbac/roles/{role_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| role_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RBACRole](#rbacrole)<br> |

### [POST] /workspaces/current/rbac/roles/{role_id}/copy
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| role_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Role copied | **application/json**: [RBACRole](#rbacrole)<br> |

### [GET] /workspaces/current/rbac/roles/{role_id}/members
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| role_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [_MembersInRoleList](#_membersinrolelist)<br> |

### [PUT] /workspaces/current/rbac/workspace/apps/access-policies/{policy_id}/bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [_ReplaceBindingsRequest](#_replacebindingsrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccessMatrixItem](#accessmatrixitem)<br> |

### [GET] /workspaces/current/rbac/workspace/apps/access-policies/{policy_id}/member-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MemberBindingsResponse](#memberbindingsresponse)<br> |

### [GET] /workspaces/current/rbac/workspace/apps/access-policies/{policy_id}/role-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RoleBindingsResponse](#rolebindingsresponse)<br> |

### [GET] /workspaces/current/rbac/workspace/apps/access-policy
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WorkspaceAccessMatrix](#workspaceaccessmatrix)<br> |

### [PUT] /workspaces/current/rbac/workspace/datasets/access-policies/{policy_id}/bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [_ReplaceBindingsRequest](#_replacebindingsrequest)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccessMatrixItem](#accessmatrixitem)<br> |

### [GET] /workspaces/current/rbac/workspace/datasets/access-policies/{policy_id}/member-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [MemberBindingsResponse](#memberbindingsresponse)<br> |

### [GET] /workspaces/current/rbac/workspace/datasets/access-policies/{policy_id}/role-bindings
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| policy_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [RoleBindingsResponse](#rolebindingsresponse)<br> |

### [GET] /workspaces/current/rbac/workspace/datasets/access-policy
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WorkspaceAccessMatrix](#workspaceaccessmatrix)<br> |

### [GET] /workspaces/current/tool-labels
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/api/add
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ApiToolProviderAddPayload](#apitoolprovideraddpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/api/delete
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ApiToolProviderDeletePayload](#apitoolproviderdeletepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/api/get
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/api/remote
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| url | query |  | Yes | string (uri) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/api/schema
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ApiToolSchemaPayload](#apitoolschemapayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/api/test/pre
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ApiToolTestPayload](#apitooltestpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/api/tools
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/api/update
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ApiToolProviderUpdatePayload](#apitoolproviderupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/builtin/{provider}/add
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [BuiltinToolAddPayload](#builtintooladdpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/builtin/{provider}/credential/info
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| include_credential_ids | query | Credential IDs to include even if visibility would hide them | No | [ string ] |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/builtin/{provider}/credential/schema/{credential_type}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| credential_type | path |  | Yes | string |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/builtin/{provider}/credentials
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| include_credential_ids | query | Credential IDs to include even if visibility would hide them | No | [ string ] |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/builtin/{provider}/default-credential
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [BuiltinProviderDefaultCredentialPayload](#builtinproviderdefaultcredentialpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/builtin/{provider}/delete
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [BuiltinToolCredentialDeletePayload](#builtintoolcredentialdeletepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/builtin/{provider}/icon
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [BinaryFileResponse](#binaryfileresponse)<br> |

### [GET] /workspaces/current/tool-provider/builtin/{provider}/info
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/builtin/{provider}/oauth/client-schema
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolOAuthClientSchemaResponse](#tooloauthclientschemaresponse)<br> |

### [DELETE] /workspaces/current/tool-provider/builtin/{provider}/oauth/custom-client
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /workspaces/current/tool-provider/builtin/{provider}/oauth/custom-client
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolOAuthCustomClientResponse](#tooloauthcustomclientresponse)<br> |

### [POST] /workspaces/current/tool-provider/builtin/{provider}/oauth/custom-client
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ToolOAuthCustomClientPayload](#tooloauthcustomclientpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /workspaces/current/tool-provider/builtin/{provider}/tools
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/builtin/{provider}/update
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [BuiltinToolUpdatePayload](#builtintoolupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [DELETE] /workspaces/current/tool-provider/mcp
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MCPProviderDeletePayload](#mcpproviderdeletepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/tool-provider/mcp
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MCPProviderCreatePayload](#mcpprovidercreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [PUT] /workspaces/current/tool-provider/mcp
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MCPProviderUpdatePayload](#mcpproviderupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/tool-provider/mcp/auth
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MCPAuthPayload](#mcpauthpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/mcp/tools/{provider_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/mcp/update/{provider_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/workflow/create
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowToolCreatePayload](#workflowtoolcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/workflow/delete
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowToolDeletePayload](#workflowtooldeletepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/workflow/get
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_app_id | query |  | No | string |
| workflow_tool_id | query |  | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-provider/workflow/tools
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_tool_id | query |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [POST] /workspaces/current/tool-provider/workflow/update
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowToolUpdatePayload](#workflowtoolupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tool-providers
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| type | query |  | No | string, <br>**Available values:** "api", "builtin", "mcp", "model", "workflow" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tools/api
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tools/builtin
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tools/mcp
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/tools/workflow
#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ToolProviderOpaqueResponse](#toolprovideropaqueresponse)<br> |

### [GET] /workspaces/current/trigger-provider/{provider}/icon
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [BinaryFileResponse](#binaryfileresponse)<br> |

### [GET] /workspaces/current/trigger-provider/{provider}/info
**Get info for a trigger provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerProviderApiEntity](#triggerproviderapientity)<br> |

### [DELETE] /workspaces/current/trigger-provider/{provider}/oauth/client
**Remove custom OAuth client configuration**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /workspaces/current/trigger-provider/{provider}/oauth/client
**Get OAuth client configuration for a provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerOAuthClientResponse](#triggeroauthclientresponse)<br> |

### [POST] /workspaces/current/trigger-provider/{provider}/oauth/client
**Configure custom OAuth client for a provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TriggerOAuthClientPayload](#triggeroauthclientpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/trigger-provider/{provider}/subscriptions/builder/build/{subscription_builder_id}
**Build a subscription instance for a trigger provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TriggerSubscriptionBuilderUpdatePayload](#triggersubscriptionbuilderupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerProviderOpaqueResponse](#triggerprovideropaqueresponse)<br> |

### [POST] /workspaces/current/trigger-provider/{provider}/subscriptions/builder/create
**Add a new subscription instance for a trigger provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TriggerSubscriptionBuilderCreatePayload](#triggersubscriptionbuildercreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerSubscriptionBuilderCreateResponse](#triggersubscriptionbuildercreateresponse)<br> |

### [GET] /workspaces/current/trigger-provider/{provider}/subscriptions/builder/logs/{subscription_builder_id}
**Get the request logs for a subscription instance for a trigger provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerSubscriptionBuilderLogsResponse](#triggersubscriptionbuilderlogsresponse)<br> |

### [POST] /workspaces/current/trigger-provider/{provider}/subscriptions/builder/update/{subscription_builder_id}
**Update a subscription instance for a trigger provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TriggerSubscriptionBuilderUpdatePayload](#triggersubscriptionbuilderupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SubscriptionBuilderApiEntity](#subscriptionbuilderapientity)<br> |

### [POST] /workspaces/current/trigger-provider/{provider}/subscriptions/builder/verify-and-update/{subscription_builder_id}
**Verify and update a subscription instance for a trigger provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TriggerSubscriptionBuilderVerifyPayload](#triggersubscriptionbuilderverifypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerSubscriptionBuilderVerifyResponse](#triggersubscriptionbuilderverifyresponse)<br> |

### [GET] /workspaces/current/trigger-provider/{provider}/subscriptions/builder/{subscription_builder_id}
**Get a subscription instance for a trigger provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_builder_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SubscriptionBuilderApiEntity](#subscriptionbuilderapientity)<br> |

### [GET] /workspaces/current/trigger-provider/{provider}/subscriptions/list
**List all trigger subscriptions for the current tenant's provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerSubscriptionListResponse](#triggersubscriptionlistresponse)<br> |

### [GET] /workspaces/current/trigger-provider/{provider}/subscriptions/oauth/authorize
**Initiate OAuth authorization flow for a trigger provider**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Authorization URL retrieved successfully | **application/json**: [TriggerOAuthAuthorizeResponse](#triggeroauthauthorizeresponse)<br> |

### [POST] /workspaces/current/trigger-provider/{provider}/subscriptions/verify/{subscription_id}
**Verify credentials for an existing subscription (edit mode only)**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |
| subscription_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TriggerSubscriptionBuilderVerifyPayload](#triggersubscriptionbuilderverifypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerSubscriptionBuilderVerifyResponse](#triggersubscriptionbuilderverifyresponse)<br> |

### [POST] /workspaces/current/trigger-provider/{subscription_id}/subscriptions/delete
**Delete a subscription instance**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| subscription_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [POST] /workspaces/current/trigger-provider/{subscription_id}/subscriptions/update
**Update a subscription instance**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| subscription_id | path |  | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TriggerSubscriptionBuilderUpdatePayload](#triggersubscriptionbuilderupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerProviderOpaqueResponse](#triggerprovideropaqueresponse)<br> |

### [GET] /workspaces/current/triggers
**List all trigger providers for the current tenant**

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [TriggerProviderListResponse](#triggerproviderlistresponse)<br> |

### [POST] /workspaces/custom-config
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkspaceCustomConfigPayload](#workspacecustomconfigpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WorkspaceTenantResultResponse](#workspacetenantresultresponse)<br> |

### [POST] /workspaces/custom-config/webapp-logo/upload
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Logo uploaded | **application/json**: [WorkspaceLogoUploadResponse](#workspacelogouploadresponse)<br> |

### [POST] /workspaces/info
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkspaceInfoPayload](#workspaceinfopayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WorkspaceTenantResultResponse](#workspacetenantresultresponse)<br> |

### [POST] /workspaces/switch
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SwitchWorkspacePayload](#switchworkspacepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SwitchWorkspaceResponse](#switchworkspaceresponse)<br> |

### [GET] /workspaces/{tenant_id}/model-providers/{provider}/{icon_type}/{lang}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| icon_type | path |  | Yes | string |
| lang | path |  | Yes | string |
| provider | path |  | Yes | string |
| tenant_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [BinaryFileResponse](#binaryfileresponse)<br> |

---
## default
Default namespace

### [GET] /explore/banners
**Get banner list**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| language | query | Banner language | No | string, <br>**Default:** en-US |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [BannerListResponse](#bannerlistresponse)<br> |

---
### Schemas

#### AIModelEntityResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| deprecated | boolean |  | No |
| features | [ [ModelFeature](#modelfeature) ] |  | No |
| fetch_from | [FetchFrom](#fetchfrom) |  | Yes |
| label | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | Yes |
| model | string |  | Yes |
| model_properties | object |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |
| parameter_rules | [ [ParameterRule](#parameterrule) ], <br>**Default:**  |  | No |
| pricing | [PriceConfigResponse](#priceconfigresponse) |  | No |

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
| created_at | integer |  | No |
| id | string |  | Yes |
| name | string |  | Yes |

#### AccessMatrixItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| accounts | [ [AccessPolicyAccount](#accesspolicyaccount) ] |  | No |
| policy | [AccessPolicy](#accesspolicy) |  | No |
| roles | [ [AccessPolicyRole](#accesspolicyrole) ] |  | No |

#### AccessPolicy

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| category | string |  | No |
| created_at | integer |  | No |
| description | string |  | No |
| id | string |  | Yes |
| is_builtin | boolean |  | No |
| name | string |  | Yes |
| permission_keys | [ string ] |  | No |
| policy_key | string |  | No |
| resource_type | string |  | Yes |
| tenant_id | string |  | No |
| updated_at | integer |  | No |

#### AccessPolicyAccount

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_id | string |  | Yes |
| account_name | string |  | Yes |
| avatar | string |  | No |
| binding_id | string |  | Yes |
| email | string |  | No |
| is_locked | boolean |  | No |

#### AccessPolicyBindingState

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binding_id | string |  | Yes |
| is_locked | boolean |  | No |

#### AccessPolicyMemberBinding

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_policy_id | string |  | Yes |
| account_id | string |  | Yes |
| account_name | string |  | No |
| created_at | integer |  | No |
| id | string |  | Yes |
| resource_id | string |  | No |
| resource_type | string |  | Yes |
| tenant_id | string |  | No |

#### AccessPolicyRole

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binding_id | string |  | Yes |
| is_locked | boolean |  | No |
| role_id | string |  | Yes |
| role_name | string |  | Yes |
| role_tag | string |  | No |

#### AccessPolicyRoleBinding

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_policy_id | string |  | Yes |
| created_at | integer |  | No |
| id | string |  | Yes |
| resource_id | string |  | No |
| resource_type | string |  | Yes |
| role_id | string |  | Yes |
| role_name | string |  | No |
| tenant_id | string |  | No |

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
| invitation_code | string |  | No |
| timezone | string |  | Yes |

#### AccountIntegrateListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AccountIntegrateResponse](#accountintegrateresponse) ] |  | Yes |

#### AccountIntegrateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| is_bound | boolean |  | Yes |
| link | string |  | No |
| provider | string |  | Yes |

#### AccountInterfaceLanguagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| interface_language | string |  | Yes |

#### AccountInterfaceThemePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| interface_theme | string, <br>**Available values:** "dark", "light" | *Enum:* `"dark"`, `"light"` | Yes |

#### AccountNamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

#### AccountPasswordPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_password | string |  | Yes |
| password | string |  | No |
| repeat_new_password | string |  | Yes |

#### AccountResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar | string |  | No |
| avatar_url | string |  | Yes |
| created_at | integer |  | No |
| email | string |  | Yes |
| id | string |  | Yes |
| interface_language | string |  | No |
| interface_theme | string |  | No |
| is_password_set | boolean |  | Yes |
| last_login_at | integer |  | No |
| last_login_ip | string |  | No |
| name | string |  | Yes |
| timezone | string |  | No |

#### AccountTimezonePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| timezone | string |  | Yes |

#### AccountWithRoleListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| accounts | [ [AccountWithRoleResponse](#accountwithroleresponse) ] |  | Yes |

#### AccountWithRoleResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar | string |  | No |
| avatar_url | string |  | Yes |
| created_at | integer |  | No |
| email | string |  | Yes |
| id | string |  | Yes |
| last_active_at | integer |  | No |
| last_login_at | integer |  | No |
| name | string |  | Yes |
| role | string |  | Yes |
| roles | [ object ] |  | No |
| status | string |  | Yes |

#### ActivateCheckQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | No |
| token | string |  | Yes |
| workspace_id | string |  | No |

#### ActivatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | No |
| interface_language | string |  | No |
| name | string |  | No |
| timezone | string |  | No |
| token | string |  | Yes |
| workspace_id | string |  | No |

#### ActivationCheckData

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_status | string |  | No |
| email | string |  | Yes |
| requires_setup | boolean |  | No |
| workspace_id | string |  | Yes |
| workspace_name | string |  | Yes |

#### ActivationCheckResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ActivationCheckData](#activationcheckdata) | Activation data if valid | No |
| is_valid | boolean | Whether token is valid | Yes |

#### ActivationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Operation result | Yes |

#### AdvancedChatWorkflowRunForListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string |  | No |
| created_at | integer |  | No |
| created_by_account | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| elapsed_time | number |  | No |
| exceptions_count | integer |  | No |
| finished_at | integer |  | No |
| id | string |  | Yes |
| message_id | string |  | No |
| retry_index | integer |  | No |
| status | string |  | No |
| total_steps | integer |  | No |
| total_tokens | integer |  | No |
| version | string |  | No |

#### AdvancedChatWorkflowRunPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AdvancedChatWorkflowRunForListResponse](#advancedchatworkflowrunforlistresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### AdvancedChatWorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string |  | No |
| files | [ object ] |  | No |
| inputs | object |  | No |
| parent_message_id | string |  | No |
| query | string |  | No |

#### AdvancedPromptTemplateQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_mode | string | Application mode | Yes |
| has_context | string, <br>**Default:** true | Whether has context | No |
| model_mode | string | Model mode | Yes |
| model_name | string | Model name | Yes |

#### AdvancedPromptTemplateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chat_prompt_config | object |  | No |
| completion_prompt_config | object |  | No |

#### AgentApiAccessResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| api_key_count | integer |  | Yes |
| api_rph | integer |  | Yes |
| api_rpm | integer |  | Yes |
| chat_endpoint | string |  | Yes |
| conversations_endpoint | string |  | Yes |
| enabled | boolean |  | Yes |
| files_upload_endpoint | string |  | Yes |
| info_endpoint | string |  | Yes |
| messages_endpoint | string |  | Yes |
| meta_endpoint | string |  | Yes |
| parameters_endpoint | string |  | Yes |
| service_api_base_url | string |  | Yes |
| stop_endpoint | string |  | Yes |
| streaming_only | boolean, <br>**Default:** true |  | No |

#### AgentApiStatusPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enable_api | boolean | Enable or disable Agent service API | Yes |

#### AgentAppComposerResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_config_snapshot | [AgentConfigSnapshotSummaryResponse](#agentconfigsnapshotsummaryresponse) |  | No |
| agent | [AgentComposerAgentResponse](#agentcomposeragentresponse) |  | Yes |
| agent_soul | [AgentSoulConfig](#agentsoulconfig) |  | Yes |
| app_id | string |  | No |
| backing_app_id | string |  | No |
| chat_endpoint | string |  | No |
| draft | [AgentConfigDraftSummaryResponse](#agentconfigdraftsummaryresponse) |  | No |
| hidden_app_backed | boolean |  | No |
| save_options | [ [ComposerSaveStrategy](#composersavestrategy) ] |  | Yes |
| validation | [ComposerValidationFindingsResponse](#composervalidationfindingsresponse) |  | No |
| variant | string |  | Yes |

#### AgentAppCopyPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Description for the copied agent | No |
| icon | string | Icon | No |
| icon_background | string | Icon background color | No |
| icon_type | [IconType](#icontype) | Icon type | No |
| name | string | Name for the copied agent | No |
| role | string | Role for the copied agent | No |

#### AgentAppCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Agent description (max 400 chars) | No |
| icon | string | Icon | No |
| icon_background | string | Icon background color | No |
| icon_type | [IconType](#icontype) | Icon type | No |
| name | string | Agent name | Yes |
| role | string | Agent role | No |

#### AgentAppDetailWithSite

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode | string |  | No |
| active_config_is_published | boolean |  | No |
| api_base_url | string |  | No |
| app_id | string |  | No |
| backing_app_id | string |  | No |
| bound_agent_id | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| debug_conversation_has_messages | boolean |  | No |
| debug_conversation_id | string |  | No |
| debug_conversation_message_count | integer |  | No |
| deleted_tools | [ [DeletedTool](#deletedtool) ] |  | No |
| description | string |  | No |
| enable_api | boolean |  | Yes |
| enable_site | boolean |  | Yes |
| hidden_app_backed | boolean |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | Yes |
| id | string |  | Yes |
| maintainer | string |  | No |
| max_active_requests | integer |  | No |
| mode | string |  | Yes |
| model_config | [ModelConfig](#modelconfig) |  | No |
| name | string |  | Yes |
| permission_keys | [ string ] |  | No |
| role | string |  | No |
| site | [AppDetailSiteResponse](#appdetailsiteresponse) |  | No |
| tags | [ [Tag](#tag) ] |  | No |
| tracing |  |  | No |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |
| workflow | [WorkflowPartial](#workflowpartial) |  | No |

#### AgentAppFeaturesPayload

Presentation features configurable on an Agent App.

All fields are optional; an omitted field is reset to its disabled/empty
default (the config form sends the full desired feature state on save).

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| opening_statement | string | Conversation opener shown before the first turn | No |
| retriever_resource | [AgentFeatureToggleConfig](#agentfeaturetoggleconfig) | Citations / attributions config, e.g. {'enabled': true} | No |
| sensitive_word_avoidance | [AgentSensitiveWordAvoidanceFeatureConfig](#agentsensitivewordavoidancefeatureconfig) | Content moderation config | No |
| speech_to_text | [AgentFeatureToggleConfig](#agentfeaturetoggleconfig) | Speech-to-text config | No |
| suggested_questions | [ string ] | Preset questions shown alongside the opener | No |
| suggested_questions_after_answer | [AgentSuggestedQuestionsAfterAnswerFeatureConfig](#agentsuggestedquestionsafteranswerfeatureconfig) | Follow-up suggestions config, e.g. {'enabled': true} | No |
| text_to_speech | [AgentTextToSpeechFeatureConfig](#agenttexttospeechfeatureconfig) | Text-to-speech config | No |

#### AgentAppPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AgentAppPartial](#agentapppartial) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### AgentAppPartial

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode | string |  | No |
| active_config_is_published | boolean |  | No |
| app_id | string |  | No |
| author_name | string |  | No |
| backing_app_id | string |  | No |
| bound_agent_id | string |  | No |
| create_user_name | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| debug_conversation_id | string |  | No |
| description | string |  | No |
| has_draft_trigger | boolean |  | No |
| hidden_app_backed | boolean |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | Yes |
| id | string |  | Yes |
| is_starred | boolean |  | No |
| maintainer | string |  | No |
| max_active_requests | integer |  | No |
| mode | string |  | Yes |
| model_config | [ModelConfigPartial](#modelconfigpartial) |  | No |
| name | string |  | Yes |
| permission_keys | [ string ] |  | No |
| published_reference_count | integer |  | No |
| published_references | [ [AgentAppPublishedReferenceResponse](#agentapppublishedreferenceresponse) ] |  | No |
| role | string |  | No |
| tags | [ [Tag](#tag) ] |  | No |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |
| workflow | [WorkflowPartial](#workflowpartial) |  | No |

#### AgentAppPublishedReferenceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_icon | string |  | No |
| app_icon_background | string |  | No |
| app_icon_type | string |  | No |
| app_id | string |  | Yes |
| app_name | string |  | Yes |

#### AgentAppUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | App description (max 400 chars) | No |
| icon | string | Icon | No |
| icon_background | string | Icon background color | No |
| icon_type | [IconType](#icontype) | Icon type | No |
| max_active_requests | integer | Maximum active requests | No |
| name | string | App name | Yes |
| role | string | Agent role | No |
| use_icon_as_answer_icon | boolean | Use icon as answer icon | No |

#### AgentAverageResponseTimeStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| latency | number |  | Yes |

#### AgentAverageSessionInteractionStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| interactions | number |  | Yes |

#### AgentBuildDraftApplyResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| draft | object |  | Yes |
| result | string |  | Yes |

#### AgentBuildDraftCheckoutPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| force | boolean | Overwrite the existing current-user build draft | No |

#### AgentBuildDraftResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_soul | [AgentSoulConfig](#agentsoulconfig) |  | Yes |
| draft | [AgentConfigDraftSummaryResponse](#agentconfigdraftsummaryresponse) |  | Yes |
| variant | string |  | Yes |

#### AgentCliToolAuthorizationStatus

Authorization state for Agent-scoped CLI tools.

Missing status keeps backward compatibility with draft rows and CLI tools that
do not need pre-authorization. Explicit denied-like states are blocked by the
composer/publish validators and skipped by runtime request builders.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentCliToolAuthorizationStatus | string | Authorization state for Agent-scoped CLI tools.  Missing status keeps backward compatibility with draft rows and CLI tools that do not need pre-authorization. Explicit denied-like states are blocked by the composer/publish validators and skipped by runtime request builders. |  |

#### AgentCliToolConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| approved | boolean |  | No |
| authorization_status | [AgentCliToolAuthorizationStatus](#agentclitoolauthorizationstatus) |  | No |
| command | string |  | No |
| dangerous | boolean |  | No |
| dangerous_accepted | boolean |  | No |
| dangerous_acknowledged | boolean |  | No |
| dangerous_command | boolean |  | No |
| description | string |  | No |
| enabled | boolean, <br>**Default:** true |  | No |
| env | [AgentCliToolEnvConfig](#agentclitoolenvconfig) |  | No |
| id | string |  | No |
| inferred_from | string |  | No |
| install | string |  | No |
| install_command | string |  | No |
| install_commands | [ string ] |  | No |
| invoke_metadata | object |  | No |
| label | string |  | No |
| name | string |  | No |
| permission | [AgentPermissionConfig](#agentpermissionconfig) |  | No |
| pre_authorized | boolean |  | No |
| requires_confirmation | boolean |  | No |
| risk_accepted | boolean |  | No |
| risk_level | [AgentCliToolRiskLevel](#agentclitoolrisklevel) |  | No |
| setup_command | string |  | No |
| tool_name | string |  | No |

#### AgentCliToolEnvConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| secret_refs | [ [AgentSecretRefConfig](#agentsecretrefconfig) ] |  | No |
| variables | [ [AgentEnvVariableConfig](#agentenvvariableconfig) ] |  | No |

#### AgentCliToolRiskLevel

Risk marker for CLI tool bootstrap commands.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentCliToolRiskLevel | string | Risk marker for CLI tool bootstrap commands. |  |

#### AgentComposerAgentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_config_snapshot_id | string |  | No |
| app_id | string |  | No |
| backing_app_id | string |  | No |
| description | string |  | Yes |
| hidden_app_backed | boolean |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| id | string |  | Yes |
| name | string |  | Yes |
| role | string |  | No |
| scope | [AgentScope](#agentscope) |  | Yes |
| source | [AgentSource](#agentsource) |  | No |
| status | [AgentStatus](#agentstatus) |  | Yes |

#### AgentComposerBindingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_id | string |  | No |
| binding_type | [WorkflowAgentBindingType](#workflowagentbindingtype) |  | Yes |
| current_snapshot_id | string |  | No |
| id | string |  | Yes |
| node_id | string |  | Yes |
| workflow_id | string |  | Yes |

#### AgentComposerCandidatesResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed_node_job_candidates | [AgentComposerNodeJobCandidatesResponse](#agentcomposernodejobcandidatesresponse) |  | No |
| allowed_soul_candidates | [AgentComposerSoulCandidatesResponse](#agentcomposersoulcandidatesresponse) |  | No |
| capabilities | [ComposerCandidateCapabilities](#composercandidatecapabilities) |  | No |
| truncated | boolean |  | No |
| variant | [ComposerVariant](#composervariant) |  | Yes |

#### AgentComposerDifyToolCandidateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| granularity | string |  | No |
| id | string |  | No |
| name | string |  | No |
| plugin_id | string |  | No |
| provider | string |  | No |
| provider_id | string |  | No |
| tools_count | integer |  | No |

#### AgentComposerImpactBindingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |
| node_id | string |  | Yes |
| workflow_id | string |  | Yes |

#### AgentComposerImpactResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| bindings | [ [AgentComposerImpactBindingResponse](#agentcomposerimpactbindingresponse) ] |  | No |
| current_snapshot_id | string |  | No |
| workflow_node_count | integer |  | Yes |

#### AgentComposerKnowledgeDatasetCandidateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | No |
| missing | boolean |  | No |
| name | string |  | No |

#### AgentComposerKnowledgeSetCandidateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| datasets | [ [AgentComposerKnowledgeDatasetCandidateResponse](#agentcomposerknowledgedatasetcandidateresponse) ] |  | No |
| description | string |  | No |
| id | string |  | Yes |
| missing_dataset_ids | [ string ] |  | No |
| name | string |  | Yes |

#### AgentComposerNodeJobCandidatesResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| declare_output_types | [ [DeclaredOutputType](#declaredoutputtype) ] |  | No |
| human_contacts | [ [AgentHumanContactConfig](#agenthumancontactconfig) ] |  | No |
| previous_node_outputs | [ [WorkflowPreviousNodeOutputRef](#workflowpreviousnodeoutputref) ] |  | No |

#### AgentComposerSoulCandidatesResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| cli_tools | [ [AgentCliToolConfig](#agentclitoolconfig) ] |  | No |
| dify_tools | [ [AgentComposerDifyToolCandidateResponse](#agentcomposerdifytoolcandidateresponse) ] |  | No |
| human_contacts | [ [AgentHumanContactConfig](#agenthumancontactconfig) ] |  | No |
| knowledge_sets | [ [AgentComposerKnowledgeSetCandidateResponse](#agentcomposerknowledgesetcandidateresponse) ] |  | No |

#### AgentComposerSoulLockResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| can_unlock | boolean |  | No |
| locked | boolean |  | Yes |
| reason | string |  | No |

#### AgentComposerValidateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| errors | [ string ] |  | No |
| knowledge_retrieval_placeholder | [ [ComposerKnowledgePlaceholderResponse](#composerknowledgeplaceholderresponse) ] |  | No |
| result | string |  | Yes |
| warnings | [ [ComposerValidationWarningResponse](#composervalidationwarningresponse) ] |  | No |

#### AgentConfigDeleteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| removed_names | [ string ] |  | No |
| result | string |  | Yes |

#### AgentConfigDownloadResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string |  | Yes |

#### AgentConfigDraftSummaryResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_id | string |  | No |
| agent_id | string |  | Yes |
| base_snapshot_id | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| draft_type | [AgentConfigDraftType](#agentconfigdrafttype) |  | Yes |
| id | string |  | Yes |
| updated_at | integer |  | No |
| updated_by | string |  | No |

#### AgentConfigDraftType

Editable Agent Soul draft workspace type.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentConfigDraftType | string | Editable Agent Soul draft workspace type. |  |

#### AgentConfigFileItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_id | string |  | No |
| hash | string |  | No |
| id | string |  | Yes |
| mime_type | string |  | No |
| name | string |  | Yes |
| size | integer |  | No |

#### AgentConfigFileItemsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [AgentConfigFileItemResponse](#agentconfigfileitemresponse) ] |  | No |

#### AgentConfigFileListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_id | string |  | Yes |
| config_version | [AgentConfigVersionResponse](#agentconfigversionresponse) |  | Yes |
| items | [ [AgentConfigFileItemResponse](#agentconfigfileitemresponse) ] |  | No |

#### AgentConfigFilePreviewResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binary | boolean |  | Yes |
| name | string |  | Yes |
| size | integer |  | No |
| text | string |  | No |
| truncated | boolean |  | Yes |

#### AgentConfigFileRefConfig

Stable Agent Soul reference to one config file payload.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_id | string |  | Yes |
| file_kind | string, <br>**Available values:** "tool_file", "upload_file" | *Enum:* `"tool_file"`, `"upload_file"` | Yes |
| hash | string |  | No |
| mime_type | string |  | No |
| name | string |  | Yes |
| size | integer |  | No |

#### AgentConfigFileUploadPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| upload_file_id | string | UploadFile UUID from POST /console/api/files/upload | Yes |

#### AgentConfigFileUploadResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| config_version | [AgentConfigVersionResponse](#agentconfigversionresponse) |  | Yes |
| file | [AgentConfigFileItemResponse](#agentconfigfileitemresponse) |  | Yes |

#### AgentConfigManifestResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_id | string |  | Yes |
| config_version | [AgentConfigVersionResponse](#agentconfigversionresponse) |  | Yes |
| env_keys | [ string ] |  | No |
| files | [AgentConfigFileItemsResponse](#agentconfigfileitemsresponse) |  | No |
| note | string |  | No |
| skills | [AgentConfigSkillItemsResponse](#agentconfigskillitemsresponse) |  | No |

#### AgentConfigRevisionOperation

Audit operation recorded for Agent Soul version/revision changes.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentConfigRevisionOperation | string | Audit operation recorded for Agent Soul version/revision changes. |  |

#### AgentConfigRevisionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by | string |  | No |
| current_snapshot_id | string |  | Yes |
| id | string |  | Yes |
| operation | [AgentConfigRevisionOperation](#agentconfigrevisionoperation) |  | Yes |
| previous_snapshot_id | string |  | No |
| revision | integer |  | Yes |
| summary | string |  | No |
| version_note | string |  | No |

#### AgentConfigSkillFilePreviewResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binary | boolean |  | Yes |
| path | string |  | Yes |
| size | integer |  | No |
| text | string |  | No |
| truncated | boolean |  | Yes |

#### AgentConfigSkillFileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| downloadable | boolean |  | Yes |
| name | string |  | Yes |
| path | string |  | Yes |
| previewable | boolean |  | Yes |
| type | string, <br>**Available values:** "directory", "file" | *Enum:* `"directory"`, `"file"` | Yes |

#### AgentConfigSkillInspectResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| file_tree | [ object ] |  | No |
| files | [ [AgentConfigSkillFileResponse](#agentconfigskillfileresponse) ] |  | No |
| hash | string |  | No |
| id | string |  | Yes |
| mime_type | string |  | No |
| name | string |  | Yes |
| size | integer |  | No |
| skill_md | [AgentConfigSkillMarkdownResponse](#agentconfigskillmarkdownresponse) |  | Yes |
| source | string |  | Yes |
| warnings | [ string ] |  | No |

#### AgentConfigSkillItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| file_id | string |  | No |
| hash | string |  | No |
| id | string |  | Yes |
| mime_type | string |  | No |
| name | string |  | Yes |
| size | integer |  | No |

#### AgentConfigSkillItemsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [AgentConfigSkillItemResponse](#agentconfigskillitemresponse) ] |  | No |

#### AgentConfigSkillListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_id | string |  | Yes |
| config_version | [AgentConfigVersionResponse](#agentconfigversionresponse) |  | Yes |
| items | [ [AgentConfigSkillItemResponse](#agentconfigskillitemresponse) ] |  | No |

#### AgentConfigSkillMarkdownResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binary | boolean |  | Yes |
| path | string |  | Yes |
| size | integer |  | No |
| text | string |  | Yes |
| truncated | boolean |  | Yes |

#### AgentConfigSkillRefConfig

Stable Agent Soul reference to one normalized skill archive.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| file_id | string |  | Yes |
| file_kind | string, <br>**Default:** tool_file |  | No |
| hash | string |  | No |
| mime_type | string |  | No |
| name | string |  | Yes |
| size | integer |  | No |

#### AgentConfigSkillUploadResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| config_version | [AgentConfigVersionResponse](#agentconfigversionresponse) |  | Yes |
| skill | [AgentConfigSkillItemResponse](#agentconfigskillitemresponse) |  | Yes |

#### AgentConfigSnapshotDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_id | string |  | No |
| config_snapshot | [AgentSoulConfig](#agentsoulconfig) |  | Yes |
| created_at | integer |  | No |
| created_by | string |  | No |
| display_version | integer |  | No |
| id | string |  | Yes |
| revisions | [ [AgentConfigRevisionResponse](#agentconfigrevisionresponse) ] |  | No |
| snapshot_version | integer |  | No |
| summary | string |  | No |
| version | integer |  | Yes |
| version_note | string |  | No |

#### AgentConfigSnapshotListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AgentConfigSnapshotSummaryResponse](#agentconfigsnapshotsummaryresponse) ] |  | Yes |

#### AgentConfigSnapshotRestoreResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_config_snapshot_id | string |  | Yes |
| draft_config_id | string |  | No |
| restored_version_id | string |  | No |
| result | string |  | Yes |

#### AgentConfigSnapshotSummaryResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_id | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| display_version | integer |  | No |
| id | string |  | Yes |
| snapshot_version | integer |  | No |
| summary | string |  | No |
| version | integer |  | Yes |
| version_note | string |  | No |

#### AgentConfigVersionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| kind | string, <br>**Available values:** "build_draft", "draft", "snapshot" | *Enum:* `"build_draft"`, `"draft"`, `"snapshot"` | Yes |
| writable | boolean |  | Yes |

#### AgentDailyConversationStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_count | integer |  | Yes |
| date | string |  | Yes |

#### AgentDailyEndUserStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| terminal_count | integer |  | Yes |

#### AgentDailyMessageStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| message_count | integer |  | Yes |

#### AgentDebugConversationRefreshResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| debug_conversation_has_messages | boolean |  | No |
| debug_conversation_id | string |  | Yes |
| debug_conversation_message_count | integer |  | No |

#### AgentDriveDeleteFileByAgentQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| key | string | Drive key, e.g. files/sample.pdf | Yes |

#### AgentDriveDeleteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| removed_keys | [ string ] |  | No |
| result | string |  | Yes |

#### AgentDriveDownloadResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string |  | Yes |

#### AgentDriveFileCommitResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file | [AgentDriveFileResponse](#agentdrivefileresponse) |  | Yes |

#### AgentDriveFilePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| upload_file_id | string | UploadFile UUID from POST /console/api/files/upload | Yes |

#### AgentDriveFileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| drive_key | string |  | Yes |
| file_id | string |  | Yes |
| mime_type | string |  | No |
| name | string |  | Yes |
| size | integer |  | No |

#### AgentDriveItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| file_kind | string |  | Yes |
| hash | string |  | No |
| is_skill | boolean |  | No |
| key | string |  | Yes |
| mime_type | string |  | No |
| size | integer |  | No |
| skill_metadata | string |  | No |

#### AgentDriveListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [AgentDriveItemResponse](#agentdriveitemresponse) ] |  | No |

#### AgentDrivePreviewResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binary | boolean |  | Yes |
| key | string |  | Yes |
| size | integer |  | No |
| text | string |  | No |
| truncated | boolean |  | Yes |

#### AgentDriveSkillFileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| available_in_drive | boolean |  | Yes |
| drive_key | string |  | No |
| name | string |  | Yes |
| path | string |  | Yes |
| type | string |  | Yes |

#### AgentDriveSkillInspectResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| archive_key | string |  | No |
| created_at | integer |  | No |
| description | string |  | Yes |
| file_tree | [ object ] |  | No |
| files | [ [AgentDriveSkillFileResponse](#agentdriveskillfileresponse) ] |  | No |
| hash | string |  | No |
| mime_type | string |  | No |
| name | string |  | Yes |
| path | string |  | Yes |
| size | integer |  | No |
| skill_md | [AgentDriveSkillMarkdownResponse](#agentdriveskillmarkdownresponse) |  | Yes |
| skill_md_key | string |  | Yes |
| source | string |  | Yes |
| warnings | [ string ] |  | No |

#### AgentDriveSkillItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| archive_key | string |  | No |
| created_at | integer |  | No |
| description | string |  | Yes |
| hash | string |  | No |
| mime_type | string |  | No |
| name | string |  | Yes |
| path | string |  | Yes |
| size | integer |  | No |
| skill_md_key | string |  | Yes |

#### AgentDriveSkillListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [AgentDriveSkillItemResponse](#agentdriveskillitemresponse) ] |  | No |

#### AgentDriveSkillMarkdownResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binary | boolean |  | Yes |
| key | string |  | Yes |
| size | integer |  | No |
| text | string |  | No |
| truncated | boolean |  | Yes |

#### AgentEnvVariableConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default | string<br>integer<br>number<br>boolean<br>[ string ]<br>[ integer ]<br>[ number ]<br>[ boolean ] |  | No |
| env_name | string |  | No |
| key | string |  | No |
| name | string |  | No |
| required | boolean |  | No |
| type | string |  | No |
| value | string<br>integer<br>number<br>boolean<br>[ string ]<br>[ integer ]<br>[ number ]<br>[ boolean ] |  | No |
| variable | string |  | No |

#### AgentFeatureToggleConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | No |

#### AgentFileRefConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| drive_key | string |  | No |
| file_id | string |  | No |
| id | string |  | No |
| name | string |  | No |
| reference | string |  | No |
| remote_url | string |  | No |
| tenant_id | string |  | No |
| transfer_method | string |  | No |
| type | string |  | No |
| upload_file_id | string |  | No |
| url | string |  | No |

#### AgentFileUploadFeatureConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed_file_extensions | [ string ] |  | No |
| allowed_file_types | [ [FileType](#filetype) ] |  | No |
| allowed_file_upload_methods | [ [FileTransferMethod](#filetransfermethod) ] |  | No |
| enabled | boolean, <br>**Default:** true |  | No |
| image | [AgentFileUploadImageFeatureConfig](#agentfileuploadimagefeatureconfig) |  | No |
| number_limits | integer, <br>**Default:** 3 |  | No |

#### AgentFileUploadImageFeatureConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean, <br>**Default:** true |  | No |

#### AgentHumanContactConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| channel | string |  | No |
| contact_id | string |  | No |
| contact_method | string |  | No |
| email | string |  | No |
| human_id | string |  | No |
| id | string |  | No |
| method | string |  | No |
| name | string |  | No |
| tenant_id | string |  | No |

#### AgentHumanToolConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| enabled | boolean, <br>**Default:** true |  | No |
| name | string |  | No |

#### AgentIconType

Supported icon storage formats for Agent roster entries.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentIconType | string | Supported icon storage formats for Agent roster entries. |  |

#### AgentIdPath

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_id | string |  | Yes |

#### AgentInviteOptionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_config_is_published | boolean |  | No |
| active_config_snapshot | [AgentConfigSnapshotSummaryResponse](#agentconfigsnapshotsummaryresponse) |  | No |
| active_config_snapshot_id | string |  | No |
| agent_kind | [AgentKind](#agentkind) |  | Yes |
| app_id | string |  | No |
| archived_at | integer |  | No |
| archived_by | string |  | No |
| backing_app_id | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| description | string |  | Yes |
| existing_node_ids | [ string ] |  | No |
| hidden_app_backed | boolean |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | [AgentIconType](#agenticontype) |  | No |
| id | string |  | Yes |
| in_current_workflow_count | integer |  | No |
| is_in_current_workflow | boolean |  | No |
| name | string |  | Yes |
| published_node_reference_count | integer |  | No |
| published_reference_count | integer |  | No |
| published_references | [ [AgentPublishedReferenceResponse](#agentpublishedreferenceresponse) ] |  | No |
| role | string |  | No |
| scope | [AgentScope](#agentscope) |  | Yes |
| source | [AgentSource](#agentsource) |  | Yes |
| status | [AgentStatus](#agentstatus) |  | Yes |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| workflow_id | string |  | No |
| workflow_node_id | string |  | No |

#### AgentInviteOptionsQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string | Workflow app id for in-current-workflow markers | No |
| keyword | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### AgentInviteOptionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AgentInviteOptionResponse](#agentinviteoptionresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### AgentIterationLogResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | string |  | Yes |
| files | [  ] |  | No |
| thought | string |  | No |
| tokens | integer |  | Yes |
| tool_calls | [ [AgentToolCallResponse](#agenttoolcallresponse) ] |  | Yes |
| tool_raw | object |  | Yes |

#### AgentKind

Agent implementation family.

This leaves room for future non-Dify agent implementations while keeping
the current roster/workflow APIs scoped to Dify Agent.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentKind | string | Agent implementation family.  This leaves room for future non-Dify agent implementations while keeping the current roster/workflow APIs scoped to Dify Agent. |  |

#### AgentKnowledgeDatasetConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | No |
| name | string |  | No |

#### AgentKnowledgeMetadataCondition

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| comparison_operator | string, <br>**Available values:** "<", "=", ">", "after", "before", "contains", "empty", "end with", "in", "is", "is not", "not contains", "not empty", "not in", "start with", "≠", "≤", "≥" | *Enum:* `"<"`, `"="`, `">"`, `"after"`, `"before"`, `"contains"`, `"empty"`, `"end with"`, `"in"`, `"is"`, `"is not"`, `"not contains"`, `"not empty"`, `"not in"`, `"start with"`, `"≠"`, `"≤"`, `"≥"` | Yes |
| name | string |  | Yes |
| value | string<br>[ string ]<br>number |  | No |

#### AgentKnowledgeMetadataConditions

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conditions | [ [AgentKnowledgeMetadataCondition](#agentknowledgemetadatacondition) ] |  | No |
| logical_operator | string, <br>**Available values:** "and", "or", <br>**Default:** and | *Enum:* `"and"`, `"or"` | No |

#### AgentKnowledgeMetadataFilteringConfig

Per-set metadata filtering policy.

The Python attribute uses ``metadata_model_config`` for clarity because the
model belongs to metadata filtering specifically, while the external API and
generated schema keep the historical ``model_config`` field name via alias.
Mode-dependent completeness is enforced by composer publish validation so
draft saves can persist partially configured metadata filters.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conditions | [AgentKnowledgeMetadataConditions](#agentknowledgemetadataconditions) |  | No |
| mode | string, <br>**Available values:** "automatic", "disabled", "manual", <br>**Default:** disabled | *Enum:* `"automatic"`, `"disabled"`, `"manual"` | No |
| model_config | [AgentKnowledgeModelConfig](#agentknowledgemodelconfig) |  | No |

#### AgentKnowledgeModelConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| completion_params | object |  | No |
| mode | string |  | Yes |
| name | string |  | Yes |
| provider | string |  | Yes |

#### AgentKnowledgeQueryConfig

Per-set query policy for Agent v2 knowledge retrieval.

Agent v2 stores knowledge as explicit ``knowledge.sets`` rather than the
legacy flat ``datasets`` / ``query_mode`` / ``query_config`` shape. Each
set owns its own query policy. Mode-dependent completeness, such as
requiring ``value`` for ``user_query``, is enforced by composer publish
validation so draft saves can persist partially configured knowledge sets.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| mode | [AgentKnowledgeQueryMode](#agentknowledgequerymode) |  | Yes |
| value | string |  | No |

#### AgentKnowledgeQueryMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentKnowledgeQueryMode | string |  |  |

#### AgentKnowledgeRerankingModelConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string |  | Yes |
| provider | string |  | Yes |

#### AgentKnowledgeRetrievalConfig

Per-set retrieval policy for Agent v2 knowledge retrieval.

Retrieval settings now live on each knowledge set instead of one shared
flat config. Mode-dependent completeness, such as requiring ``top_k`` for
``multiple`` or a model for ``single``, is enforced by composer publish
validation so draft saves can persist partially configured knowledge sets.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| mode | string, <br>**Available values:** "multiple", "single" | *Enum:* `"multiple"`, `"single"` | Yes |
| model | [AgentKnowledgeModelConfig](#agentknowledgemodelconfig) |  | No |
| reranking_enable | boolean, <br>**Default:** true |  | No |
| reranking_mode | string, <br>**Default:** reranking_model |  | No |
| reranking_model | [AgentKnowledgeRerankingModelConfig](#agentknowledgererankingmodelconfig) |  | No |
| score_threshold | number |  | No |
| top_k | integer |  | No |
| weights | [AgentKnowledgeWeightedScoreConfig](#agentknowledgeweightedscoreconfig) |  | No |

#### AgentKnowledgeSetConfig

One explicit knowledge set in Agent v2.

``knowledge.sets`` replaces the old flat knowledge config. Each set owns
its datasets plus query, retrieval, and metadata policies. An individual
set must contain at least one dataset id even though the overall knowledge
section may be empty, which is how callers express "no knowledge layer".

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| datasets | [ [AgentKnowledgeDatasetConfig](#agentknowledgedatasetconfig) ] |  | Yes |
| description | string |  | No |
| id | string |  | Yes |
| metadata_filtering | [AgentKnowledgeMetadataFilteringConfig](#agentknowledgemetadatafilteringconfig) |  | No |
| name | string |  | Yes |
| query | [AgentKnowledgeQueryConfig](#agentknowledgequeryconfig) |  | Yes |
| retrieval | [AgentKnowledgeRetrievalConfig](#agentknowledgeretrievalconfig) |  | Yes |

#### AgentKnowledgeWeightedScoreConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_setting | object |  | No |
| vector_setting | object |  | No |
| weight_type | string |  | No |

#### AgentLogConversationItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string |  | Yes |
| created_at | integer |  | No |
| end_user_id | string |  | No |
| id | string |  | Yes |
| message_count | integer |  | Yes |
| operation_rate | number |  | No |
| source | [AgentLogSourceResponse](#agentlogsourceresponse) |  | No |
| status | string, <br>**Available values:** "failed", "paused", "success" | *Enum:* `"failed"`, `"paused"`, `"success"` | Yes |
| title | string |  | No |
| unread | boolean |  | Yes |
| updated_at | integer |  | No |
| user_rate | number |  | No |

#### AgentLogListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AgentLogConversationItemResponse](#agentlogconversationitemresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### AgentLogMessageItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | Yes |
| answer_tokens | integer |  | Yes |
| conversation_id | string |  | Yes |
| created_at | integer |  | No |
| currency | string |  | Yes |
| error | string |  | No |
| from_account_id | string |  | No |
| from_end_user_id | string |  | No |
| id | string |  | Yes |
| latency | number |  | Yes |
| message_id | string |  | Yes |
| message_tokens | integer |  | Yes |
| query | string |  | Yes |
| status | string |  | Yes |
| total_price | string |  | Yes |
| total_tokens | integer |  | Yes |
| updated_at | integer |  | No |

#### AgentLogMessageListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AgentLogMessageItemResponse](#agentlogmessageitemresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### AgentLogMetaResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_mode | string |  | Yes |
| elapsed_time | number |  | No |
| executor | string |  | Yes |
| iterations | integer |  | Yes |
| start_time | string |  | Yes |
| status | string |  | Yes |
| total_tokens | integer |  | Yes |

#### AgentLogQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation UUID | Yes |
| message_id | string | Message UUID | Yes |

#### AgentLogResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [  ] |  | No |
| iterations | [ [AgentIterationLogResponse](#agentiterationlogresponse) ] |  | Yes |
| meta | [AgentLogMetaResponse](#agentlogmetaresponse) |  | Yes |

#### AgentLogSourceGroupResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| label | string |  | Yes |
| sources | [ [AgentLogSourceResponse](#agentlogsourceresponse) ] |  | No |
| type | string, <br>**Available values:** "webapp", "workflow" | *Enum:* `"webapp"`, `"workflow"` | Yes |

#### AgentLogSourceListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AgentLogSourceResponse](#agentlogsourceresponse) ] |  | Yes |
| groups | [ [AgentLogSourceGroupResponse](#agentlogsourcegroupresponse) ] |  | Yes |

#### AgentLogSourceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_icon | string |  | No |
| app_icon_background | string |  | No |
| app_icon_type | string |  | No |
| app_id | string |  | Yes |
| app_name | string |  | Yes |
| id | string |  | Yes |
| node_id | string |  | No |
| type | string, <br>**Available values:** "webapp", "workflow" | *Enum:* `"webapp"`, `"workflow"` | Yes |
| workflow_id | string |  | No |
| workflow_version | string |  | No |

#### AgentLogsQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| end | string | End date (YYYY-MM-DD HH:MM) | No |
| keyword | string | Search query, answer, or conversation name | No |
| limit | integer, <br>**Default:** 20 | Page size | No |
| page | integer, <br>**Default:** 1 | Page number | No |
| sort_by | string, <br>**Default:** updated_at | Sort by created_at or updated_at | No |
| sort_order | string, <br>**Default:** desc | Sort order: asc or desc | No |
| source | string | Deprecated single source filter | No |
| sources | [ string ] | Filter by one or more source IDs, e.g. webapp:<app_id> or workflow:<app_id>:<workflow_id>:<version>:<node_id> | No |
| start | string | Start date (YYYY-MM-DD HH:MM) | No |
| status | string | Deprecated single status filter | No |
| statuses | [ string ] | Filter by one or more of success, failed, paused | No |

#### AgentMemoryArtifactConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | No |
| name | string |  | No |
| type | string |  | No |
| url | string |  | No |

#### AgentModelResponseFormatConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| type | string |  | No |

#### AgentModerationIOConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | No |
| preset_response | string |  | No |

#### AgentModerationProviderConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| api_based_extension_id | string |  | No |
| inputs_config | [AgentModerationIOConfig](#agentmoderationioconfig) |  | No |
| keywords | string |  | No |
| outputs_config | [AgentModerationIOConfig](#agentmoderationioconfig) |  | No |

#### AgentPermissionConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed | boolean |  | No |
| state | string |  | No |
| status | string |  | No |

#### AgentProviderListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentProviderListResponse | array |  |  |

#### AgentProviderResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentProviderResponse | object |  |  |

#### AgentPublishPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| version_note | string | Optional note for this published Agent version | No |

#### AgentPublishResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_config_snapshot | [AgentConfigSnapshotSummaryResponse](#agentconfigsnapshotsummaryresponse) |  | No |
| active_config_snapshot_id | string |  | Yes |
| draft | [AgentConfigDraftSummaryResponse](#agentconfigdraftsummaryresponse) |  | No |
| result | string |  | Yes |

#### AgentPublishedReferenceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_icon | string |  | No |
| app_icon_background | string |  | No |
| app_icon_type | string |  | No |
| app_id | string |  | Yes |
| app_mode | string |  | Yes |
| app_name | string |  | Yes |
| app_updated_at | integer |  | No |
| node_ids | [ string ] |  | No |
| workflow_id | string |  | Yes |
| workflow_version | string |  | Yes |

#### AgentReferencingWorkflowResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_icon | string |  | No |
| app_icon_background | string |  | No |
| app_icon_type | string |  | No |
| app_id | string |  | Yes |
| app_mode | string |  | Yes |
| app_name | string |  | Yes |
| app_updated_at | integer |  | No |
| node_ids | [ string ] |  | No |
| workflow_id | string |  | Yes |
| workflow_version | string |  | Yes |

#### AgentReferencingWorkflowsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AgentReferencingWorkflowResponse](#agentreferencingworkflowresponse) ] |  | No |

#### AgentRosterListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AgentRosterResponse](#agentrosterresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### AgentRosterResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_config_is_published | boolean |  | No |
| active_config_snapshot | [AgentConfigSnapshotSummaryResponse](#agentconfigsnapshotsummaryresponse) |  | No |
| active_config_snapshot_id | string |  | No |
| agent_kind | [AgentKind](#agentkind) |  | Yes |
| app_id | string |  | No |
| archived_at | integer |  | No |
| archived_by | string |  | No |
| backing_app_id | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| description | string |  | Yes |
| hidden_app_backed | boolean |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | [AgentIconType](#agenticontype) |  | No |
| id | string |  | Yes |
| name | string |  | Yes |
| published_node_reference_count | integer |  | No |
| published_reference_count | integer |  | No |
| published_references | [ [AgentPublishedReferenceResponse](#agentpublishedreferenceresponse) ] |  | No |
| role | string |  | No |
| scope | [AgentScope](#agentscope) |  | Yes |
| source | [AgentSource](#agentsource) |  | Yes |
| status | [AgentStatus](#agentstatus) |  | Yes |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| workflow_id | string |  | No |
| workflow_node_id | string |  | No |

#### AgentSandboxProviderConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| cpu | integer |  | No |
| env | [ [AgentEnvVariableConfig](#agentenvvariableconfig) ] |  | No |
| image | string |  | No |
| working_dir | string |  | No |

#### AgentSandboxUploadPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Agent App conversation ID | Yes |
| path | string | File path relative to the sandbox workspace | Yes |

#### AgentScope

Visibility and lifecycle scope of an Agent record.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentScope | string | Visibility and lifecycle scope of an Agent record. |  |

#### AgentSecretRefConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | No |
| env_name | string |  | No |
| id | string |  | No |
| key | string |  | No |
| name | string |  | No |
| permission | [AgentPermissionConfig](#agentpermissionconfig) |  | No |
| permission_status | string |  | No |
| provider | string |  | No |
| provider_credential_id | string |  | No |
| ref | string |  | No |
| type | string |  | No |
| value | string |  | No |
| variable | string |  | No |

#### AgentSensitiveWordAvoidanceFeatureConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| config | [AgentModerationProviderConfig](#agentmoderationproviderconfig) |  | No |
| enabled | boolean |  | No |
| type | string |  | No |

#### AgentSimpleResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |

#### AgentSkillRefConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| file_id | string |  | No |
| full_archive_file_id | string |  | No |
| full_archive_key | string |  | No |
| id | string |  | No |
| manifest_files | [ string ] |  | No |
| name | string |  | No |
| path | string |  | No |
| skill_md_file_id | string |  | No |
| skill_md_key | string |  | No |

#### AgentSkillUploadResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| manifest | [SkillManifest](#skillmanifest) |  | Yes |
| skill | [AgentUploadedSkillResponse](#agentuploadedskillresponse) |  | Yes |

#### AgentSoulAppFeaturesConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_upload | [AgentFileUploadFeatureConfig](#agentfileuploadfeatureconfig) |  | No |
| opening_statement | string |  | No |
| retriever_resource | [AgentFeatureToggleConfig](#agentfeaturetoggleconfig) |  | No |
| sensitive_word_avoidance | [AgentSensitiveWordAvoidanceFeatureConfig](#agentsensitivewordavoidancefeatureconfig) |  | No |
| speech_to_text | [AgentFeatureToggleConfig](#agentfeaturetoggleconfig) |  | No |
| suggested_questions | [ string ] |  | No |
| suggested_questions_after_answer | [AgentSuggestedQuestionsAfterAnswerFeatureConfig](#agentsuggestedquestionsafteranswerfeatureconfig) |  | No |
| text_to_speech | [AgentTextToSpeechFeatureConfig](#agenttexttospeechfeatureconfig) |  | No |

#### AgentSoulConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_features | [AgentSoulAppFeaturesConfig](#agentsoulappfeaturesconfig) |  | No |
| app_variables | [ [AppVariableConfig](#appvariableconfig) ] |  | No |
| config_files | [ [AgentConfigFileRefConfig](#agentconfigfilerefconfig) ] |  | No |
| config_note | string |  | No |
| config_skills | [ [AgentConfigSkillRefConfig](#agentconfigskillrefconfig) ] |  | No |
| env | [AgentSoulEnvConfig](#agentsoulenvconfig) |  | No |
| files | [AgentSoulFilesConfig](#agentsoulfilesconfig) |  | No |
| human | [AgentSoulHumanConfig](#agentsoulhumanconfig) |  | No |
| knowledge | [AgentSoulKnowledgeConfig](#agentsoulknowledgeconfig) |  | No |
| memory | [AgentSoulMemoryConfig](#agentsoulmemoryconfig) |  | No |
| misc_legacy | [AgentSoulAppFeaturesConfig](#agentsoulappfeaturesconfig) |  | No |
| model | [AgentSoulModelConfig](#agentsoulmodelconfig) |  | No |
| prompt | [AgentSoulPromptConfig](#agentsoulpromptconfig) |  | No |
| sandbox | [AgentSoulSandboxConfig](#agentsoulsandboxconfig) |  | No |
| schema_version | integer, <br>**Default:** 1 |  | No |
| tools | [AgentSoulToolsConfig](#agentsoultoolsconfig) |  | No |

#### AgentSoulDifyToolConfig

One Dify tool configured on Agent Soul.

The API backend prepares this persisted product shape into
either ``DifyPluginToolConfig`` or ``DifyCoreToolConfig`` before sending a
run request to Agent backend. ``plugin`` providers keep the direct
``dify.plugin.tools`` transport; ``builtin`` / ``api`` / ``workflow`` /
``mcp`` providers are prepared for ``dify.core.tools``. ``provider_id``
keeps compatibility with existing Agent tool config payloads; new callers
should send ``plugin_id`` + ``provider`` when available.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_ref | [AgentSoulDifyToolCredentialRef](#agentsouldifytoolcredentialref) |  | No |
| credential_type | string, <br>**Available values:** "api-key", "oauth2", "unauthorized", <br>**Default:** api-key | *Enum:* `"api-key"`, `"oauth2"`, `"unauthorized"` | No |
| description | string |  | No |
| enabled | boolean, <br>**Default:** true |  | No |
| name | string |  | No |
| plugin_id | string |  | No |
| provider | string |  | No |
| provider_id | string |  | No |
| provider_type | string, <br>**Default:** plugin |  | No |
| runtime_parameters | object |  | No |
| tool_name | string |  | No |

#### AgentSoulDifyToolCredentialRef

Reference to a stored Dify Plugin Tool credential.

Secret values are resolved only at runtime. The legacy ``credential_id``
field is accepted by :class:`AgentSoulDifyToolConfig` and normalized here so
old Agent tool payloads can be read while new payloads stay explicit.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | No |
| provider | string |  | No |
| type | string, <br>**Available values:** "provider", "tool", <br>**Default:** tool | *Enum:* `"provider"`, `"tool"` | No |

#### AgentSoulEnvConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| secret_refs | [ [AgentSecretRefConfig](#agentsecretrefconfig) ] |  | No |
| variables | [ [AgentEnvVariableConfig](#agentenvvariableconfig) ] |  | No |

#### AgentSoulFilesConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ [AgentFileRefConfig](#agentfilerefconfig) ] |  | No |
| skills | [ [AgentSkillRefConfig](#agentskillrefconfig) ] |  | No |

#### AgentSoulHumanConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| contacts | [ [AgentHumanContactConfig](#agenthumancontactconfig) ] |  | No |
| tools | [ [AgentHumanToolConfig](#agenthumantoolconfig) ] |  | No |

#### AgentSoulKnowledgeConfig

Top-level Agent v2 knowledge config.

Agent v2 models knowledge as explicit sets instead of one flat
``datasets`` / ``query_mode`` / ``query_config`` block. An empty ``sets``
list means no knowledge layer should be emitted at runtime, while set-name
uniqueness stays case-insensitive because runtime selection addresses sets
by name.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| sets | [ [AgentKnowledgeSetConfig](#agentknowledgesetconfig) ] |  | No |

#### AgentSoulMemoryConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| artifacts | [ [AgentMemoryArtifactConfig](#agentmemoryartifactconfig) ] |  | No |
| budget | string |  | No |
| scope | string |  | No |

#### AgentSoulModelConfig

Stable model selection for Agent runtime without storing secret values.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_ref | [AgentSoulModelCredentialRef](#agentsoulmodelcredentialref) |  | No |
| model | string |  | Yes |
| model_provider | string |  | Yes |
| model_settings | [AgentSoulModelSettings](#agentsoulmodelsettings) |  | No |
| plugin_id | string |  | Yes |

#### AgentSoulModelCredentialRef

Reference to model credentials resolved only at runtime.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | No |
| provider | string |  | No |
| type | string |  | Yes |

#### AgentSoulModelSettings

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| frequency_penalty | number |  | No |
| max_tokens | integer |  | No |
| presence_penalty | number |  | No |
| response_format | [AgentModelResponseFormatConfig](#agentmodelresponseformatconfig) |  | No |
| stop | [ string ] |  | No |
| temperature | number |  | No |
| top_p | number |  | No |

#### AgentSoulPromptConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| system_prompt | string |  | No |

#### AgentSoulSandboxConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| config | [AgentSandboxProviderConfig](#agentsandboxproviderconfig) |  | No |
| provider | string |  | No |

#### AgentSoulToolsConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| cli_tools | [ [AgentCliToolConfig](#agentclitoolconfig) ] |  | No |
| dify_tools | [ [AgentSoulDifyToolConfig](#agentsouldifytoolconfig) ] |  | No |

#### AgentSource

Origin that created or imported the Agent.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentSource | string | Origin that created or imported the Agent. |  |

#### AgentStatisticChartsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| average_response_time | [ [AgentAverageResponseTimeStatisticResponse](#agentaverageresponsetimestatisticresponse) ] |  | No |
| average_session_interactions | [ [AgentAverageSessionInteractionStatisticResponse](#agentaveragesessioninteractionstatisticresponse) ] |  | No |
| daily_conversations | [ [AgentDailyConversationStatisticResponse](#agentdailyconversationstatisticresponse) ] |  | No |
| daily_end_users | [ [AgentDailyEndUserStatisticResponse](#agentdailyenduserstatisticresponse) ] |  | No |
| daily_messages | [ [AgentDailyMessageStatisticResponse](#agentdailymessagestatisticresponse) ] |  | No |
| token_usage | [ [AgentTokenUsageStatisticResponse](#agenttokenusagestatisticresponse) ] |  | No |
| tokens_per_second | [ [AgentTokensPerSecondStatisticResponse](#agenttokenspersecondstatisticresponse) ] |  | No |
| user_satisfaction_rate | [ [AgentUserSatisfactionRateStatisticResponse](#agentusersatisfactionratestatisticresponse) ] |  | No |

#### AgentStatisticSummaryEnvelopeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| charts | [AgentStatisticChartsResponse](#agentstatisticchartsresponse) |  | Yes |
| source | string |  | Yes |
| summary | [AgentStatisticSummaryResponse](#agentstatisticsummaryresponse) |  | Yes |

#### AgentStatisticSummaryResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| average_response_time | number |  | Yes |
| average_session_interactions | number |  | Yes |
| currency | string |  | Yes |
| tokens_per_second | number |  | Yes |
| total_conversations | integer |  | Yes |
| total_end_users | integer |  | Yes |
| total_messages | integer |  | Yes |
| total_price | string |  | Yes |
| total_tokens | integer |  | Yes |
| user_satisfaction_rate | number |  | Yes |

#### AgentStatisticsQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| end | string | End date (YYYY-MM-DD HH:MM) | No |
| source | string | Filter by all, console/explore, api/service-api, web-app, debugger, openapi, or trigger | No |
| start | string | Start date (YYYY-MM-DD HH:MM) | No |

#### AgentStatus

Soft lifecycle state for Agent records.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentStatus | string | Soft lifecycle state for Agent records. |  |

#### AgentSuggestedQuestionsAfterAnswerFeatureConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | No |
| model | [AgentSuggestedQuestionsAfterAnswerModelConfig](#agentsuggestedquestionsafteranswermodelconfig) |  | No |
| prompt | string |  | No |

#### AgentSuggestedQuestionsAfterAnswerModelConfig

Legacy Chat App model config used only for follow-up question generation.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| completion_params | object |  | No |
| mode | string |  | No |
| name | string |  | Yes |
| provider | string |  | Yes |

#### AgentTextToSpeechFeatureConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| autoPlay | string |  | No |
| enabled | boolean |  | No |
| language | string |  | No |
| voice | string |  | No |

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

#### AgentTokenUsageStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| currency | string |  | Yes |
| date | string |  | Yes |
| token_count | integer |  | Yes |
| total_price | string |  | Yes |

#### AgentTokensPerSecondStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| tps | number |  | Yes |

#### AgentToolCallResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| error | string |  | No |
| status | string |  | Yes |
| time_cost | number<br>integer |  | Yes |
| tool_icon |  |  | No |
| tool_input | object |  | Yes |
| tool_label | string |  | Yes |
| tool_name | string |  | Yes |
| tool_output | object |  | Yes |
| tool_parameters | object |  | Yes |

#### AgentUploadedSkillResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| archive_key | string |  | No |
| description | string |  | Yes |
| name | string |  | Yes |
| path | string |  | Yes |
| skill_md_key | string |  | Yes |

#### AgentUserSatisfactionRateStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| rate | number |  | Yes |

#### AllowedExtensionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed_extensions | [ string ] |  | Yes |

#### Annotation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | No |
| created_at | integer |  | No |
| hit_count | integer |  | No |
| id | string |  | Yes |
| question | string |  | No |

#### AnnotationBatchImportResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| error_msg | string |  | No |
| job_id | string |  | No |
| job_status | string |  | No |
| record_count | integer |  | No |

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
| created_at | integer |  | No |
| id | string |  | Yes |
| match | string |  | No |
| question | string |  | No |
| response | string |  | No |
| score | number |  | No |
| source | string |  | No |

#### AnnotationHitHistoryList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AnnotationHitHistory](#annotationhithistory) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### AnnotationHitHistoryListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 | Page size | No |
| page | integer, <br>**Default:** 1 | Page number | No |

#### AnnotationJobStatusDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| error_msg | string |  | No |
| job_id | string |  | Yes |
| job_status | string<br>string |  | Yes |

#### AnnotationJobStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| job_id | string |  | Yes |
| job_status | string<br>string |  | Yes |

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
| limit | integer, <br>**Default:** 20 | Page size | No |
| page | integer, <br>**Default:** 1 | Page number | No |

#### AnnotationReplyPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string | Embedding model name | Yes |
| embedding_provider_name | string | Embedding provider name | Yes |
| score_threshold | number | Score threshold for annotation matching | Yes |

#### AnnotationReplyStatusQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string, <br>**Available values:** "disable", "enable" | *Enum:* `"disable"`, `"enable"` | Yes |

#### AnnotationSettingEmbeddingModelResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string |  | No |
| embedding_provider_name | string |  | No |

#### AnnotationSettingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model | [AnnotationSettingEmbeddingModelResponse](#annotationsettingembeddingmodelresponse) |  | No |
| enabled | boolean |  | Yes |
| id | string |  | No |
| score_threshold | number |  | No |

#### AnnotationSettingUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| score_threshold | number | Score threshold | Yes |

#### ApiBaseUrlResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| api_base_url | string |  | Yes |

#### ApiKeyAuthBindingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| category | string |  | Yes |
| credentials | object |  | Yes |
| provider | string |  | Yes |

#### ApiKeyAuthDataSourceItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| category | string |  | Yes |
| created_at | integer |  | Yes |
| disabled | boolean |  | Yes |
| id | string |  | Yes |
| provider | string |  | Yes |
| updated_at | integer |  | Yes |

#### ApiKeyAuthDataSourceListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| sources | [ [ApiKeyAuthDataSourceItem](#apikeyauthdatasourceitem) ] |  | Yes |

#### ApiKeyItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| id | string |  | Yes |
| last_used_at | integer |  | No |
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
| labels | [ string ] |  | No |
| privacy_policy | string |  | No |
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
| labels | [ string ] |  | No |
| original_provider | string |  | Yes |
| privacy_policy | string |  | No |
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
| provider_name | string |  | No |
| schema | string |  | Yes |
| schema_type | [ApiProviderSchemaType](#apiproviderschematype) |  | Yes |
| tool_name | string |  | Yes |

#### AppAccessMatrix

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | No |
| items | [ [AccessMatrixItem](#accessmatrixitem) ] |  | No |

#### AppApiStatusPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enable_api | boolean | Enable or disable API | Yes |

#### AppDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode | string |  | No |
| app_model_config | [ModelConfig](#modelconfig) |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| description | string |  | No |
| enable_api | boolean |  | Yes |
| enable_site | boolean |  | Yes |
| icon | string |  | No |
| icon_background | string |  | No |
| id | string |  | Yes |
| maintainer | string |  | No |
| mode_compatible_with_agent | string |  | Yes |
| name | string |  | Yes |
| permission_keys | [ string ] |  | No |
| tags | [ [Tag](#tag) ] |  | No |
| tracing |  |  | No |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |
| workflow | [WorkflowPartial](#workflowpartial) |  | No |

#### AppDetailSiteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | No |
| app_base_url | string |  | No |
| chat_color_theme | string |  | No |
| chat_color_theme_inverted | boolean |  | No |
| code | string |  | No |
| copyright | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| custom_disclaimer | string |  | No |
| customize_domain | string |  | No |
| customize_token_strategy | string |  | No |
| default_language | string |  | No |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string<br>[IconType](#icontype) |  | No |
| icon_url | string |  | Yes |
| input_placeholder | string |  | No |
| privacy_policy | string |  | No |
| prompt_public | boolean |  | No |
| show_workflow_steps | boolean |  | No |
| title | string |  | No |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |

#### AppDetailWithSite

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode | string |  | No |
| api_base_url | string |  | No |
| app_id | string |  | No |
| bound_agent_id | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| deleted_tools | [ [DeletedTool](#deletedtool) ] |  | No |
| description | string |  | No |
| enable_api | boolean |  | Yes |
| enable_site | boolean |  | Yes |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | Yes |
| id | string |  | Yes |
| maintainer | string |  | No |
| max_active_requests | integer |  | No |
| mode | string |  | Yes |
| model_config | [ModelConfig](#modelconfig) |  | No |
| name | string |  | Yes |
| permission_keys | [ string ] |  | No |
| site | [AppDetailSiteResponse](#appdetailsiteresponse) |  | No |
| tags | [ [Tag](#tag) ] |  | No |
| tracing |  |  | No |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |
| workflow | [WorkflowPartial](#workflowpartial) |  | No |

#### AppDslVersionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_dsl_version | string |  | Yes |

#### AppExportQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| include_secret | boolean | Include secrets in export | No |
| workflow_id | string | Specific workflow ID to export | No |

#### AppExportResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string |  | Yes |

#### AppIconPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon | string | Icon data | No |
| icon_background | string | Icon background color | No |
| icon_type | [IconType](#icontype) | Icon type | No |

#### AppImportPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | No |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| mode | string | Import mode | Yes |
| name | string |  | No |
| yaml_content | string |  | No |
| yaml_url | string |  | No |

#### AppImportResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | No |
| app_mode | string |  | No |
| current_dsl_version | string |  | Yes |
| error | string |  | No |
| id | string |  | Yes |
| imported_dsl_version | string |  | No |
| status | [ImportStatus](#importstatus) |  | Yes |

#### AppListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| creator_ids | [ string ] | Filter by creator account IDs | No |
| is_created_by_me | boolean | Filter by creator | No |
| limit | integer, <br>**Default:** 20 | Page size (1-100) | No |
| mode | string, <br>**Available values:** "advanced-chat", "agent", "agent-chat", "all", "channel", "chat", "completion", "workflow", <br>**Default:** all | App mode filter<br>*Enum:* `"advanced-chat"`, `"agent"`, `"agent-chat"`, `"all"`, `"channel"`, `"chat"`, `"completion"`, `"workflow"` | No |
| name | string | Filter by app name | No |
| page | integer, <br>**Default:** 1 | Page number (1-99999) | No |
| sort_by | string, <br>**Available values:** "earliest_created", "last_modified", "recently_created", <br>**Default:** last_modified | Sort apps by last modified, recently created, or earliest created<br>*Enum:* `"earliest_created"`, `"last_modified"`, `"recently_created"` | No |
| tag_ids | [ string ] | Filter by tag IDs | No |

#### AppMCPServerResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| description | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| parameters | object<br>[ object ]<br>string |  | Yes |
| server_code | string |  | Yes |
| status | [AppMCPServerStatus](#appmcpserverstatus) |  | Yes |
| updated_at | integer |  | No |

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
| data | [ [AppPartial](#apppartial) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### AppPartial

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode | string |  | No |
| app_id | string |  | No |
| author_name | string |  | No |
| bound_agent_id | string |  | No |
| create_user_name | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| description | string |  | No |
| has_draft_trigger | boolean |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | Yes |
| id | string |  | Yes |
| is_starred | boolean |  | No |
| maintainer | string |  | No |
| max_active_requests | integer |  | No |
| mode | string |  | Yes |
| model_config | [ModelConfigPartial](#modelconfigpartial) |  | No |
| name | string |  | Yes |
| permission_keys | [ string ] |  | No |
| tags | [ [Tag](#tag) ] |  | No |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |
| workflow | [WorkflowPartial](#workflowpartial) |  | No |

#### AppSelectorScope

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AppSelectorScope | string |  |  |

#### AppSiteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |
| code | string |  | No |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| customize_domain | string |  | No |
| customize_token_strategy | string |  | Yes |
| default_language | string |  | Yes |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| input_placeholder | string |  | No |
| privacy_policy | string |  | No |
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
| chat_color_theme | string |  | No |
| chat_color_theme_inverted | boolean |  | No |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| customize_domain | string |  | No |
| customize_token_strategy | string |  | No |
| default_language | string |  | No |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| input_placeholder | string |  | No |
| privacy_policy | string |  | No |
| prompt_public | boolean |  | No |
| show_workflow_steps | boolean |  | No |
| title | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |

#### AppTracePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean | Enable or disable tracing | Yes |
| tracing_provider | string | Tracing provider | No |

#### AppTraceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | No |
| tracing_provider | string |  | No |

#### AppVariableConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default |  |  | No |
| name | string |  | Yes |
| required | boolean |  | No |
| type | string |  | Yes |

#### AudioBinaryResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AudioBinaryResponse | string |  |  |

#### AudioTranscriptResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| text | string |  | Yes |

#### AutoDisableLogsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| count | integer |  | Yes |
| document_ids | [ string ] |  | Yes |

#### AvatarUrlResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar_url | string |  | Yes |

#### AverageResponseTimeStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| latency | number |  | Yes |

#### AverageResponseTimeStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AverageResponseTimeStatisticItem](#averageresponsetimestatisticitem) ] |  | Yes |

#### AverageSessionInteractionStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| interactions | number |  | Yes |

#### AverageSessionInteractionStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AverageSessionInteractionStatisticItem](#averagesessioninteractionstatisticitem) ] |  | Yes |

#### BannerListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| BannerListResponse | array |  |  |

#### BannerResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content |  |  | Yes |
| created_at | string |  | No |
| id | string |  | Yes |
| link | string |  | No |
| sort | integer |  | Yes |
| status | string |  | Yes |

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
| top_k | integer | Maximum number of results to retrieve | No |

#### BillingInvoiceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string |  | Yes |

#### BillingModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | Yes |
| subscription | [SubscriptionModel](#subscriptionmodel) |  | Yes |

#### BillingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| BillingResponse | object |  |  |

#### BinaryFileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| BinaryFileResponse | string |  |  |

#### BrandingModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| application_title | string |  | Yes |
| enabled | boolean |  | Yes |
| favicon | string |  | Yes |
| login_page_logo | string |  | Yes |
| workspace_logo | string |  | Yes |

#### BuiltinCredentialListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| include_credential_ids | [ string ] | Credential IDs to include even if visibility would hide them | No |

#### BuiltinProviderDefaultCredentialPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |

#### BuiltinToolAddPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| name | string |  | No |
| type | [CredentialType](#credentialtype) |  | Yes |
| visibility | string |  | No |

#### BuiltinToolCredentialDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |

#### BuiltinToolUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| credentials | object |  | No |
| name | string |  | No |

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
| language | string |  | No |
| phase | string |  | No |
| token | string |  | No |

#### ChangeEmailValidityPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| email | string |  | Yes |
| token | string |  | Yes |

#### ChatConversationQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_status | string, <br>**Available values:** "all", "annotated", "not_annotated", <br>**Default:** all | Annotation status filter<br>*Enum:* `"all"`, `"annotated"`, `"not_annotated"` | No |
| end | string | End date (YYYY-MM-DD HH:MM) | No |
| keyword | string | Search keyword | No |
| limit | integer, <br>**Default:** 20 | Page size (1-100) | No |
| page | integer, <br>**Default:** 1 | Page number | No |
| sort_by | string, <br>**Available values:** "-created_at", "-updated_at", "created_at", "updated_at", <br>**Default:** -updated_at | Sort field and direction<br>*Enum:* `"-created_at"`, `"-updated_at"`, `"created_at"`, `"updated_at"` | No |
| start | string | Start date (YYYY-MM-DD HH:MM) | No |

#### ChatMessagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation ID | No |
| draft_type | string, <br>**Available values:** "debug_build", "draft", <br>**Default:** draft | Agent App debug config source. Use debug_build while the Agent is in build mode.<br>*Enum:* `"debug_build"`, `"draft"` | No |
| files | [ object ] | Uploaded files | No |
| inputs | object |  | Yes |
| model_config | object |  | No |
| parent_message_id | string | Parent message ID | No |
| query | string | User query | Yes |
| response_mode | string, <br>**Available values:** "blocking", "streaming", <br>**Default:** blocking | Response mode<br>*Enum:* `"blocking"`, `"streaming"` | No |
| retriever_from | string, <br>**Default:** dev | Retriever source | No |

#### ChatMessagesQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation ID | Yes |
| first_id | string | First message ID for pagination | No |
| limit | integer, <br>**Default:** 20 | Number of messages to return (1-100) | No |

#### ChatRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string |  | No |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| parent_message_id | string |  | No |
| query | string |  | Yes |
| retriever_from | string, <br>**Default:** explore_app |  | No |

#### CheckDependenciesResult

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| leaked_dependencies | [ [PluginDependency](#plugindependency) ] |  | No |

#### CheckEmailUniquePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |

#### CheckResultView

``type_check`` / ``output_check`` per-output summary block.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| passed | boolean |  | Yes |
| reason | string |  | No |

#### ChildChunkBatchUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chunks | [ [ChildChunkUpdateArgs](#childchunkupdateargs) ] |  | Yes |

#### ChildChunkBatchUpdateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ChildChunkResponse](#childchunkresponse) ] |  | Yes |

#### ChildChunkCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Child chunk text content. | Yes |

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

#### ChildChunkUpdateArgs

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Child chunk text content. | Yes |
| id | string | Existing child chunk ID. Omit to create a new child chunk. | No |

#### ChildChunkUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Child chunk text content. | Yes |

#### CliToolSuggestion

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| command | string |  | No |
| description | string |  | No |
| env_suggestions | [ [EnvSuggestion](#envsuggestion) ] |  | No |
| inferred_from | string |  | No |
| install_commands | [ string ] |  | No |
| name | string |  | Yes |

#### CodeBasedExtensionQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| module | string |  | Yes |

#### CodeBasedExtensionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data |  | Extension data | Yes |
| module | string | Module name | Yes |

#### CompletionConversationQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_status | string, <br>**Available values:** "all", "annotated", "not_annotated", <br>**Default:** all | Annotation status filter<br>*Enum:* `"all"`, `"annotated"`, `"not_annotated"` | No |
| end | string | End date (YYYY-MM-DD HH:MM) | No |
| keyword | string | Search keyword | No |
| limit | integer, <br>**Default:** 20 | Page size (1-100) | No |
| page | integer, <br>**Default:** 1 | Page number | No |
| start | string | Start date (YYYY-MM-DD HH:MM) | No |

#### CompletionMessageExplorePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| query | string |  | No |
| response_mode | string |  | No |
| retriever_from | string, <br>**Default:** explore_app |  | No |

#### CompletionMessagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] | Uploaded files | No |
| inputs | object |  | Yes |
| model_config | object |  | No |
| query | string | Query text | No |
| response_mode | string, <br>**Available values:** "blocking", "streaming", <br>**Default:** blocking | Response mode<br>*Enum:* `"blocking"`, `"streaming"` | No |
| retriever_from | string, <br>**Default:** dev | Retriever source | No |

#### CompletionRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| query | string |  | No |
| response_mode | string |  | No |
| retriever_from | string, <br>**Default:** explore_app |  | No |

#### ComplianceDownloadQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_name | string | Compliance document name | Yes |

#### ComplianceDownloadResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ComplianceDownloadResponse | object |  |  |

#### ComposerBindingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_id | string |  | No |
| binding_type | string, <br>**Available values:** "inline_agent", "roster_agent" | *Enum:* `"inline_agent"`, `"roster_agent"` | Yes |
| current_snapshot_id | string |  | No |

#### ComposerCandidateCapabilities

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| human_roster_available | boolean |  | No |

#### ComposerKnowledgePlaceholderResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| placeholder_name | string |  | Yes |

#### ComposerSavePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_soul | [AgentSoulConfig](#agentsoulconfig) |  | No |
| binding | [ComposerBindingPayload](#composerbindingpayload) |  | No |
| client_revision_id | string |  | No |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | [AgentIconType](#agenticontype) |  | No |
| idempotency_key | string |  | No |
| new_agent_name | string |  | No |
| node_job | [WorkflowNodeJobConfig](#workflownodejobconfig) |  | No |
| role | string |  | No |
| save_strategy | [ComposerSaveStrategy](#composersavestrategy) |  | Yes |
| soul_lock | [ComposerSoulLockPayload](#composersoullockpayload) |  | No |
| variant | [ComposerVariant](#composervariant) |  | Yes |
| version_note | string |  | No |

#### ComposerSaveStrategy

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ComposerSaveStrategy | string |  |  |

#### ComposerSoulLockPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| locked | boolean, <br>**Default:** true |  | No |
| unlocked_from_version_id | string |  | No |

#### ComposerValidationFindingsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| knowledge_retrieval_placeholder | [ [ComposerKnowledgePlaceholderResponse](#composerknowledgeplaceholderresponse) ] |  | No |
| warnings | [ [ComposerValidationWarningResponse](#composervalidationwarningresponse) ] |  | No |

#### ComposerValidationWarningResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| id | string |  | No |
| kind | string |  | No |
| message | string |  | No |
| surface | string |  | No |

#### ComposerVariant

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ComposerVariant | string |  |  |

#### Condition

Condition detail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| comparison_operator | string, <br>**Available values:** "<", "=", ">", "after", "before", "contains", "empty", "end with", "in", "is", "is not", "not contains", "not empty", "not in", "start with", "≠", "≤", "≥" | Comparison to apply. String operators (`contains`, `not contains`, `start with`, `end with`, `is`, `is not`, `empty`, `not empty`, `in`, `not in`) act on string or array metadata; numeric operators (`=`, `≠`, `>`, `<`, `≥`, `≤`) act on numeric metadata; time operators (`before`, `after`) act on time metadata.<br>*Enum:* `"<"`, `"="`, `">"`, `"after"`, `"before"`, `"contains"`, `"empty"`, `"end with"`, `"in"`, `"is"`, `"is not"`, `"not contains"`, `"not empty"`, `"not in"`, `"start with"`, `"≠"`, `"≤"`, `"≥"` | Yes |
| name | string | Metadata field name to compare against. | Yes |
| value | string<br>[ string ]<br>number | Value to compare against. Type depends on `comparison_operator`: string for most string operators, array of strings for `in` and `not in`, number for numeric operators, and omit or use `null` for `empty` and `not empty`. | No |

#### ConfigurateMethod

Enum class for configurate method of provider model.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConfigurateMethod | string | Enum class for configurate method of provider model. |  |

#### ConsoleDatasetListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ids | [ string ] | Filter by dataset IDs | No |
| include_all | boolean | Include all datasets | No |
| keyword | string | Search keyword | No |
| limit | integer, <br>**Default:** 20 | Number of items per page | No |
| page | integer, <br>**Default:** 1 | Page number | No |
| tag_ids | [ string ] | Filter by tag IDs | No |

#### ConsoleHumanInputFormDefinitionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConsoleHumanInputFormDefinitionResponse | object |  |  |

#### ConsoleHumanInputFormSubmitResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConsoleHumanInputFormSubmitResponse | object |  |  |

#### ConsoleSegmentListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [SegmentResponse](#segmentresponse) ] |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |
| total_pages | integer |  | Yes |

#### Conversation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| admin_feedback_stats | [FeedbackStat](#feedbackstat) |  | No |
| annotation | [ConversationAnnotation](#conversationannotation) |  | No |
| created_at | integer |  | No |
| from_account_id | string |  | No |
| from_account_name | string |  | No |
| from_end_user_id | string |  | No |
| from_end_user_session_id | string |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| message | [SimpleMessageDetail](#simplemessagedetail) |  | No |
| model_config | [SimpleModelConfig](#simplemodelconfig) |  | No |
| read_at | integer |  | No |
| status | string |  | Yes |
| updated_at | integer |  | No |
| user_feedback_stats | [FeedbackStat](#feedbackstat) |  | No |

#### ConversationAnnotation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account | [SimpleAccount](#simpleaccount) |  | No |
| content | string |  | Yes |
| created_at | integer |  | No |
| id | string |  | Yes |
| question | string |  | No |

#### ConversationAnnotationHitHistory

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_create_account | [SimpleAccount](#simpleaccount) |  | No |
| annotation_id | string |  | Yes |
| created_at | integer |  | No |

#### ConversationDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| admin_feedback_stats | [FeedbackStat](#feedbackstat) |  | No |
| annotated | boolean |  | Yes |
| created_at | integer |  | No |
| from_account_id | string |  | No |
| from_end_user_id | string |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| introduction | string |  | No |
| message_count | integer |  | Yes |
| model_config | [ModelConfig](#modelconfig) |  | No |
| status | string |  | Yes |
| updated_at | integer |  | No |
| user_feedback_stats | [FeedbackStat](#feedbackstat) |  | No |

#### ConversationInfiniteScrollPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [SimpleConversation](#simpleconversation) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### ConversationListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| pinned | boolean |  | No |

#### ConversationMessageDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| from_account_id | string |  | No |
| from_end_user_id | string |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| message | [MessageDetail](#messagedetail) |  | No |
| model_config | [ModelConfig](#modelconfig) |  | No |
| status | string |  | Yes |

#### ConversationPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [Conversation](#conversation) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### ConversationRenamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate | boolean | Automatically generate the conversation name. When `true`, the `name` field is ignored. | No |
| name | string | Conversation name. Required when `auto_generate` is `false`. | No |

#### ConversationVariableItemPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | No |
| name | string |  | No |
| value |  |  | No |
| value_type | string |  | No |

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
| conversation_variables | [ [ConversationVariableItemPayload](#conversationvariableitempayload) ] | Conversation variables for the draft workflow | Yes |

#### ConversationVariablesQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation ID to filter variables | Yes |

#### ConversationWithSummary

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| admin_feedback_stats | [FeedbackStat](#feedbackstat) |  | No |
| annotated | boolean |  | Yes |
| created_at | integer |  | No |
| from_account_id | string |  | No |
| from_account_name | string |  | No |
| from_end_user_id | string |  | No |
| from_end_user_session_id | string |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| message_count | integer |  | Yes |
| model_config | [SimpleModelConfig](#simplemodelconfig) |  | No |
| name | string |  | Yes |
| read_at | integer |  | No |
| status | string |  | Yes |
| status_count | [StatusCount](#statuscount) |  | No |
| summary | string |  | Yes |
| updated_at | integer |  | No |
| user_feedback_stats | [FeedbackStat](#feedbackstat) |  | No |

#### ConversationWithSummaryPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ConversationWithSummary](#conversationwithsummary) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### ConvertToWorkflowPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| name | string |  | No |

#### CopyAppPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Description for the copied app | No |
| icon | string | Icon | No |
| icon_background | string | Icon background color | No |
| icon_type | [IconType](#icontype) | Icon type | No |
| name | string | Name for the copied app | No |

#### CreateAnnotationPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_reply | object | Annotation reply data | No |
| answer | string | Answer text | No |
| content | string | Content text | No |
| message_id | string | Message ID | No |
| question | string | Question text | No |

#### CreateAppPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | App description (max 400 chars) | No |
| icon | string | Icon | No |
| icon_background | string | Icon background color | No |
| icon_type | [IconType](#icontype) | Icon type | No |
| mode | string, <br>**Available values:** "advanced-chat", "agent-chat", "chat", "completion", "workflow" | App mode<br>*Enum:* `"advanced-chat"`, `"agent-chat"`, `"chat"`, `"completion"`, `"workflow"` | Yes |
| name | string | App name | Yes |

#### CreateSnippetPayload

Payload for creating a new snippet.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| graph | object |  | No |
| icon_info | [IconInfo](#iconinfo) |  | No |
| input_fields | [ [InputFieldDefinition](#inputfielddefinition) ] |  | No |
| name | string |  | Yes |
| type | string, <br>**Available values:** "group", "node", <br>**Default:** node | *Enum:* `"group"`, `"node"` | No |

#### CredentialConfiguration

Model class for credential configuration.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| credential_name | string |  | Yes |

#### CredentialFormSchema

Model class for credential form schema.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default | string |  | No |
| label | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | Yes |
| max_length | integer |  | No |
| options | [ [FormOption](#formoption) ] |  | No |
| placeholder | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | No |
| required | boolean, <br>**Default:** true |  | No |
| show_on | [ [FormShowOnObject](#formshowonobject) ], <br>**Default:**  |  | No |
| type | [FormType](#formtype) |  | Yes |
| variable | string |  | Yes |

#### CredentialType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| CredentialType | string |  |  |

#### CustomConfigurationResponse

Model class for provider custom configuration response.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| available_credentials | [ [CredentialConfiguration](#credentialconfiguration) ] |  | No |
| can_added_models | [ [UnaddedModelConfiguration](#unaddedmodelconfiguration) ] |  | No |
| current_credential_id | string |  | No |
| current_credential_name | string |  | No |
| custom_models | [ [CustomModelConfiguration](#custommodelconfiguration) ] |  | No |
| status | [CustomConfigurationStatus](#customconfigurationstatus) |  | Yes |

#### CustomConfigurationStatus

Enum class for custom configuration status.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| CustomConfigurationStatus | string | Enum class for custom configuration status. |  |

#### CustomModelConfiguration

Model class for provider custom model configuration.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| available_model_credentials | [ [CredentialConfiguration](#credentialconfiguration) ], <br>**Default:**  |  | No |
| credentials | object |  | Yes |
| current_credential_id | string |  | No |
| current_credential_name | string |  | No |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |
| unadded_to_model_list | boolean |  | No |

#### CustomizedPipelineTemplatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| icon_info | object |  | No |
| name | string |  | Yes |

#### DailyConversationStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_count | integer |  | Yes |
| date | string |  | Yes |

#### DailyConversationStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DailyConversationStatisticItem](#dailyconversationstatisticitem) ] |  | Yes |

#### DailyMessageStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| message_count | integer |  | Yes |

#### DailyMessageStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DailyMessageStatisticItem](#dailymessagestatisticitem) ] |  | Yes |

#### DailyTerminalStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| terminal_count | integer |  | Yes |

#### DailyTerminalStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DailyTerminalStatisticItem](#dailyterminalstatisticitem) ] |  | Yes |

#### DailyTokenCostStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| currency | string |  | No |
| date | string |  | Yes |
| token_count | integer |  | No |
| total_price | string |  | No |

#### DailyTokenCostStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DailyTokenCostStatisticItem](#dailytokencoststatisticitem) ] |  | Yes |

#### DataSource

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| info_list | [InfoList](#infolist) |  | Yes |

#### DataSourceIntegrateIconResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| emoji | string |  | No |
| type | string |  | No |
| url | string |  | No |

#### DataSourceIntegrateListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DataSourceIntegrateResponse](#datasourceintegrateresponse) ] |  | Yes |

#### DataSourceIntegratePageResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page_icon | [DataSourceIntegrateIconResponse](#datasourceintegrateiconresponse) |  | Yes |
| page_id | string |  | Yes |
| page_name | string |  | Yes |
| parent_id | string |  | Yes |
| type | string |  | Yes |

#### DataSourceIntegrateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | Yes |
| disabled | boolean |  | Yes |
| id | string |  | Yes |
| is_bound | boolean |  | Yes |
| link | string |  | Yes |
| provider | string |  | Yes |
| source_info | [DataSourceIntegrateWorkspaceResponse](#datasourceintegrateworkspaceresponse) |  | Yes |

#### DataSourceIntegrateWorkspaceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| pages | [ [DataSourceIntegratePageResponse](#datasourceintegratepageresponse) ] |  | Yes |
| total | integer |  | Yes |
| workspace_icon | string |  | Yes |
| workspace_id | string |  | Yes |
| workspace_name | string |  | Yes |

#### DatasetAccessMatrix

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| dataset_id | string |  | No |
| items | [ [AccessMatrixItem](#accessmatrixitem) ] |  | No |

#### DatasetAndDocumentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| batch | string |  | Yes |
| dataset | [DatasetResponse](#datasetresponse) |  | Yes |
| documents | [ [DocumentResponse](#documentresponse) ] |  | Yes |

#### DatasetCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| external_knowledge_api_id | string |  | No |
| external_knowledge_id | string |  | No |
| indexing_technique | string |  | No |
| name | string |  | Yes |
| permission | [PermissionEnum](#permissionenum) |  | No |
| provider | string, <br>**Default:** vendor |  | No |

#### DatasetDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_count | integer |  | No |
| author_name | string |  | No |
| built_in_field_enabled | boolean |  | No |
| chunk_structure | string |  | No |
| created_at | long |  | No |
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
| permission_keys | [ string ] |  | No |
| pipeline_id | string |  | No |
| provider | string |  | No |
| retrieval_model_dict | [DatasetRetrievalModel](#datasetretrievalmodel) |  | No |
| runtime_mode | string |  | No |
| summary_index_setting | [_AnonymousInlineModel_b1954337d565](#_anonymousinlinemodel_b1954337d565) |  | No |
| tags | [ [Tag](#tag) ] |  | No |
| total_available_documents | integer |  | No |
| total_documents | integer |  | No |
| updated_at | long |  | No |
| updated_by | string |  | No |
| word_count | integer |  | No |

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
| maintainer | string |  | No |
| name | string |  | Yes |
| permission | string |  | Yes |
| permission_keys | [ string ] |  | No |
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
| maintainer | string |  | No |
| name | string |  | Yes |
| partial_member_list | [ string ] |  | No |
| permission | string |  | Yes |
| permission_keys | [ string ] |  | No |
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

#### DatasetDocMetadata

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | No |
| name | string |  | No |
| type | string |  | No |

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

#### DatasetIconInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | No |

#### DatasetIconInfoResponse

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

#### DatasetKeywordSettingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_weight | number |  | No |

#### DatasetListItemResponse

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
| maintainer | string |  | No |
| name | string |  | Yes |
| partial_member_list | [ string ] |  | Yes |
| permission | string |  | Yes |
| permission_keys | [ string ] |  | No |
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

#### DatasetListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DatasetListItemResponse](#datasetlistitemresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

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

#### DatasetQueryContentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |
| content_type | string |  | Yes |
| file_info | [DatasetQueryFileInfoResponse](#datasetqueryfileinforesponse) |  | No |

#### DatasetQueryDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | Yes |
| created_by | string |  | Yes |
| created_by_role | string |  | Yes |
| id | string |  | Yes |
| queries | [ [DatasetQueryContentResponse](#datasetquerycontentresponse) ] |  | Yes |
| source | string |  | Yes |
| source_app_id | string |  | Yes |

#### DatasetQueryFileInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| extension | string |  | Yes |
| id | string |  | Yes |
| mime_type | string |  | Yes |
| name | string |  | Yes |
| size | integer |  | Yes |
| source_url | string |  | Yes |

#### DatasetQueryListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DatasetQueryDetailResponse](#datasetquerydetailresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### DatasetRerankingModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_model_name | string |  | No |
| reranking_provider_name | string |  | No |

#### DatasetRerankingModelResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_model_name | string |  | No |
| reranking_provider_name | string |  | No |

#### DatasetResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by | string |  | No |
| data_source_type | string |  | No |
| description | string |  | No |
| id | string |  | Yes |
| indexing_technique | string |  | No |
| name | string |  | Yes |
| permission | string |  | No |

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
| description | string |  | No |
| embedding_model | string |  | No |
| embedding_model_provider | string |  | No |
| external_knowledge_api_id | string |  | No |
| external_knowledge_id | string |  | No |
| external_retrieval_model | object |  | No |
| icon_info | object |  | No |
| indexing_technique | string |  | No |
| is_multimodal | boolean |  | No |
| name | string |  | No |
| partial_member_list | [ object ] |  | No |
| permission | [PermissionEnum](#permissionenum) |  | No |
| retrieval_model | object |  | No |
| summary_index_setting | object |  | No |

#### DatasetVectorSetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string |  | No |
| embedding_provider_name | string |  | No |
| vector_weight | number |  | No |

#### DatasetVectorSettingResponse

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

#### DatasetWeightedScoreResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_setting | [DatasetKeywordSettingResponse](#datasetkeywordsettingresponse) |  | No |
| vector_setting | [DatasetVectorSettingResponse](#datasetvectorsettingresponse) |  | No |
| weight_type | string |  | No |

#### DatasourceCredentialDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |

#### DatasourceCredentialListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | [ [DatasourceCredentialResponse](#datasourcecredentialresponse) ] |  | Yes |

#### DatasourceCredentialPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object | Plugin-defined credential parameters. The schema is declared by the datasource provider. | Yes |
| name | string |  | No |

#### DatasourceCredentialResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar_url | string |  | Yes |
| credential | object | Obfuscated plugin-defined credential parameters from the datasource provider. | Yes |
| id | string |  | Yes |
| is_default | boolean |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### DatasourceCredentialUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| credentials | object | Plugin-defined credential parameters. The schema is declared by the datasource provider. | No |
| name | string |  | No |

#### DatasourceCustomClientPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_params | object | Plugin-defined OAuth client parameters. The schema is declared by the datasource provider. | No |
| enable_oauth_custom_client | boolean |  | No |

#### DatasourceDefaultPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |

#### DatasourceNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | No |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |

#### DatasourceOAuthAuthorizationQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string | Credential ID to reauthorize | No |

#### DatasourceOAuthCallbackQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string | Authorization code from OAuth provider | No |
| context_id | string | OAuth proxy context ID | No |
| error | string | Error message from OAuth provider | No |
| state | string | OAuth state parameter | No |

#### DatasourceOAuthSchemaResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_schema | [ [ProviderConfig](#providerconfig) ] |  | Yes |
| credentials_schema | [ [ProviderConfig](#providerconfig) ] |  | Yes |
| is_oauth_custom_client_enabled | boolean |  | Yes |
| is_system_oauth_params_exists | boolean |  | Yes |
| oauth_custom_client_params | object | Masked plugin-defined OAuth client parameters, when configured for the tenant. | Yes |
| redirect_uri | string |  | Yes |

#### DatasourceProviderAuthListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | [ [DatasourceProviderAuthResponse](#datasourceproviderauthresponse) ] |  | Yes |

#### DatasourceProviderAuthResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| author | string |  | Yes |
| credential_schema | [ [ProviderConfig](#providerconfig) ] |  | Yes |
| credentials_list | [ [DatasourceCredentialResponse](#datasourcecredentialresponse) ] |  | Yes |
| description | [I18nObject](#i18nobject) |  | Yes |
| icon | string |  | Yes |
| label | [I18nObject](#i18nobject) |  | Yes |
| name | string |  | Yes |
| oauth_schema | [DatasourceOAuthSchemaResponse](#datasourceoauthschemaresponse) |  | Yes |
| plugin_id | string |  | Yes |
| plugin_unique_identifier | string |  | Yes |
| provider | string |  | Yes |

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

#### DeclaredArrayItem

Per-item shape for an ``array``-typed declared output.

PRD §OUTPUT 配置框 keeps arrays one level deep on first version; nested arrays
are rejected so the runtime type checker and JSON Schema stay easy to reason
about. Stage 4 §4.2.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| children | [ { **"array_item"**: { **"children"**: [ object ], **"description"**: , **"type"**: string, <br>**Available values:** "array", "boolean", "file", "number", "object", "string" }, **"children"**: [ object ], **"description"**: , **"file"**: object, **"name"**: string, **"required"**: boolean, **"type"**: string, <br>**Available values:** "array", "boolean", "file", "number", "object", "string" } ] |  | No |
| description | string |  | No |
| type | [DeclaredOutputType](#declaredoutputtype) |  | Yes |

#### DeclaredOutputCheckConfig

File-output content check via a model-based comparison against a benchmark file.

Per PRD §OUTPUT 配置框, output check is **file-only** and optional. Stage 4 §4.3.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| benchmark_file_ref | [AgentFileRefConfig](#agentfilerefconfig) |  | No |
| enabled | boolean |  | No |
| model_ref | [AgentSoulModelConfig](#agentsoulmodelconfig) |  | No |
| prompt | string |  | No |

#### DeclaredOutputConfig

One declared output of a Workflow Agent Node.

Stage 4 normalizes the shape: ``check`` is singular (was ``checks: list`` in
stage 3), and ``failure_strategy`` defaults to a populated value so runtime
code can call ``output.failure_strategy.on_failure`` without None-guards.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| array_item | [DeclaredArrayItem](#declaredarrayitem) |  | No |
| check | [DeclaredOutputCheckConfig](#declaredoutputcheckconfig) |  | No |
| children | [ { **"array_item"**: { **"children"**: [ object ], **"description"**: , **"type"**: string, <br>**Available values:** "array", "boolean", "file", "number", "object", "string" }, **"children"**: [ object ], **"description"**: , **"file"**: object, **"name"**: string, **"required"**: boolean, **"type"**: string, <br>**Available values:** "array", "boolean", "file", "number", "object", "string" } ] |  | No |
| description | string |  | No |
| failure_strategy | [DeclaredOutputFailureStrategy](#declaredoutputfailurestrategy) |  | No |
| file | [DeclaredOutputFileConfig](#declaredoutputfileconfig) |  | No |
| id | string |  | No |
| name | string |  | Yes |
| required | boolean, <br>**Default:** true |  | No |
| type | [DeclaredOutputType](#declaredoutputtype) |  | Yes |

#### DeclaredOutputFailureStrategy

Per-output failure handling.

A single strategy applies to both ``type_check`` and ``output_check`` failures
(PRD does not distinguish them at the UX level). Stage 4 §4.4.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default_value |  |  | No |
| on_failure | [OutputErrorStrategy](#outputerrorstrategy) |  | No |
| retry | [DeclaredOutputRetryConfig](#declaredoutputretryconfig) |  | No |

#### DeclaredOutputFileConfig

File-type output metadata. Both lists empty means "any file accepted".

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| extensions | [ string ] |  | No |
| mime_types | [ string ] |  | No |

#### DeclaredOutputRetryConfig

Per-output retry configuration that mirrors ``graphon.RetryConfig`` shape.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | No |
| max_retries | integer |  | No |
| retry_interval_ms | integer |  | No |

#### DeclaredOutputType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| DeclaredOutputType | string |  |  |

#### DefaultBlockConfigQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| q | string |  | No |

#### DefaultBlockConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| DefaultBlockConfigResponse | object |  |  |

#### DefaultBlockConfigsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| DefaultBlockConfigsResponse | array |  |  |

#### DefaultModelDataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [DefaultModelResponse](#defaultmodelresponse) |  | No |

#### DefaultModelResponse

Default model entity.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |
| provider | [SimpleProviderEntityResponse](#simpleproviderentityresponse) |  | Yes |

#### DeletedTool

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| provider_id | string |  | Yes |
| tool_name | string |  | Yes |
| type | string |  | Yes |

#### DismissNotificationPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| notification_id | string |  | Yes |

#### DocumentBatchDownloadZipPayload

Request payload for bulk downloading documents as a zip archive.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_ids | [ string (uuid) ] | List of document IDs to include in the ZIP download. | Yes |

#### DocumentMetadataOperation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_id | string | Document ID whose metadata should be updated. | Yes |
| metadata_list | [ [MetadataDetail](#metadatadetail) ] | Metadata fields to update. | Yes |
| partial_update | boolean | Whether to partially update metadata, keeping existing values for unspecified fields. | No |

#### DocumentMetadataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |
| value | string<br>integer<br>number<br>boolean |  | No |

#### DocumentMetadataUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_metadata |  |  | No |
| doc_type | string |  | No |

#### DocumentRenamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

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

#### DocumentRetryPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_ids | [ string ] |  | Yes |

#### DocumentStatusListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DocumentStatusResponse](#documentstatusresponse) ] |  | Yes |

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

#### DocumentWithSegmentsListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DocumentWithSegmentsResponse](#documentwithsegmentsresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### DocumentWithSegmentsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| archived | boolean |  | No |
| completed_segments | integer |  | No |
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
| process_rule_dict |  |  | No |
| summary_index_status | string |  | No |
| tokens | integer |  | No |
| total_segments | integer |  | No |
| word_count | integer |  | No |

#### DraftWorkflowNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
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
| conversation_variables | [ object ] |  | No |
| environment_variables | [ object ] |  | No |
| features | object |  | No |
| graph | object |  | Yes |
| hash | string |  | No |
| rag_pipeline_variables | [ object ] |  | No |

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
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer |  | No |

#### EducationAutocompleteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| curr_page | integer |  | No |
| data | [ string ] |  | No |
| has_next | boolean |  | No |

#### EducationModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| activated | boolean |  | Yes |
| enabled | boolean |  | Yes |

#### EducationStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allow_refresh | boolean |  | No |
| expire_at | integer |  | No |
| is_student | boolean |  | No |
| result | boolean |  | No |

#### EducationVerifyResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| token | string |  | No |

#### EmailCodeLoginPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| email | string |  | Yes |
| language | string |  | No |
| timezone | string |  | No |
| token | string |  | Yes |

#### EmailPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| language | string |  | No |

#### EmailRegisterResetPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language | string |  | No |
| new_password | string |  | Yes |
| password_confirm | string |  | Yes |
| timezone | string |  | No |
| token | string |  | Yes |

#### EmailRegisterResetResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [EmailRegisterTokenPairResponse](#emailregistertokenpairresponse) |  | Yes |
| result | string |  | Yes |

#### EmailRegisterSendPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string | Email address | Yes |
| language | string | Language code | No |

#### EmailRegisterTokenPairResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | Yes |
| csrf_token | string |  | Yes |
| refresh_token | string |  | Yes |

#### EmailRegisterValidityPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| email | string |  | Yes |
| token | string |  | Yes |

#### EmptyObjectResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EmptyObjectResponse | object |  |  |

#### EndpointCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| plugin_unique_identifier | string |  | Yes |
| settings | object |  | Yes |

#### EndpointDeclarationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| hidden | boolean |  | No |
| method | string |  | Yes |
| path | string |  | Yes |

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

#### EndpointListItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | dateTime |  | Yes |
| declaration | [EndpointProviderDeclarationResponse](#endpointproviderdeclarationresponse) |  | No |
| enabled | boolean |  | Yes |
| expired_at | dateTime |  | Yes |
| hook_id | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| plugin_id | string |  | Yes |
| settings | object |  | Yes |
| tenant_id | string |  | Yes |
| updated_at | dateTime |  | Yes |
| url | string |  | Yes |

#### EndpointListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page | integer |  | Yes |
| page_size | integer |  | Yes |

#### EndpointListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| endpoints | [ [EndpointListItemResponse](#endpointlistitemresponse) ] | Endpoint information | Yes |

#### EndpointProviderConfigI18nResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| en_US | string |  | Yes |
| ja_JP | string |  | No |
| pt_BR | string |  | No |
| zh_Hans | string |  | No |

#### EndpointProviderConfigOptionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| label | [EndpointProviderConfigI18nResponse](#endpointproviderconfigi18nresponse) |  | Yes |
| value | string |  | Yes |

#### EndpointProviderConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default | integer<br>string<br>number<br>boolean |  | No |
| help | [EndpointProviderConfigI18nResponse](#endpointproviderconfigi18nresponse) |  | No |
| label | [EndpointProviderConfigI18nResponse](#endpointproviderconfigi18nresponse) |  | No |
| multiple | boolean |  | No |
| name | string |  | Yes |
| options | [ [EndpointProviderConfigOptionResponse](#endpointproviderconfigoptionresponse) ] |  | No |
| placeholder | [EndpointProviderConfigI18nResponse](#endpointproviderconfigi18nresponse) |  | No |
| required | boolean |  | No |
| scope | [EndpointProviderConfigScope](#endpointproviderconfigscope) |  | No |
| type | [ProviderConfigType](#providerconfigtype) |  | Yes |
| url | string |  | No |

#### EndpointProviderConfigScope

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EndpointProviderConfigScope | string |  |  |

#### EndpointProviderDeclarationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| endpoints | [ [EndpointDeclarationResponse](#endpointdeclarationresponse) ] |  | No |
| settings | [ [EndpointProviderConfigResponse](#endpointproviderconfigresponse) ] |  | No |

#### EndpointSettingsPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| settings | object |  | Yes |

#### EndpointUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| settings | object |  | Yes |

#### EnvSuggestion

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| key | string |  | Yes |
| reason | string |  | No |
| secret_likely | boolean |  | No |

#### EnvironmentVariableItemPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| id | string |  | No |
| name | string |  | No |
| value |  |  | No |
| value_type | string |  | No |

#### EnvironmentVariableItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| editable | boolean |  | Yes |
| edited | boolean |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| selector | [ string ] |  | Yes |
| type | string |  | Yes |
| value |  |  | Yes |
| value_type | string |  | Yes |
| visible | boolean |  | Yes |

#### EnvironmentVariableListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [EnvironmentVariableItemResponse](#environmentvariableitemresponse) ] |  | Yes |

#### EnvironmentVariableUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| environment_variables | [ [EnvironmentVariableItemPayload](#environmentvariableitempayload) ] | Environment variables for the draft workflow | Yes |

#### ErrorDocsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [DocumentStatusResponse](#documentstatusresponse) ] |  | Yes |
| total | integer |  | Yes |

#### EventApiEntity

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | [I18nObject](#i18nobject) | The description of the trigger | Yes |
| identity | [EventIdentity](#eventidentity) | The identity of the trigger | Yes |
| name | string | The name of the trigger | Yes |
| output_schema | object | The output schema of the trigger | Yes |
| parameters | [ [EventParameter](#eventparameter) ] | The parameters of the trigger | Yes |

#### EventIdentity

The identity of the event

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| author | string | The author of the event | Yes |
| label | [I18nObject](#i18nobject) | The label of the event | Yes |
| name | string | The name of the event | Yes |
| provider | string | The provider of the event | No |

#### EventParameter

The parameter of the event

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate | [PluginParameterAutoGenerate](#pluginparameterautogenerate) | The auto generate of the parameter | No |
| default | integer<br>number<br>string<br>[ object ] |  | No |
| description | [I18nObject](#i18nobject) |  | No |
| label | [I18nObject](#i18nobject) | The label presented to the user | Yes |
| max | number<br>integer |  | No |
| min | number<br>integer |  | No |
| multiple | boolean | Whether the parameter is multiple select, only valid for select or dynamic-select type | No |
| name | string | The name of the parameter | Yes |
| options | [ [PluginParameterOption](#pluginparameteroption) ] |  | No |
| precision | integer |  | No |
| required | boolean |  | No |
| scope | string |  | No |
| template | [PluginParameterTemplate](#pluginparametertemplate) | The template of the parameter | No |
| type | [EventParameterType](#eventparametertype) |  | Yes |

#### EventParameterType

The type of the parameter

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EventParameterType | string | The type of the parameter |  |

#### EventStreamResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EventStreamResponse | string |  |  |

#### ExecutionContentType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ExecutionContentType | string |  |  |

#### ExploreAppMetaResponse

Metadata consumed by the installed-app chat UI.

Built-in tool icons are URL strings; API-based tool icons are provider-defined payload objects.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tool_icons | object |  | No |

#### ExploreMessageInfiniteScrollPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ExploreMessageListItem](#exploremessagelistitem) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### ExploreMessageListItem

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
| metadata | [JSONValueType](#jsonvaluetype) |  | No |
| parent_message_id | string |  | No |
| query | string |  | Yes |
| retriever_resources | [ [RetrieverResource](#retrieverresource) ] |  | Yes |
| status | string |  | Yes |

#### ExternalApiTemplateListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword | string | Search keyword | No |
| limit | integer, <br>**Default:** 20 | Number of items per page | No |
| page | integer, <br>**Default:** 1 | Page number | No |

#### ExternalDatasetCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| external_knowledge_api_id | string |  | Yes |
| external_knowledge_id | string |  | Yes |
| external_retrieval_model | object |  | No |
| name | string |  | Yes |

#### ExternalHitTestingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| external_retrieval_model | object |  | No |
| metadata_filtering_conditions | object |  | No |
| query | string |  | Yes |

#### ExternalKnowledgeApiListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ExternalKnowledgeApiResponse](#externalknowledgeapiresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### ExternalKnowledgeApiPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| settings | object |  | Yes |

#### ExternalKnowledgeApiResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | string |  | Yes |
| created_by | string |  | Yes |
| dataset_bindings | [ [ExternalKnowledgeDatasetBindingResponse](#externalknowledgedatasetbindingresponse) ] |  | No |
| description | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| settings | object |  | No |
| tenant_id | string |  | Yes |

#### ExternalKnowledgeDatasetBindingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |

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

#### ExternalRetrievalTestResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ExternalRetrievalTestResponse | object<br>[ object ] |  |  |

#### FeatureModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_quota_limit | [LimitationModel](#limitationmodel) |  | Yes |
| api_rate_limit | [Quota](#quota) |  | Yes |
| apps | [LimitationModel](#limitationmodel) |  | Yes |
| billing | [BillingModel](#billingmodel) |  | Yes |
| can_replace_logo | boolean |  | Yes |
| dataset_operator_enabled | boolean |  | Yes |
| docs_processing | string, <br>**Default:** standard |  | Yes |
| documents_upload_quota | [LimitationModel](#limitationmodel) |  | Yes |
| education | [EducationModel](#educationmodel) |  | Yes |
| human_input_email_delivery_enabled | boolean |  | Yes |
| is_allow_transfer_workspace | boolean, <br>**Default:** true |  | Yes |
| knowledge_pipeline | [KnowledgePipeline](#knowledgepipeline) |  | Yes |
| knowledge_rate_limit | integer, <br>**Default:** 10 |  | Yes |
| members | [LimitationModel](#limitationmodel) |  | Yes |
| model_load_balancing_enabled | boolean |  | Yes |
| next_credit_reset_date | integer |  | Yes |
| trigger_event | [Quota](#quota) |  | Yes |
| vector_space | [LimitationModel](#limitationmodel) |  | Yes |
| webapp_copyright_enabled | boolean |  | Yes |
| workspace_members | [LicenseLimitationModel](#licenselimitationmodel) |  | Yes |

#### Feedback

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | No |
| from_account | [SimpleAccount](#simpleaccount) |  | No |
| from_end_user_id | string |  | No |
| from_source | string |  | Yes |
| rating | string |  | Yes |

#### FeedbackExportQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| end_date | string | End date (YYYY-MM-DD) | No |
| format | string, <br>**Available values:** "csv", "json", <br>**Default:** csv | Export format<br>*Enum:* `"csv"`, `"json"` | No |
| from_source | string | Filter by feedback source | No |
| has_comment | boolean | Only include feedback with comments | No |
| rating | string | Filter by rating | No |
| start_date | string | Start date (YYYY-MM-DD) | No |

#### FeedbackStat

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| dislike | integer |  | Yes |
| like | integer |  | Yes |

#### FetchFrom

Enum class for fetch from.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FetchFrom | string | Enum class for fetch from. |  |

#### FieldModelSchema

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| label | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | Yes |
| placeholder | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | No |

#### FileInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_ids | [ string ] |  | Yes |

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

#### FileWithSignedUrl

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | Yes |
| created_by | string |  | Yes |
| extension | string |  | Yes |
| id | string |  | Yes |
| mime_type | string |  | Yes |
| name | string |  | Yes |
| size | integer |  | Yes |
| url | string |  | Yes |

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
| code | string | Error code if account not found | No |
| data | string | Reset token | No |
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
| language | string |  | No |

#### FormInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FormInputConfig | [ParagraphInputConfig](#paragraphinputconfig)<br>[SelectInputConfig](#selectinputconfig)<br>[FileInputConfig](#fileinputconfig)<br>[FileListInputConfig](#filelistinputconfig) |  |  |

#### FormOption

Model class for form option.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| label | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | Yes |
| show_on | [ [FormShowOnObject](#formshowonobject) ], <br>**Default:**  |  | No |
| value | string |  | Yes |

#### FormShowOnObject

Model class for form show on.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| value | string |  | Yes |
| variable | string |  | Yes |

#### FormType

Enum class for form type.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FormType | string | Enum class for form type. |  |

#### GenerateSummaryPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_list | [ string ] |  | Yes |

#### GeneratedAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| GeneratedAppResponse |  |  |  |

#### GeneratorResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| GeneratorResponse |  |  |  |

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
| attachment_ids | [ string ] | List of attachment IDs to include in the retrieval context. | No |
| external_retrieval_model | object | Retrieval settings for external knowledge bases. | No |
| query | string | Search query text. | Yes |
| retrieval_model | [RetrievalModel](#retrievalmodel) | Retrieval model configuration. Controls how chunks are searched and ranked. | No |

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

#### HumanInputDeliveryTestPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| delivery_method_id | string | Delivery method ID | Yes |
| inputs | object | Values used to fill missing upstream variables referenced in form_content | No |

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

#### HumanInputFormPreviewPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object | Values used to fill missing upstream variables referenced in form_content | No |

#### HumanInputFormPreviewResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| actions | [ object ] |  | No |
| display_in_ui | boolean |  | No |
| expiration_time | integer |  | No |
| form_content | string |  | Yes |
| form_id | string |  | Yes |
| form_token | string |  | No |
| inputs | [ object ] |  | No |
| node_id | string |  | Yes |
| node_title | string |  | Yes |
| resolved_default_values | object |  | No |

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
| action | string | Selected action ID | Yes |
| form_inputs | object | Values the user provides for the form's own fields | Yes |
| inputs | object | Values used to fill missing upstream variables referenced in form_content | Yes |

#### HumanInputFormSubmitResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| HumanInputFormSubmitResponse | object |  |  |

#### HumanInputPauseTypeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| backstage_input_url | string |  | No |
| form_id | string |  | Yes |
| type | string |  | Yes |

#### I18nObject

Model class for i18n object.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| en_US | string |  | Yes |
| ja_JP | string |  | No |
| pt_BR | string |  | No |
| zh_Hans | string |  | No |

#### IconInfo

Icon information model.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | No |

#### IconType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| IconType | string |  |  |

#### IdentityMode

How Dify forwards the end-user's identity to an MCP server.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| IdentityMode | string | How Dify forwards the end-user's identity to an MCP server. |  |

#### Import

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | No |
| app_mode | string |  | No |
| current_dsl_version | string, <br>**Default:** 0.6.0 |  | No |
| error | string |  | No |
| id | string |  | Yes |
| imported_dsl_version | string |  | No |
| permission_keys | [ string ] |  | No |
| status | [ImportStatus](#importstatus) |  | Yes |

#### ImportStatus

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ImportStatus | string |  |  |

#### IncludeSecretQuery

Query parameter for including secret variables in export.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| include_secret | string, <br>**Default:** false | Whether to include secret variables | No |

#### IndexingEstimate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| preview | [ [PreviewDetail](#previewdetail) ] |  | Yes |
| qa_preview | [ [QAPreviewDetail](#qapreviewdetail) ] |  | No |
| total_segments | integer |  | Yes |

#### IndexingEstimatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| dataset_id | string |  | No |
| doc_form | string, <br>**Default:** text_model |  | No |
| doc_language | string, <br>**Default:** English |  | No |
| indexing_technique | string |  | Yes |
| info_list | object |  | Yes |
| process_rule | object |  | Yes |

#### IndexingEstimatePreviewItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| child_chunks | [ string ] |  | No |
| content | string |  | Yes |
| summary | string |  | No |

#### IndexingEstimateQaPreviewItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | Yes |
| question | string |  | Yes |

#### IndexingEstimateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| preview | [ [IndexingEstimatePreviewItemResponse](#indexingestimatepreviewitemresponse) ] |  | Yes |
| qa_preview | [ [IndexingEstimateQaPreviewItemResponse](#indexingestimateqapreviewitemresponse) ] |  | No |
| total_segments | integer |  | Yes |

#### InfoList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data_source_type | string, <br>**Available values:** "notion_import", "upload_file", "website_crawl" | *Enum:* `"notion_import"`, `"upload_file"`, `"website_crawl"` | Yes |
| file_info_list | [FileInfo](#fileinfo) |  | No |
| notion_info_list | [ [NotionInfo](#notioninfo) ] |  | No |
| website_info_list | [WebsiteInfo](#websiteinfo) |  | No |

#### Inner

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string |  | No |
| model_type | [ModelType](#modeltype) |  | Yes |
| provider | string |  | No |

#### InputFieldDefinition

Input field definition for snippet parameters.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default | string |  | No |
| hint | boolean |  | No |
| label | string |  | No |
| max_length | integer |  | No |
| options | [ string ] |  | No |
| placeholder | string |  | No |
| required | boolean |  | No |
| type | string |  | No |

#### InstalledAppCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |

#### InstalledAppInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | Yes |
| id | string |  | Yes |
| mode | string |  | No |
| name | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |

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
| last_used_at | integer |  | No |
| uninstallable | boolean |  | Yes |

#### InstalledAppUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| is_pinned | boolean |  | No |

#### InstalledAppsListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string | App ID to filter by | No |

#### InstructionGeneratePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current | string | Current instruction text | No |
| flow_id | string | Workflow/Flow ID | Yes |
| ideal_output | string | Expected ideal output | No |
| instruction | string | Instruction for generation | Yes |
| language | string, <br>**Default:** javascript | Programming language (javascript/python) | No |
| model_config | [ModelConfig](#modelconfig) | Model configuration | Yes |
| node_id | string | Node ID for workflow context | No |

#### InstructionTemplatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| type | string | Instruction template type | Yes |

#### IterationNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object |  | No |

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

#### JsonObject

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JsonObject | object |  |  |

#### JsonValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JsonValue |  |  |  |

#### KnowledgeConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data_source | [DataSource](#datasource) | Document data source configuration. | No |
| doc_form | string, <br>**Available values:** "hierarchical_model", "qa_model", "text_model", <br>**Default:** text_model | `text_model` for standard text chunking, `hierarchical_model` for parent-child chunk structure, `qa_model` for question-answer pair extraction.<br>*Enum:* `"hierarchical_model"`, `"qa_model"`, `"text_model"` | No |
| doc_language | string, <br>**Default:** English | Language of the document for processing optimization. | No |
| duplicate | boolean, <br>**Default:** true | Whether duplicate document content is allowed. | No |
| embedding_model | string | Embedding model name. Use the `model` field from [Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`. | No |
| embedding_model_provider | string | Embedding model provider. Use the `provider` field from [Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`. | No |
| indexing_technique | string, <br>**Available values:** "economy", "high_quality" | `high_quality` uses embedding models for precise search; `economy` uses keyword-based indexing. Required when adding the first document to a knowledge base; subsequent documents inherit the knowledge base's indexing technique if omitted.<br>*Enum:* `"economy"`, `"high_quality"` | Yes |
| is_multimodal | boolean | Whether the document uses multimodal indexing. | No |
| name | string | Document name. | No |
| original_document_id | string | Original document ID for replacement updates. | No |
| process_rule | [ProcessRule](#processrule) | Processing rules for chunking. | No |
| retrieval_model | [RetrievalModel](#retrievalmodel) | Retrieval model configuration. Controls how chunks are searched and ranked in this knowledge base. | No |
| summary_index_setting | object | Summary index configuration. | No |

#### KnowledgePipeline

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| publish_enabled | boolean |  | Yes |

#### LLMMode

Enum class for large language model mode.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| LLMMode | string | Enum class for large language model mode. |  |

#### LatestPluginCache

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| alternative_plugin_id | string |  | Yes |
| deprecated_reason | string |  | Yes |
| plugin_id | string |  | Yes |
| status | string, <br>**Available values:** "active", "deleted" | *Enum:* `"active"`, `"deleted"` | Yes |
| unique_identifier | string |  | Yes |
| version | string |  | Yes |

#### LearnDifyAppListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| recommended_apps | [ [RecommendedAppResponse](#recommendedappresponse) ] |  | Yes |

#### LegacyEndpointUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| endpoint_id | string |  | Yes |
| name | string |  | Yes |
| settings | object |  | Yes |

#### LicenseLimitationModel

- enabled: whether this limit is enforced
- size: current usage count
- limit: maximum allowed count; 0 means unlimited

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean | Whether this limit is currently active | Yes |
| limit | integer | Maximum number of resources allowed; 0 means no limit | Yes |
| size | integer | Number of resources already consumed | Yes |

#### LicenseModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| expired_at | string |  | Yes |
| status | [LicenseStatus](#licensestatus) |  | Yes |
| workspaces | [LicenseLimitationModel](#licenselimitationmodel) |  | Yes |

#### LicenseStatus

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| LicenseStatus | string |  |  |

#### LimitationModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer |  | Yes |
| size | integer |  | Yes |

#### LoadBalancingCredentialPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### LoadBalancingCredentialValidateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| error | string |  | No |
| result | string |  | Yes |

#### LoadBalancingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| configs | [ object ] |  | No |
| enabled | boolean |  | No |

#### LoginPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| invite_token | string | Invitation token | No |
| password | string |  | Yes |
| remember_me | boolean | Remember me flag | No |

#### LoopNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object |  | No |

#### MCPAuthPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| authorization_code | string |  | No |
| provider_id | string |  | Yes |

#### MCPCallbackQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| state | string |  | Yes |

#### MCPProviderCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| authentication | object |  | No |
| configuration | object |  | No |
| headers | object |  | No |
| icon | string |  | Yes |
| icon_background | string |  | No |
| icon_type | string |  | Yes |
| identity_mode | [IdentityMode](#identitymode) |  | No |
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
| authentication | object |  | No |
| configuration | object |  | No |
| headers | object |  | No |
| icon | string |  | Yes |
| icon_background | string |  | No |
| icon_type | string |  | Yes |
| identity_mode | [IdentityMode](#identitymode) |  | No |
| name | string |  | Yes |
| provider_id | string |  | Yes |
| server_identifier | string |  | Yes |
| server_url | string |  | Yes |

#### MCPServerCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Server description | No |
| parameters | object | Server parameters configuration | Yes |

#### MCPServerUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Server description | No |
| id | string | Server ID | Yes |
| parameters | object | Server parameters configuration | Yes |
| status | string | Server status | No |

#### Marketplace

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| marketplace_plugin_unique_identifier | string |  | Yes |
| version | string |  | No |

#### MemberActionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |
| tenant_id | string |  | Yes |

#### MemberBindingsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AccessPolicyMemberBinding](#accesspolicymemberbinding) ] |  | No |

#### MemberInvitePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| emails | [ string ] |  | No |
| language | string |  | No |
| role | string |  | Yes |

#### MemberInviteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| invitation_results | [ [MemberInviteResultResponse](#memberinviteresultresponse) ] |  | Yes |
| result | string |  | Yes |
| tenant_id | string |  | Yes |

#### MemberInviteResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| message | string |  | No |
| status | string |  | Yes |
| url | string |  | No |

#### MemberRoleUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| role | string |  | Yes |

#### MemberRolesResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_id | string |  | Yes |
| roles | [ [RBACRole](#rbacrole) ] |  | No |

#### MembersInRole

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_id | string |  | No |
| account_name | string |  | No |

#### MessageDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_thoughts | [ [AgentThought](#agentthought) ] |  | Yes |
| annotation | [ConversationAnnotation](#conversationannotation) |  | No |
| annotation_hit_history | [ConversationAnnotationHitHistory](#conversationannotationhithistory) |  | No |
| answer | string |  | Yes |
| answer_tokens | integer |  | Yes |
| conversation_id | string |  | Yes |
| created_at | integer |  | No |
| error | string |  | No |
| feedbacks | [ [Feedback](#feedback) ] |  | Yes |
| from_account_id | string |  | No |
| from_end_user_id | string |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| inputs | object |  | Yes |
| message | [JSONValue](#jsonvalue) |  | Yes |
| message_files | [ [MessageFile](#messagefile) ] |  | Yes |
| message_tokens | integer |  | Yes |
| metadata | [JSONValue](#jsonvalue) |  | Yes |
| parent_message_id | string |  | No |
| provider_response_latency | number |  | Yes |
| query | string |  | Yes |
| status | string |  | Yes |
| workflow_run_id | string |  | No |

#### MessageDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_thoughts | [ [AgentThought](#agentthought) ] |  | Yes |
| annotation | [ConversationAnnotation](#conversationannotation) |  | No |
| annotation_hit_history | [ConversationAnnotationHitHistory](#conversationannotationhithistory) |  | No |
| answer | string |  | Yes |
| answer_tokens | integer |  | Yes |
| conversation_id | string |  | Yes |
| created_at | integer |  | No |
| error | string |  | No |
| extra_contents | [ [HumanInputContent](#humaninputcontent) ] |  | No |
| feedbacks | [ [Feedback](#feedback) ] |  | Yes |
| from_account_id | string |  | No |
| from_end_user_id | string |  | No |
| from_source | string |  | Yes |
| id | string |  | Yes |
| inputs | object |  | Yes |
| message | [JSONValue](#jsonvalue) |  | Yes |
| message_files | [ [MessageFile](#messagefile) ] |  | Yes |
| message_tokens | integer |  | Yes |
| metadata | [JSONValue](#jsonvalue) |  | Yes |
| parent_message_id | string |  | No |
| provider_response_latency | number |  | Yes |
| query | string |  | Yes |
| status | string |  | Yes |
| workflow_run_id | string |  | No |

#### MessageFeedbackPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Optional text feedback providing additional detail. | No |
| message_id | string | Message ID | Yes |
| rating | string | Feedback rating. Set to `null` to revoke previously submitted feedback. | No |

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

#### MessageInfiniteScrollPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [MessageDetailResponse](#messagedetailresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### MessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation ID. | Yes |
| first_id | string | The ID of the first chat record on the current page. Omit this value to fetch the latest messages; for subsequent pages, use the first message ID from the current list to fetch older messages. | No |
| limit | integer, <br>**Default:** 20 | Number of chat history messages to return per request. | No |

#### MetadataArgs

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string | Metadata field name. | Yes |
| type | string, <br>**Available values:** "number", "string", "time" | `string` for text values, `number` for numeric values, `time` for date/time values.<br>*Enum:* `"number"`, `"string"`, `"time"` | Yes |

#### MetadataDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string | Metadata field ID. | Yes |
| name | string | Metadata field name. | Yes |
| value | string<br>integer<br>number | Metadata value. Can be a string, number, or `null`. | No |

#### MetadataFilteringCondition

Metadata Filtering Condition.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conditions | [ [Condition](#condition) ] | List of metadata conditions to evaluate. | No |
| logical_operator | string | How to combine multiple conditions. | No |

#### MetadataOperationData

Metadata operation data

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| operation_data | [ [DocumentMetadataOperation](#documentmetadataoperation) ] | Array of document metadata update operations. Each entry maps a document ID to its metadata values. | Yes |

#### MetadataUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string | New metadata field name. | Yes |

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
| created_at | integer |  | No |
| created_by | string |  | No |
| model |  |  | No |
| pre_prompt | string |  | No |
| updated_at | integer |  | No |
| updated_by | string |  | No |

#### ModelConfigRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_mode | object | Agent mode configuration | No |
| configs | object | Model configuration parameters | No |
| dataset_configs | object | Dataset configurations | No |
| model | string | Model name | No |
| more_like_this | object | More like this configuration | No |
| opening_statement | string | Opening statement | No |
| provider | string | Model provider | No |
| retrieval_model | object | Retrieval model configuration | No |
| speech_to_text | object | Speech to text configuration | No |
| suggested_questions | [ string ] | Suggested questions | No |
| text_to_speech | object | Text to speech configuration | No |
| tools | [ object ] | Available tools | No |

#### ModelCredentialLoadBalancingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| configs | [ object ] |  | No |
| enabled | boolean |  | Yes |

#### ModelCredentialResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| available_credentials | [ [CredentialConfiguration](#credentialconfiguration) ] |  | Yes |
| credentials | object |  | No |
| current_credential_id | string |  | No |
| current_credential_name | string |  | No |
| load_balancing | [ModelCredentialLoadBalancingResponse](#modelcredentialloadbalancingresponse) |  | Yes |

#### ModelCredentialSchema

Model class for model credential schema.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_form_schemas | [ [CredentialFormSchema](#credentialformschema) ] |  | Yes |
| model | [FieldModelSchema](#fieldmodelschema) |  | Yes |

#### ModelCredentialValidateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| error | string |  | No |
| result | string |  | Yes |

#### ModelFeature

Enum class for llm feature.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelFeature | string | Enum class for llm feature. |  |

#### ModelParameterRulesResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ParameterRule](#parameterrule) ] |  | Yes |

#### ModelPropertyKey

Enum class for model property key.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelPropertyKey | string | Enum class for model property key. |  |

#### ModelProviderListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ProviderResponse](#providerresponse) ] |  | Yes |

#### ModelProviderPaymentCheckoutUrlResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| payment_link | string |  | Yes |

#### ModelSelectorScope

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelSelectorScope | string |  |  |

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

#### ModelWithProviderEntityResponse

Model with provider entity.

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
| provider | [SimpleProviderEntityResponse](#simpleproviderentityresponse) |  | Yes |
| status | [ModelStatus](#modelstatus) |  | Yes |

#### ModelWithProviderListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ModelWithProviderEntityResponse](#modelwithproviderentityresponse) ] |  | Yes |

#### MoreLikeThisQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| response_mode | string, <br>**Available values:** "blocking", "streaming" | *Enum:* `"blocking"`, `"streaming"` | Yes |

#### MyPermissionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app | [ResourcePermissionSnapshot](#resourcepermissionsnapshot) |  | No |
| dataset | [ResourcePermissionSnapshot](#resourcepermissionsnapshot) |  | No |
| workspace | [WorkspacePermissionSnapshot](#workspacepermissionsnapshot) |  | No |

#### NewAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_app_id | string |  | Yes |
| permission_keys | [ string ] |  | No |

#### NodeIdQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_id | string |  | Yes |

#### NodeOutputStatus

Lifecycle status of a single declared output within a run.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| NodeOutputStatus | string | Lifecycle status of a single declared output within a run. |  |

#### NodeOutputView

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| output_check | [CheckResultView](#checkresultview) |  | No |
| retried | integer |  | No |
| status | [NodeOutputStatus](#nodeoutputstatus) |  | Yes |
| type | [DeclaredOutputType](#declaredoutputtype) |  | No |
| type_check | [CheckResultView](#checkresultview) |  | No |
| value_preview |  |  | No |

#### NodeOutputsView

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_completed_at | string |  | No |
| node_display_name | string |  | Yes |
| node_id | string |  | Yes |
| node_kind | string |  | Yes |
| node_started_at | string |  | No |
| node_status | [NodeStatus](#nodestatus) |  | Yes |
| outputs | [ [NodeOutputView](#nodeoutputview) ] |  | No |

#### NodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object |  | No |

#### NodeRunRequiredPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object |  | Yes |

#### NodeStatus

Coarse node-level status used by Inspector to pick a banner.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| NodeStatus | string | Coarse node-level status used by Inspector to pick a banner. |  |

#### NotificationItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| body | string |  | Yes |
| frequency | string |  | No |
| lang | string |  | Yes |
| notification_id | string |  | No |
| subtitle | string |  | Yes |
| title | string |  | Yes |
| title_pic_url | string |  | Yes |

#### NotificationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| notifications | [ [NotificationItemResponse](#notificationitemresponse) ] |  | Yes |
| should_show | boolean |  | Yes |

#### NotionEstimatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_form | string, <br>**Default:** text_model |  | No |
| doc_language | string, <br>**Default:** English |  | No |
| notion_info_list | [ object ] |  | Yes |
| process_rule | object |  | Yes |

#### NotionIcon

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| emoji | string |  | No |
| type | string |  | Yes |
| url | string |  | No |

#### NotionInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| pages | [ [NotionPage](#notionpage) ] |  | Yes |
| workspace_id | string |  | Yes |

#### NotionIntegrateInfoListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| notion_info | [ [NotionIntegrateWorkspaceResponse](#notionintegrateworkspaceresponse) ] |  | Yes |

#### NotionIntegratePageResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| is_bound | boolean |  | Yes |
| page_icon | [DataSourceIntegrateIconResponse](#datasourceintegrateiconresponse) |  | Yes |
| page_id | string |  | Yes |
| page_name | string |  | Yes |
| parent_id | string |  | Yes |
| type | string |  | Yes |

#### NotionIntegrateWorkspaceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| pages | [ [NotionIntegratePageResponse](#notionintegratepageresponse) ] |  | Yes |
| workspace_icon | string |  | Yes |
| workspace_id | string |  | Yes |
| workspace_name | string |  | Yes |

#### NotionPage

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page_icon | [NotionIcon](#notionicon) |  | No |
| page_id | string |  | Yes |
| page_name | string |  | Yes |
| type | string |  | Yes |

#### OAuthCallbackQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string | Authorization code from OAuth provider | Yes |
| state | string | OAuth state parameter | No |

#### OAuthClientPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_id | string |  | Yes |

#### OAuthDataSourceBindingQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string | Authorization code from OAuth provider | Yes |

#### OAuthDataSourceBindingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Operation result | Yes |

#### OAuthDataSourceCallbackQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string | Authorization code from OAuth provider | No |
| error | string | Error message from OAuth provider | No |

#### OAuthDataSourceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string | Authorization URL or 'internal' for internal setup | Yes |

#### OAuthDataSourceSyncResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Operation result | Yes |

#### OAuthLoginQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| invite_token | string | Optional invitation token | No |
| language | string | Preferred interface language | No |
| timezone | string | Preferred timezone | No |

#### OAuthProviderAccountResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar | string |  | No |
| email | string |  | Yes |
| interface_language | string |  | Yes |
| name | string |  | Yes |
| timezone | string |  | Yes |

#### OAuthProviderAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_icon | string |  | Yes |
| app_label | object |  | Yes |
| scope | string |  | Yes |

#### OAuthProviderAuthorizeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |

#### OAuthProviderRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_id | string |  | Yes |
| redirect_uri | string |  | Yes |

#### OAuthProviderTokenResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | Yes |
| expires_in | integer |  | Yes |
| refresh_token | string |  | Yes |
| token_type | string |  | Yes |

#### OAuthSchema

OAuth schema

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_schema | [ [ProviderConfig](#providerconfig) ] | client schema like client_id, client_secret, etc. | No |
| credentials_schema | [ [ProviderConfig](#providerconfig) ] | credentials schema like access_token, refresh_token, etc. | No |

#### OAuthTokenRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_id | string |  | Yes |
| client_secret | string |  | No |
| code | string |  | No |
| grant_type | string |  | Yes |
| redirect_uri | string |  | No |
| refresh_token | string |  | No |

#### OpaqueObjectResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| OpaqueObjectResponse | object |  |  |

#### Option

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| label | [I18nObject](#i18nobject) | The label of the option | Yes |
| value | string | The value of the option | Yes |

#### OutputErrorStrategy

Per-output failure handling strategy.

Mirrors ``graphon.ErrorStrategy`` but scoped to a single declared output of
a Workflow Agent Node. The runtime applies the strategy after type check or
output check fails and any configured retry attempts have been exhausted.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| OutputErrorStrategy | string | Per-output failure handling strategy.  Mirrors ``graphon.ErrorStrategy`` but scoped to a single declared output of a Workflow Agent Node. The runtime applies the strategy after type check or output check fails and any configured retry attempts have been exhausted. |  |

#### OutputPreviewView

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_id | string |  | Yes |
| output_name | string |  | Yes |
| status | [NodeOutputStatus](#nodeoutputstatus) |  | Yes |
| type | [DeclaredOutputType](#declaredoutputtype) |  | No |
| value |  |  | No |

#### OwnerTransferCheckPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| token | string |  | Yes |

#### OwnerTransferEmailPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language | string |  | No |

#### OwnerTransferPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| token | string |  | Yes |

#### Package

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_unique_identifier | string |  | Yes |
| version | string |  | No |

#### PaginatedConversationVariableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ConversationVariableResponse](#conversationvariableresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### Pagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current_page | integer |  | No |
| per_page | integer |  | No |
| total_count | integer |  | No |
| total_pages | integer |  | No |

#### PaginationQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### ParagraphInputConfig

Form input definition.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default | [StringSource](#stringsource) |  | No |
| output_variable_name | string |  | Yes |
| type | string |  | No |

#### ParameterRule

Model class for parameter rule.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default |  |  | No |
| help | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | No |
| label | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | Yes |
| max | number |  | No |
| min | number |  | No |
| name | string |  | Yes |
| options | [ string ], <br>**Default:**  |  | No |
| precision | integer |  | No |
| required | boolean |  | No |
| type | [ParameterType](#parametertype) |  | Yes |
| use_template | string |  | No |

#### ParameterType

Enum class for parameter type.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ParameterType | string | Enum class for parameter type. |  |

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

#### Parser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | No |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |

#### ParserAsset

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_name | string |  | Yes |
| plugin_unique_identifier | string |  | Yes |

#### ParserAutoUpgradeChange

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_upgrade | [PluginAutoUpgradeSettingsPayload](#pluginautoupgradesettingspayload) |  | Yes |
| category | [TenantPluginAutoUpgradeCategory](#tenantpluginautoupgradecategory) |  | Yes |

#### ParserAutoUpgradeFetch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| category | [TenantPluginAutoUpgradeCategory](#tenantpluginautoupgradecategory) |  | Yes |

#### ParserCreateCredential

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |
| name | string |  | No |

#### ParserCredentialCreate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| name | string |  | No |

#### ParserCredentialDelete

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |

#### ParserCredentialId

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | No |

#### ParserCredentialSwitch

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |

#### ParserCredentialUpdate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | Yes |
| credentials | object |  | Yes |
| name | string |  | No |

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
| credential_id | string |  | No |
| parameter | string |  | Yes |
| plugin_id | string |  | Yes |
| provider | string |  | Yes |
| provider_type | string, <br>**Available values:** "tool", "trigger" | *Enum:* `"tool"`, `"trigger"` | Yes |

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
| category | [TenantPluginAutoUpgradeCategory](#tenantpluginautoupgradecategory) |  | Yes |
| plugin_id | string |  | Yes |

#### ParserGetCredentials

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| config_from | string |  | No |
| credential_id | string |  | No |
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
| page | integer, <br>**Default:** 1 | Page number | No |
| page_size | integer, <br>**Default:** 256 | Page size (1-256) | No |

#### ParserMarketplaceUpgrade

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_plugin_unique_identifier | string |  | Yes |
| original_plugin_unique_identifier | string |  | Yes |

#### ParserModelList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model_type | [ModelType](#modeltype) |  | No |

#### ParserParameter

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string |  | Yes |

#### ParserPermissionChange

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| debug_permission | [TenantPluginDebugPermission](#tenantplugindebugpermission) |  | No |
| install_permission | [TenantPluginInstallPermission](#tenantplugininstallpermission) |  | No |

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
| config_from | string |  | No |
| credential_id | string |  | No |
| load_balancing | [LoadBalancingPayload](#loadbalancingpayload) |  | No |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### ParserPreferredProviderType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| preferred_provider_type | string, <br>**Available values:** "custom", "system" | *Enum:* `"custom"`, `"system"` | Yes |

#### ParserReadme

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language | string, <br>**Default:** en-US |  | No |
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
| page | integer, <br>**Default:** 1 | Page number | No |
| page_size | integer, <br>**Default:** 256 | Page size (1-256) | No |

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
| name | string |  | No |

#### ParserValidate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### PartialMemberListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ string ] |  | Yes |

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

#### PermissionCatalogGroup

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| group_key | string |  | Yes |
| group_name | string |  | Yes |
| permissions | [ [PermissionCatalogItem](#permissioncatalogitem) ] |  | No |

#### PermissionCatalogItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| key | string |  | Yes |
| name | string |  | Yes |

#### PermissionCatalogResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| groups | [ [PermissionCatalogGroup](#permissioncataloggroup) ] |  | No |

#### PermissionEnum

Shared permission levels for resources (datasets, credentials, etc.)

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PermissionEnum | string | Shared permission levels for resources (datasets, credentials, etc.) |  |

#### PipelineTemplateDetailQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| type | string, <br>**Default:** built-in | Template source: built-in or customized | No |

#### PipelineTemplateDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chunk_structure | string |  | Yes |
| created_by | string |  | No |
| description | string |  | Yes |
| export_data | string |  | Yes |
| graph | object |  | Yes |
| icon_info | object |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |

#### PipelineTemplateItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chunk_structure | string |  | Yes |
| copyright | string |  | No |
| description | string |  | Yes |
| icon | object |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| position | integer |  | Yes |
| privacy_policy | string |  | No |

#### PipelineTemplateListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language | string, <br>**Default:** en-US | Template language | No |
| type | string, <br>**Default:** built-in | Template source: built-in or customized | No |

#### PipelineTemplateListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| pipeline_templates | [ [PipelineTemplateItemResponse](#pipelinetemplateitemresponse) ] |  | Yes |

#### PipelineVariableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed_file_extensions | [ string ] |  | No |
| allowed_file_types | [ string ] |  | No |
| allowed_file_upload_methods | [ string ] |  | No |
| belong_to_node_id | string |  | Yes |
| default_value |  |  | No |
| label | string |  | Yes |
| max_length | integer |  | No |
| options | [ string ] |  | No |
| placeholder | string |  | No |
| required | boolean |  | Yes |
| tooltips | string |  | No |
| type | string |  | Yes |
| unit | string |  | No |
| variable | string |  | Yes |

#### PluginAutoUpgradeChangeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message | string |  | No |
| success | boolean |  | Yes |

#### PluginAutoUpgradeFetchResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_upgrade | [PluginAutoUpgradeSettingsResponseModel](#pluginautoupgradesettingsresponsemodel) |  | Yes |
| category | [TenantPluginAutoUpgradeCategory](#tenantpluginautoupgradecategory) |  | Yes |

#### PluginAutoUpgradeSettingsPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| exclude_plugins | [ string ] |  | No |
| include_plugins | [ string ] |  | No |
| strategy_setting | [TenantPluginAutoUpgradeStrategySetting](#tenantpluginautoupgradestrategysetting) |  | No |
| upgrade_mode | [TenantPluginAutoUpgradeMode](#tenantpluginautoupgrademode) |  | No |
| upgrade_time_of_day | integer |  | No |

#### PluginAutoUpgradeSettingsResponseModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| exclude_plugins | [ string ] |  | Yes |
| include_plugins | [ string ] |  | Yes |
| strategy_setting | [TenantPluginAutoUpgradeStrategySetting](#tenantpluginautoupgradestrategysetting) |  | Yes |
| upgrade_mode | [TenantPluginAutoUpgradeMode](#tenantpluginautoupgrademode) |  | Yes |
| upgrade_time_of_day | integer |  | Yes |

#### PluginCategory

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PluginCategory | string |  |  |

#### PluginCategoryBuiltinToolProviderResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allow_delete | boolean |  | Yes |
| author | string |  | Yes |
| description | [core__tools__entities__common_entities__I18nObject](#core__tools__entities__common_entities__i18nobject) |  | Yes |
| icon | string<br>object |  | Yes |
| icon_dark | string<br>object |  | Yes |
| id | string |  | Yes |
| is_team_authorization | boolean |  | Yes |
| label | [core__tools__entities__common_entities__I18nObject](#core__tools__entities__common_entities__i18nobject) |  | Yes |
| labels | [ string ] |  | Yes |
| name | string |  | Yes |
| plugin_id | string |  | Yes |
| plugin_unique_identifier | string |  | Yes |
| team_credentials | object |  | Yes |
| tools | [ [PluginCategoryBuiltinToolResponse](#plugincategorybuiltintoolresponse) ] |  | Yes |
| type | [ToolProviderType](#toolprovidertype) |  | Yes |

#### PluginCategoryBuiltinToolResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| author | string |  | Yes |
| description | [core__tools__entities__common_entities__I18nObject](#core__tools__entities__common_entities__i18nobject) |  | Yes |
| label | [core__tools__entities__common_entities__I18nObject](#core__tools__entities__common_entities__i18nobject) |  | Yes |
| labels | [ string ] |  | Yes |
| name | string |  | Yes |
| output_schema | object |  | Yes |
| parameters | [ object ] |  | No |

#### PluginCategoryInstalledPluginResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| checksum | string |  | Yes |
| created_at | dateTime |  | Yes |
| declaration | [PluginDeclarationResponse](#plugindeclarationresponse) |  | Yes |
| endpoints_active | integer |  | Yes |
| endpoints_setups | integer |  | Yes |
| id | string |  | Yes |
| installation_id | string |  | Yes |
| meta | object |  | Yes |
| name | string |  | Yes |
| plugin_id | string |  | Yes |
| plugin_unique_identifier | string |  | Yes |
| runtime_type | string |  | Yes |
| source | [PluginInstallationSource](#plugininstallationsource) |  | Yes |
| tenant_id | string |  | Yes |
| updated_at | dateTime |  | Yes |
| version | string |  | Yes |

#### PluginCategoryListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| page | integer, <br>**Default:** 1 | Page number | No |
| page_size | integer, <br>**Default:** 256 | Page size (1-256) | No |

#### PluginCategoryListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| builtin_tools | [ [PluginCategoryBuiltinToolProviderResponse](#plugincategorybuiltintoolproviderresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| plugins | [ [PluginCategoryInstalledPluginResponse](#plugincategoryinstalledpluginresponse) ] |  | Yes |

#### PluginDaemonOperationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PluginDaemonOperationResponse |  |  |  |

#### PluginDebuggingKeyResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| host | string |  | Yes |
| key | string |  | Yes |
| port | integer |  | Yes |

#### PluginDeclarationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_strategy | object |  | No |
| author | string |  | Yes |
| category | [PluginCategory](#plugincategory) |  | Yes |
| created_at | dateTime |  | Yes |
| datasource | object |  | No |
| description | [core__tools__entities__common_entities__I18nObject](#core__tools__entities__common_entities__i18nobject) |  | Yes |
| endpoint | object |  | No |
| icon | string |  | Yes |
| icon_dark | string |  | No |
| label | [core__tools__entities__common_entities__I18nObject](#core__tools__entities__common_entities__i18nobject) |  | Yes |
| meta | object |  | Yes |
| model | [ProviderEntityResponse](#providerentityresponse) |  | No |
| name | string |  | Yes |
| plugins | object |  | Yes |
| repo | string |  | No |
| resource | object |  | Yes |
| tags | [ string ] |  | No |
| tool | object |  | No |
| trigger | object |  | No |
| verified | boolean |  | No |
| version | string |  | Yes |

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

#### PluginDynamicOptionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| options |  |  | Yes |

#### PluginInstallationItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| checksum | string |  | Yes |
| created_at | dateTime |  | Yes |
| declaration | [PluginDeclarationResponse](#plugindeclarationresponse) |  | Yes |
| endpoints_active | integer |  | Yes |
| endpoints_setups | integer |  | Yes |
| id | string |  | Yes |
| meta | object |  | Yes |
| plugin_id | string |  | Yes |
| plugin_unique_identifier | string |  | Yes |
| runtime_type | string |  | Yes |
| source | [PluginInstallationSource](#plugininstallationsource) |  | Yes |
| tenant_id | string |  | Yes |
| updated_at | dateTime |  | Yes |
| version | string |  | Yes |

#### PluginInstallationPermissionModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_installation_scope | [PluginInstallationScope](#plugininstallationscope) |  | Yes |
| restrict_to_marketplace_only | boolean |  | Yes |

#### PluginInstallationScope

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PluginInstallationScope | string |  |  |

#### PluginInstallationSource

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PluginInstallationSource | string |  |  |

#### PluginInstallationsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugins | [ [PluginInstallationItemResponse](#plugininstallationitemresponse) ] |  | Yes |

#### PluginListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugins |  |  | Yes |
| total | integer |  | Yes |

#### PluginManagerModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | Yes |

#### PluginManifestResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| manifest |  |  | Yes |

#### PluginOAuthAuthorizationUrlResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| authorization_url | string | The URL of the authorization. | Yes |

#### PluginOperationSuccessResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message | string |  | No |
| success | boolean |  | Yes |

#### PluginParameterAutoGenerate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| type | [PluginParameterAutoGenerateType](#pluginparameterautogeneratetype) |  | Yes |

#### PluginParameterAutoGenerateType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PluginParameterAutoGenerateType | string |  |  |

#### PluginParameterOption

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon | string | The icon of the option, can be a url or a base64 encoded image | No |
| label | [I18nObject](#i18nobject) | The label of the option | Yes |
| value | string | The value of the option | Yes |

#### PluginParameterTemplate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean | Whether the parameter is jinja enabled | No |

#### PluginPermissionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| debug_permission | [TenantPluginDebugPermission](#tenantplugindebugpermission) |  | Yes |
| install_permission | [TenantPluginInstallPermission](#tenantplugininstallpermission) |  | Yes |

#### PluginPermissionSettingsPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| debug_permission | [TenantPluginDebugPermission](#tenantplugindebugpermission) |  | No |
| install_permission | [TenantPluginInstallPermission](#tenantplugininstallpermission) |  | No |

#### PluginReadmeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| readme | string |  | Yes |

#### PluginTaskResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| task |  |  | Yes |

#### PluginTasksResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tasks |  |  | Yes |

#### PluginVersionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| versions | object |  | Yes |

#### PreProcessingRule

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean | Whether this preprocessing rule is enabled. | Yes |
| id | string, <br>**Available values:** "remove_extra_spaces", "remove_stopwords", "remove_urls_emails" | Rule identifier.<br>*Enum:* `"remove_extra_spaces"`, `"remove_stopwords"`, `"remove_urls_emails"` | Yes |

#### PreviewDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| child_chunks | [ string ] |  | No |
| content | string |  | Yes |
| summary | string |  | No |

#### PriceConfigResponse

Serialized pricing info with codegen-safe decimal string patterns.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| currency | string |  | Yes |
| input | string |  | Yes |
| output | string |  | No |
| unit | string |  | Yes |

#### ProcessRule

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| mode | [ProcessRuleMode](#processrulemode) | Processing mode. `automatic` uses built-in rules, `custom` allows manual configuration, and `hierarchical` enables parent-child chunk structure for `doc_form: hierarchical_model`. | Yes |
| rules | [Rule](#rule) | Custom processing rules. | No |

#### ProcessRuleMode

Dataset Process Rule Mode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ProcessRuleMode | string | Dataset Process Rule Mode |  |

#### ProviderConfig

Model class for common provider settings like credentials

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default | integer<br>string<br>number<br>boolean |  | No |
| help | [I18nObject](#i18nobject) |  | No |
| label | [I18nObject](#i18nobject) |  | No |
| multiple | boolean |  | No |
| name | string | The name of the credentials | Yes |
| options | [ [Option](#option) ] |  | No |
| placeholder | [I18nObject](#i18nobject) |  | No |
| required | boolean |  | No |
| scope | [AppSelectorScope](#appselectorscope)<br>[ModelSelectorScope](#modelselectorscope)<br>[ToolSelectorScope](#toolselectorscope) |  | No |
| type | [ProviderConfigType](#providerconfigtype) | The type of the credentials | Yes |
| url | string |  | No |

#### ProviderConfigType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ProviderConfigType | string |  |  |

#### ProviderCredentialResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | No |

#### ProviderCredentialSchema

Model class for provider credential schema.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_form_schemas | [ [CredentialFormSchema](#credentialformschema) ] |  | Yes |

#### ProviderCredentialValidateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| error | string |  | No |
| result | string, <br>**Available values:** "error", "success" | *Enum:* `"error"`, `"success"` | Yes |

#### ProviderEntityResponse

Runtime provider response with codegen-safe model pricing schemas.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| background | string |  | No |
| configurate_methods | [ [ConfigurateMethod](#configuratemethod) ] |  | Yes |
| description | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | No |
| help | [ProviderHelpEntity](#providerhelpentity) |  | No |
| icon_small | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | No |
| icon_small_dark | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | No |
| label | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | Yes |
| model_credential_schema | [ModelCredentialSchema](#modelcredentialschema) |  | No |
| models | [ [AIModelEntityResponse](#aimodelentityresponse) ], <br>**Default:**  |  | No |
| position | object |  | No |
| provider | string |  | Yes |
| provider_credential_schema | [ProviderCredentialSchema](#providercredentialschema) |  | No |
| provider_name | string |  | No |
| supported_model_types | [ [ModelType](#modeltype) ] |  | Yes |

#### ProviderHelpEntity

Model class for provider help.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| title | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | Yes |
| url | [graphon__model_runtime__entities__common_entities__I18nObject](#graphon__model_runtime__entities__common_entities__i18nobject) |  | Yes |

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

#### ProviderQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| provider | string |  | Yes |

#### ProviderQuotaType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ProviderQuotaType | string |  |  |

#### ProviderResponse

Model class for provider response.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| background | string |  | No |
| configurate_methods | [ [ConfigurateMethod](#configuratemethod) ] |  | Yes |
| custom_configuration | [CustomConfigurationResponse](#customconfigurationresponse) |  | Yes |
| description | [I18nObject](#i18nobject) |  | No |
| help | [ProviderHelpEntity](#providerhelpentity) |  | No |
| icon_small | [I18nObject](#i18nobject) |  | No |
| icon_small_dark | [I18nObject](#i18nobject) |  | No |
| label | [I18nObject](#i18nobject) |  | Yes |
| model_credential_schema | [ModelCredentialSchema](#modelcredentialschema) |  | No |
| preferred_provider_type | [ProviderType](#providertype) |  | Yes |
| provider | string |  | Yes |
| provider_credential_schema | [ProviderCredentialSchema](#providercredentialschema) |  | No |
| supported_model_types | [ [ModelType](#modeltype) ] |  | Yes |
| system_configuration | [SystemConfigurationResponse](#systemconfigurationresponse) |  | Yes |
| tenant_id | string |  | Yes |

#### ProviderType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ProviderType | string |  |  |

#### ProviderWithModelsDataResponse

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

#### PublishWorkflowPayload

Payload for publishing snippet workflow.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| knowledge_base_setting | object |  | No |

#### PublishedWorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| datasource_info_list | [ object ] |  | Yes |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |
| is_preview | boolean |  | No |
| original_document_id | string |  | No |
| response_mode | string, <br>**Available values:** "blocking", "streaming", <br>**Default:** streaming | *Enum:* `"blocking"`, `"streaming"` | No |
| start_node_id | string |  | Yes |

#### QAPreviewDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | Yes |
| question | string |  | Yes |

#### Quota

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer |  | Yes |
| reset_date | integer, <br>**Default:** -1 |  | Yes |
| usage | integer |  | Yes |

#### QuotaConfiguration

Model class for provider quota configuration.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| is_valid | boolean |  | Yes |
| quota_limit | integer |  | Yes |
| quota_type | [ProviderQuotaType](#providerquotatype) |  | Yes |
| quota_unit | [QuotaUnit](#quotaunit) |  | Yes |
| quota_used | integer |  | Yes |
| restrict_models | [ [RestrictModel](#restrictmodel) ], <br>**Default:**  |  | No |

#### QuotaUnit

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| QuotaUnit | string |  |  |

#### RBACResourceWhitelistScope

Whitelist scopes accepted by RBAC app and dataset access config APIs.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RBACResourceWhitelistScope | string | Whitelist scopes accepted by RBAC app and dataset access config APIs. |  |

#### RBACRole

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| category | string |  | No |
| description | string |  | No |
| id | string |  | Yes |
| is_builtin | boolean |  | No |
| name | string |  | Yes |
| permission_keys | [ string ] |  | No |
| role_tag | string |  | No |
| tenant_id | string |  | No |
| type | string |  | Yes |

#### RBACRoleAccount

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_id | string |  | Yes |
| account_name | string |  | No |
| avatar | string |  | No |
| email | string |  | No |

#### RagPipelineDatasetImportPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| yaml_content | string |  | Yes |

#### RagPipelineImportCheckDependenciesResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| leaked_dependencies | [ [PluginDependency](#plugindependency) ] |  | No |

#### RagPipelineImportPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| mode | string |  | Yes |
| name | string |  | No |
| pipeline_id | string |  | No |
| yaml_content | string |  | No |
| yaml_url | string |  | No |

#### RagPipelineImportResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current_dsl_version | string |  | Yes |
| dataset_id | string |  | No |
| error | string |  | No |
| id | string |  | Yes |
| imported_dsl_version | string |  | Yes |
| pipeline_id | string |  | No |
| status | [ImportStatus](#importstatus) |  | Yes |

#### RagPipelineOpaqueResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RagPipelineOpaqueResponse |  |  |  |

#### RagPipelineRecommendedPluginQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| type | string, <br>**Default:** all |  | No |

#### RagPipelineStepParametersResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| variables |  |  | Yes |

#### RagPipelineWorkflowPublishResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | Yes |
| result | string |  | Yes |

#### RagPipelineWorkflowSyncResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| hash | string |  | Yes |
| result | string |  | Yes |
| updated_at | integer |  | Yes |

#### RecommendedAppDetailNullableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RecommendedAppDetailNullableResponse | [RecommendedAppDetailResponse](#recommendedappdetailresponse) |  |  |

#### RecommendedAppDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| can_trial | boolean |  | No |
| export_data | string |  | Yes |
| icon | string |  | No |
| icon_background | string |  | No |
| id | string |  | Yes |
| mode | string |  | Yes |
| name | string |  | Yes |

#### RecommendedAppInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | Yes |
| id | string |  | Yes |
| mode | string |  | No |
| name | string |  | No |

#### RecommendedAppListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| categories | [ string ] |  | Yes |
| recommended_apps | [ [RecommendedAppResponse](#recommendedappresponse) ] |  | Yes |

#### RecommendedAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app | [RecommendedAppInfoResponse](#recommendedappinforesponse) |  | No |
| app_id | string |  | Yes |
| can_trial | boolean |  | No |
| categories | [ string ] |  | No |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| description | string |  | No |
| is_listed | boolean |  | No |
| position | integer |  | No |
| privacy_policy | string |  | No |

#### RecommendedAppsQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language | string | Language code for recommended app localization | No |

#### RedirectResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RedirectResponse | string |  |  |

#### RedirectUrlResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| redirect_url | string |  | Yes |

#### RelatedAppListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [RelatedAppResponse](#relatedappresponse) ] |  | Yes |
| total | integer |  | Yes |

#### RelatedAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | Yes |
| icon | string |  | Yes |
| icon_background | string |  | Yes |
| icon_type | string |  | Yes |
| icon_url | string |  | No |
| id | string |  | Yes |
| mode | string |  | Yes |
| name | string |  | Yes |

#### RemoteFileInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_length | integer |  | Yes |
| file_type | string |  | Yes |

#### RemoteFileUploadPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string | URL to fetch | Yes |

#### ReplaceUserAccessPolicies

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_policy_ids | [ string ] |  | No |

#### ReplaceUserAccessPoliciesResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_policies | [ [AccessPolicy](#accesspolicy) ] |  | No |

#### RequestLog

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | dateTime | The created at of the request log | Yes |
| endpoint | string | The endpoint of the request log | Yes |
| id | string | The id of the request log | Yes |
| request | object | The request of the request log | Yes |
| response | object | The response of the request log | Yes |

#### RerankingModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_model_name | string | Name of the reranking model. | No |
| reranking_provider_name | string | Provider name of the reranking model. | No |

#### ResourcePermissionKeys

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| permission_keys | [ string ] |  | No |
| resource_id | string |  | Yes |

#### ResourcePermissionSnapshot

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default_permission_keys | [ string ] |  | No |
| overrides | [ [ResourcePermissionKeys](#resourcepermissionkeys) ] |  | No |

#### ResourceUserAccessPolicies

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_policies | [ [AccessPolicy](#accesspolicy) ] |  | No |
| account | [RBACRoleAccount](#rbacroleaccount) |  | Yes |
| roles | [ [RBACRole](#rbacrole) ] |  | No |

#### ResourceUserAccessPoliciesResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ResourceUserAccessPolicies](#resourceuseraccesspolicies) ] |  | No |
| scope | [RBACResourceWhitelistScope](#rbacresourcewhitelistscope) |  | Yes |

#### ResourceWhitelist

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_ids | [ string ] |  | No |

#### RestrictModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| base_model_name | string |  | No |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

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
| metadata_filtering_conditions | [MetadataFilteringCondition](#metadatafilteringcondition) | Restrict retrieval to chunks whose document metadata matches the given conditions. Conditions are evaluated server-side against document metadata fields. | No |
| reranking_enable | boolean | Whether reranking is enabled. | Yes |
| reranking_mode | string | Reranking mode. Required when `reranking_enable` is `true`. | No |
| reranking_model | [RerankingModel](#rerankingmodel) | Reranking model configuration. | No |
| score_threshold | number | Minimum similarity score for results. Only effective when score threshold filtering is enabled. | No |
| score_threshold_enabled | boolean | Whether score threshold filtering is enabled. | Yes |
| search_method | [RetrievalMethod](#retrievalmethod) | Search method used for retrieval. | Yes |
| top_k | integer | Maximum number of results to return. | Yes |
| weights | [WeightModel](#weightmodel) | Weight configuration for hybrid search. | No |

#### RetrievalSettingResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| retrieval_method | [ string ] |  | Yes |

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

#### RoleBindingsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AccessPolicyRoleBinding](#accesspolicyrolebinding) ] |  | No |

#### RosterListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### Rule

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| parent_mode | string | Parent-child segmentation mode. | No |
| pre_processing_rules | [ [PreProcessingRule](#preprocessingrule) ] | Pre-processing rules to apply before segmentation. | No |
| segmentation | [Segmentation](#segmentation) | Parent chunk segmentation settings. | No |
| subchunk_segmentation | [Segmentation](#segmentation) | Child chunk segmentation settings. | No |

#### RuleCodeGeneratePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code_language | string, <br>**Default:** javascript | Programming language for code generation | No |
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

#### SandboxFileEntryResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| mtime | integer |  | No |
| name | string |  | Yes |
| size | integer |  | No |
| type | string, <br>**Available values:** "dir", "file", "other", "symlink" | *Enum:* `"dir"`, `"file"`, `"other"`, `"symlink"` | Yes |

#### SandboxInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| session_id | string |  | Yes |
| workspace_cwd | string |  | Yes |

#### SandboxListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| entries | [ [SandboxFileEntryResponse](#sandboxfileentryresponse) ] |  | No |
| path | string |  | Yes |
| truncated | boolean |  | No |

#### SandboxReadResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binary | boolean |  | Yes |
| path | string |  | Yes |
| size | integer |  | No |
| text | string |  | No |
| truncated | boolean |  | Yes |

#### SandboxToolFileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reference | string |  | Yes |
| transfer_method | string, <br>**Default:** tool_file |  | No |

#### SandboxUploadResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file | [SandboxToolFileResponse](#sandboxtoolfileresponse) |  | Yes |
| path | string |  | Yes |

#### SavedMessageCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string |  | Yes |

#### SavedMessageInfiniteScrollPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [SavedMessageItem](#savedmessageitem) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### SavedMessageItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | Yes |
| created_at | integer |  | No |
| feedback | [SimpleFeedback](#simplefeedback) |  | No |
| id | string |  | Yes |
| inputs | object |  | Yes |
| message_files | [ [MessageFile](#messagefile) ] |  | Yes |
| query | string |  | Yes |

#### SavedMessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |

#### SchemaDefinitionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| SchemaDefinitionsResponse |  |  |  |

#### SegmentAttachmentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| extension | string |  | Yes |
| id | string |  | Yes |
| mime_type | string |  | Yes |
| name | string |  | Yes |
| size | integer |  | Yes |
| source_url | string |  | Yes |

#### SegmentBatchImportStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| job_id | string |  | Yes |
| job_status | string |  | Yes |

#### SegmentCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | No |
| attachment_ids | [ string ] |  | No |
| content | string |  | Yes |
| keywords | [ string ] |  | No |

#### SegmentDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [SegmentResponse](#segmentresponse) |  | Yes |
| doc_form | string |  | Yes |

#### SegmentIdListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| segment_id | [ string ] | Segment IDs | No |

#### SegmentListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | string, <br>**Default:** all |  | No |
| hit_count_gte | integer |  | No |
| keyword | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |
| status | [ string ] |  | No |

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

#### SegmentUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | No |
| attachment_ids | [ string ] |  | No |
| content | string |  | Yes |
| keywords | [ string ] |  | No |
| regenerate_child_chunks | boolean |  | No |
| summary | string |  | No |

#### Segmentation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chunk_overlap | integer | Token overlap between chunks. | No |
| max_tokens | integer | Maximum token count per chunk. | Yes |
| separator | string, <br>**Default:**
 | Custom separator for splitting text. | No |

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

#### SimpleAccountResponse

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

#### SimpleDataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string |  | Yes |

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

#### SimpleMessageDetail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | Yes |
| inputs | object |  | Yes |
| message | string |  | Yes |
| query | string |  | Yes |

#### SimpleMessageResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message | string |  | Yes |

#### SimpleModelConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | [JSONValue](#jsonvalue) |  | No |
| pre_prompt | string |  | No |

#### SimpleProviderEntityResponse

Simple provider entity response.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| icon_small | [I18nObject](#i18nobject) |  | No |
| icon_small_dark | [I18nObject](#i18nobject) |  | No |
| label | [I18nObject](#i18nobject) |  | Yes |
| models | [ [AIModelEntityResponse](#aimodelentityresponse) ], <br>**Default:**  |  | No |
| provider | string |  | Yes |
| provider_name | string |  | No |
| supported_model_types | [ [ModelType](#modeltype) ] |  | Yes |
| tenant_id | string |  | Yes |

#### SimpleResultDataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string |  | Yes |
| result | string |  | Yes |

#### SimpleResultMessageResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message | string |  | Yes |
| result | string |  | Yes |

#### SimpleResultOptionalDataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string |  | No |
| result | string |  | Yes |

#### SimpleResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
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
| input_placeholder | string |  | No |
| privacy_policy | string |  | No |
| show_workflow_steps | boolean |  | Yes |
| title | string |  | Yes |
| use_icon_as_answer_icon | boolean |  | Yes |

#### SkillManifest

Validated metadata extracted from a Skill package.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | Yes |
| entry_path | string |  | Yes |
| files | [ string ] |  | Yes |
| hash | string |  | Yes |
| name | string |  | Yes |
| size | integer |  | Yes |

#### SkillToolInferenceResult

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| cli_tools | [ [CliToolSuggestion](#clitoolsuggestion) ] |  | No |
| inferable | boolean |  | Yes |
| reason | string |  | No |

#### SnippetAccountResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |

#### SnippetDependencyCheckResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| leaked_dependencies | [ [PluginDependency](#plugindependency) ] |  | Yes |

#### SnippetDraftConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| parallel_depth_limit | integer |  | Yes |

#### SnippetDraftNodeRunPayload

Payload for running a single node in snippet draft workflow.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |
| query | string |  | No |

#### SnippetDraftRunPayload

Payload for running snippet draft workflow.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |

#### SnippetDraftSyncPayload

Payload for syncing snippet draft workflow.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables | [ object ] | Ignored. Snippet workflows do not persist conversation variables. | No |
| graph | object |  | Yes |
| hash | string |  | No |
| input_fields | [ object ] |  | No |

#### SnippetImportPayload

Payload for importing snippet from DSL.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Override snippet description | No |
| mode | string | Import mode: yaml-content or yaml-url | Yes |
| name | string | Override snippet name | No |
| snippet_id | string | Snippet ID to update (optional) | No |
| yaml_content | string | YAML content (required for yaml-content mode) | No |
| yaml_url | string | YAML URL (required for yaml-url mode) | No |

#### SnippetImportResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current_dsl_version | string |  | Yes |
| error | string |  | Yes |
| id | string |  | Yes |
| imported_dsl_version | string |  | Yes |
| snippet_id | string |  | Yes |
| status | [ImportStatus](#importstatus) |  | Yes |

#### SnippetIterationNodeRunPayload

Payload for running an iteration node in snippet draft workflow.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object |  | No |

#### SnippetListItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| author_name | string |  | Yes |
| created_at | integer |  | Yes |
| created_by | string |  | Yes |
| description | string |  | Yes |
| icon_info | object |  | Yes |
| id | string |  | Yes |
| is_published | boolean |  | Yes |
| name | string |  | Yes |
| tags | [ [SnippetTagResponse](#snippettagresponse) ] |  | Yes |
| type | [SnippetType](#snippettype) |  | Yes |
| updated_at | integer |  | Yes |
| updated_by | string |  | Yes |
| use_count | integer |  | Yes |
| version | integer |  | Yes |

#### SnippetListQuery

Query parameters for listing snippets.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| creators | [ string ] | Filter by creator account IDs | No |
| is_published | boolean | Filter by published status | No |
| keyword | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |
| tag_ids | [ string ] | Filter by tag IDs | No |

#### SnippetLoopNodeRunPayload

Payload for running a loop node in snippet draft workflow.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| inputs | object |  | No |

#### SnippetPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [SnippetListItemResponse](#snippetlistitemresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### SnippetResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | Yes |
| created_by | [SnippetAccountResponse](#snippetaccountresponse) |  | Yes |
| description | string |  | Yes |
| graph | object |  | Yes |
| icon_info | object |  | Yes |
| id | string |  | Yes |
| input_fields | [ object ] |  | Yes |
| is_published | boolean |  | Yes |
| name | string |  | Yes |
| tags | [ [SnippetTagResponse](#snippettagresponse) ] |  | Yes |
| type | [SnippetType](#snippettype) |  | Yes |
| updated_at | integer |  | Yes |
| updated_by | [SnippetAccountResponse](#snippetaccountresponse) |  | Yes |
| use_count | integer |  | Yes |
| version | integer |  | Yes |

#### SnippetTagResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### SnippetType

Snippet Type Enum

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| SnippetType | string | Snippet Type Enum |  |

#### SnippetUseCountResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |
| use_count | integer |  | Yes |

#### SnippetWorkflowListQuery

Query parameters for listing snippet published workflows.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 10 |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### SnippetWorkflowPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| has_more | boolean |  | Yes |
| items | [ [SnippetWorkflowResponse](#snippetworkflowresponse) ] |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |

#### SnippetWorkflowResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables | [ [WorkflowConversationVariableResponse](#workflowconversationvariableresponse) ] |  | Yes |
| created_at | integer |  | Yes |
| created_by | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| environment_variables | [ [WorkflowEnvironmentVariableResponse](#workflowenvironmentvariableresponse) ] |  | Yes |
| features | object |  | Yes |
| graph | object |  | Yes |
| hash | string |  | Yes |
| id | string |  | Yes |
| input_fields | [ object ] |  | No |
| marked_comment | string |  | Yes |
| marked_name | string |  | Yes |
| rag_pipeline_variables | [ [PipelineVariableResponse](#pipelinevariableresponse) ] |  | Yes |
| tool_published | boolean |  | Yes |
| updated_at | integer |  | Yes |
| updated_by | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| version | string |  | Yes |

#### StarredAppListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| creator_ids | [ string ] | Filter by creator account IDs | No |
| is_created_by_me | boolean | Filter by creator | No |
| limit | integer, <br>**Default:** 20 | Page size (1-100) | No |
| mode | string, <br>**Available values:** "advanced-chat", "agent", "agent-chat", "all", "channel", "chat", "completion", "workflow", <br>**Default:** all | App mode filter<br>*Enum:* `"advanced-chat"`, `"agent"`, `"agent-chat"`, `"all"`, `"channel"`, `"chat"`, `"completion"`, `"workflow"` | No |
| name | string | Filter by app name | No |
| page | integer, <br>**Default:** 1 | Page number (1-99999) | No |
| sort_by | string, <br>**Available values:** "earliest_created", "last_modified", "recently_created", <br>**Default:** last_modified | Sort apps by last modified, recently created, or earliest created<br>*Enum:* `"earliest_created"`, `"last_modified"`, `"recently_created"` | No |
| tag_ids | [ string ] | Filter by tag IDs | No |

#### StatisticTimeRangeQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| end | string | End date (YYYY-MM-DD HH:MM) | No |
| start | string | Start date (YYYY-MM-DD HH:MM) | No |

#### StatusCount

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| failed | integer |  | Yes |
| partial_success | integer |  | Yes |
| paused | integer |  | Yes |
| success | integer |  | Yes |

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

#### SubscriptionBuilderApiEntity

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_type | [CredentialType](#credentialtype) | The credential type of the subscription builder | Yes |
| credentials | object | The credentials of the subscription builder | Yes |
| endpoint | string | The endpoint id of the subscription builder | Yes |
| id | string | The id of the subscription builder | Yes |
| name | string | The name of the subscription builder | Yes |
| parameters | object | The parameters of the subscription builder | Yes |
| properties | object | The properties of the subscription builder | Yes |
| provider | string | The provider id of the subscription builder | Yes |

#### SubscriptionConstructor

The subscription constructor of the trigger provider

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials_schema | [ [ProviderConfig](#providerconfig) ] | The credentials schema of the subscription constructor | No |
| oauth_schema | [OAuthSchema](#oauthschema) | The OAuth schema of the subscription constructor if OAuth is supported | No |
| parameters | [ [EventParameter](#eventparameter) ] | The parameters schema of the subscription constructor | No |

#### SubscriptionModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| interval | string |  | Yes |
| plan | string, <br>**Default:** sandbox |  | Yes |

#### SubscriptionQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| interval | string, <br>**Available values:** "month", "year" | Billing interval<br>*Enum:* `"month"`, `"year"` | Yes |
| plan | string, <br>**Available values:** "professional", "team" | Subscription plan<br>*Enum:* `"professional"`, `"team"` | Yes |

#### SuccessResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| success | boolean |  | Yes |

#### SuggestedQuestionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ string ] |  | Yes |

#### SwitchWorkspacePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tenant_id | string |  | Yes |

#### SwitchWorkspaceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_tenant | [TenantInfoResponse](#tenantinforesponse) |  | Yes |
| result | string |  | Yes |

#### SyncDraftWorkflowPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables | [ object ] |  | No |
| environment_variables | [ object ] |  | No |
| features | object |  | Yes |
| graph | object |  | Yes |
| hash | string |  | No |

#### SyncDraftWorkflowResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| hash | string |  | No |
| result | string |  | No |
| updated_at | string |  | No |

#### SystemConfigurationResponse

Model class for provider system configuration response.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current_quota_type | [ProviderQuotaType](#providerquotatype) |  | No |
| enabled | boolean |  | Yes |
| quota_configurations | [ [QuotaConfiguration](#quotaconfiguration) ], <br>**Default:**  |  | No |

#### SystemFeatureModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| branding | [BrandingModel](#brandingmodel) |  | Yes |
| enable_app_deploy | boolean |  | Yes |
| enable_change_email | boolean, <br>**Default:** true |  | Yes |
| enable_collaboration_mode | boolean, <br>**Default:** true |  | Yes |
| enable_creators_platform | boolean |  | Yes |
| enable_email_code_login | boolean |  | Yes |
| enable_email_password_login | boolean, <br>**Default:** true |  | Yes |
| enable_explore_banner | boolean |  | Yes |
| enable_learn_app | boolean, <br>**Default:** true |  | Yes |
| enable_marketplace | boolean |  | Yes |
| enable_social_oauth_login | boolean |  | Yes |
| enable_trial_app | boolean |  | Yes |
| is_allow_create_workspace | boolean |  | Yes |
| is_allow_register | boolean |  | Yes |
| is_email_setup | boolean |  | Yes |
| license | [LicenseModel](#licensemodel) |  | Yes |
| max_plugin_package_size | integer, <br>**Default:** 15728640 |  | Yes |
| plugin_installation_permission | [PluginInstallationPermissionModel](#plugininstallationpermissionmodel) |  | Yes |
| plugin_manager | [PluginManagerModel](#pluginmanagermodel) |  | Yes |
| rbac_enabled | boolean |  | Yes |
| sso_enforced_for_signin | boolean |  | Yes |
| sso_enforced_for_signin_protocol | string |  | Yes |
| webapp_auth | [WebAppAuthModel](#webappauthmodel) |  | Yes |

#### SystemParameters

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| audio_file_size_limit | integer |  | Yes |
| file_size_limit | integer |  | Yes |
| image_file_size_limit | integer |  | Yes |
| video_file_size_limit | integer |  | Yes |
| workflow_file_upload_limit | integer |  | Yes |

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
| keyword | string | Search keyword | No |
| type | string, <br>**Available values:** "", "app", "knowledge", "snippet" | Tag type filter<br>*Enum:* `""`, `"app"`, `"knowledge"`, `"snippet"` | No |

#### TagListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TagListResponse | array |  |  |

#### TagResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binding_count | string |  | No |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | No |

#### TagType

Tag type

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TagType | string | Tag type |  |

#### TagUpdateRequestPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string | Tag name | Yes |

#### TenantAccountRole

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TenantAccountRole | string |  |  |

#### TenantInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| custom_config | [WorkspaceCustomConfigResponse](#workspacecustomconfigresponse) |  | No |
| id | string |  | Yes |
| in_trial | boolean |  | No |
| name | string |  | No |
| next_credit_reset_date | integer |  | No |
| plan | string |  | No |
| role | string |  | No |
| status | string |  | No |
| trial_credits | integer |  | No |
| trial_credits_used | integer |  | No |
| trial_end_reason | string |  | No |

#### TenantListItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| current | boolean |  | Yes |
| id | string |  | Yes |
| last_opened_at | integer |  | No |
| name | string |  | No |
| plan | string |  | No |
| status | string |  | No |

#### TenantListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| workspaces | [ [TenantListItemResponse](#tenantlistitemresponse) ] |  | Yes |

#### TenantPluginAutoUpgradeCategory

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TenantPluginAutoUpgradeCategory | string |  |  |

#### TenantPluginAutoUpgradeMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TenantPluginAutoUpgradeMode | string |  |  |

#### TenantPluginAutoUpgradeStrategySetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TenantPluginAutoUpgradeStrategySetting | string |  |  |

#### TenantPluginDebugPermission

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TenantPluginDebugPermission | string |  |  |

#### TenantPluginInstallPermission

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TenantPluginInstallPermission | string |  |  |

#### TextContentResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |

#### TextFileResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TextFileResponse | string |  |  |

#### TextToAudioPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string | Message ID. Takes priority over `text` when both are provided. | No |
| streaming | boolean | Reserved for compatibility; TTS response streaming is determined by the provider output. | No |
| text | string | Speech content to convert. | No |
| voice | string | Voice to use for text-to-speech. Available voices depend on the TTS provider configured for this app. Omit to use the app's configured voice when available; that value is exposed by [Get App Parameters](/api-reference/applications/get-app-parameters) as `text_to_speech.voice`. | No |

#### TextToSpeechPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string | Message ID | No |
| streaming | boolean | Whether to stream audio | No |
| text | string | Text to convert | Yes |
| voice | string | Voice name | No |

#### TextToSpeechRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string |  | No |
| streaming | boolean |  | No |
| text | string |  | No |
| voice | string |  | No |

#### TextToSpeechVoiceListResponse

Available voices

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TextToSpeechVoiceListResponse | array | Available voices |  |

#### TextToSpeechVoiceQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language | string | Language code | Yes |

#### TextToSpeechVoiceResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string | Voice display name | Yes |
| value | string | Voice identifier | Yes |

#### TokensPerSecondStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| tps | number |  | Yes |

#### TokensPerSecondStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [TokensPerSecondStatisticItem](#tokenspersecondstatisticitem) ] |  | Yes |

#### ToolOAuthClientSchemaResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ToolOAuthClientSchemaResponse | array |  |  |

#### ToolOAuthCustomClientPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_params | object |  | No |
| enable_oauth_custom_client | boolean |  | No |

#### ToolOAuthCustomClientResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ToolOAuthCustomClientResponse | object |  |  |

#### ToolParameterForm

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ToolParameterForm | string |  |  |

#### ToolProviderListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| type | string |  | No |

#### ToolProviderOpaqueResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ToolProviderOpaqueResponse |  |  |  |

#### ToolProviderType

Enum class for tool provider

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ToolProviderType | string | Enum class for tool provider |  |

#### ToolSelectorScope

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ToolSelectorScope | string |  |  |

#### TraceAppConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | No |
| created_at | string |  | No |
| error | string |  | No |
| has_not_configured | boolean |  | No |
| id | string |  | No |
| is_active | boolean |  | No |
| result | string |  | No |
| tracing_config | object |  | No |
| tracing_provider | string |  | No |
| updated_at | string |  | No |

#### TraceConfigPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tracing_config | object | Tracing configuration data | Yes |
| tracing_provider | string | Tracing provider name | Yes |

#### TraceProviderQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tracing_provider | string | Tracing provider name | Yes |

#### TrialAppAgentMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | No |
| strategy | string |  | No |
| tools | [ [JsonObject](#jsonobject) ] |  | No |

#### TrialAppDetailResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_mode | string |  | No |
| api_base_url | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| deleted_tools | [ [TrialDeletedToolResponse](#trialdeletedtoolresponse) ] |  | No |
| description | string |  | No |
| enable_api | boolean |  | Yes |
| enable_site | boolean |  | Yes |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | [TrialIconType](#trialicontype) |  | No |
| icon_url | string |  | No |
| id | string |  | Yes |
| max_active_requests | integer |  | No |
| mode | [TrialAppMode](#trialappmode) |  | Yes |
| model_config | [TrialAppModelConfigResponse](#trialappmodelconfigresponse) |  | No |
| name | string |  | Yes |
| permission_keys | [ string ] |  | No |
| site | [TrialSiteResponse](#trialsiteresponse) |  | Yes |
| tags | [ [TrialTagResponse](#trialtagresponse) ] |  | No |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |
| workflow | [TrialWorkflowPartialResponse](#trialworkflowpartialresponse) |  | No |

#### TrialAppMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TrialAppMode | string |  |  |

#### TrialAppModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| completion_params | [JsonObject](#jsonobject) |  | No |
| mode | string |  | No |
| name | string |  | Yes |
| provider | string |  | Yes |

#### TrialAppModelConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_mode | [TrialAppAgentMode](#trialappagentmode) |  | No |
| annotation_reply | [JsonObject](#jsonobject) |  | No |
| chat_prompt_config | [JsonObject](#jsonobject) |  | No |
| completion_prompt_config | [JsonObject](#jsonobject) |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| dataset_configs | [JsonObject](#jsonobject) |  | No |
| dataset_query_variable | string |  | No |
| external_data_tools | [ [JsonObject](#jsonobject) ] |  | No |
| file_upload | [JsonObject](#jsonobject) |  | No |
| model | [TrialAppModel](#trialappmodel) |  | No |
| more_like_this | [JsonObject](#jsonobject) |  | No |
| opening_statement | string |  | No |
| pre_prompt | string |  | No |
| prompt_type | string |  | No |
| retriever_resource | [JsonObject](#jsonobject) |  | No |
| sensitive_word_avoidance | [JsonObject](#jsonobject) |  | No |
| speech_to_text | [JsonObject](#jsonobject) |  | No |
| suggested_questions | [ string ] |  | No |
| suggested_questions_after_answer | [JsonObject](#jsonobject) |  | No |
| text_to_speech | [JsonObject](#jsonobject) |  | No |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| user_input_form | [ [JsonObject](#jsonobject) ] |  | No |

#### TrialDatasetListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ids | [ string ] | Dataset IDs | No |
| limit | integer, <br>**Default:** 20 | Number of items per page | No |
| page | integer, <br>**Default:** 1 | Page number | No |

#### TrialDatasetListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [TrialDatasetResponse](#trialdatasetresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### TrialDatasetResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by | string |  | No |
| data_source_type | string |  | No |
| description | string |  | No |
| id | string |  | Yes |
| indexing_technique | string |  | No |
| name | string |  | Yes |
| permission | string |  | No |
| permission_keys | [ string ] |  | No |

#### TrialDeletedToolResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| provider_id | string |  | Yes |
| tool_name | string |  | Yes |
| type | string |  | Yes |

#### TrialIconType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TrialIconType | string |  |  |

#### TrialModelsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| trial_models | [ string ] |  | Yes |

#### TrialSimpleAccount

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | No |
| id | string |  | Yes |
| name | string |  | No |

#### TrialSiteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | No |
| app_base_url | string |  | No |
| chat_color_theme | string |  | No |
| chat_color_theme_inverted | boolean |  | No |
| code | string |  | No |
| copyright | string |  | No |
| created_at | integer |  | No |
| created_by | string |  | No |
| custom_disclaimer | string |  | No |
| customize_domain | string |  | No |
| customize_token_strategy | string |  | No |
| default_language | string |  | Yes |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | [TrialIconType](#trialicontype) |  | No |
| icon_url | string |  | No |
| input_placeholder | string |  | No |
| privacy_policy | string |  | No |
| prompt_public | boolean |  | No |
| show_workflow_steps | boolean |  | No |
| title | string |  | Yes |
| updated_at | integer |  | No |
| updated_by | string |  | No |
| use_icon_as_answer_icon | boolean |  | No |

#### TrialTagResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### TrialWorkflowPartialResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by | string |  | No |
| id | string |  | Yes |
| updated_at | integer |  | No |
| updated_by | string |  | No |

#### TrialWorkflowResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables | [ [JsonObject](#jsonobject) ] |  | No |
| created_at | integer |  | No |
| created_by | [TrialSimpleAccount](#trialsimpleaccount) |  | No |
| environment_variables | [ [JsonObject](#jsonobject) ] |  | No |
| features | [JsonObject](#jsonobject) |  | No |
| graph | [JsonObject](#jsonobject) |  | Yes |
| hash | string |  | No |
| id | string |  | Yes |
| marked_comment | string |  | No |
| marked_name | string |  | No |
| rag_pipeline_variables | [ [JsonObject](#jsonobject) ] |  | No |
| tool_published | boolean |  | No |
| updated_at | integer |  | No |
| updated_by | [TrialSimpleAccount](#trialsimpleaccount) |  | No |
| version | string |  | No |

#### TriggerCreationMethod

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TriggerCreationMethod | string |  |  |

#### TriggerOAuthAuthorizeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| authorization_url | string |  | Yes |
| subscription_builder | [SubscriptionBuilderApiEntity](#subscriptionbuilderapientity) |  | Yes |
| subscription_builder_id | string |  | Yes |

#### TriggerOAuthClientPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| client_params | object |  | No |
| enabled | boolean |  | No |

#### TriggerOAuthClientResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| configured | boolean |  | Yes |
| custom_configured | boolean |  | Yes |
| custom_enabled | boolean |  | Yes |
| oauth_client_schema | [ [TriggerProviderConfigResponse](#triggerproviderconfigresponse) ] |  | Yes |
| params | object |  | Yes |
| redirect_uri | string |  | Yes |
| system_configured | boolean |  | Yes |

#### TriggerProviderApiEntity

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| author | string | The author of the trigger provider | Yes |
| description | [I18nObject](#i18nobject) | The description of the trigger provider | Yes |
| events | [ [EventApiEntity](#eventapientity) ] | The events of the trigger provider | Yes |
| icon | string | The icon of the trigger provider | No |
| icon_dark | string | The dark icon of the trigger provider | No |
| label | [I18nObject](#i18nobject) | The label of the trigger provider | Yes |
| name | string | The name of the trigger provider | Yes |
| plugin_id | string | The plugin id of the tool | No |
| plugin_unique_identifier | string | The unique identifier of the tool | No |
| subscription_constructor | [SubscriptionConstructor](#subscriptionconstructor) | The subscription constructor of the trigger provider | No |
| subscription_schema | [ [ProviderConfig](#providerconfig) ] | The subscription schema of the trigger provider | No |
| supported_creation_methods | [ [TriggerCreationMethod](#triggercreationmethod) ] | Supported creation methods for the trigger provider. like 'OAUTH', 'APIKEY', 'MANUAL'. | No |
| tags | [ string ] | The tags of the trigger provider | No |

#### TriggerProviderConfigOptionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| label | [I18nObject](#i18nobject) | The label of the option | Yes |
| value | string | The value of the option | Yes |

#### TriggerProviderConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default | integer<br>string<br>number<br>boolean |  | No |
| help | [I18nObject](#i18nobject) |  | No |
| label | [I18nObject](#i18nobject) |  | No |
| multiple | boolean |  | No |
| name | string | The name of the credentials | Yes |
| options | [ [TriggerProviderConfigOptionResponse](#triggerproviderconfigoptionresponse) ] |  | No |
| placeholder | [I18nObject](#i18nobject) |  | No |
| required | boolean |  | No |
| scope | [AppSelectorScope](#appselectorscope)<br>[ModelSelectorScope](#modelselectorscope)<br>[ToolSelectorScope](#toolselectorscope) |  | No |
| type | string, <br>**Available values:** "app-selector", "array[tools]", "boolean", "model-selector", "secret-input", "select", "text-input" | The type of the credentials<br>*Enum:* `"app-selector"`, `"array[tools]"`, `"boolean"`, `"model-selector"`, `"secret-input"`, `"select"`, `"text-input"` | Yes |
| url | string |  | No |

#### TriggerProviderListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TriggerProviderListResponse | array |  |  |

#### TriggerProviderOpaqueResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TriggerProviderOpaqueResponse |  |  |  |

#### TriggerProviderSubscriptionApiEntity

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_type | [CredentialType](#credentialtype) | The type of the credential | Yes |
| credentials | object | The credentials of the subscription | Yes |
| endpoint | string | The endpoint of the subscription | Yes |
| id | string | The unique id of the subscription | Yes |
| name | string | The name of the subscription | Yes |
| parameters | object | The parameters of the subscription | Yes |
| properties | object | The properties of the subscription | Yes |
| provider | string | The provider id of the subscription | Yes |
| workflows_in_use | integer | The number of workflows using this subscription | Yes |

#### TriggerSubscriptionBuilderCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_type | string, <br>**Default:** unauthorized |  | No |

#### TriggerSubscriptionBuilderCreateResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| subscription_builder | [SubscriptionBuilderApiEntity](#subscriptionbuilderapientity) |  | Yes |

#### TriggerSubscriptionBuilderLogsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| logs | [ [RequestLog](#requestlog) ] |  | Yes |

#### TriggerSubscriptionBuilderUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | No |
| name | string |  | No |
| parameters | object |  | No |
| properties | object |  | No |

#### TriggerSubscriptionBuilderVerifyPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |

#### TriggerSubscriptionBuilderVerifyResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| verified | boolean |  | Yes |

#### TriggerSubscriptionListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TriggerSubscriptionListResponse | array |  |  |

#### UnaddedModelConfiguration

Model class for provider unadded model configuration.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model | string |  | Yes |
| model_type | [ModelType](#modeltype) |  | Yes |

#### UpdateAnnotationPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| annotation_reply | object |  | No |
| answer | string |  | No |
| content | string |  | No |
| question | string |  | No |

#### UpdateAppPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | App description (max 400 chars) | No |
| icon | string | Icon | No |
| icon_background | string | Icon background color | No |
| icon_type | [IconType](#icontype) | Icon type | No |
| max_active_requests | integer | Maximum active requests | No |
| name | string | App name | Yes |
| use_icon_as_answer_icon | boolean | Use icon as answer icon | No |

#### UpdateSnippetPayload

Payload for updating a snippet.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | No |
| icon_info | [IconInfo](#iconinfo) |  | No |
| name | string |  | No |

#### UploadConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachment_image_file_size_limit | integer |  | No |
| audio_file_size_limit | integer |  | Yes |
| batch_count_limit | integer |  | Yes |
| file_size_limit | integer |  | Yes |
| file_upload_limit | integer |  | No |
| image_file_batch_limit | integer |  | Yes |
| image_file_size_limit | integer |  | Yes |
| single_chunk_attachment_limit | integer |  | Yes |
| video_file_size_limit | integer |  | Yes |
| workflow_file_upload_limit | integer |  | Yes |

#### UrlQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string (uri) |  | Yes |

#### UrlResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string |  | Yes |

#### UsageCheckResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| is_using | boolean |  | Yes |

#### UsageCountResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| count | integer |  | Yes |
| is_using | boolean |  | Yes |

#### UserActionConfig

User action configuration.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| button_style | [ButtonStyle](#buttonstyle) |  | No |
| id | string |  | Yes |
| title | string |  | Yes |

#### UserSatisfactionRateStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| rate | number |  | Yes |

#### UserSatisfactionRateStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [UserSatisfactionRateStatisticItem](#usersatisfactionratestatisticitem) ] |  | Yes |

#### ValueSourceType

ValueSourceType records whether the value comes from a static setting
in form definiton, or a variable while the workflow is running.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ValueSourceType | string | ValueSourceType records whether the value comes from a static setting in form definiton, or a variable while the workflow is running. |  |

#### VerificationTokenResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| is_valid | boolean |  | Yes |
| token | string |  | Yes |

#### WebAppAuthModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allow_email_code_login | boolean |  | Yes |
| allow_email_password_login | boolean |  | Yes |
| allow_sso | boolean |  | Yes |
| enabled | boolean |  | Yes |
| sso_config | [WebAppAuthSSOModel](#webappauthssomodel) |  | Yes |

#### WebAppAuthSSOModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| protocol | string |  | Yes |

#### WebhookTriggerResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | string |  | No |
| id | string |  | Yes |
| node_id | string |  | Yes |
| webhook_debug_url | string |  | Yes |
| webhook_id | string |  | Yes |
| webhook_url | string |  | Yes |

#### WebsiteCrawlPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| options | object |  | Yes |
| provider | string, <br>**Available values:** "firecrawl", "jinareader", "watercrawl" | *Enum:* `"firecrawl"`, `"jinareader"`, `"watercrawl"` | Yes |
| url | string |  | Yes |

#### WebsiteCrawlResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| WebsiteCrawlResponse | object |  |  |

#### WebsiteCrawlStatusQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| provider | string, <br>**Available values:** "firecrawl", "jinareader", "watercrawl" | *Enum:* `"firecrawl"`, `"jinareader"`, `"watercrawl"` | Yes |

#### WebsiteInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| job_id | string |  | Yes |
| only_main_content | boolean, <br>**Default:** true |  | No |
| provider | string |  | Yes |
| urls | [ string ] |  | Yes |

#### WeightKeywordSetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_weight | number | Weight assigned to keyword search results. | Yes |

#### WeightModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword_setting | [WeightKeywordSetting](#weightkeywordsetting) | Keyword search weight settings. | No |
| vector_setting | [WeightVectorSetting](#weightvectorsetting) | Semantic search weight settings. | No |
| weight_type | string | Strategy for balancing semantic and keyword search weights. | No |

#### WeightVectorSetting

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string | Name of the embedding model used for vector search. | Yes |
| embedding_provider_name | string | Provider of the embedding model used for vector search. | Yes |
| vector_weight | number | Weight assigned to semantic vector search results. | Yes |

#### WorkflowAgentBindingType

How a workflow node is bound to an Agent.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| WorkflowAgentBindingType | string | How a workflow node is bound to an Agent. |  |

#### WorkflowAgentComposerQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| snapshot_id | string |  | No |

#### WorkflowAgentComposerResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| active_config_snapshot | [AgentConfigSnapshotSummaryResponse](#agentconfigsnapshotsummaryresponse) |  | No |
| agent | [AgentComposerAgentResponse](#agentcomposeragentresponse) |  | No |
| agent_soul | [AgentSoulConfig](#agentsoulconfig) |  | Yes |
| app_id | string |  | No |
| backing_app_id | string |  | No |
| binding | [AgentComposerBindingResponse](#agentcomposerbindingresponse) |  | No |
| chat_endpoint | string |  | No |
| debug_conversation_has_messages | boolean |  | No |
| debug_conversation_id | string |  | No |
| debug_conversation_message_count | integer |  | No |
| effective_declared_outputs | [ [DeclaredOutputConfig](#declaredoutputconfig) ] |  | No |
| hidden_app_backed | boolean |  | No |
| impact_summary | [AgentComposerImpactResponse](#agentcomposerimpactresponse) |  | No |
| node_id | string |  | No |
| node_job | [WorkflowNodeJobConfig](#workflownodejobconfig) |  | Yes |
| save_options | [ [ComposerSaveStrategy](#composersavestrategy) ] |  | Yes |
| soul_lock | [AgentComposerSoulLockResponse](#agentcomposersoullockresponse) |  | Yes |
| validation | [ComposerValidationFindingsResponse](#composervalidationfindingsresponse) |  | No |
| variant | string |  | Yes |
| workflow_id | string |  | No |

#### WorkflowAgentSandboxUploadPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_execution_id | string | Optional workflow node execution ID. When omitted, the latest active session for the node is used. | No |
| path | string | File path relative to the sandbox workspace | Yes |

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
| created_by_account | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| created_by_end_user | [SimpleEndUser](#simpleenduser) |  | No |
| created_by_role | string |  | No |
| created_from | string |  | No |
| details |  |  | No |
| id | string |  | Yes |
| workflow_run | [WorkflowRunForLogResponse](#workflowrunforlogresponse) |  | No |

#### WorkflowAppLogQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at__after | string | Filter logs created after this timestamp | No |
| created_at__before | string | Filter logs created before this timestamp | No |
| created_by_account | string | Filter by account | No |
| created_by_end_user_session_id | string | Filter by end user session ID | No |
| detail | boolean | Whether to return detailed logs | No |
| keyword | string | Search keyword for filtering logs | No |
| limit | integer, <br>**Default:** 20 | Number of items per page (1-100) | No |
| page | integer, <br>**Default:** 1 | Page number (1-99999) | No |
| status | [WorkflowExecutionStatus](#workflowexecutionstatus) | Execution status filter (succeeded, failed, stopped, partial-succeeded) | No |

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
| created_at | integer |  | No |
| created_by_account | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| created_by_end_user | [SimpleEndUser](#simpleenduser) |  | No |
| id | string |  | Yes |
| trigger_metadata |  |  | No |
| workflow_run | [WorkflowRunForArchivedLogResponse](#workflowrunforarchivedlogresponse) |  | No |

#### WorkflowAverageAppInteractionStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| interactions | number |  | Yes |

#### WorkflowAverageAppInteractionStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowAverageAppInteractionStatisticItem](#workflowaverageappinteractionstatisticitem) ] |  | Yes |

#### WorkflowCommentAccount

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar_url | string |  | Yes |
| email | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |

#### WorkflowCommentBasic

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |
| created_at | integer |  | No |
| created_by | string |  | Yes |
| created_by_account | [WorkflowCommentAccount](#workflowcommentaccount) |  | No |
| id | string |  | Yes |
| mention_count | integer |  | Yes |
| participants | [ [WorkflowCommentAccount](#workflowcommentaccount) ] |  | Yes |
| position_x | number |  | Yes |
| position_y | number |  | Yes |
| reply_count | integer |  | Yes |
| resolved | boolean |  | Yes |
| resolved_at | integer |  | No |
| resolved_by | string |  | No |
| resolved_by_account | [WorkflowCommentAccount](#workflowcommentaccount) |  | No |
| updated_at | integer |  | No |

#### WorkflowCommentBasicList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowCommentBasic](#workflowcommentbasic) ] |  | Yes |

#### WorkflowCommentCreate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
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
| created_at | integer |  | No |
| created_by | string |  | Yes |
| created_by_account | [WorkflowCommentAccount](#workflowcommentaccount) |  | No |
| id | string |  | Yes |
| mentions | [ [WorkflowCommentMention](#workflowcommentmention) ] |  | Yes |
| position_x | number |  | Yes |
| position_y | number |  | Yes |
| replies | [ [WorkflowCommentReply](#workflowcommentreply) ] |  | Yes |
| resolved | boolean |  | Yes |
| resolved_at | integer |  | No |
| resolved_by | string |  | No |
| resolved_by_account | [WorkflowCommentAccount](#workflowcommentaccount) |  | No |
| updated_at | integer |  | No |

#### WorkflowCommentMention

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| mentioned_user_account | [WorkflowCommentAccount](#workflowcommentaccount) |  | No |
| mentioned_user_id | string |  | Yes |
| reply_id | string |  | No |

#### WorkflowCommentMentionUsersPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| users | [ [AccountWithRoleResponse](#accountwithroleresponse) ] |  | Yes |

#### WorkflowCommentReply

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |
| created_at | integer |  | No |
| created_by | string |  | Yes |
| created_by_account | [WorkflowCommentAccount](#workflowcommentaccount) |  | No |
| id | string |  | Yes |

#### WorkflowCommentReplyCreate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
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
| updated_at | integer |  | No |

#### WorkflowCommentResolve

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| resolved | boolean |  | Yes |
| resolved_at | integer |  | No |
| resolved_by | string |  | No |

#### WorkflowCommentUpdate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| updated_at | integer |  | No |

#### WorkflowCommentUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Comment content | Yes |
| mentioned_user_ids | [ string ] | Mentioned user IDs. Omit to keep existing mentions. | No |
| position_x | number | Comment X position | No |
| position_y | number | Comment Y position | No |

#### WorkflowComposerCopyFromRosterPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| idempotency_key | string |  | No |
| source_agent_id | string |  | Yes |
| source_snapshot_id | string |  | No |

#### WorkflowConversationVariableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| value |  |  | Yes |
| value_type | string |  | Yes |

#### WorkflowDailyRunsStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| runs | integer |  | Yes |

#### WorkflowDailyRunsStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowDailyRunsStatisticItem](#workflowdailyrunsstatisticitem) ] |  | Yes |

#### WorkflowDailyTerminalsStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| terminal_count | integer |  | Yes |

#### WorkflowDailyTerminalsStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowDailyTerminalsStatisticItem](#workflowdailyterminalsstatisticitem) ] |  | Yes |

#### WorkflowDailyTokenCostStatisticItem

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| date | string |  | Yes |
| token_count | integer |  | Yes |

#### WorkflowDailyTokenCostStatisticResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowDailyTokenCostStatisticItem](#workflowdailytokencoststatisticitem) ] |  | Yes |

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
| value | string<br>integer<br>number<br>boolean<br>object<br>[ object ] |  | No |
| value_type | string |  | No |
| visible | boolean |  | No |

#### WorkflowDraftVariableList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [WorkflowDraftVariable](#workflowdraftvariable) ] |  | No |

#### WorkflowDraftVariableListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 | Items per page | No |
| page | integer, <br>**Default:** 1 | Page number | No |

#### WorkflowDraftVariableListWithoutValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [WorkflowDraftVariableWithoutValue](#workflowdraftvariablewithoutvalue) ] |  | No |
| total | integer |  | No |

#### WorkflowDraftVariablePatchPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | No |
| value |  |  | No |

#### WorkflowDraftVariableUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string | Variable name | No |
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

#### WorkflowEnvironmentVariableResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | Yes |
| id | string |  | Yes |
| name | string |  | Yes |
| value |  |  | Yes |
| value_type | string |  | Yes |

#### WorkflowExecutionStatus

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| WorkflowExecutionStatus | string |  |  |

#### WorkflowFeatureTogglePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | No |

#### WorkflowFeaturesConfigPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_upload | [WorkflowFileUploadPayload](#workflowfileuploadpayload) |  | No |
| opening_statement | string |  | No |
| retriever_resource | [WorkflowFeatureTogglePayload](#workflowfeaturetogglepayload) |  | No |
| sensitive_word_avoidance | [WorkflowSensitiveWordAvoidancePayload](#workflowsensitivewordavoidancepayload) |  | No |
| speech_to_text | [WorkflowFeatureTogglePayload](#workflowfeaturetogglepayload) |  | No |
| suggested_questions | [ string ] |  | No |
| suggested_questions_after_answer | [WorkflowSuggestedQuestionsAfterAnswerPayload](#workflowsuggestedquestionsafteranswerpayload) |  | No |
| text_to_speech | [WorkflowTextToSpeechPayload](#workflowtexttospeechpayload) |  | No |

#### WorkflowFeaturesPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| features | [WorkflowFeaturesConfigPayload](#workflowfeaturesconfigpayload) | Workflow feature configuration | Yes |

#### WorkflowFileUploadImagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| detail | string |  | No |
| enabled | boolean |  | No |
| number_limits | integer |  | No |
| transfer_methods | [ string ] |  | No |

#### WorkflowFileUploadPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed_file_extensions | [ string ] |  | No |
| allowed_file_types | [ string ] |  | No |
| allowed_file_upload_methods | [ string ] |  | No |
| audio | [WorkflowFileUploadTransferPayload](#workflowfileuploadtransferpayload) |  | No |
| custom | [WorkflowFileUploadTransferPayload](#workflowfileuploadtransferpayload) |  | No |
| document | [WorkflowFileUploadTransferPayload](#workflowfileuploadtransferpayload) |  | No |
| enabled | boolean |  | No |
| fileUploadConfig | object |  | No |
| image | [WorkflowFileUploadImagePayload](#workflowfileuploadimagepayload) |  | No |
| number_limits | integer |  | No |
| preview_config | [WorkflowFileUploadPreviewConfigPayload](#workflowfileuploadpreviewconfigpayload) |  | No |
| video | [WorkflowFileUploadTransferPayload](#workflowfileuploadtransferpayload) |  | No |

#### WorkflowFileUploadPreviewConfigPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_type_list | [ string ] |  | No |
| mode | string |  | No |

#### WorkflowFileUploadTransferPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | No |
| number_limits | integer |  | No |
| transfer_methods | [ string ] |  | No |

#### WorkflowGeneratePayload

Payload for the cmd+k `/create` and `/refine` workflow generator endpoint.

See ``services/workflow_generator_service.py`` for behaviour. Errors are
surfaced through the same envelope as ``/rule-generate`` so the frontend
can reuse its existing handler.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| current_graph | object | Existing draft graph to refine (cmd+k `/refine`); omit for create-from-scratch | No |
| ideal_output | string | Optional sample output for grounding | No |
| instruction | string | Natural-language workflow description | Yes |
| mode | string, <br>**Available values:** "advanced-chat", "auto", "workflow" | Target app mode for the generated graph; 'auto' lets the backend classify the instruction<br>*Enum:* `"advanced-chat"`, `"auto"`, `"workflow"` | Yes |
| model_config | [ModelConfig](#modelconfig) | Model configuration | Yes |

#### WorkflowInstructionSuggestionsPayload

Payload for the workflow-generator instruction-suggestions endpoint.

Runs before the user picks a model, so the suggestions come from the
tenant's default model. The underlying generator never raises — an empty
``suggestions`` list is a valid 200 (soft-fail).

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| count | integer, <br>**Default:** 4 | Number of suggestions to return (1-6) | No |
| language | string | Optional language to write the suggestions in | No |
| mode | string, <br>**Available values:** "advanced-chat", "workflow" | Target app mode for the suggestions<br>*Enum:* `"advanced-chat"`, `"workflow"` | Yes |

#### WorkflowListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 10 |  | No |
| named_only | boolean |  | No |
| page | integer, <br>**Default:** 1 |  | No |
| user_id | string |  | No |

#### WorkflowNodeJobConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| declared_outputs | [ [DeclaredOutputConfig](#declaredoutputconfig) ] |  | No |
| human_contacts | [ [AgentHumanContactConfig](#agenthumancontactconfig) ] |  | No |
| metadata | [WorkflowNodeJobMetadata](#workflownodejobmetadata) |  | No |
| mode | [WorkflowNodeJobMode](#workflownodejobmode) |  | No |
| previous_node_output_refs | [ [WorkflowPreviousNodeOutputRef](#workflowpreviousnodeoutputref) ] |  | No |
| schema_version | integer, <br>**Default:** 1 |  | No |
| workflow_prompt | string |  | No |

#### WorkflowNodeJobMetadata

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_soul | object |  | No |
| file_refs | [ [AgentFileRefConfig](#agentfilerefconfig) ] |  | No |

#### WorkflowNodeJobMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| WorkflowNodeJobMode | string |  |  |

#### WorkflowOnlineUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| avatar | string |  | No |
| user_id | string |  | Yes |
| username | string |  | Yes |

#### WorkflowOnlineUsersByApp

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |
| users | [ [WorkflowOnlineUser](#workflowonlineuser) ] |  | Yes |

#### WorkflowOnlineUsersPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_ids | [ string ] | App IDs | No |

#### WorkflowOnlineUsersResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowOnlineUsersByApp](#workflowonlineusersbyapp) ] |  | Yes |

#### WorkflowPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| has_more | boolean |  | Yes |
| items | [ [WorkflowResponse](#workflowresponse) ] |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |

#### WorkflowPartial

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by | string |  | No |
| id | string |  | Yes |
| updated_at | integer |  | No |
| updated_by | string |  | No |

#### WorkflowPauseDetailsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| paused_at | string |  | No |
| paused_nodes | [ [PausedNodeResponse](#pausednoderesponse) ] |  | Yes |

#### WorkflowPreviousNodeOutputRef

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| key | string |  | No |
| name | string |  | No |
| node_id | string |  | No |
| output | string |  | No |
| selector | [ string<br>integer<br>number<br>boolean ] |  | No |
| value_selector | [ string<br>integer<br>number<br>boolean ] |  | No |
| variable | string |  | No |
| variable_selector | [ string<br>integer<br>number<br>boolean ] |  | No |

#### WorkflowPublishResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | Yes |
| result | string |  | Yes |

#### WorkflowResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_variables | [ [WorkflowConversationVariableResponse](#workflowconversationvariableresponse) ] |  | Yes |
| created_at | integer |  | Yes |
| created_by | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| environment_variables | [ [WorkflowEnvironmentVariableResponse](#workflowenvironmentvariableresponse) ] |  | Yes |
| features | object |  | Yes |
| graph | object |  | Yes |
| hash | string |  | Yes |
| id | string |  | Yes |
| marked_comment | string |  | Yes |
| marked_name | string |  | Yes |
| rag_pipeline_variables | [ [PipelineVariableResponse](#pipelinevariableresponse) ] |  | Yes |
| tool_published | boolean |  | Yes |
| updated_at | integer |  | Yes |
| updated_by | [SimpleAccountResponse](#simpleaccountresponse) |  | No |
| version | string |  | Yes |

#### WorkflowRestoreResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| hash | string |  | Yes |
| result | string |  | Yes |
| updated_at | integer |  | Yes |

#### WorkflowRunCountQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| status | string | Workflow run status filter | No |
| time_range | string | Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), 30m (30 minutes), 30s (30 seconds). Filters by created_at field. | No |
| triggered_from | string | Filter by trigger source: debugging or app-run. Default: debugging | No |

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

#### WorkflowRunExportResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| presigned_url | string | Pre-signed URL for download | No |
| presigned_url_expires_at | string | Pre-signed URL expiration time | No |
| status | string | Export status: success/failed | Yes |

#### WorkflowRunForArchivedLogResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| elapsed_time | number |  | No |
| id | string |  | Yes |
| status | string |  | No |
| total_tokens | integer |  | No |
| triggered_from | string |  | No |

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

#### WorkflowRunForLogResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| elapsed_time | number |  | No |
| error | string |  | No |
| exceptions_count | integer |  | No |
| finished_at | integer |  | No |
| id | string |  | Yes |
| status | string |  | No |
| total_steps | integer |  | No |
| total_tokens | integer |  | No |
| triggered_from | string |  | No |
| version | string |  | No |

#### WorkflowRunListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string | Last run ID for pagination | No |
| limit | integer, <br>**Default:** 20 | Number of items per page (1-100) | No |
| status | string | Workflow run status filter | No |
| triggered_from | string | Filter by trigger source: debugging or app-run. Default: debugging | No |

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
| status | string |  | No |
| title | string |  | No |

#### WorkflowRunPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowRunForListResponse](#workflowrunforlistresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### WorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] | File list for workflow system file inputs. Available when file upload is enabled for the workflow. To attach a local file, first upload it via [Upload File](/api-reference/files/upload-file) and use the returned `id` as `upload_file_id` with `transfer_method: local_file`. | No |
| inputs | object | Key-value pairs for workflow input variables. Values for file-type variables should be arrays of file objects with `type`, `transfer_method`, and either `url` or `upload_file_id`. Refer to the `user_input_form` field in the [Get App Parameters](/api-reference/applications/get-app-parameters) response to discover the variable names and types expected by your app. | Yes |

#### WorkflowRunQuery

Query parameters for workflow runs.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |

#### WorkflowRunRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |

#### WorkflowRunSnapshotView

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| node_outputs | [ [NodeOutputsView](#nodeoutputsview) ] |  | No |
| workflow_run_id | string |  | Yes |
| workflow_run_status | [WorkflowExecutionStatus](#workflowexecutionstatus) |  | Yes |

#### WorkflowSensitiveWordAvoidancePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| config | object |  | No |
| enabled | boolean |  | No |
| type | string |  | No |

#### WorkflowStatisticQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| end | string | End date and time (YYYY-MM-DD HH:MM) | No |
| start | string | Start date and time (YYYY-MM-DD HH:MM) | No |

#### WorkflowSuggestedQuestionsAfterAnswerPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | No |
| model | object |  | No |
| prompt | string |  | No |

#### WorkflowTextToSpeechPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| autoPlay | string |  | No |
| enabled | boolean |  | No |
| language | string |  | No |
| voice | string |  | No |

#### WorkflowToolCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string |  | Yes |
| icon | object |  | Yes |
| label | string |  | Yes |
| labels | [ string ] |  | No |
| name | string |  | Yes |
| parameters | [ [WorkflowToolParameterConfiguration](#workflowtoolparameterconfiguration) ] |  | No |
| privacy_policy | string |  | No |
| workflow_app_id | string |  | Yes |

#### WorkflowToolDeletePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| workflow_tool_id | string |  | Yes |

#### WorkflowToolGetQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| workflow_app_id | string |  | No |
| workflow_tool_id | string |  | No |

#### WorkflowToolListQuery

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
| labels | [ string ] |  | No |
| name | string |  | Yes |
| parameters | [ [WorkflowToolParameterConfiguration](#workflowtoolparameterconfiguration) ] |  | No |
| privacy_policy | string |  | No |
| workflow_tool_id | string |  | Yes |

#### WorkflowTriggerListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkflowTriggerResponse](#workflowtriggerresponse) ] |  | Yes |

#### WorkflowTriggerResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | string |  | No |
| icon | string |  | Yes |
| id | string |  | Yes |
| node_id | string |  | Yes |
| provider_name | string |  | Yes |
| status | string |  | Yes |
| title | string |  | Yes |
| trigger_type | string |  | Yes |
| updated_at | string |  | No |

#### WorkflowUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| marked_comment | string |  | No |
| marked_name | string |  | No |

#### WorkspaceAccessMatrix

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| items | [ [AccessMatrixItem](#accessmatrixitem) ] |  | No |
| pagination | [Pagination](#pagination) |  | No |

#### WorkspaceCustomConfigPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| remove_webapp_brand | boolean |  | No |
| replace_webapp_logo | string |  | No |

#### WorkspaceCustomConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| remove_webapp_brand | boolean |  | No |
| replace_webapp_logo | string |  | No |

#### WorkspaceInfoPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |

#### WorkspaceListItemResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| id | string |  | Yes |
| name | string |  | No |
| status | string |  | No |

#### WorkspaceListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 |  | No |
| page | integer, <br>**Default:** 1 |  | No |

#### WorkspaceLogoUploadResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |

#### WorkspacePaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WorkspaceListItemResponse](#workspacelistitemresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |
| page | integer |  | Yes |
| total | integer |  | Yes |

#### WorkspacePermissionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allow_member_invite | boolean |  | Yes |
| allow_owner_transfer | boolean |  | Yes |
| workspace_id | string |  | Yes |

#### WorkspacePermissionSnapshot

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| permission_keys | [ string ] |  | No |

#### WorkspaceTenantResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |
| tenant | [TenantInfoResponse](#tenantinforesponse) |  | Yes |

#### _AccessControlLanguageQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| language | string | Localized policy label language | No |

#### _AccessPolicyList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [AccessPolicy](#accesspolicy) ] |  | No |
| pagination | [Pagination](#pagination) |  | No |

#### _AnonymousInlineModel_b1954337d565

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enable | boolean |  | No |
| model_name | string |  | No |
| model_provider_name | string |  | No |
| summary_prompt | string |  | No |

#### _DeleteMemberBindingsRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_ids | [ string ] |  | No |

#### _MembersInRoleList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [MembersInRole](#membersinrole) ] |  | No |
| pagination | [Pagination](#pagination) |  | No |

#### _RBACRoleAccountList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [RBACRoleAccount](#rbacroleaccount) ] |  | No |
| pagination | [Pagination](#pagination) |  | No |

#### _RBACRoleList

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [RBACRole](#rbacrole) ] |  | No |
| pagination | [Pagination](#pagination) |  | No |

#### _ReplaceBindingsRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_ids | [ string ] |  | No |
| role_ids | [ string ] |  | No |

#### _ReplaceMemberRolesRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| role_ids | [ string ], <br>**Default:**  |  | No |

#### _ResourceAccessScopeRequest

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| scope | [RBACResourceWhitelistScope](#rbacresourcewhitelistscope) |  | Yes |

#### core__tools__entities__common_entities__I18nObject

Model class for i18n object.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| en_US | string |  | Yes |
| ja_JP | string |  | No |
| pt_BR | string |  | No |
| zh_Hans | string |  | No |

#### graphon__model_runtime__entities__common_entities__I18nObject

Model class for i18n object.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| en_US | string |  | Yes |
| zh_Hans | string |  | No |

## FastOpenAPI Preview (OpenAPI 3.1)

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
| language | string | Admin language | No |
| name | string | Admin name (max 30 characters) | Yes |
| password | string | Admin password | Yes |

###### SetupResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string | Setup result | Yes |

###### SetupStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| setup_at | string | Setup completion time (ISO format) | No |
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

# Web API
Public APIs for web applications including file uploads, chat interactions, and app management

## Version: 1.0

### Available authorizations
#### Bearer (API Key Authentication)
Type: Bearer {your-api-key}  
**Name:** Authorization  
**In:** header  

---
## web
Web application API operations

### [POST] /audio-to-text
**Convert audio to text**

Convert audio file to text using speech-to-text service.

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 413 | Audio file too large |
| 415 | Unsupported audio type |
| 500 | Internal Server Error |

### [POST] /chat-messages
Create a chat message for conversational applications.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatMessagePayload](#chatmessagepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### [POST] /chat-messages/{task_id}/stop
Stop a running chat message task.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Task ID to stop | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Task Not Found |  |
| 500 | Internal Server Error |  |

### [POST] /completion-messages
Create a completion message for text generation applications.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CompletionMessagePayload](#completionmessagepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### [POST] /completion-messages/{task_id}/stop
Stop a running completion message task.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Task ID to stop | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Task Not Found |  |
| 500 | Internal Server Error |  |

### [GET] /conversations
Retrieve paginated list of conversations for a chat application.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query | Last conversation ID for pagination | No | string |
| limit | query | Number of conversations to return (1-100) | No | integer, <br>**Default:** 20 |
| pinned | query | Filter by pinned status | No | string, <br>**Available values:** "false", "true" |
| sort_by | query | Sort order | No | string, <br>**Available values:** "-created_at", "-updated_at", "created_at", "updated_at", <br>**Default:** -updated_at |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found or Not a Chat App |
| 500 | Internal Server Error |

### [DELETE] /conversations/{c_id}
Delete a specific conversation.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Conversation Not Found or Not a Chat App |
| 500 | Internal Server Error |

### [POST] /conversations/{c_id}/name
Rename a specific conversation with a custom name or auto-generate one.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string |
| auto_generate | query | Auto-generate conversation name | No | boolean |
| name | query | New conversation name | No | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Conversation renamed successfully |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Conversation Not Found or Not a Chat App |
| 500 | Internal Server Error |

### [PATCH] /conversations/{c_id}/pin
Pin a specific conversation to keep it at the top of the list.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation pinned successfully | **application/json**: [ResultResponse](#resultresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Conversation Not Found or Not a Chat App |  |
| 500 | Internal Server Error |  |

### [PATCH] /conversations/{c_id}/unpin
Unpin a specific conversation to remove it from the top of the list.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation unpinned successfully | **application/json**: [ResultResponse](#resultresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Conversation Not Found or Not a Chat App |  |
| 500 | Internal Server Error |  |

### [POST] /email-code-login
Send email verification code for login

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EmailCodeLoginSendPayload](#emailcodeloginsendpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Email code sent successfully | **application/json**: [SimpleResultDataResponse](#simpleresultdataresponse)<br> |
| 400 | Bad request - invalid email format |  |
| 404 | Account not found |  |

### [POST] /email-code-login/validity
Verify email code and complete login

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EmailCodeLoginVerifyPayload](#emailcodeloginverifypayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Email code verified and login successful | **application/json**: [AccessTokenResultResponse](#accesstokenresultresponse)<br> |
| 400 | Bad request - invalid code or token |  |
| 401 | Invalid token or expired code |  |
| 404 | Account not found |  |

### [POST] /files/upload
**Upload a file for use in web applications**

Upload a file for use in web applications
Accepts file uploads for use within web applications, supporting
multiple file types with automatic validation and storage.

Args:
    app_model: The associated application model
    end_user: The end user uploading the file

Form Parameters:
    file: The file to upload (required)
    source: Optional source type (datasets or None)

Returns:
    dict: File information including ID, URL, and metadata
    int: HTTP status code 201 for success

Raises:
    NoFileUploadedError: No file provided in request
    TooManyFilesError: Multiple files provided (only one allowed)
    FilenameNotExistsError: File has no filename
    FileTooLargeError: File exceeds size limit
    UnsupportedFileTypeError: File type not supported

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileResponse](#fileresponse)<br> |
| 400 | Bad request - invalid file or parameters |  |
| 413 | File too large |  |
| 415 | Unsupported file type |  |

### [POST] /forgot-password
Send password reset email

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ForgotPasswordSendPayload](#forgotpasswordsendpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Password reset email sent successfully | **application/json**: [SimpleResultDataResponse](#simpleresultdataresponse)<br> |
| 400 | Bad request - invalid email format |  |
| 404 | Account not found |  |
| 429 | Too many requests - rate limit exceeded |  |

### [POST] /forgot-password/resets
Reset user password with verification token

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ForgotPasswordResetPayload](#forgotpasswordresetpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Password reset successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | Bad request - invalid parameters or password mismatch |  |
| 401 | Invalid or expired token |  |
| 404 | Account not found |  |

### [POST] /forgot-password/validity
Verify password reset token validity

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ForgotPasswordCheckPayload](#forgotpasswordcheckpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Token is valid | **application/json**: [VerificationTokenResponse](#verificationtokenresponse)<br> |
| 400 | Bad request - invalid token format |  |
| 401 | Invalid or expired token |  |

### [GET] /form/human_input/{form_token}
**Get human input form definition by token**

GET /api/form/human_input/<form_token>

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [POST] /form/human_input/{form_token}
**Submit human input form by token**

POST /api/form/human_input/<form_token>

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

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [POST] /form/human_input/{form_token}/upload-token
**Issue an upload token for a human input form**

POST /api/form/human_input/<form_token>/upload-token

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### [POST] /human-input-forms/files
**Upload one local file or remote URL file for a HITL human input form**

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileResponse](#fileresponse)<br> |

### [POST] /login
**Authenticate user and login**

Authenticate user for web application access

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [LoginPayload](#loginpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Authentication successful | **application/json**: [AccessTokenResultResponse](#accesstokenresultresponse)<br> |
| 400 | Bad request - invalid email or password format |  |
| 401 | Authentication failed - email or password mismatch |  |
| 403 | Account banned or login disabled |  |
| 404 | Account not found |  |

### [GET] /login/status
Check login status

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Login status | **application/json**: [LoginStatusResponse](#loginstatusresponse)<br> |
| 401 | Login status |  |

### [POST] /logout
Logout user from web application

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Logout successful | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |

### [GET] /messages
Retrieve paginated list of messages from a conversation in a chat application.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| conversation_id | query | Conversation UUID | Yes | string |
| first_id | query | First message ID for pagination | No | string |
| limit | query | Number of messages to return (1-100) | No | integer, <br>**Default:** 20 |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Conversation Not Found or Not a Chat App |
| 500 | Internal Server Error |

### [POST] /messages/{message_id}/feedbacks
Submit feedback (like/dislike) for a specific message.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message UUID | Yes | string |
| content | query | Feedback content | No | string |
| rating | query | Feedback rating | No | string, <br>**Available values:** "dislike", "like" |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Feedback submitted successfully | **application/json**: [ResultResponse](#resultresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Message Not Found |  |
| 500 | Internal Server Error |  |

### [GET] /messages/{message_id}/more-like-this
Generate a new completion similar to an existing message (completion apps only).

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| response_mode | query | Response mode | Yes | string, <br>**Available values:** "blocking", "streaming" |
| message_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request - Not a completion app or feature disabled |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Message Not Found |
| 500 | Internal Server Error |

### [GET] /messages/{message_id}/suggested-questions
Get suggested follow-up questions after a message (chat apps only).

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message UUID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SuggestedQuestionsResponse](#suggestedquestionsresponse)<br> |
| 400 | Bad Request - Not a chat app or feature disabled |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Message Not Found or Conversation Not Found |  |
| 500 | Internal Server Error |  |

### [GET] /meta
**Get app meta**

Retrieve the metadata for a specific app.

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### [GET] /parameters
**Retrieve app parameters**

Retrieve the parameters for a specific app.

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### [GET] /passport
Get authentication passport for web application access

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Passport retrieved successfully |
| 401 | Unauthorized - missing app code or invalid authentication |
| 404 | Application or user not found |

### [POST] /remote-files/upload
**Upload a file from a remote URL**

Upload a file from a remote URL
Downloads a file from the provided remote URL and uploads it
to the platform storage for use in web applications.

Args:
    app_model: The associated application model
    end_user: The end user making the request

JSON Parameters:
    url: The remote URL to download the file from (required)

Returns:
    dict: File information including ID, signed URL, and metadata
    int: HTTP status code 201 for success

Raises:
    RemoteFileUploadError: Failed to fetch file from remote URL
    FileTooLargeError: File exceeds size limit
    UnsupportedFileTypeError: File type not supported

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Remote file uploaded successfully | **application/json**: [FileWithSignedUrl](#filewithsignedurl)<br> |
| 400 | Bad request - invalid URL or parameters |  |
| 413 | File too large |  |
| 415 | Unsupported file type |  |
| 500 | Failed to fetch remote file |  |

### [GET] /remote-files/{url}
**Get information about a remote file**

Get information about a remote file
Retrieves basic information about a file located at a remote URL,
including content type and content length.

Args:
    app_model: The associated application model
    end_user: The end user making the request
    url: URL-encoded path to the remote file

Returns:
    dict: Remote file information including type and length

Raises:
    HTTPException: If the remote file cannot be accessed

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| url | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Remote file information retrieved successfully | **application/json**: [RemoteFileInfo](#remotefileinfo)<br> |
| 400 | Bad request - invalid URL |  |
| 404 | Remote file not found |  |
| 500 | Failed to fetch remote file |  |

### [GET] /saved-messages
Retrieve paginated list of saved messages for a completion application.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query | Last message ID for pagination | No | string |
| limit | query | Number of messages to return (1-100) | No | integer, <br>**Default:** 20 |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request - Not a completion app |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### [POST] /saved-messages
Save a specific message for later reference.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | query | Message UUID to save | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Message saved successfully | **application/json**: [ResultResponse](#resultresponse)<br> |
| 400 | Bad Request - Not a completion app |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Message Not Found |  |
| 500 | Internal Server Error |  |

### [DELETE] /saved-messages/{message_id}
Remove a message from saved messages.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message UUID to delete | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Message removed successfully |
| 400 | Bad Request - Not a completion app |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Message Not Found |
| 500 | Internal Server Error |

### [GET] /site
**Retrieve app site info**

Retrieve app site information and configuration.

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### [GET] /system-features
**Get system feature flags and configuration**

Get system feature flags and configuration
Returns the current system feature flags and configuration
that control various functionalities across the platform.

Returns:
    dict: System feature configuration object

This endpoint is akin to the `SystemFeatureApi` endpoint in api/controllers/console/feature.py,
except it is intended for use by the web app, instead of the console dashboard.

NOTE: This endpoint is unauthenticated by design, as it provides system features
data required for webapp initialization.

Authentication would create circular dependency (can't authenticate without webapp loading).

Only non-sensitive configuration data should be returned by this endpoint.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | System features retrieved successfully | **application/json**: [SystemFeatureModel](#systemfeaturemodel)<br> |
| 500 | Internal server error |  |

### [POST] /text-to-audio
**Convert text to audio**

Convert text to audio using text-to-speech service.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TextToAudioPayload](#texttoaudiopayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 500 | Internal Server Error |

### [GET] /webapp/access-mode
Retrieve the access mode for a web application (public or restricted).

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| appCode | query | Application code | No | string |
| appId | query | Application ID | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AccessModeResponse](#accessmoderesponse)<br> |
| 400 | Bad Request |  |
| 500 | Internal Server Error |  |

### [GET] /webapp/permission
Check if user has permission to access a web application.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| appId | query | Application ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [BooleanResultResponse](#booleanresultresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 500 | Internal Server Error |  |

### [POST] /workflows/run
**Run workflow**

Execute a workflow with provided inputs and files.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowRunPayload](#workflowrunpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### [POST] /workflows/tasks/{task_id}/stop
**Stop workflow task**

Stop a running workflow task.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Task ID to stop | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Task Not Found |  |
| 500 | Internal Server Error |  |

---
## default
Default namespace

### [GET] /workflow/{task_id}/events
**Get workflow execution events stream after resume**

GET /api/workflow/<task_id>/events

Returns Server-Sent Events stream.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

---
### Schemas

#### AccessModeResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| accessMode | string |  | Yes |

#### AccessTokenData

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | Yes |

#### AccessTokenResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [AccessTokenData](#accesstokendata) |  | Yes |
| result | string |  | Yes |

#### AppAccessModeQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| appCode | string | Application code | No |
| appId | string | Application ID | No |

#### BooleanResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | boolean |  | Yes |

#### BrandingModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| application_title | string |  | Yes |
| enabled | boolean |  | Yes |
| favicon | string |  | Yes |
| login_page_logo | string |  | Yes |
| workspace_logo | string |  | Yes |

#### ChatMessagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation ID | No |
| files | [ object ] | Files to be processed | No |
| inputs | object | Input variables for the chat | Yes |
| parent_message_id | string | Parent message ID | No |
| query | string | User query/message | Yes |
| response_mode | string | Response mode: blocking or streaming | No |
| retriever_from | string, <br>**Default:** web_app | Source of retriever | No |

#### CompletionMessagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] | Files to be processed | No |
| inputs | object | Input variables for the completion | Yes |
| query | string | Query text for completion | No |
| response_mode | string | Response mode: blocking or streaming | No |
| retriever_from | string, <br>**Default:** web_app | Source of retriever | No |

#### ConversationListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| pinned | boolean |  | No |
| sort_by | string, <br>**Available values:** "-created_at", "-updated_at", "created_at", "updated_at", <br>**Default:** -updated_at | *Enum:* `"-created_at"`, `"-updated_at"`, `"created_at"`, `"updated_at"` | No |

#### ConversationRenamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate | boolean |  | No |
| name | string |  | No |

#### EmailCodeLoginSendPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| language | string |  | No |

#### EmailCodeLoginVerifyPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| email | string |  | Yes |
| token | string |  | Yes |

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

#### ForgotPasswordResetPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| new_password | string |  | Yes |
| password_confirm | string |  | Yes |
| token | string |  | Yes |

#### ForgotPasswordSendPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| language | string |  | No |

#### HumanInputFileUploadFormPayload

Parsed multipart form fields for HITL uploads.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string | Remote file URL | No |

#### HumanInputUploadTokenResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| expires_at | integer |  | Yes |
| upload_token | string |  | Yes |

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

#### LoginPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| password | string |  | Yes |

#### LoginStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_logged_in | boolean |  | Yes |
| logged_in | boolean |  | Yes |

#### MessageFeedbackPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | No |
| rating | string |  | No |

#### MessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation UUID | Yes |
| first_id | string | First message ID for pagination | No |
| limit | integer, <br>**Default:** 20 | Number of messages to return (1-100) | No |

#### MessageMoreLikeThisQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| response_mode | string, <br>**Available values:** "blocking", "streaming" | Response mode<br>*Enum:* `"blocking"`, `"streaming"` | Yes |

#### PluginInstallationPermissionModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_installation_scope | [PluginInstallationScope](#plugininstallationscope) |  | Yes |
| restrict_to_marketplace_only | boolean |  | Yes |

#### PluginInstallationScope

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PluginInstallationScope | string |  |  |

#### PluginManagerModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| enabled | boolean |  | Yes |

#### RemoteFileInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_length | integer |  | Yes |
| file_type | string |  | Yes |

#### RemoteFileUploadPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string (uri) | Remote file URL | Yes |

#### ResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |

#### SavedMessageCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string |  | Yes |

#### SavedMessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |

#### SimpleResultDataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string |  | Yes |
| result | string |  | Yes |

#### SimpleResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |

#### SuggestedQuestionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ string ] |  | Yes |

#### SystemFeatureModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| branding | [BrandingModel](#brandingmodel) |  | Yes |
| enable_change_email | boolean, <br>**Default:** true |  | Yes |
| enable_collaboration_mode | boolean, <br>**Default:** true |  | Yes |
| enable_creators_platform | boolean |  | Yes |
| enable_email_code_login | boolean |  | Yes |
| enable_email_password_login | boolean, <br>**Default:** true |  | Yes |
| enable_explore_banner | boolean |  | Yes |
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
| sso_enforced_for_signin | boolean |  | Yes |
| sso_enforced_for_signin_protocol | string |  | Yes |
| webapp_auth | [WebAppAuthModel](#webappauthmodel) |  | Yes |

#### TextToAudioPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string | Message ID | No |
| streaming | boolean | Enable streaming response | No |
| text | string | Text to convert to audio | No |
| voice | string | Voice to use for TTS | No |

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

#### WorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |

# Web API
Public APIs for web applications including file uploads, chat interactions, and app management

## Version: 1.0

### Available authorizations
#### Bearer (HTTP, bearer)
Use the Service API key as a Bearer token in the Authorization header.
Bearer format: API_KEY

---
## web
Web application API operations

### [POST] /audio-to-text
**Convert audio to text**

Convert audio file to text using speech-to-text service.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AudioToTextResponse](#audiototextresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 413 | Audio file too large |  |
| 415 | Unsupported audio type |  |
| 500 | Internal Server Error |  |

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
| last_id | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| pinned | query |  | No | boolean |
| sort_by | query |  | No | string, <br>**Available values:** "-created_at", "-updated_at", "created_at", "updated_at", <br>**Default:** -updated_at |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [ConversationInfiniteScrollPagination](#conversationinfinitescrollpagination)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | App Not Found or Not a Chat App |  |
| 500 | Internal Server Error |  |

### [DELETE] /conversations/{c_id}
Delete a specific conversation.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string (uuid) |

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
| c_id | path | Conversation UUID | Yes | string (uuid) |
| auto_generate | query | Auto-generate conversation name | No | boolean |
| name | query | New conversation name | No | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ConversationRenamePayload](#conversationrenamepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Conversation renamed successfully | **application/json**: [SimpleConversation](#simpleconversation)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Conversation Not Found or Not a Chat App |  |
| 500 | Internal Server Error |  |

### [PATCH] /conversations/{c_id}/pin
Pin a specific conversation to keep it at the top of the list.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string (uuid) |

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
| c_id | path | Conversation UUID | Yes | string (uuid) |

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

Get a human input form definition by token
GET /api/form/human_input/<form_token>

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path | Human input form token | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Form retrieved successfully | **application/json**: [HumanInputFormDefinitionResponse](#humaninputformdefinitionresponse)<br> |
| 403 | Forbidden |  |
| 404 | Form not found |  |
| 412 | Form already submitted or expired |  |
| 429 | Too many requests |  |

### [POST] /form/human_input/{form_token}
**Submit human input form by token**

Submit a human input form by token
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
| form_token | path | Human input form token | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputFormSubmitPayload](#humaninputformsubmitpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Form submitted successfully | **application/json**: [HumanInputFormSubmitResponse](#humaninputformsubmitresponse)<br> |
| 400 | Bad request - invalid submission data |  |
| 404 | Form not found |  |
| 412 | Form already submitted or expired |  |
| 429 | Too many requests |  |

### [POST] /form/human_input/{form_token}/upload-token
**Issue an upload token for a human input form**

Issue an upload token for an active human input form
POST /api/form/human_input/<form_token>/upload-token

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path | Human input form token | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Upload token issued successfully | **application/json**: [HumanInputUploadTokenResponse](#humaninputuploadtokenresponse)<br> |
| 404 | Form not found |  |
| 412 | Form already submitted or expired |  |
| 429 | Too many requests |  |

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

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_code | query | Web app code | No | string |
| user_id | query | End user session ID | No | string |

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
| conversation_id | query | Conversation ID. | Yes | string |
| first_id | query | The ID of the first chat record on the current page. Omit this value to fetch the latest messages; for subsequent pages, use the first message ID from the current list to fetch older messages. | No | string |
| limit | query | Number of chat history messages to return per request. | No | integer, <br>**Default:** 20 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WebMessageInfiniteScrollPagination](#webmessageinfinitescrollpagination)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | Conversation Not Found or Not a Chat App |  |
| 500 | Internal Server Error |  |

### [POST] /messages/{message_id}/feedbacks
Submit feedback (like/dislike) for a specific message.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message UUID | Yes | string (uuid) |
| content | query | Feedback content | No | string |
| rating | query | Feedback rating | No | string, <br>**Available values:** "dislike", "like" |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MessageFeedbackPayload](#messagefeedbackpayload)<br> |

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
| message_id | path |  | Yes | string (uuid) |

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
| message_id | path | Message UUID | Yes | string (uuid) |

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

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AppMetaResponse](#appmetaresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | App Not Found |  |
| 500 | Internal Server Error |  |

### [GET] /parameters
**Retrieve app parameters**

Retrieve the parameters for a specific app.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [Parameters](#parameters)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | App Not Found |  |
| 500 | Internal Server Error |  |

### [GET] /passport
Get authentication passport for web application access

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| user_id | query | End user session ID | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Passport retrieved successfully | **application/json**: [PassportAccessTokenResponse](#passportaccesstokenresponse)<br> |
| 401 | Unauthorized - missing app code or invalid authentication |  |
| 404 | Application or user not found |  |

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

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [RemoteFileUploadPayload](#remotefileuploadpayload)<br> |

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
| last_id | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [SavedMessageInfiniteScrollPagination](#savedmessageinfinitescrollpagination)<br> |
| 400 | Bad Request - Not a completion app |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | App Not Found |  |
| 500 | Internal Server Error |  |

### [POST] /saved-messages
Save a specific message for later reference.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | query | Message UUID to save | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SavedMessageCreatePayload](#savedmessagecreatepayload)<br> |

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
| message_id | path | Message UUID to delete | Yes | string (uuid) |

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

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WebAppSiteResponse](#webappsiteresponse)<br> |
| 400 | Bad Request |  |
| 401 | Unauthorized |  |
| 403 | Forbidden |  |
| 404 | App Not Found |  |
| 500 | Internal Server Error |  |

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

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | SSE event stream | **application/json**: [EventStreamResponse](#eventstreamresponse)<br> |

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

#### AppAccessModeQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| appCode | string | Application code | No |
| appId | string | Application ID | No |

#### AppMetaResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tool_icons | object | Tool icon metadata keyed by tool name | No |

#### AppPermissionQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| appId | string | Application ID | Yes |

#### AudioToTextResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| text | string |  | Yes |

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

#### ButtonStyle

Button styles for user actions.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ButtonStyle | string | Button styles for user actions. |  |

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
| sort_by | string, <br>**Available values:** "-created_at", "-updated_at", "created_at", "updated_at", <br>**Default:** -updated_at | *Enum:* `"-created_at"`, `"-updated_at"`, `"created_at"`, `"updated_at"` | No |

#### ConversationRenamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate | boolean | Automatically generate the conversation name. When `true`, the `name` field is ignored. | No |
| name | string | Conversation name. Required when `auto_generate` is `false`. | No |

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

#### EventStreamResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EventStreamResponse | string |  |  |

#### ExecutionContentType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ExecutionContentType | string |  |  |

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

#### FormInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FormInputConfig | [ParagraphInputConfig](#paragraphinputconfig)<br>[SelectInputConfig](#selectinputconfig)<br>[FileInputConfig](#fileinputconfig)<br>[FileListInputConfig](#filelistinputconfig) |  |  |

#### HumanInputContent

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| form_definition | [HumanInputFormDefinition](#humaninputformdefinition) |  | No |
| form_submission_data | [HumanInputFormSubmissionData](#humaninputformsubmissiondata) |  | No |
| submitted | boolean |  | Yes |
| type | [ExecutionContentType](#executioncontenttype) |  | No |
| workflow_run_id | string |  | Yes |

#### HumanInputFileUploadFormPayload

Parsed multipart form fields for HITL uploads.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string | Remote file URL | No |

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
| expiration_time | integer |  | Yes |
| form_content | string |  | Yes |
| inputs | [ [FormInputConfig](#forminputconfig) ] |  | Yes |
| resolved_default_values | object |  | Yes |
| site | [WebAppSiteResponse](#webappsiteresponse) |  | No |
| user_actions | [ [UserActionConfig](#useractionconfig) ] |  | Yes |

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
| action | string | ID of the action button the recipient selected. Must match one of the `id` values from the form's `user_actions` list. | Yes |
| inputs | object | Submitted human input values keyed by output variable name. Use a string for paragraph or select input values, a file mapping for file inputs, and a list of file mappings for file-list inputs. Local file mappings use `transfer_method=local_file` with `upload_file_id`; remote file mappings use `transfer_method=remote_url` with `url` or `remote_url`. | Yes |

#### HumanInputFormSubmitResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |

#### HumanInputUploadTokenResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| expires_at | integer |  | Yes |
| upload_token | string |  | Yes |

#### JSONObject

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JSONObject | object |  |  |

#### JSONValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JSONValue |  |  |  |

#### JSONValueType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JSONValueType |  |  |  |

#### JsonValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JsonValue |  |  |  |

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

#### LoginStatusQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_code | string | Web app code | No |
| user_id | string | End user session ID | No |

#### LoginStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_logged_in | boolean |  | Yes |
| logged_in | boolean |  | Yes |

#### MessageFeedbackPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Optional text feedback providing additional detail. | No |
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

#### MessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation ID. | Yes |
| first_id | string | The ID of the first chat record on the current page. Omit this value to fetch the latest messages; for subsequent pages, use the first message ID from the current list to fetch older messages. | No |
| limit | integer, <br>**Default:** 20 | Number of chat history messages to return per request. | No |

#### MessageMoreLikeThisQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| response_mode | string, <br>**Available values:** "blocking", "streaming" | Response mode<br>*Enum:* `"blocking"`, `"streaming"` | Yes |

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

#### PassportAccessTokenResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | Yes |

#### PassportQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| user_id | string | End user session ID | No |

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

#### SelectInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| option_source | [StringListSource](#stringlistsource) |  | Yes |
| output_variable_name | string |  | Yes |
| type | string |  | No |

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

#### SimpleFeedback

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| rating | string |  | No |

#### SimpleResultDataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | string |  | Yes |
| result | string |  | Yes |

#### SimpleResultResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| result | string |  | Yes |

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

#### SuggestedQuestionsResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ string ] |  | Yes |

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

#### TextToAudioPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string | Message ID. Takes priority over `text` when both are provided. | No |
| streaming | boolean | Reserved for compatibility; TTS response streaming is determined by the provider output. | No |
| text | string | Speech content to convert. | No |
| voice | string | Voice to use for text-to-speech. Available voices depend on the TTS provider configured for this app. Omit to use the app's configured voice when available; that value is exposed by [Get App Parameters](/api-reference/applications/get-app-parameters) as `text_to_speech.voice`. | No |

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

#### WebAppCustomConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| remove_webapp_brand | boolean |  | Yes |
| replace_webapp_logo | string |  | No |

#### WebAppSiteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |
| can_replace_logo | boolean |  | Yes |
| custom_config | [WebAppCustomConfigResponse](#webappcustomconfigresponse) |  | No |
| enable_site | boolean |  | Yes |
| end_user_id | string |  | No |
| model_config | [WebModelConfigResponse](#webmodelconfigresponse) |  | No |
| plan | string |  | Yes |
| site | [WebSiteResponse](#websiteresponse) |  | Yes |

#### WebMessageInfiniteScrollPagination

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [WebMessageListItem](#webmessagelistitem) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

#### WebMessageListItem

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

#### WebModelConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| model |  |  | No |
| more_like_this |  |  | No |
| opening_statement | string |  | No |
| pre_prompt | string |  | No |
| suggested_questions |  |  | No |
| suggested_questions_after_answer |  |  | No |
| user_input_form |  |  | No |

#### WebSiteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| chat_color_theme | string |  | No |
| chat_color_theme_inverted | boolean |  | Yes |
| copyright | string |  | No |
| custom_disclaimer | string |  | No |
| default_language | string |  | No |
| description | string |  | No |
| icon | string |  | No |
| icon_background | string |  | No |
| icon_type | string |  | No |
| icon_url | string |  | Yes |
| privacy_policy | string |  | No |
| prompt_public | boolean |  | No |
| show_workflow_steps | boolean |  | No |
| title | string |  | Yes |
| use_icon_as_answer_icon | boolean |  | No |

#### WorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] | File list for workflow system file inputs. Available when file upload is enabled for the workflow. To attach a local file, first upload it via [Upload File](/api-reference/files/upload-file) and use the returned `id` as `upload_file_id` with `transfer_method: local_file`. | No |
| inputs | object | Key-value pairs for workflow input variables. Values for file-type variables should be arrays of file objects with `type`, `transfer_method`, and either `url` or `upload_file_id`. Refer to the `user_input_form` field in the [Get App Parameters](/api-reference/applications/get-app-parameters) response to discover the variable names and types expected by your app. | Yes |

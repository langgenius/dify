# Web API
Public APIs for web applications including file uploads, chat interactions, and app management

## Version: 1.0

### Security
**Bearer**  

| apiKey | *API Key* |
| ------ | --------- |
| Description | Type: Bearer {your-api-key} |
| In | header |
| Name | Authorization |

---
## web
Web application API operations

### /audio-to-text

#### POST
##### Summary

Convert audio to text

##### Description

Convert audio file to text using speech-to-text service.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 413 | Audio file too large |
| 415 | Unsupported audio type |
| 500 | Internal Server Error |

### /chat-messages

#### POST
##### Description

Create a chat message for conversational applications.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChatMessagePayload](#chatmessagepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### /chat-messages/{task_id}/stop

#### POST
##### Description

Stop a running chat message task.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Task ID to stop | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Task Not Found |
| 500 | Internal Server Error |

### /completion-messages

#### POST
##### Description

Create a completion message for text generation applications.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [CompletionMessagePayload](#completionmessagepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### /completion-messages/{task_id}/stop

#### POST
##### Description

Stop a running completion message task.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Task ID to stop | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Task Not Found |
| 500 | Internal Server Error |

### /conversations

#### GET
##### Description

Retrieve paginated list of conversations for a chat application.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query | Last conversation ID for pagination | No | string |
| limit | query | Number of conversations to return (1-100) | No | integer |
| pinned | query | Filter by pinned status | No | string |
| sort_by | query | Sort order | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found or Not a Chat App |
| 500 | Internal Server Error |

### /conversations/{c_id}

#### DELETE
##### Description

Delete a specific conversation.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Conversation Not Found or Not a Chat App |
| 500 | Internal Server Error |

### /conversations/{c_id}/name

#### POST
##### Description

Rename a specific conversation with a custom name or auto-generate one.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string |
| auto_generate | query | Auto-generate conversation name | No | boolean |
| name | query | New conversation name | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Conversation renamed successfully |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Conversation Not Found or Not a Chat App |
| 500 | Internal Server Error |

### /conversations/{c_id}/pin

#### PATCH
##### Description

Pin a specific conversation to keep it at the top of the list.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Conversation pinned successfully |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Conversation Not Found or Not a Chat App |
| 500 | Internal Server Error |

### /conversations/{c_id}/unpin

#### PATCH
##### Description

Unpin a specific conversation to remove it from the top of the list.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Conversation unpinned successfully |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Conversation Not Found or Not a Chat App |
| 500 | Internal Server Error |

### /email-code-login

#### POST
##### Description

Send email verification code for login

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EmailCodeLoginSendPayload](#emailcodeloginsendpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Email code sent successfully |
| 400 | Bad request - invalid email format |
| 404 | Account not found |

### /email-code-login/validity

#### POST
##### Description

Verify email code and complete login

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [EmailCodeLoginVerifyPayload](#emailcodeloginverifypayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Email code verified and login successful |
| 400 | Bad request - invalid code or token |
| 401 | Invalid token or expired code |
| 404 | Account not found |

### /files/upload

#### POST
##### Summary

Upload a file for use in web applications

##### Description

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

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | [FileResponse](#fileresponse) |
| 400 | Bad request - invalid file or parameters |  |
| 413 | File too large |  |
| 415 | Unsupported file type |  |

### /forgot-password

#### POST
##### Description

Send password reset email

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ForgotPasswordSendPayload](#forgotpasswordsendpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Password reset email sent successfully |
| 400 | Bad request - invalid email format |
| 404 | Account not found |
| 429 | Too many requests - rate limit exceeded |

### /forgot-password/resets

#### POST
##### Description

Reset user password with verification token

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ForgotPasswordResetPayload](#forgotpasswordresetpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Password reset successfully |
| 400 | Bad request - invalid parameters or password mismatch |
| 401 | Invalid or expired token |
| 404 | Account not found |

### /forgot-password/validity

#### POST
##### Description

Verify password reset token validity

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ForgotPasswordCheckPayload](#forgotpasswordcheckpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Token is valid |
| 400 | Bad request - invalid token format |
| 401 | Invalid or expired token |

### /form/human_input/{form_token}

#### GET
##### Summary

Get human input form definition by token

##### Description

GET /api/form/human_input/<form_token>

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

Submit human input form by token

##### Description

POST /api/form/human_input/<form_token>

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

### /login

#### POST
##### Summary

Authenticate user and login

##### Description

Authenticate user for web application access

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [LoginPayload](#loginpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Authentication successful |
| 400 | Bad request - invalid email or password format |
| 401 | Authentication failed - email or password mismatch |
| 403 | Account banned or login disabled |
| 404 | Account not found |

### /login/status

#### GET
##### Description

Check login status

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Login status |
| 401 | Login status |

### /logout

#### POST
##### Description

Logout user from web application

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Logout successful |

### /messages

#### GET
##### Description

Retrieve paginated list of messages from a conversation in a chat application.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| conversation_id | query | Conversation UUID | Yes | string |
| first_id | query | First message ID for pagination | No | string |
| limit | query | Number of messages to return (1-100) | No | integer |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Conversation Not Found or Not a Chat App |
| 500 | Internal Server Error |

### /messages/{message_id}/feedbacks

#### POST
##### Description

Submit feedback (like/dislike) for a specific message.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message UUID | Yes | string |
| content | query | Feedback content | No | string |
| rating | query | Feedback rating | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Feedback submitted successfully |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Message Not Found |
| 500 | Internal Server Error |

### /messages/{message_id}/more-like-this

#### GET
##### Description

Generate a new completion similar to an existing message (completion apps only).

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path |  | Yes | string |
| payload | body |  | Yes | [MessageMoreLikeThisQuery](#messagemorelikethisquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request - Not a completion app or feature disabled |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Message Not Found |
| 500 | Internal Server Error |

### /messages/{message_id}/suggested-questions

#### GET
##### Description

Get suggested follow-up questions after a message (chat apps only).

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message UUID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request - Not a chat app or feature disabled |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Message Not Found or Conversation Not Found |
| 500 | Internal Server Error |

### /meta

#### GET
##### Summary

Get app meta

##### Description

Retrieve the metadata for a specific app.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### /parameters

#### GET
##### Summary

Retrieve app parameters

##### Description

Retrieve the parameters for a specific app.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### /passport

#### GET
##### Description

Get authentication passport for web application access

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Passport retrieved successfully |
| 401 | Unauthorized - missing app code or invalid authentication |
| 404 | Application or user not found |

### /remote-files/upload

#### POST
##### Summary

Upload a file from a remote URL

##### Description

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

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Remote file uploaded successfully | [FileWithSignedUrl](#filewithsignedurl) |
| 400 | Bad request - invalid URL or parameters |  |
| 413 | File too large |  |
| 415 | Unsupported file type |  |
| 500 | Failed to fetch remote file |  |

### /remote-files/{url}

#### GET
##### Summary

Get information about a remote file

##### Description

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

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| url | path |  | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Remote file information retrieved successfully | [RemoteFileInfo](#remotefileinfo) |
| 400 | Bad request - invalid URL |  |
| 404 | Remote file not found |  |
| 500 | Failed to fetch remote file |  |

### /saved-messages

#### GET
##### Description

Retrieve paginated list of saved messages for a completion application.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| last_id | query | Last message ID for pagination | No | string |
| limit | query | Number of messages to return (1-100) | No | integer |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request - Not a completion app |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

#### POST
##### Description

Save a specific message for later reference.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | query | Message UUID to save | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Message saved successfully |
| 400 | Bad Request - Not a completion app |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Message Not Found |
| 500 | Internal Server Error |

### /saved-messages/{message_id}

#### DELETE
##### Description

Remove a message from saved messages.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message UUID to delete | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Message removed successfully |
| 400 | Bad Request - Not a completion app |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Message Not Found |
| 500 | Internal Server Error |

### /site

#### GET
##### Summary

Retrieve app site info

##### Description

Retrieve app site information and configuration.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### /system-features

#### GET
##### Summary

Get system feature flags and configuration

##### Description

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

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | System features retrieved successfully |
| 500 | Internal server error |

### /text-to-audio

#### POST
##### Summary

Convert text to audio

##### Description

Convert text to audio using text-to-speech service.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TextToAudioPayload](#texttoaudiopayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 500 | Internal Server Error |

### /webapp/access-mode

#### GET
##### Description

Retrieve the access mode for a web application (public or restricted).

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| appCode | query | Application code | No | string |
| appId | query | Application ID | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 500 | Internal Server Error |

### /webapp/permission

#### GET
##### Description

Check if user has permission to access a web application.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| appId | query | Application ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 500 | Internal Server Error |

### /workflows/run

#### POST
##### Summary

Run workflow

##### Description

Execute a workflow with provided inputs and files.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowRunPayload](#workflowrunpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | App Not Found |
| 500 | Internal Server Error |

### /workflows/tasks/{task_id}/stop

#### POST
##### Summary

Stop workflow task

##### Description

Stop a running workflow task.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Task ID to stop | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Task Not Found |
| 500 | Internal Server Error |

---
## default
Default namespace

### /workflow/{task_id}/events

#### GET
##### Summary

Get workflow execution events stream after resume

##### Description

GET /api/workflow/<task_id>/events

Returns Server-Sent Events stream.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

---
### Models

#### AppAccessModeQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| appCode | string | Application code | No |
| appId | string | Application ID | No |

#### ChatMessagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation ID | No |
| files | [ object ] | Files to be processed | No |
| inputs | object | Input variables for the chat | Yes |
| parent_message_id | string | Parent message ID | No |
| query | string | User query/message | Yes |
| response_mode | string | Response mode: blocking or streaming<br>*Enum:* `"blocking"`, `"streaming"` | No |
| retriever_from | string | Source of retriever | No |

#### CompletionMessagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] | Files to be processed | No |
| inputs | object | Input variables for the completion | Yes |
| query | string | Query text for completion | No |
| response_mode | string | Response mode: blocking or streaming<br>*Enum:* `"blocking"`, `"streaming"` | No |
| retriever_from | string | Source of retriever | No |

#### ConversationListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string |  | No |
| limit | integer |  | No |
| pinned | boolean |  | No |
| sort_by | string | *Enum:* `"-created_at"`, `"-updated_at"`, `"created_at"`, `"updated_at"` | No |

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
| size | integer |  | Yes |
| source_url | string |  | No |
| tenant_id | string |  | No |
| user_id | string |  | No |

#### FileWithSignedUrl

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| created_by | string |  | No |
| extension | string |  | No |
| id | string |  | Yes |
| mime_type | string |  | No |
| name | string |  | Yes |
| size | integer |  | Yes |
| url | string |  | No |

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

#### LoginPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| password | string |  | Yes |

#### MessageFeedbackPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | No |
| rating | string | *Enum:* `"dislike"`, `"like"` | No |

#### MessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| conversation_id | string | Conversation UUID | Yes |
| first_id | string | First message ID for pagination | No |
| limit | integer | Number of messages to return (1-100) | No |

#### MessageMoreLikeThisQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| response_mode | string | Response mode<br>*Enum:* `"blocking"`, `"streaming"` | Yes |

#### RemoteFileInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_length | integer |  | Yes |
| file_type | string |  | Yes |

#### RemoteFileUploadPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string (uri) | Remote file URL | Yes |

#### SavedMessageCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string |  | Yes |

#### SavedMessageListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string |  | No |
| limit | integer |  | No |

#### TextToAudioPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string | Message ID | No |
| streaming | boolean | Enable streaming response | No |
| text | string | Text to convert to audio | No |
| voice | string | Voice to use for TTS | No |

#### WorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] |  | No |
| inputs | object |  | Yes |

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
| 400 | Bad Request | **application/json**: [AppUnavailableError](#appunavailableerror)<br>[CompletionRequestError](#completionrequesterror)<br>[ModelCurrentlyNotSupportError](#modelcurrentlynotsupporterror)<br>[NoAudioUploadedError](#noaudiouploadederror)<br>[ProviderNotInitializeError](#providernotinitializeerror)<br>[ProviderNotSupportSpeechToTextError](#providernotsupportspeechtotexterror)<br>[ProviderQuotaExceededError](#providerquotaexceedederror)<br>[SpeechToTextDisabledError](#speechtotextdisablederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 413 | Audio file too large | **application/json**: [AudioTooLargeError](#audiotoolargeerror)<br>[ErrorResponse](#errorresponse)<br> |
| 415 | Unsupported audio type | **application/json**: [UnsupportedAudioTypeError](#unsupportedaudiotypeerror)<br>[ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /chat-messages
Create a chat message for conversational applications.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatMessagePayload](#chatmessagepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | Bad Request | **application/json**: [AgentNotPublishedError](#agentnotpublishederror)<br>[AppUnavailableError](#appunavailableerror)<br>[CompletionRequestError](#completionrequesterror)<br>[ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ConnectionCredentialsInvalidError](#connectioncredentialsinvaliderror)<br>[ConnectionRequiredError](#connectionrequirederror)<br>[ModelCurrentlyNotSupportError](#modelcurrentlynotsupporterror)<br>[NotChatAppError](#notchatapperror)<br>[ProviderNotInitializeError](#providernotinitializeerror)<br>[ProviderQuotaExceededError](#providerquotaexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | App Not Found | **application/json**: [ConnectionNotFoundError](#connectionnotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [ConnectionConflictError](#connectionconflicterror)<br>[ConnectionReauthorizationRequiredError](#connectionreauthorizationrequirederror)<br>[WorkflowChangedError](#workflowchangederror)<br>[ErrorResponse](#errorresponse)<br> |
| 429 | Too Many Requests | **application/json**: [RateLimitError](#ratelimiterror)<br>[ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [ConnectionCredentialsUnavailableError](#connectioncredentialsunavailableerror)<br>[CredentialCheckUnavailableError](#credentialcheckunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [NotChatAppError](#notchatapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Task Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /completion-messages
Create a completion message for text generation applications.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CompletionMessagePayload](#completionmessagepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | Bad Request | **application/json**: [AppUnavailableError](#appunavailableerror)<br>[CompletionRequestError](#completionrequesterror)<br>[ModelCurrentlyNotSupportError](#modelcurrentlynotsupporterror)<br>[NotCompletionAppError](#notcompletionapperror)<br>[ProviderNotInitializeError](#providernotinitializeerror)<br>[ProviderQuotaExceededError](#providerquotaexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | App Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [NotCompletionAppError](#notcompletionapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Task Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /connections
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| cursor | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| provider | query |  | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Personal connections | **application/json**: [EndUserConnectionListResponse](#enduserconnectionlistresponse)<br> |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /connections
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndUserConnectionCreatePayload](#enduserconnectioncreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | API-key connection created | **application/json**: [EndUserConnectionResponse](#enduserconnectionresponse)<br> |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ConnectionCredentialsInvalidError](#connectioncredentialsinvaliderror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [WorkflowChangedError](#workflowchangederror)<br>[ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [ConnectionCredentialsUnavailableError](#connectioncredentialsunavailableerror)<br>[CredentialCheckUnavailableError](#credentialcheckunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /connections/configuration
Read saved App or Conversation choices without validating or refreshing credentials.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| conversation_id | query | Chatflow Conversation to read. If omitted or the Conversation has no saved choices, return the current App user's last choices for form initialization. | No | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Saved Connection configuration | **application/json**: [ConnectionConfigurationResponse](#connectionconfigurationresponse)<br> |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /connections/oauth/authorization-url
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndUserConnectionOAuthPayload](#enduserconnectionoauthpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | OAuth authorization URL | **application/json**: [EndUserConnectionOAuthResponse](#enduserconnectionoauthresponse)<br> |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ConnectionOauthFailedError](#connectionoauthfailederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [ConnectionReauthorizationRequiredError](#connectionreauthorizationrequirederror)<br>[WorkflowChangedError](#workflowchangederror)<br>[ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [ConnectionCredentialsUnavailableError](#connectioncredentialsunavailableerror)<br>[CredentialCheckUnavailableError](#credentialcheckunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /connections/oauth/{provider}/callback
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| provider | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 302 | Redirect to OAuth completion page |  |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ConnectionOauthFailedError](#connectionoauthfailederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Not Found | **application/json**: [ConnectionNotFoundError](#connectionnotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [ConnectionConflictError](#connectionconflicterror)<br>[ConnectionReauthorizationRequiredError](#connectionreauthorizationrequirederror)<br>[WorkflowChangedError](#workflowchangederror)<br>[ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [ConnectionCredentialsUnavailableError](#connectioncredentialsunavailableerror)<br>[CredentialCheckUnavailableError](#credentialcheckunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /connections/preflight
#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndUserConnectionPreflightPayload](#enduserconnectionpreflightpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Explicit connection requirements and readiness | **application/json**: [EndUserConnectionPreflightResponse](#enduserconnectionpreflightresponse)<br> |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [ConnectionConflictError](#connectionconflicterror)<br>[ConnectionReauthorizationRequiredError](#connectionreauthorizationrequirederror)<br>[WorkflowChangedError](#workflowchangederror)<br>[ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [ConnectionCredentialsUnavailableError](#connectioncredentialsunavailableerror)<br>[CredentialCheckUnavailableError](#credentialcheckunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [DELETE] /connections/{connection_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| connection_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 204 | Connection deleted |  |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Not Found | **application/json**: [ConnectionNotFoundError](#connectionnotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [ConnectionConflictError](#connectionconflicterror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /connections/{connection_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| connection_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Personal connection | **application/json**: [EndUserConnectionResponse](#enduserconnectionresponse)<br> |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Not Found | **application/json**: [ConnectionNotFoundError](#connectionnotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [PATCH] /connections/{connection_id}
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| connection_id | path |  | Yes | string (uuid) |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [EndUserConnectionUpdatePayload](#enduserconnectionupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Connection updated | **application/json**: [EndUserConnectionResponse](#enduserconnectionresponse)<br> |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ConnectionCredentialsInvalidError](#connectioncredentialsinvaliderror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Not Found | **application/json**: [ConnectionNotFoundError](#connectionnotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [ConnectionConflictError](#connectionconflicterror)<br>[ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [ConnectionCredentialsUnavailableError](#connectioncredentialsunavailableerror)<br>[CredentialCheckUnavailableError](#credentialcheckunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /connections/{connection_id}/check
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| connection_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Credential check result | **application/json**: [EndUserConnectionCheckResponse](#enduserconnectioncheckresponse)<br> |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Not Found | **application/json**: [ConnectionNotFoundError](#connectionnotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [ConnectionConflictError](#connectionconflicterror)<br>[ConnectionReauthorizationRequiredError](#connectionreauthorizationrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [ConnectionCredentialsUnavailableError](#connectioncredentialsunavailableerror)<br>[CredentialCheckUnavailableError](#credentialcheckunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /connections/{connection_id}/reauthorize
#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| connection_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | OAuth reauthorization URL | **application/json**: [EndUserConnectionOAuthResponse](#enduserconnectionoauthresponse)<br> |
| 400 | Bad Request | **application/json**: [ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ConnectionOauthFailedError](#connectionoauthfailederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Not Found | **application/json**: [ConnectionNotFoundError](#connectionnotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [ConnectionReauthorizationRequiredError](#connectionreauthorizationrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [ConnectionCredentialsUnavailableError](#connectioncredentialsunavailableerror)<br>[CredentialCheckUnavailableError](#credentialcheckunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [NotChatAppError](#notchatapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | App Not Found or Not a Chat App | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [DELETE] /conversations/{c_id}
Delete a specific conversation.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation UUID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 204 | Conversation deleted successfully |  |
| 400 | Bad Request | **application/json**: [NotChatAppError](#notchatapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Conversation Not Found or Not a Chat App | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [NotChatAppError](#notchatapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Conversation Not Found or Not a Chat App | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [NotChatAppError](#notchatapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Conversation Not Found or Not a Chat App | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [NotChatAppError](#notchatapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Conversation Not Found or Not a Chat App | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad request - invalid email format | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [AuthenticationFailedError](#authenticationfailederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Account not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad request - invalid code or token | **application/json**: [AccountBannedError](#accountbannederror)<br>[EmailCodeError](#emailcodeerror)<br>[InvalidEmailError](#invalidemailerror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Invalid token or expired code | **application/json**: [AuthenticationFailedError](#authenticationfailederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Account not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
    BlockedFileExtensionError: File extension is blocked

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileResponse](#fileresponse)<br> |
| 400 | - `no_file_uploaded` : No file was provided in the request. - `too_many_files` : Only one file is allowed per request. - `filename_not_exists_error` : The uploaded file has no filename. - `file_extension_blocked` : The file extension is blocked for security reasons. | **application/json**: [FileExtensionBlockedError](#fileextensionblockederror)<br>[FilenameNotExistsError](#filenamenotexistserror)<br>[NoFileUploadedError](#nofileuploadederror)<br>[TooManyFilesError](#toomanyfileserror)<br>[ErrorResponse](#errorresponse)<br> |
| 413 | `file_too_large` : File size exceeded. | **application/json**: [FileTooLargeError](#filetoolargeerror)<br>[ErrorResponse](#errorresponse)<br> |
| 415 | `unsupported_file_type` : File type not allowed. | **application/json**: [UnsupportedFileTypeError](#unsupportedfiletypeerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad request - invalid email format | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [AuthenticationFailedError](#authenticationfailederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Account not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 429 | Too many requests - rate limit exceeded | **application/json**: [EmailSendIpLimitError](#emailsendiplimiterror)<br>[PasswordResetRateLimitExceededError](#passwordresetratelimitexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad request - invalid parameters or password mismatch | **application/json**: [InvalidOrExpiredTokenError](#invalidorexpiredtokenerror)<br>[PasswordMismatchError](#passwordmismatcherror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Invalid or expired token | **application/json**: [AuthenticationFailedError](#authenticationfailederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Account not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad request - invalid token format | **application/json**: [EmailCodeError](#emailcodeerror)<br>[InvalidEmailError](#invalidemailerror)<br>[InvalidOrExpiredTokenError](#invalidorexpiredtokenerror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Invalid or expired token | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 429 | Too Many Requests | **application/json**: [EmailPasswordResetLimitError](#emailpasswordresetlimiterror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 403 | Forbidden | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Form not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 412 | Form already submitted or expired | **application/json**: [HumanInputFormExpiredError](#humaninputformexpirederror)<br>[HumanInputFormSubmittedError](#humaninputformsubmittederror)<br>[ErrorResponse](#errorresponse)<br> |
| 429 | Too many requests | **application/json**: [WebFormRateLimitExceededError](#webformratelimitexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad request - invalid submission data | **application/json**: [InvalidFormDataError](#invalidformdataerror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Form not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 412 | Form already submitted or expired | **application/json**: [HumanInputFormExpiredError](#humaninputformexpirederror)<br>[HumanInputFormSubmittedError](#humaninputformsubmittederror)<br>[ErrorResponse](#errorresponse)<br> |
| 429 | Too many requests | **application/json**: [WebFormRateLimitExceededError](#webformratelimitexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 404 | Form not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 412 | Form already submitted or expired | **application/json**: [HumanInputFormExpiredError](#humaninputformexpirederror)<br>[HumanInputFormSubmittedError](#humaninputformsubmittederror)<br>[ErrorResponse](#errorresponse)<br> |
| 429 | Too many requests | **application/json**: [WebFormRateLimitExceededError](#webformratelimitexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /human-input-forms/files
**Upload one local file or remote URL file for a HITL human input form**

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileResponse](#fileresponse)<br> |
| 400 | Bad Request | **application/json**: [FileExtensionBlockedError](#fileextensionblockederror)<br>[FilenameNotExistsError](#filenamenotexistserror)<br>[MalformedUploadTokenError](#malformeduploadtokenerror)<br>[NoFileUploadedError](#nofileuploadederror)<br>[RemoteFileAccessDeniedError](#remotefileaccessdeniederror)<br>[RemoteFileInvalidUrlError](#remotefileinvalidurlerror)<br>[RemoteFileUrlBlockedError](#remotefileurlblockederror)<br>[TooManyFilesError](#toomanyfileserror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [UploadTokenRequiredError](#uploadtokenrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 403 | Forbidden | **application/json**: [InvalidUploadTokenError](#invaliduploadtokenerror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Not Found | **application/json**: [RemoteFileNotFoundError](#remotefilenotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 412 | Precondition Failed | **application/json**: [HumanInputFormExpiredError](#humaninputformexpirederror)<br>[HumanInputFormSubmittedError](#humaninputformsubmittederror)<br>[ErrorResponse](#errorresponse)<br> |
| 413 | Request Entity Too Large | **application/json**: [FileTooLargeError](#filetoolargeerror)<br>[ErrorResponse](#errorresponse)<br> |
| 415 | Unsupported Media Type | **application/json**: [UnsupportedFileTypeError](#unsupportedfiletypeerror)<br>[ErrorResponse](#errorresponse)<br> |
| 502 | Bad Gateway | **application/json**: [RemoteFileInvalidResponseError](#remotefileinvalidresponseerror)<br>[RemoteFileUnavailableError](#remotefileunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad request - invalid email or password format | **application/json**: [AccountBannedError](#accountbannederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Authentication failed - email or password mismatch | **application/json**: [AuthenticationFailedError](#authenticationfailederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Account not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /login/status
Check login status

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| app_code | query | Web app code | No | string |
| mode | query | end_user reports actual Account authentication instead of Public App access | No | string, <br>**Available values:** "console", "end_user", <br>**Default:** console |
| user_id | query | End user session ID | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Login status | **application/json**: [LoginStatusResponse](#loginstatusresponse)<br> |
| 401 | Login status | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | App not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 503 | Web app access service unavailable | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /logout
Logout user from web application

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Logout successful | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [NotChatAppError](#notchatapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Conversation Not Found or Not a Chat App | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Message Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /messages/{message_id}/more-like-this
Generate a new completion similar to an existing message (completion apps only).

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| response_mode | query | Response mode | Yes | string, <br>**Available values:** "blocking", "streaming" |
| message_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | Bad Request - Not a completion app or feature disabled | **application/json**: [CompletionRequestError](#completionrequesterror)<br>[ModelCurrentlyNotSupportError](#modelcurrentlynotsupporterror)<br>[NotCompletionAppError](#notcompletionapperror)<br>[ProviderNotInitializeError](#providernotinitializeerror)<br>[ProviderQuotaExceededError](#providerquotaexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 403 | Forbidden | **application/json**: [AppMoreLikeThisDisabledError](#appmorelikethisdisablederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Message Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request - Not a chat app or feature disabled | **application/json**: [CompletionRequestError](#completionrequesterror)<br>[ModelCurrentlyNotSupportError](#modelcurrentlynotsupporterror)<br>[NotChatAppError](#notchatapperror)<br>[ProviderNotInitializeError](#providernotinitializeerror)<br>[ProviderQuotaExceededError](#providerquotaexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 403 | Forbidden | **application/json**: [AppSuggestedQuestionsAfterAnswerDisabledError](#appsuggestedquestionsafteranswerdisablederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Message Not Found or Conversation Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /meta
**Get app meta**

Retrieve the metadata for a specific app.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [AppMetaResponse](#appmetaresponse)<br> |
| 400 | Bad Request | **application/json**: [AppUnavailableError](#appunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | App Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /parameters
**Retrieve app parameters**

Retrieve the parameters for a specific app.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WebAppParametersResponse](#webappparametersresponse)<br> |
| 400 | Bad Request | **application/json**: [AgentNotPublishedError](#agentnotpublishederror)<br>[AppUnavailableError](#appunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | App Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /passport
Get authentication passport for web application access

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| mode | query | end_user reuses Account login; console preserves legacy Web App authentication | No | string, <br>**Available values:** "console", "end_user", <br>**Default:** console |
| user_id | query | End user session ID | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Passport retrieved successfully | **application/json**: [PassportAccessTokenResponse](#passportaccesstokenresponse)<br> |
| 401 | Unauthorized - missing app code or invalid authentication | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Application or user not found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /passport
Redeem a one-use S256 PKCE login code after returning to /webapp-signin. Returns the App Passport and a Web-only login proof for subsequent visits.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| X-App-Code | header | Web app code | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [PassportLoginPayload](#passportloginpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Web login completed | **application/json**: [PassportLoginResponse](#passportloginresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [WebLoginUnavailableError](#webloginunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
    RemoteFileInvalidUrlError: Remote file URL is invalid
    RemoteFileUrlBlockedError: Remote file URL is blocked
    RemoteFileNotFoundError: Remote file does not exist
    RemoteFileAccessDeniedError: Remote file requires authorization
    RemoteFileUnavailableError: Remote file is unavailable
    RemoteFileInvalidResponseError: Remote file response is invalid
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
| 400 | Invalid, blocked, or inaccessible remote file URL | **application/json**: [FileExtensionBlockedError](#fileextensionblockederror)<br>[RemoteFileAccessDeniedError](#remotefileaccessdeniederror)<br>[RemoteFileInvalidUrlError](#remotefileinvalidurlerror)<br>[RemoteFileUrlBlockedError](#remotefileurlblockederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Remote file not found | **application/json**: [RemoteFileNotFoundError](#remotefilenotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 413 | File too large | **application/json**: [FileTooLargeError](#filetoolargeerror)<br>[ErrorResponse](#errorresponse)<br> |
| 415 | Unsupported file type | **application/json**: [UnsupportedFileTypeError](#unsupportedfiletypeerror)<br>[ErrorResponse](#errorresponse)<br> |
| 422 | Request payload validation failed | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal server error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 502 | Remote file unavailable or returned an invalid response | **application/json**: [RemoteFileInvalidResponseError](#remotefileinvalidresponseerror)<br>[RemoteFileUnavailableError](#remotefileunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Invalid, blocked, or inaccessible remote file URL | **application/json**: [RemoteFileAccessDeniedError](#remotefileaccessdeniederror)<br>[RemoteFileInvalidUrlError](#remotefileinvalidurlerror)<br>[RemoteFileUrlBlockedError](#remotefileurlblockederror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | Remote file not found | **application/json**: [RemoteFileNotFoundError](#remotefilenotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 500 | Internal server error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 502 | Remote file unavailable or returned an invalid response | **application/json**: [RemoteFileInvalidResponseError](#remotefileinvalidresponseerror)<br>[RemoteFileUnavailableError](#remotefileunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request - Not a completion app | **application/json**: [NotCompletionAppError](#notcompletionapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | App Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request - Not a completion app | **application/json**: [NotCompletionAppError](#notcompletionapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Message Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [DELETE] /saved-messages/{message_id}
Remove a message from saved messages.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message UUID to delete | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 204 | Message removed successfully |  |
| 400 | Bad Request - Not a completion app | **application/json**: [NotCompletionAppError](#notcompletionapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Message Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /site
**Retrieve app site info**

Retrieve app site information and configuration.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [WebAppSiteResponse](#webappsiteresponse)<br> |
| 400 | Bad Request | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 403 | Forbidden | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | App Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [GET] /system-features
**Get the non-sensitive bootstrap snapshot exposed before authentication**

Get the non-sensitive bootstrap snapshot exposed before Console or Web authentication. This is not a general feature registry.
This endpoint is akin to the `SystemFeatureApi` endpoint in api/controllers/console/feature.py,
except it is intended for use by the web app, instead of the console dashboard.

Authentication configuration must be available before the authentication flow can be selected.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | System features retrieved successfully | **application/json**: [SystemFeatureModel](#systemfeaturemodel)<br> |
| 500 | Internal server error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /text-to-audio
**Convert text to audio**

Convert text to audio using text-to-speech service.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TextToAudioPayload](#texttoaudiopayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success |  |
| 400 | Bad Request | **application/json**: [AppUnavailableError](#appunavailableerror)<br>[CompletionRequestError](#completionrequesterror)<br>[ModelCurrentlyNotSupportError](#modelcurrentlynotsupporterror)<br>[ProviderNotInitializeError](#providernotinitializeerror)<br>[ProviderQuotaExceededError](#providerquotaexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [InvalidParamError](#invalidparamerror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | App Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 503 | Web App Access Service Unavailable | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 503 | Web App Access Service Unavailable | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

### [POST] /workflows/run
**Run workflow**

Execute a workflow with provided inputs and files.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowRunPayload](#workflowrunpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Success | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | Bad Request | **application/json**: [CompletionRequestError](#completionrequesterror)<br>[ConnectionConfigurationInvalidError](#connectionconfigurationinvaliderror)<br>[ConnectionCredentialsInvalidError](#connectioncredentialsinvaliderror)<br>[ConnectionRequiredError](#connectionrequirederror)<br>[ModelCurrentlyNotSupportError](#modelcurrentlynotsupporterror)<br>[NotWorkflowAppError](#notworkflowapperror)<br>[ProviderNotInitializeError](#providernotinitializeerror)<br>[ProviderQuotaExceededError](#providerquotaexceedederror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [EndUserLoginRequiredError](#enduserloginrequirederror)<br>[ErrorResponse](#errorresponse)<br> |
| 403 | Forbidden | **application/json**: [TriggerWorkflowServiceModeUnavailableError](#triggerworkflowservicemodeunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| 404 | App Not Found | **application/json**: [ConnectionNotFoundError](#connectionnotfounderror)<br>[ErrorResponse](#errorresponse)<br> |
| 409 | Conflict | **application/json**: [ConnectionConflictError](#connectionconflicterror)<br>[ConnectionReauthorizationRequiredError](#connectionreauthorizationrequirederror)<br>[WorkflowChangedError](#workflowchangederror)<br>[ErrorResponse](#errorresponse)<br> |
| 429 | Too Many Requests | **application/json**: [RateLimitError](#ratelimiterror)<br>[ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 503 | Service Unavailable | **application/json**: [ConnectionCredentialsUnavailableError](#connectioncredentialsunavailableerror)<br>[CredentialCheckUnavailableError](#credentialcheckunavailableerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [NotWorkflowAppError](#notworkflowapperror)<br>[ErrorResponse](#errorresponse)<br> |
| 401 | Unauthorized | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 404 | Task Not Found | **application/json**: [ErrorResponse](#errorresponse)<br> |
| 500 | Internal Server Error | **application/json**: [ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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
| 400 | Bad Request | **application/json**: [InvalidParamError](#invalidparamerror)<br>[ErrorResponse](#errorresponse)<br> |
| default | Error | **application/json**: [ErrorResponse](#errorresponse)<br> |

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

#### AccountBannedError

Account is banned.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AccountBannedError |  | Account is banned. |  |

#### AgentNotPublishedError

Agent has not been published. Please publish the Agent before using the web app.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AgentNotPublishedError |  | Agent has not been published. Please publish the Agent before using the web app. |  |

#### AgentThought

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer | string |  | No |
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
| tool_labels | [AnyJSONValue](#anyjsonvalue) | Labels for tools used. | Yes |

#### AnyJSONValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AnyJSONValue |  |  |  |

#### AppAccessModeQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| appCode | string | Application code | No |
| appId | string | Application ID | No |

#### AppMetaResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tool_icons | object | Tool icon metadata keyed by tool name | No |

#### AppMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AppMode | string |  |  |

#### AppMoreLikeThisDisabledError

The 'More like this' feature is disabled. Please refresh your page.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AppMoreLikeThisDisabledError |  | The 'More like this' feature is disabled. Please refresh your page. |  |

#### AppPermissionQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| appId | string | Application ID | Yes |

#### AppSuggestedQuestionsAfterAnswerDisabledError

The 'Suggested Questions After Answer' feature is disabled. Please refresh your page.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AppSuggestedQuestionsAfterAnswerDisabledError |  | The 'Suggested Questions After Answer' feature is disabled. Please refresh your page. |  |

#### AppUnavailableError

App unavailable, please check your app configurations.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AppUnavailableError |  | App unavailable, please check your app configurations. |  |

#### AudioToTextResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| text | string |  | Yes |

#### AudioTooLargeError

Audio size exceeded. {message}

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AudioTooLargeError |  | Audio size exceeded. {message} |  |

#### AuthenticationFailedError

Invalid email or password.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| AuthenticationFailedError |  | Invalid email or password. |  |

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
| connections | object | Chatflow choices keyed by independent authorization node ID. Omit on an existing conversation to reuse its last accepted choices. Explicit choices replace the saved configuration after validation. An explicit null, empty map, or missing node does not inherit saved choices. Required for a new conversation with EndUser tool authentication. | No |
| conversation_id | string | Conversation ID | No |
| files | [ object ] | Files to be processed | No |
| inputs | object | Input variables for the chat | Yes |
| parent_message_id | string | Parent message ID | No |
| query | string | User query/message | Yes |
| response_mode | string, <br>**Available values:** "blocking", "streaming" | Response mode: blocking or streaming | No |
| retriever_from | string, <br>**Default:** web_app | Source of retriever | No |
| workflow_id | string | Connections protocol revision from Web App parameters. Required for EndUser tool authentication; must match the current published workflow and does not select an execution version. | No |

#### CompletionMessagePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files | [ object ] | Files to be processed | No |
| inputs | object | Input variables for the completion | Yes |
| query | string | Query text for completion | No |
| response_mode | string, <br>**Available values:** "blocking", "streaming" | Response mode: blocking or streaming | No |
| retriever_from | string, <br>**Default:** web_app | Source of retriever | No |

#### CompletionRequestError

Completion request failed.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| CompletionRequestError |  | Completion request failed. |  |

#### ConnectionConfigurationInvalidError

The connection is not compatible with this tool configuration.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionConfigurationInvalidError |  | The connection is not compatible with this tool configuration. |  |

#### ConnectionConfigurationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| connections | object | Last accepted choices keyed by authorization node ID, not a readiness result. Inaccessible Connection references are returned as null. | Yes |
| workflow_id | string | Workflow of the saved choices; null when no choices remain saved. | Yes |

#### ConnectionConflictError

Connection changed during the operation.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionConflictError |  | Connection changed during the operation. |  |

#### ConnectionCredentialStatus

Last known credential lifecycle state, not readiness for a particular node.

Keep the existing storage values. App-specific Client mismatches and unbinding
must never be written back as a global credential state change.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionCredentialStatus | string | Last known credential lifecycle state, not readiness for a particular node.  Keep the existing storage values. App-specific Client mismatches and unbinding must never be written back as a global credential state change. |  |

#### ConnectionCredentialType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionCredentialType | string |  |  |

#### ConnectionCredentialsInvalidError

Invalid credentials for this provider.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionCredentialsInvalidError |  | Invalid credentials for this provider. |  |

#### ConnectionCredentialsUnavailableError

Connection credentials are temporarily unavailable.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionCredentialsUnavailableError |  | Connection credentials are temporarily unavailable. |  |

#### ConnectionNotFoundError

Connection not found.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionNotFoundError |  | Connection not found. |  |

#### ConnectionOauthFailedError

OAuth authorization could not be completed. Start authorization again.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionOauthFailedError |  | OAuth authorization could not be completed. Start authorization again. |  |

#### ConnectionPreflightRequirement

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed_credential_types | [ [ConnectionCredentialType](#connectioncredentialtype) ] |  | Yes |
| check | [CredentialCheckResult](#credentialcheckresult) |  | Yes |
| connection_id | string |  | Yes |
| node_id | string | Independent authorization node ID to use as the selection key. | Yes |
| node_ids | [ string ] | The authorization node and all nodes explicitly reusing it. | Yes |
| provider | string |  | Yes |
| purpose | string |  | Yes |
| status | [NodeConnectionStatus](#nodeconnectionstatus) | Effective node status; null when availability cannot be determined. | Yes |
| title | string |  | Yes |

#### ConnectionReauthorizationRequiredError

The OAuth client changed or is unavailable. Start authorization again.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionReauthorizationRequiredError |  | The OAuth client changed or is unavailable. Start authorization again. |  |

#### ConnectionRequiredError

Select a connection for every required tool before running.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ConnectionRequiredError |  | Select a connection for every required tool before running. |  |

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

#### CredentialCheckResult

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| checked_at | integer |  | Yes |
| reason_code | string, <br>**Available values:** "credential_expired", "credential_invalid", "credential_revoked", "provider_network_error", "provider_rate_limited", "provider_timeout", "provider_unavailable" |  | Yes |
| retryable | boolean |  | Yes |
| status | string, <br>**Available values:** "invalid", "temporarily_unavailable", "unsupported", "valid" | *Enum:* `"invalid"`, `"temporarily_unavailable"`, `"unsupported"`, `"valid"` | Yes |

#### CredentialCheckUnavailableError

Credential validation is temporarily unavailable.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| CredentialCheckUnavailableError |  | Credential validation is temporarily unavailable. |  |

#### DeploymentEdition

Enum representing the deployment edition of the platform.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| DeploymentEdition | string | Enum representing the deployment edition of the platform. |  |

#### EmailCodeError

Email code is invalid or expired.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EmailCodeError |  | Email code is invalid or expired. |  |

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

#### EmailPasswordResetLimitError

Too many failed password reset attempts. Please try again in 24 hours.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EmailPasswordResetLimitError |  | Too many failed password reset attempts. Please try again in 24 hours. |  |

#### EmailSendIpLimitError

Too many emails have been sent from this IP address recently. Please try again later.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EmailSendIpLimitError |  | Too many emails have been sent from this IP address recently. Please try again later. |  |

#### EndUserConnectionCheckResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| check | [CredentialCheckResult](#credentialcheckresult) |  | Yes |
| connection_id | string |  | Yes |
| credential_status | [ConnectionCredentialStatus](#connectioncredentialstatus) |  | Yes |

#### EndUserConnectionCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | Yes |
| name | string |  | Yes |
| node_id | string |  | Yes |
| workflow_id | string (uuid) | Expected connection contract revision from Web App parameters. | Yes |

#### EndUserConnectionListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| cursor | string |  | No |
| limit | integer, <br>**Default:** 20 |  | No |
| provider | string |  | No |

#### EndUserConnectionListResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [EndUserConnectionResponse](#enduserconnectionresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| next_cursor | string |  | Yes |

#### EndUserConnectionOAuthPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| name | string |  | Yes |
| node_id | string |  | Yes |
| workflow_id | string (uuid) | Expected connection contract revision from Web App parameters. | Yes |

#### EndUserConnectionOAuthResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| authorization_url | string |  | Yes |

#### EndUserConnectionPreflightPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| connections | object | Explicit choices keyed by independent authorization node ID. Missing/null choices remain disconnected; saved choices are never inferred. | Yes |
| conversation_id | string | Existing Chatflow conversation. Omit for a new conversation or plain Workflow. | No |
| workflow_id | string (uuid) | Expected connection contract revision from Web App parameters. Must match the current published workflow; does not select an execution version. | Yes |

#### EndUserConnectionPreflightResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ready | boolean |  | Yes |
| requirements | [ [ConnectionPreflightRequirement](#connectionpreflightrequirement) ] |  | Yes |
| workflow_id | string | Connection contract revision evaluated by this preflight. | Yes |

#### EndUserConnectionResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_label | string |  | Yes |
| created_at | integer |  | Yes |
| credential_status | [ConnectionCredentialStatus](#connectioncredentialstatus) |  | Yes |
| credential_type | [ConnectionCredentialType](#connectioncredentialtype) |  | Yes |
| expires_at | integer |  | Yes |
| id | string |  | Yes |
| last_active_at | integer |  | Yes |
| name | string |  | Yes |
| provider | string |  | Yes |
| updated_at | integer |  | Yes |

#### EndUserConnectionUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credentials | object |  | No |
| name | string |  | No |

#### EndUserLoginRequiredError

Sign in to use personal connections.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EndUserLoginRequiredError |  | Sign in to use personal connections. |  |

#### ErrorResponse

Documented non-2xx body emitted by ``register_external_error_handlers``.

``params`` and ``details`` appear only on the errors that set them. The schema
stays open because ``HTTPException.data`` may carry extra keys.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code | string |  | Yes |
| details | object |  | No |
| message | string |  | Yes |
| params | string |  | No |
| status | integer |  | Yes |

#### EventStreamResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| EventStreamResponse | string |  |  |

#### ExecutionContentType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ExecutionContentType | string |  |  |

#### FileExtensionBlockedError

The file extension is blocked for security reasons.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FileExtensionBlockedError |  | The file extension is blocked for security reasons. |  |

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

#### FileTooLargeError

File size exceeded. {message}

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FileTooLargeError |  | File size exceeded. {message} |  |

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

#### FilenameNotExistsError

The specified filename does not exist.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FilenameNotExistsError |  | The specified filename does not exist. |  |

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

#### GeneratedAppResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| GeneratedAppResponse |  |  |  |

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

#### HumanInputFormExpiredError

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| HumanInputFormExpiredError |  |  |  |

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

#### HumanInputFormSubmittedError

This form has already been submitted by another user, form_id={form_id}

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| HumanInputFormSubmittedError |  | This form has already been submitted by another user, form_id={form_id} |  |

#### HumanInputUploadTokenResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| expires_at | integer |  | Yes |
| upload_token | string |  | Yes |

#### InvalidEmailError

The email address is not valid.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| InvalidEmailError |  | The email address is not valid. |  |

#### InvalidFormDataError

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| InvalidFormDataError |  |  |  |

#### InvalidOrExpiredTokenError

The token is invalid or has expired.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| InvalidOrExpiredTokenError |  | The token is invalid or has expired. |  |

#### InvalidParamError

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| InvalidParamError |  |  |  |

#### InvalidUploadTokenError

Upload token is invalid or expired.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| InvalidUploadTokenError |  | Upload token is invalid or expired. |  |

#### JSONValueType

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JSONValueType |  |  |  |

#### JsonValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JsonValue |  |  |  |

#### KnowledgeFsCitation

Immutable evidence identity; no signed URLs, tokens or storage keys.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| artifact_hash | string |  | Yes |
| control_space_id | string |  | Yes |
| document_asset_id | string |  | Yes |
| document_title | string |  | No |
| document_version | integer |  | No |
| end_offset | integer |  | No |
| id | string |  | Yes |
| node_id | string |  | Yes |
| page_number | integer |  | No |
| parse_artifact_id | string |  | No |
| section_path | [ string ] |  | No |
| space_name | string |  | Yes |
| start_offset | integer |  | No |

#### LicenseStatus

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| LicenseStatus | string |  |  |

#### LicenseStatusModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| status | [LicenseStatus](#licensestatus) |  | Yes |

#### LoginMode

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| LoginMode | string |  |  |

#### LoginPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| email | string |  | Yes |
| password | string |  | Yes |

#### LoginStatusQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_code | string | Web app code | No |
| mode | [LoginMode](#loginmode) | end_user reports actual Account authentication instead of Public App access | No |
| user_id | string | End user session ID | No |

#### LoginStatusResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_logged_in | boolean |  | Yes |
| logged_in | boolean |  | Yes |

#### MalformedUploadTokenError

The upload token is malformed.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| MalformedUploadTokenError |  | The upload token is malformed. |  |

#### MessageFeedbackPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string | Optional text feedback providing additional detail. | No |
| rating | string, <br>**Available values:** "dislike", "like" | Feedback rating. Set to `null` to revoke previously submitted feedback. | No |

#### MessageFile

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| belongs_to | string |  | No |
| filename | string |  | Yes |
| id | string (uuid) |  | Yes |
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

#### ModelCurrentlyNotSupportError

Dify Hosted OpenAI trial currently not support the GPT-4 model.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ModelCurrentlyNotSupportError |  | Dify Hosted OpenAI trial currently not support the GPT-4 model. |  |

#### NoAudioUploadedError

Please upload your audio.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| NoAudioUploadedError |  | Please upload your audio. |  |

#### NoFileUploadedError

Please upload your file.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| NoFileUploadedError |  | Please upload your file. |  |

#### NodeConnectionStatus

The current selection's effective status for one published Tool node.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| NodeConnectionStatus | string | The current selection's effective status for one published Tool node. |  |

#### NotChatAppError

Please check if your app mode matches the right API route.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| NotChatAppError |  | Please check if your app mode matches the right API route. |  |

#### NotCompletionAppError

Please check if your Completion app mode matches the right API route.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| NotCompletionAppError |  | Please check if your Completion app mode matches the right API route. |  |

#### NotWorkflowAppError

Please check if your Workflow app mode matches the right API route.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| NotWorkflowAppError |  | Please check if your Workflow app mode matches the right API route. |  |

#### ParagraphInputConfig

Form input definition.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default | [StringSource](#stringsource) | Raw default-value configuration for the paragraph input. Runtime-resolved values are exposed in the surrounding `resolved_default_values` mapping. | No |
| output_variable_name | string |  | Yes |
| type | string |  | No |

#### PassportAccessTokenResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | Yes |

#### PassportLoginPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| code_verifier | string |  | Yes |
| login_code | string |  | Yes |

#### PassportLoginResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| access_token | string |  | Yes |
| webapp_access_token | string | Web-only login proof for subsequent login-status and Passport requests; never a Console token | Yes |

#### PassportQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| mode | [LoginMode](#loginmode) | end_user reuses Account login; console preserves legacy Web App authentication | No |
| user_id | string | End user session ID | No |

#### PasswordMismatchError

The passwords do not match.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PasswordMismatchError |  | The passwords do not match. |  |

#### PasswordResetRateLimitExceededError

Too many password reset emails have been sent. Please try again in {minutes} minutes.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PasswordResetRateLimitExceededError |  | Too many password reset emails have been sent. Please try again in {minutes} minutes. |  |

#### PluginInstallationPermissionModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| plugin_installation_scope | [PluginInstallationScope](#plugininstallationscope) |  | Yes |
| restrict_to_marketplace_only | boolean |  | Yes |

#### PluginInstallationScope

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| PluginInstallationScope | string |  |  |

#### ProviderNotInitializeError

No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ProviderNotInitializeError |  | No valid model provider credentials found. Please go to Settings -> Model Provider to complete your provider credentials. |  |

#### ProviderNotSupportSpeechToTextError

Provider not support speech to text.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ProviderNotSupportSpeechToTextError |  | Provider not support speech to text. |  |

#### ProviderQuotaExceededError

Your quota for Dify Hosted OpenAI has been exhausted. Please go to Settings -> Model Provider to complete your own provider credentials.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ProviderQuotaExceededError |  | Your quota for Dify Hosted OpenAI has been exhausted. Please go to Settings -> Model Provider to complete your own provider credentials. |  |

#### RateLimitError

Rate Limit Error

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RateLimitError |  | Rate Limit Error |  |

#### RemoteFileAccessDeniedError

The remote file cannot be accessed without authorization.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RemoteFileAccessDeniedError |  | The remote file cannot be accessed without authorization. |  |

#### RemoteFileInfo

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| file_length | integer |  | Yes |
| file_type | string |  | Yes |

#### RemoteFileInvalidResponseError

The remote file server returned an invalid response.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RemoteFileInvalidResponseError |  | The remote file server returned an invalid response. |  |

#### RemoteFileInvalidUrlError

The remote file URL is invalid.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RemoteFileInvalidUrlError |  | The remote file URL is invalid. |  |

#### RemoteFileNotFoundError

The remote file could not be found.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RemoteFileNotFoundError |  | The remote file could not be found. |  |

#### RemoteFileUnavailableError

The remote file is temporarily unavailable.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RemoteFileUnavailableError |  | The remote file is temporarily unavailable. |  |

#### RemoteFileUploadPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string (uri) | Remote file URL | Yes |

#### RemoteFileUrlBlockedError

The remote file URL is not allowed.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| RemoteFileUrlBlockedError |  | The remote file URL is not allowed. |  |

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
| doc_metadata | object |  | No |
| document_asset_id | string |  | No |
| document_id | string |  | No |
| document_name | string |  | No |
| document_revision | integer |  | No |
| document_version | integer |  | No |
| files | [ object ] |  | No |
| hit_count | integer |  | No |
| id | string (uuid) |  | No |
| index_node_hash | string |  | No |
| knowledge_fs_citation | [KnowledgeFsCitation](#knowledgefscitation) |  | No |
| message_id | string (uuid) |  | No |
| page | integer |  | No |
| position | integer |  | Yes |
| retriever_from | string |  | No |
| score | number |  | No |
| segment_id | string |  | No |
| segment_position | integer |  | No |
| summary | string |  | No |
| title | string |  | No |
| word_count | integer |  | No |

#### SSOProtocol

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| SSOProtocol | string |  |  |

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
| option_source | [StringListSource](#stringlistsource) | Source of options for `select` inputs. Present only when `type` is `select`. | Yes |
| output_variable_name | string |  | Yes |
| type | string |  | No |

#### ShallowJSONValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ShallowJSONValue | string<br>integer<br>number<br>boolean<br>object<br>[ object ] |  |  |

#### SimpleConversation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at | integer |  | No |
| id | string (uuid) |  | Yes |
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
| result | string | Operation result. | Yes |

#### SpeechToTextDisabledError

Speech to text is disabled.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| SpeechToTextDisabledError |  | Speech to text is disabled. |  |

#### StringListSource

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| selector | [ string ] | Variable reference path when `type` is `variable`. | No |
| type | [ValueSourceType](#valuesourcetype) | Origin of the options. `constant` means `value` lists the options literally; `variable` means `selector` points to an `array[string]` workflow variable that provides them. | Yes |
| value | [ string ] | Literal option list when `type` is `constant`. | No |

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

Non-sensitive bootstrap snapshot exposed before Console or Web authentication.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| agent_tracing_api_collection_enabled | boolean | Deployment-level API gate for Agent trace collection, independent of workspace and provider configuration. Does not indicate Agent runtime, worker, or provider health or confirm trace delivery. | Yes |
| branding | [BrandingModel](#brandingmodel) |  | Yes |
| deployment_edition | [DeploymentEdition](#deploymentedition) |  | Yes |
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
| enable_step_by_step_tour | boolean |  | Yes |
| is_allow_register | boolean |  | Yes |
| is_email_setup | boolean |  | Yes |
| license | [LicenseStatusModel](#licensestatusmodel) |  | Yes |
| plugin_installation_permission | [PluginInstallationPermissionModel](#plugininstallationpermissionmodel) |  | Yes |
| rbac_enabled | boolean |  | Yes |
| sso_enforced_for_signin | boolean |  | Yes |
| sso_enforced_for_signin_protocol | [SSOProtocol](#ssoprotocol) |  | Yes |
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

#### TooManyFilesError

Only one file is allowed.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TooManyFilesError |  | Only one file is allowed. |  |

#### TriggerWorkflowServiceModeUnavailableError

This workflow uses a trigger entry and cannot be invoked through Web App, Service API, OpenAPI, or MCP.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| TriggerWorkflowServiceModeUnavailableError |  | This workflow uses a trigger entry and cannot be invoked through Web App, Service API, OpenAPI, or MCP. |  |

#### UnsupportedAudioTypeError

Audio type not allowed.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| UnsupportedAudioTypeError |  | Audio type not allowed. |  |

#### UnsupportedFileTypeError

File type not allowed.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| UnsupportedFileTypeError |  | File type not allowed. |  |

#### UploadTokenRequiredError

Upload token is required.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| UploadTokenRequiredError |  | Upload token is required. |  |

#### UserActionConfig

User action configuration.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| button_style | [ButtonStyle](#buttonstyle) |  | No |
| id | string |  | Yes |
| title | string |  | Yes |

#### ValueSourceType

ValueSourceType records whether the value comes from a static setting
in form definition, or a variable while the workflow is running.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| ValueSourceType | string | ValueSourceType records whether the value comes from a static setting in form definition, or a variable while the workflow is running. |  |

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
| allow_public_access | boolean, <br>**Default:** true |  | Yes |
| allow_sso | boolean |  | Yes |
| enabled | boolean |  | Yes |
| sso_config | [WebAppAuthSSOModel](#webappauthssomodel) |  | Yes |

#### WebAppAuthSSOModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| protocol | [SSOProtocol](#ssoprotocol) |  | Yes |

#### WebAppCustomConfigResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| remove_webapp_brand | boolean |  | Yes |
| replace_webapp_logo | string |  | No |

#### WebAppParametersResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| account_login_enabled | boolean | Whether explicit Account login and Passport exchange are enabled. | Yes |
| account_login_url | string | Account-origin sign-in page for the existing Web App login flow | Yes |
| allow_anonymous_end_user_auth | boolean | Whether Guest identities may manage and use personal Connections; does not control App entry. | Yes |
| annotation_reply | { **"enabled"**: boolean } |  | Yes |
| file_upload | { **"allowed_file_extensions"**: [ string ], **"allowed_file_types"**: [ string, <br>**Available values:** "audio", "custom", "document", "image", "video" ], **"allowed_file_upload_methods"**: [ string, <br>**Available values:** "local_file", "remote_url" ], **"enabled"**: boolean, **"image"**: { **"detail"**: string, **"enabled"**: boolean, **"number_limits"**: integer, **"transfer_methods"**: [ string ] }, **"number_limits"**: integer } |  | Yes |
| more_like_this | { **"enabled"**: boolean } |  | Yes |
| opening_statement | string |  | No |
| requires_end_user_connections | boolean | Whether this published version declares EndUser tool connections, independent of user readiness. | Yes |
| retriever_resource | { **"enabled"**: boolean } |  | Yes |
| sensitive_word_avoidance | { **"enabled"**: boolean } |  | Yes |
| speech_to_text | { **"enabled"**: boolean } |  | Yes |
| suggested_questions | [ string ] |  | Yes |
| suggested_questions_after_answer | { **"enabled"**: boolean } |  | Yes |
| system_parameters | [SystemParameters](#systemparameters) | System-level parameter limits. | Yes |
| text_to_speech | { **"autoPlay"**: string, **"enabled"**: boolean, **"language"**: string, **"voice"**: string } |  | Yes |
| user_input_form | [ object<br>object<br>object<br>object<br>object<br>object<br>object<br>object<br>object ] |  | Yes |
| workflow_id | string | Connection contract revision represented by the published workflow/chatflow ID; null for other app modes. This is not an execution-version selector. | Yes |

#### WebAppSiteResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| app_id | string |  | Yes |
| can_replace_logo | boolean |  | Yes |
| custom_config | [WebAppCustomConfigResponse](#webappcustomconfigresponse) |  | No |
| enable_site | boolean |  | Yes |
| end_user_id | string |  | No |
| mode | [AppMode](#appmode) |  | Yes |
| model_config | [WebModelConfigResponse](#webmodelconfigresponse) |  | No |
| plan | string |  | Yes |
| site | [WebSiteResponse](#websiteresponse) |  | Yes |

#### WebFormRateLimitExceededError

Too many form requests. Please try again later.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| WebFormRateLimitExceededError |  | Too many form requests. Please try again later. |  |

#### WebLoginUnavailableError

Web App login is temporarily unavailable. Please retry.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| WebLoginUnavailableError |  | Web App login is temporarily unavailable. Please retry. |  |

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
| answer_tokens | integer |  | No |
| conversation_id | string (uuid) |  | Yes |
| created_at | integer |  | No |
| currency | string |  | No |
| error | string |  | No |
| extra_contents | [ [HumanInputContent](#humaninputcontent) ] |  | Yes |
| feedback | [SimpleFeedback](#simplefeedback) |  | No |
| id | string (uuid) |  | Yes |
| inputs | object |  | Yes |
| message_files | [ [MessageFile](#messagefile) ] |  | Yes |
| message_tokens | integer |  | No |
| metadata | [JSONValueType](#jsonvaluetype) |  | No |
| parent_message_id | string |  | No |
| provider_response_latency | float |  | No |
| query | string |  | Yes |
| retriever_resources | [ [RetrieverResource](#retrieverresource) ] |  | Yes |
| status | string |  | Yes |
| total_price | string |  | No |
| total_tokens | integer |  | Yes |

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
| icon_url | string |  | No |
| input_placeholder | string |  | No |
| privacy_policy | string |  | No |
| prompt_public | boolean |  | No |
| show_workflow_steps | boolean |  | No |
| title | string |  | Yes |
| use_icon_as_answer_icon | boolean |  | No |

#### WorkflowChangedError

The workflow changed. Confirm the connection selection again.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| WorkflowChangedError |  | The workflow changed. Confirm the connection selection again. |  |

#### WorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| connections | object | Explicit choices keyed by independent authorization node ID. Required for EndUser tool authentication. Missing/null choices are not filled from saved selections. | No |
| files | [ object<br>object<br>object<br>object ] | File list for workflow system file inputs. Available when file upload is enabled for the workflow. To attach a local file, first upload it via [Upload File](/api-reference/files/upload-file) and use the returned `id` as `upload_file_id` with `transfer_method: local_file`. | No |
| inputs | object | Key-value pairs for workflow input variables. Values for file-type variables should be arrays of file objects with `type`, `transfer_method`, and either `url` or `upload_file_id`. Refer to the `user_input_form` field in the [Get App Parameters](/api-reference/applications/get-app-parameters) response to discover the variable names and types expected by your app. | Yes |
| workflow_id | string | Connections protocol revision from Web App parameters. Required for EndUser tool authentication; must match the current published workflow and does not select an execution version. | No |

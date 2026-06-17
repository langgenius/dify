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

### [GET] /app/feedbacks
**Get all feedbacks for the application**

Get all feedbacks for the application
Returns paginated list of all feedback submitted for messages in this app.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| limit | query | Number of feedbacks per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Feedbacks retrieved successfully | **application/json**: [AppFeedbackListResponse](#appfeedbacklistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [POST] /apps/annotation-reply/{action}
**Enable or disable annotation reply feature**

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
| 200 | Action completed successfully | **application/json**: [AnnotationJobStatusResponse](#annotationjobstatusresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [GET] /apps/annotation-reply/{action}/status/{job_id}
**Get the status of an annotation reply action job**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action type | Yes | string |
| job_id | path | Job ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Job status retrieved successfully | **application/json**: [AnnotationJobStatusResponse](#annotationjobstatusresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Job not found |  |

### [GET] /apps/annotations
**List annotations for the application**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| keyword | query | Keyword to search annotations | No | string |
| limit | query | Number of annotations per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotations retrieved successfully | **application/json**: [AnnotationList](#annotationlist)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [POST] /apps/annotations
**Create a new annotation**

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AnnotationCreatePayload](#annotationcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Annotation created successfully | **application/json**: [Annotation](#annotation)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [DELETE] /apps/annotations/{annotation_id}
**Delete an annotation**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path | Annotation ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Annotation deleted successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Annotation not found |

### [PUT] /apps/annotations/{annotation_id}
**Update an existing annotation**

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
| 200 | Annotation updated successfully | **application/json**: [Annotation](#annotation)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |
| 404 | Annotation not found |  |

### [POST] /audio-to-text
**Convert audio to text using speech-to-text**

Convert audio to text using speech-to-text
Accepts an audio file upload and returns the transcribed text.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary, **"user"**: string }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Audio successfully transcribed | **application/json**: [AudioTranscriptResponse](#audiotranscriptresponse)<br> |
| 400 | Bad request - no audio or invalid audio |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 413 | Audio file too large |  |
| 415 | Unsupported audio type |  |
| 500 | Internal server error |  |

### [POST] /chat-messages
**Send a message in a chat conversation**

Send a message in a chat conversation
This endpoint handles chat messages for chat, agent chat, and advanced chat applications.
Supports conversation management and both blocking and streaming response modes.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatRequestPayloadWithUser](#chatrequestpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Message sent successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | Bad request - invalid parameters or workflow issues |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Conversation or workflow not found |  |
| 429 | Rate limit exceeded |  |
| 500 | Internal server error |  |

### [POST] /chat-messages/{task_id}/stop
**Stop a running chat message generation**

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
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Task not found |  |

### [POST] /completion-messages
**Create a completion for the given prompt**

Create a completion for the given prompt
This endpoint generates a completion based on the provided inputs and query.
Supports both blocking and streaming response modes.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CompletionRequestPayloadWithUser](#completionrequestpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Completion created successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | Bad request - invalid parameters |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Conversation not found |  |
| 500 | Internal server error |  |

### [POST] /completion-messages/{task_id}/stop
**Stop a running completion task**

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
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Task not found |  |

### [GET] /conversations
**List all conversations for the current user**

List all conversations for the current user
Supports pagination using last_id and limit parameters.

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
| 200 | Conversations retrieved successfully | **application/json**: [ConversationInfiniteScrollPagination](#conversationinfinitescrollpagination)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Last conversation not found |  |

### [DELETE] /conversations/{c_id}
**Delete a specific conversation**

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
| 204 | Conversation deleted successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |
| 404 | Conversation not found |

### [POST] /conversations/{c_id}/name
**Rename a conversation or auto-generate a name**

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
| 200 | Conversation renamed successfully | **application/json**: [SimpleConversation](#simpleconversation)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Conversation not found |  |

### [GET] /conversations/{c_id}/variables
**List all variables for a conversation**

List all variables for a conversation
Conversational variables are only available for chat applications.

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
| 200 | Variables retrieved successfully | **application/json**: [ConversationVariableInfiniteScrollPaginationResponse](#conversationvariableinfinitescrollpaginationresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Conversation not found |  |

### [PUT] /conversations/{c_id}/variables/{variable_id}
**Update a conversation variable's value**

Update a conversation variable's value
Allows updating the value of a specific conversation variable.
The value must match the variable's expected type.

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
| 200 | Variable updated successfully | **application/json**: [ConversationVariableResponse](#conversationvariableresponse)<br> |
| 400 | Bad request - type mismatch |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Conversation or variable not found |  |

### [GET] /datasets
**Resource for getting datasets**

List all datasets

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
| 200 | Datasets retrieved successfully | **application/json**: [DatasetListResponse](#datasetlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets
**Resource for creating datasets**

Create a new dataset

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DatasetCreatePayload](#datasetcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dataset created successfully | **application/json**: [DatasetDetailResponse](#datasetdetailresponse)<br> |
| 400 | Bad request - invalid parameters |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets/pipeline/file-upload
**Upload a file for use in conversations**

Upload a file to a knowledgebase pipeline
Accepts a single file upload via multipart/form-data.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [PipelineUploadFileResponse](#pipelineuploadfileresponse)<br> |
| 400 | Bad request - no file or invalid file |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 413 | File too large |  |
| 415 | Unsupported file type |  |

### [DELETE] /datasets/tags
**Delete a knowledge type tag**

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagDeletePayload](#tagdeletepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Tag deleted successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

### [GET] /datasets/tags
**Get all knowledge type tags**

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tags retrieved successfully | **application/json**: [KnowledgeTagListResponse](#knowledgetaglistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [PATCH] /datasets/tags
Update a knowledge type tag

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagUpdatePayload](#tagupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tag updated successfully | **application/json**: [KnowledgeTagResponse](#knowledgetagresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |

### [POST] /datasets/tags
**Add a knowledge type tag**

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagCreatePayload](#tagcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tag created successfully | **application/json**: [KnowledgeTagResponse](#knowledgetagresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |

### [POST] /datasets/tags/binding
Bind tags to a dataset

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagBindingPayload](#tagbindingpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Tags bound successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

### [POST] /datasets/tags/unbinding
Unbind tags from a dataset

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TagUnbindingPayload](#tagunbindingpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Tags unbound successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

### [DELETE] /datasets/{dataset_id}
**Deletes a dataset given its ID**

Delete a dataset
Args:
    _: ignore
    dataset_id (UUID): The ID of the dataset to be deleted.

Returns:
    dict: A dictionary with a key 'result' and a value 'success'
          if the dataset was successfully deleted. Omitted in HTTP response.
    int: HTTP status code 204 indicating that the operation was successful.

Raises:
    NotFound: If the dataset with the given ID does not exist.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Dataset deleted successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - dataset API access or workspace access denied |
| 404 | Dataset not found |
| 409 | Conflict - dataset is in use |

### [GET] /datasets/{dataset_id}
Get a specific dataset by ID

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Dataset retrieved successfully | **application/json**: [DatasetDetailWithPartialMembersResponse](#datasetdetailwithpartialmembersresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |
| 404 | Dataset not found |  |

### [PATCH] /datasets/{dataset_id}
Update an existing dataset

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
| 200 | Dataset updated successfully | **application/json**: [DatasetDetailWithPartialMembersResponse](#datasetdetailwithpartialmembersresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/document/create-by-file
Create a new document by uploading a file

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
| 200 | Document created successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 400 | Bad request - invalid file or parameters |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets/{dataset_id}/document/create-by-text
Create a new document by providing text content

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

### ~~[POST] /datasets/{dataset_id}/document/create_by_file~~

***DEPRECATED***

Create a new document by uploading a file

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
| 200 | Document created successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 400 | Bad request - invalid file or parameters |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

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

### [GET] /datasets/{dataset_id}/documents
List all documents in a dataset

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
| 200 | Documents retrieved successfully | **application/json**: [DocumentListResponse](#documentlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/documents/download-zip
Download selected uploaded documents as a single ZIP archive

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
| 200 | ZIP archive generated successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Document or dataset not found |

### [POST] /datasets/{dataset_id}/documents/metadata
**Update metadata for multiple documents**

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
| 200 | Documents metadata updated successfully | **application/json**: [DatasetMetadataActionResponse](#datasetmetadataactionresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [PATCH] /datasets/{dataset_id}/documents/status/{action}
**Batch update document status**

Batch update document status
Args:
    tenant_id: tenant id
    dataset_id: dataset id
    action: action to perform (Literal["enable", "disable", "archive", "un_archive"])

Returns:
    dict: A dictionary with a key 'result' and a value 'success'
    int: HTTP status code 200 indicating that the operation was successful.

Raises:
    NotFound: If the dataset with the given ID does not exist.
    Forbidden: If the user does not have permission.
    InvalidActionError: If the action is invalid or cannot be performed.

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
| 400 | Bad request - invalid action |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/documents/{batch}/indexing-status
Get indexing status for documents in a batch

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| batch | path | Batch ID | Yes | string |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Indexing status retrieved successfully | **application/json**: [DocumentStatusListResponse](#documentstatuslistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset or documents not found |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}
**Delete document**

Delete a document

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Document deleted successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - document is archived |
| 404 | Document not found |

### [GET] /datasets/{dataset_id}/documents/{document_id}
Get a specific document by ID

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| metadata | query | Metadata response mode | No | string, <br>**Available values:** "all", "only", "without", <br>**Default:** all |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document retrieved successfully | **application/json**: [DocumentDetailResponse](#documentdetailresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |
| 404 | Document not found |  |

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
Get a signed download URL for a document's original uploaded file

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Download URL generated successfully | **application/json**: [UrlResponse](#urlresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |
| 404 | Document or upload file not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments
List segments in a document

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
| 200 | Segments retrieved successfully | **application/json**: [SegmentListResponse](#segmentlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset or document not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments
Create segments in a document

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
| 200 | Segments created successfully | **application/json**: [SegmentCreateListResponse](#segmentcreatelistresponse)<br> |
| 400 | Bad request - segments data is missing |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset or document not found |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
Delete a specific segment

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
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - dataset API access or workspace access denied |
| 404 | Dataset, document, or segment not found |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
Get a specific segment by ID

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| document_id | path | Document ID | Yes | string (uuid) |
| segment_id | path | Segment ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Segment retrieved successfully | **application/json**: [SegmentDetailResponse](#segmentdetailresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, or segment not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
Update a specific segment

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
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, or segment not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks
List child chunks for a segment

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
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, or segment not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks
Create a new child chunk for a segment

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
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, or segment not found |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}
Delete a specific child chunk

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
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - dataset API access or workspace access denied |
| 404 | Dataset, document, segment, or child chunk not found |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}
Update a specific child chunk

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
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset, document, segment, or child chunk not found |  |

### ~~[POST] /datasets/{dataset_id}/documents/{document_id}/update-by-file~~

***DEPRECATED***

Deprecated legacy alias for updating an existing document by uploading a file. Use PATCH /datasets/{dataset_id}/documents/{document_id} instead.

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

### [POST] /datasets/{dataset_id}/documents/{document_id}/update-by-text
Update an existing document by providing text content

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

### ~~[POST] /datasets/{dataset_id}/documents/{document_id}/update_by_file~~

***DEPRECATED***

Deprecated legacy alias for updating an existing document by uploading a file. Use PATCH /datasets/{dataset_id}/documents/{document_id} instead.

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

### [POST] /datasets/{dataset_id}/hit-testing
**Perform hit testing on a dataset**

Perform hit testing on a dataset
Tests retrieval performance for the specified dataset.

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
| 200 | Hit testing results | **application/json**: [HitTestingResponse](#hittestingresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/metadata
**Get all metadata for a dataset**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Metadata retrieved successfully | **application/json**: [DatasetMetadataListResponse](#datasetmetadatalistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/metadata
**Create metadata for a dataset**

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
| 201 | Metadata created successfully | **application/json**: [DatasetMetadataResponse](#datasetmetadataresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/metadata/built-in
**Get all built-in metadata fields**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Built-in fields retrieved successfully | **application/json**: [DatasetMetadataBuiltInFieldsResponse](#datasetmetadatabuiltinfieldsresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets/{dataset_id}/metadata/built-in/{action}
**Enable or disable built-in metadata field**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform: 'enable' or 'disable' | Yes | string, <br>**Available values:** "disable", "enable" |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Action completed successfully | **application/json**: [DatasetMetadataActionResponse](#datasetmetadataactionresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [DELETE] /datasets/{dataset_id}/metadata/{metadata_id}
**Delete metadata**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |
| metadata_id | path | Metadata ID | Yes | string (uuid) |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Metadata deleted successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - dataset API access or workspace access denied |
| 404 | Dataset or metadata not found |

### [PATCH] /datasets/{dataset_id}/metadata/{metadata_id}
**Update metadata name**

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
| 200 | Metadata updated successfully | **application/json**: [DatasetMetadataResponse](#datasetmetadataresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset or metadata not found |  |

### [GET] /datasets/{dataset_id}/pipeline/datasource-plugins
**Resource for getting datasource plugins**

List all datasource plugins for a rag pipeline

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| is_published | query |  | No | boolean, <br>**Default:** true |
| dataset_id | path |  | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Datasource plugins retrieved successfully | **application/json**: [DatasourcePluginListResponse](#datasourcepluginlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets/{dataset_id}/pipeline/datasource/nodes/{node_id}/run
**Resource for getting datasource plugins**

Run a datasource node for a rag pipeline

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
| 200 | Datasource node run successfully | **text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets/{dataset_id}/pipeline/run
**Resource for running a rag pipeline**

Run a datasource node for a rag pipeline

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
| 200 | Pipeline run successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [POST] /datasets/{dataset_id}/retrieve
**Perform hit testing on a dataset**

Perform hit testing on a dataset
Tests retrieval performance for the specified dataset.

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
| 200 | Hit testing results | **application/json**: [HitTestingResponse](#hittestingresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/tags
**Get all knowledge type tags**

Get tags bound to a specific dataset

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tags retrieved successfully | **application/json**: [DatasetBoundTagListResponse](#datasetboundtaglistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - dataset API access or workspace access denied |  |

### [GET] /end-users/{end_user_id}
**Get end user detail**

Get an end user by ID
This endpoint is scoped to the current app token's tenant/app to prevent
cross-tenant/app access when an end-user ID is known.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| end_user_id | path | End user ID | Yes | string (uuid) |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | End user retrieved successfully | **application/json**: [EndUserDetail](#enduserdetail)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | End user not found |  |

### [POST] /files/upload
**Upload a file for use in conversations**

Upload a file for use in conversations
Accepts a single file upload via multipart/form-data.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **multipart/form-data**: { **"file"**: binary, **"user"**: string }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileResponse](#fileresponse)<br> |
| 400 | Bad request - no file or invalid file |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 413 | File too large |  |
| 415 | Unsupported file type |  |

### [GET] /files/{file_id}/preview
**Preview/Download a file that was uploaded via Service API**

Preview or download a file uploaded via Service API
Provides secure file preview/download functionality.
Files can only be accessed if they belong to messages within the requesting app's context.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| file_id | path | UUID of the file to preview | Yes | string (uuid) |
| as_attachment | query | Download as attachment | No | boolean |
| user | query | End user identifier | No | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | File retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - file access denied |
| 404 | File not found |

### [GET] /form/human_input/{form_token}
Get a paused human input form by token

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path | Human input form token | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Form retrieved successfully | **application/json**: [HumanInputFormDefinitionResponse](#humaninputformdefinitionresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Form not found |  |
| 412 | Form already submitted or expired |  |

### [POST] /form/human_input/{form_token}
Submit a paused human input form by token

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
| 200 | Form submitted successfully | **application/json**: [HumanInputFormSubmitResponse](#humaninputformsubmitresponse)<br> |
| 400 | Bad request - invalid submission data |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Form not found |  |
| 412 | Form already submitted or expired |  |

### [GET] /info
**Get app information**

Get basic application information
Returns basic information about the application including name, description, tags, and mode.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Application info retrieved successfully | **application/json**: [AppInfoResponse](#appinforesponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Application not found |  |

### [GET] /messages
**List messages in a conversation**

List messages in a conversation
Retrieves messages with pagination support using first_id.

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
| 200 | Messages retrieved successfully | **application/json**: [MessageInfiniteScrollPagination](#messageinfinitescrollpagination)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Conversation or first message not found |  |

### [POST] /messages/{message_id}/feedbacks
**Submit feedback for a message**

Submit feedback for a message
Allows users to rate messages as like/dislike and provide optional feedback content.

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
| 404 | Message not found |  |

### [GET] /messages/{message_id}/suggested
**Get suggested follow-up questions for a message**

Get suggested follow-up questions for a message
Returns AI-generated follow-up questions based on the message content.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message ID | Yes | string (uuid) |
| user | query | End user identifier | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Suggested questions retrieved successfully | **application/json**: [SimpleResultStringListResponse](#simpleresultstringlistresponse)<br> |
| 400 | Suggested questions feature is disabled |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Message not found |  |
| 500 | Internal server error |  |

### [GET] /meta
**Get app metadata**

Get application metadata
Returns metadata about the application including configuration and settings.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Metadata retrieved successfully | **application/json**: [AppMetaResponse](#appmetaresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Application not found |  |

### [GET] /parameters
**Retrieve app parameters**

Retrieve application input parameters and configuration
Returns the input form parameters and configuration for the application.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Parameters retrieved successfully | **application/json**: [Parameters](#parameters)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Application not found |  |

### [GET] /site
**Retrieve app site info**

Get application site configuration
Returns the site configuration for the application including theme, icons, and text.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Site configuration retrieved successfully | **application/json**: [Site](#site)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - site not found or tenant archived |  |

### [POST] /text-to-audio
**Convert text to audio using text-to-speech**

Convert text to audio using text-to-speech
Converts the provided text to audio using the specified voice.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [TextToAudioPayloadWithUser](#texttoaudiopayloadwithuser)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Text successfully converted to audio |
| 400 | Bad request - invalid parameters |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |
| 500 | Internal server error |

### [GET] /workflow/{task_id}/events
Get workflow execution events stream after resume

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
| 200 | SSE event stream | **text/event-stream**: [EventStreamResponse](#eventstreamresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Workflow run not found |  |

### [GET] /workflows/logs
**Get workflow app logs**

Get workflow execution logs
Returns paginated workflow execution logs with filtering options.

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
| 200 | Logs retrieved successfully | **application/json**: [WorkflowAppLogPaginationResponse](#workflowapplogpaginationresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |

### [POST] /workflows/run
**Execute a workflow**

Execute a workflow
Runs a workflow with the provided inputs and returns the results.
Supports both blocking and streaming response modes.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowRunPayloadWithUser](#workflowrunpayloadwithuser)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow executed successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | Bad request - invalid parameters or workflow issues |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Workflow not found |  |
| 429 | Rate limit exceeded |  |
| 500 | Internal server error |  |

### [GET] /workflows/run/{workflow_run_id}
**Get a workflow task running detail**

Get workflow run details
Returns detailed information about a specific workflow run.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_run_id | path | Workflow run ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run details retrieved successfully | **application/json**: [WorkflowRunResponse](#workflowrunresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Workflow run not found |  |

### [POST] /workflows/tasks/{task_id}/stop
**Stop a running workflow task**

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
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Task not found |  |

### [POST] /workflows/{workflow_id}/run
**Run specific workflow by ID**

Execute a specific workflow by ID
Executes a specific workflow version identified by its ID.

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
| 200 | Workflow executed successfully | **application/json**: [GeneratedAppResponse](#generatedappresponse)<br>**text/event-stream**: [GeneratedAppResponse](#generatedappresponse)<br> |
| 400 | Bad request - invalid parameters or workflow issues |  |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - token scope, app, dataset, or workspace access denied |  |
| 404 | Workflow not found |  |
| 429 | Rate limit exceeded |  |
| 500 | Internal server error |  |

### [GET] /workspaces/current/models/model-types/{model_type}
**Get available models by model type**

Get available models by model type
Returns a list of available models for the specified model type.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | path | Type of model to retrieve | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Models retrieved successfully | **application/json**: [ProviderWithModelsListResponse](#providerwithmodelslistresponse)<br> |
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
| streaming | boolean | Enable streaming response | No |
| text | string | Text to convert to audio | No |
| voice | string | Voice to use for TTS | No |

#### TextToAudioPayloadWithUser

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| message_id | string | Message ID | No |
| streaming | boolean | Enable streaming response | No |
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

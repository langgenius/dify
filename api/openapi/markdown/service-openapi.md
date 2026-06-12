# Service API
API for application services

## Version: 1.0

### Available authorizations
#### Bearer (API Key Authentication)
Type: Bearer {your-api-key}  
**Name:** Authorization  
**In:** header  

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

| Code | Description |
| ---- | ----------- |
| 200 | Feedbacks retrieved successfully |
| 401 | Unauthorized - invalid API token |

### [POST] /apps/annotation-reply/{action}
**Enable or disable annotation reply feature**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform: 'enable' or 'disable' | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [AnnotationReplyActionPayload](#annotationreplyactionpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Action completed successfully |
| 401 | Unauthorized - invalid API token |

### [GET] /apps/annotation-reply/{action}/status/{job_id}
**Get the status of an annotation reply action job**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action type | Yes | string |
| job_id | path | Job ID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Job status retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Job not found |

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

### [DELETE] /apps/annotations/{annotation_id}
**Delete an annotation**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path | Annotation ID | Yes | string |

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
| annotation_id | path | Annotation ID | Yes | string |

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

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Audio successfully transcribed |
| 400 | Bad request - no audio or invalid audio |
| 401 | Unauthorized - invalid API token |
| 413 | Audio file too large |
| 415 | Unsupported audio type |
| 500 | Internal server error |

### [POST] /chat-messages
**Send a message in a chat conversation**

Send a message in a chat conversation
This endpoint handles chat messages for chat, agent chat, and advanced chat applications.
Supports conversation management and both blocking and streaming response modes.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChatRequestPayload](#chatrequestpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Message sent successfully |
| 400 | Bad request - invalid parameters or workflow issues |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation or workflow not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

### [POST] /chat-messages/{task_id}/stop
**Stop a running chat message generation**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | The ID of the task to stop | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Task not found |  |

### [POST] /completion-messages
**Create a completion for the given prompt**

Create a completion for the given prompt
This endpoint generates a completion based on the provided inputs and query.
Supports both blocking and streaming response modes.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [CompletionRequestPayload](#completionrequestpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Completion created successfully |
| 400 | Bad request - invalid parameters |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation not found |
| 500 | Internal server error |

### [POST] /completion-messages/{task_id}/stop
**Stop a running completion task**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | The ID of the task to stop | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
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

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Conversations retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Last conversation not found |

### [DELETE] /conversations/{c_id}
**Delete a specific conversation**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation ID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation not found |

### [POST] /conversations/{c_id}/name
**Rename a conversation or auto-generate a name**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ConversationRenamePayload](#conversationrenamepayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Conversation renamed successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation not found |

### [GET] /conversations/{c_id}/variables
**List all variables for a conversation**

List all variables for a conversation
Conversational variables are only available for chat applications.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation ID | Yes | string |
| last_id | query | Last variable ID for pagination | No | string |
| limit | query | Number of variables to return | No | integer, <br>**Default:** 20 |
| variable_name | query | Filter variables by name | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variables retrieved successfully | **application/json**: [ConversationVariableInfiniteScrollPaginationResponse](#conversationvariableinfinitescrollpaginationresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Conversation not found |  |

### [PUT] /conversations/{c_id}/variables/{variable_id}
**Update a conversation variable's value**

Update a conversation variable's value
Allows updating the value of a specific conversation variable.
The value must match the variable's expected type.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation ID | Yes | string |
| variable_id | path | Variable ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ConversationVariableUpdatePayload](#conversationvariableupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable updated successfully | **application/json**: [ConversationVariableResponse](#conversationvariableresponse)<br> |
| 400 | Bad request - type mismatch |  |
| 401 | Unauthorized - invalid API token |  |
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

### [POST] /datasets/pipeline/file-upload
**Upload a file for use in conversations**

Upload a file to a knowledgebase pipeline
Accepts a single file upload via multipart/form-data.

#### Responses

| Code | Description |
| ---- | ----------- |
| 201 | File uploaded successfully |
| 400 | Bad request - no file or invalid file |
| 401 | Unauthorized - invalid API token |
| 413 | File too large |
| 415 | Unsupported file type |

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
| dataset_id | path | Dataset ID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Dataset deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset not found |
| 409 | Conflict - dataset is in use |

### [GET] /datasets/{dataset_id}
Get a specific dataset by ID

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

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
| dataset_id | path | Dataset ID | Yes | string |

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
| dataset_id | path | Dataset ID | Yes | string |

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

### [POST] /datasets/{dataset_id}/document/create-by-text
Create a new document by providing text content

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

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

### [POST] /datasets/{dataset_id}/document/create_by_file
Create a new document by uploading a file

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

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

### ~~[POST] /datasets/{dataset_id}/document/create_by_text~~

***DEPRECATED***

Deprecated legacy alias for creating a new document by providing text content. Use /datasets/{dataset_id}/document/create-by-text instead.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

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

### [GET] /datasets/{dataset_id}/documents
List all documents in a dataset

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| keyword | query | Search keyword | No | string |
| limit | query | Number of items per page | No | integer, <br>**Default:** 20 |
| page | query | Page number | No | integer, <br>**Default:** 1 |
| status | query | Document status filter | No | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Documents retrieved successfully | **application/json**: [DocumentListResponse](#documentlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/documents/download-zip
Download selected uploaded documents as a single ZIP archive

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

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
| dataset_id | path | Dataset ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MetadataOperationData](#metadataoperationdata)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Documents metadata updated successfully | **application/json**: [DatasetMetadataActionResponse](#datasetmetadataactionresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
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
| action | path | Action to perform: 'enable', 'disable', 'archive', or 'un_archive' | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |

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
| dataset_id | path | Dataset ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Indexing status retrieved successfully | **application/json**: [DocumentStatusListResponse](#documentstatuslistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset or documents not found |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}
**Delete document**

Delete a document

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

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
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Document not found |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}
Update an existing document by uploading a file

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  No | **multipart/form-data**: { **"data"**: string, **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Document not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/download
Get a signed download URL for a document's original uploaded file

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

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
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| keyword | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |
| status | query |  | No | [ string ] |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Segments retrieved successfully | **application/json**: [SegmentListResponse](#segmentlistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset or document not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments
Create segments in a document

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

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
| 404 | Dataset or document not found |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
Delete a specific segment

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Segment ID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Segment deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset, document, or segment not found |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
Get a specific segment by ID

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Segment ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Segment retrieved successfully | **application/json**: [SegmentDetailResponse](#segmentdetailresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset, document, or segment not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}
Update a specific segment

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Segment ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [SegmentUpdatePayload](#segmentupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Segment updated successfully | **application/json**: [SegmentDetailResponse](#segmentdetailresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset, document, or segment not found |  |

### [GET] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks
List child chunks for a segment

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Parent segment ID | Yes | string |
| keyword | query |  | No | string |
| limit | query |  | No | integer, <br>**Default:** 20 |
| page | query |  | No | integer, <br>**Default:** 1 |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Child chunks retrieved successfully | **application/json**: [ChildChunkListResponse](#childchunklistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset, document, or segment not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks
Create a new child chunk for a segment

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Parent segment ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChildChunkCreatePayload](#childchunkcreatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Child chunk created successfully | **application/json**: [ChildChunkDetailResponse](#childchunkdetailresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset, document, or segment not found |  |

### [DELETE] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}
Delete a specific child chunk

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| child_chunk_id | path | Child chunk ID | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Parent segment ID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Child chunk deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset, document, segment, or child chunk not found |

### [PATCH] /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}
Update a specific child chunk

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| child_chunk_id | path | Child chunk ID | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Parent segment ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [ChildChunkUpdatePayload](#childchunkupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Child chunk updated successfully | **application/json**: [ChildChunkDetailResponse](#childchunkdetailresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset, document, segment, or child chunk not found |  |

### ~~[POST] /datasets/{dataset_id}/documents/{document_id}/update-by-file~~

***DEPRECATED***

Deprecated legacy alias for updating an existing document by uploading a file. Use PATCH /datasets/{dataset_id}/documents/{document_id} instead.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  No | **multipart/form-data**: { **"data"**: string, **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Document not found |  |

### [POST] /datasets/{dataset_id}/documents/{document_id}/update-by-text
Update an existing document by providing text content

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentTextUpdate](#documenttextupdate)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Document not found |  |

### ~~[POST] /datasets/{dataset_id}/documents/{document_id}/update_by_file~~

***DEPRECATED***

Deprecated legacy alias for updating an existing document by uploading a file. Use PATCH /datasets/{dataset_id}/documents/{document_id} instead.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  No | **multipart/form-data**: { **"data"**: string, **"file"**: binary }<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Document not found |  |

### ~~[POST] /datasets/{dataset_id}/documents/{document_id}/update_by_text~~

***DEPRECATED***

Deprecated legacy alias for updating an existing document by providing text content. Use /datasets/{dataset_id}/documents/{document_id}/update-by-text instead.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [DocumentTextUpdate](#documenttextupdate)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Document updated successfully | **application/json**: [DocumentAndBatchResponse](#documentandbatchresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Document not found |  |

### [POST] /datasets/{dataset_id}/hit-testing
**Perform hit testing on a dataset**

Perform hit testing on a dataset
Tests retrieval performance for the specified dataset.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HitTestingPayload](#hittestingpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Hit testing results | **application/json**: [HitTestingResponse](#hittestingresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/metadata
**Get all metadata for a dataset**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Metadata retrieved successfully | **application/json**: [DatasetMetadataListResponse](#datasetmetadatalistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset not found |  |

### [POST] /datasets/{dataset_id}/metadata
**Create metadata for a dataset**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MetadataArgs](#metadataargs)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Metadata created successfully | **application/json**: [DatasetMetadataResponse](#datasetmetadataresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/metadata/built-in
**Get all built-in metadata fields**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Built-in fields retrieved successfully | **application/json**: [DatasetMetadataBuiltInFieldsResponse](#datasetmetadatabuiltinfieldsresponse)<br> |
| 401 | Unauthorized - invalid API token |  |

### [POST] /datasets/{dataset_id}/metadata/built-in/{action}
**Enable or disable built-in metadata field**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform: 'enable' or 'disable' | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Action completed successfully | **application/json**: [DatasetMetadataActionResponse](#datasetmetadataactionresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset not found |  |

### [DELETE] /datasets/{dataset_id}/metadata/{metadata_id}
**Delete metadata**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| metadata_id | path | Metadata ID | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Metadata deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset or metadata not found |

### [PATCH] /datasets/{dataset_id}/metadata/{metadata_id}
**Update metadata name**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| metadata_id | path | Metadata ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MetadataUpdatePayload](#metadataupdatepayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Metadata updated successfully | **application/json**: [DatasetMetadataResponse](#datasetmetadataresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset or metadata not found |  |

### [GET] /datasets/{dataset_id}/pipeline/datasource-plugins
**Resource for getting datasource plugins**

List all datasource plugins for a rag pipeline

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| is_published | query | Whether to get published or draft datasource plugins (true for published, false for draft, default: true) | No | string |
| dataset_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Datasource plugins retrieved successfully |
| 401 | Unauthorized - invalid API token |

### [POST] /datasets/{dataset_id}/pipeline/datasource/nodes/{node_id}/run
**Resource for getting datasource plugins**

Run a datasource node for a rag pipeline

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| node_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Datasource node run successfully |
| 401 | Unauthorized - invalid API token |

### [POST] /datasets/{dataset_id}/pipeline/run
**Resource for running a rag pipeline**

Run a datasource node for a rag pipeline

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Pipeline run successfully |
| 401 | Unauthorized - invalid API token |

### [POST] /datasets/{dataset_id}/retrieve
**Perform hit testing on a dataset**

Perform hit testing on a dataset
Tests retrieval performance for the specified dataset.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HitTestingPayload](#hittestingpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Hit testing results | **application/json**: [HitTestingResponse](#hittestingresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Dataset not found |  |

### [GET] /datasets/{dataset_id}/tags
**Get all knowledge type tags**

Get tags bound to a specific dataset

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Tags retrieved successfully | **application/json**: [DatasetBoundTagListResponse](#datasetboundtaglistresponse)<br> |
| 401 | Unauthorized - invalid API token |  |

### [GET] /end-users/{end_user_id}
**Get end user detail**

Get an end user by ID
This endpoint is scoped to the current app token's tenant/app to prevent
cross-tenant/app access when an end-user ID is known.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| end_user_id | path | End user ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | End user retrieved successfully | **application/json**: [EndUserDetail](#enduserdetail)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | End user not found |  |

### [POST] /files/upload
**Upload a file for use in conversations**

Upload a file for use in conversations
Accepts a single file upload via multipart/form-data.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | **application/json**: [FileResponse](#fileresponse)<br> |
| 400 | Bad request - no file or invalid file |  |
| 401 | Unauthorized - invalid API token |  |
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
| file_id | path | UUID of the file to preview | Yes | string |
| as_attachment | query | Download as attachment | No | boolean |

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

| Code | Description |
| ---- | ----------- |
| 200 | Form retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Form not found |
| 412 | Form already submitted or expired |

### [POST] /form/human_input/{form_token}
Submit a paused human input form by token

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path | Human input form token | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [HumanInputFormSubmitPayload](#humaninputformsubmitpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Form submitted successfully |
| 400 | Bad request - invalid submission data |
| 401 | Unauthorized - invalid API token |
| 404 | Form not found |
| 412 | Form already submitted or expired |

### [GET] /info
**Get app information**

Get basic application information
Returns basic information about the application including name, description, tags, and mode.

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Application info retrieved successfully | **application/json**: [AppInfoResponse](#appinforesponse)<br> |
| 401 | Unauthorized - invalid API token |  |
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

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Messages retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation or first message not found |

### [POST] /messages/{message_id}/feedbacks
**Submit feedback for a message**

Submit feedback for a message
Allows users to rate messages as like/dislike and provide optional feedback content.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message ID | Yes | string |

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [MessageFeedbackPayload](#messagefeedbackpayload)<br> |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Feedback submitted successfully | **application/json**: [ResultResponse](#resultresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
| 404 | Message not found |  |

### [GET] /messages/{message_id}/suggested
**Get suggested follow-up questions for a message**

Get suggested follow-up questions for a message
Returns AI-generated follow-up questions based on the message content.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message ID | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Suggested questions retrieved successfully | **application/json**: [SimpleResultStringListResponse](#simpleresultstringlistresponse)<br> |
| 400 | Suggested questions feature is disabled |  |
| 401 | Unauthorized - invalid API token |  |
| 404 | Message not found |  |
| 500 | Internal server error |  |

### [GET] /meta
**Get app metadata**

Get application metadata
Returns metadata about the application including configuration and settings.

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Metadata retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Application not found |

### [GET] /parameters
**Retrieve app parameters**

Retrieve application input parameters and configuration
Returns the input form parameters and configuration for the application.

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Parameters retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Application not found |

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
|  Yes | **application/json**: [TextToAudioPayload](#texttoaudiopayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Text successfully converted to audio |
| 400 | Bad request - invalid parameters |
| 401 | Unauthorized - invalid API token |
| 500 | Internal server error |

### [GET] /workflow/{task_id}/events
Get workflow execution events stream after resume

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Workflow run ID | Yes | string |
| continue_on_pause | query | Whether to keep the stream open across workflow_paused events,specify `"true"` to keep the stream open for `workflow_paused` events. | No | string |
| include_state_snapshot | query | Whether to replay from persisted state snapshot, specify `"true"` to include a status snapshot of executed nodes | No | string |
| user | query | End user identifier (query param) | No | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | SSE event stream |
| 401 | Unauthorized - invalid API token |
| 404 | Workflow run not found |

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

### [POST] /workflows/run
**Execute a workflow**

Execute a workflow
Runs a workflow with the provided inputs and returns the results.
Supports both blocking and streaming response modes.

#### Request Body

| Required | Schema |
| -------- | ------ |
|  Yes | **application/json**: [WorkflowRunPayload](#workflowrunpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow executed successfully |
| 400 | Bad request - invalid parameters or workflow issues |
| 401 | Unauthorized - invalid API token |
| 404 | Workflow not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

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
| 404 | Workflow run not found |  |

### [POST] /workflows/tasks/{task_id}/stop
**Stop a running workflow task**

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Task ID to stop | Yes | string |

#### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Task stopped successfully | **application/json**: [SimpleResultResponse](#simpleresultresponse)<br> |
| 401 | Unauthorized - invalid API token |  |
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
|  Yes | **application/json**: [WorkflowRunPayload](#workflowrunpayload)<br> |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow executed successfully |
| 400 | Bad request - invalid parameters or workflow issues |
| 401 | Unauthorized - invalid API token |
| 404 | Workflow not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

### [GET] /workspaces/current/models/model-types/{model_type}
**Get available models by model type**

Get available models by model type
Returns a list of available models for the specified model type.

#### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | path | Type of model to retrieve | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Models retrieved successfully |
| 401 | Unauthorized - invalid API token |

---
### Schemas

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

#### AppInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| author_name | string |  | Yes |
| description | string |  | Yes |
| mode | string |  | Yes |
| name | string |  | Yes |
| tags | [ string ] |  | Yes |

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

#### Condition

Condition detail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| comparison_operator | string, <br>**Available values:** "<", "=", ">", "after", "before", "contains", "empty", "end with", "in", "is", "is not", "not contains", "not empty", "not in", "start with", "≠", "≤", "≥" | *Enum:* `"<"`, `"="`, `">"`, `"after"`, `"before"`, `"contains"`, `"empty"`, `"end with"`, `"in"`, `"is"`, `"is not"`, `"not contains"`, `"not empty"`, `"not in"`, `"start with"`, `"≠"`, `"≤"`, `"≥"` | Yes |
| name | string |  | Yes |
| value | string<br>[ string ]<br>integer<br>number |  | No |

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

#### ConversationVariablesQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id | string | Last variable ID for pagination | No |
| limit | integer, <br>**Default:** 20 | Number of variables to return | No |
| variable_name | string | Filter variables by name | No |

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

#### DatasourceNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id | string |  | No |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |
| is_published | boolean |  | Yes |

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

#### FeedbackListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer, <br>**Default:** 20 | Number of feedbacks per page | No |
| page | integer, <br>**Default:** 1 | Page number | No |

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

#### HumanInputFormSubmitPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string |  | Yes |
| inputs | object | Submitted human input values keyed by output variable name. Use a string for paragraph or select input values, a file mapping for file inputs, and a list of file mappings for file-list inputs. Local file mappings use `transfer_method=local_file` with `upload_file_id`; remote file mappings use `transfer_method=remote_url` with `url` or `remote_url`. | Yes |

#### IndexInfoResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| api_version | string |  | Yes |
| server_version | string |  | Yes |
| welcome | string |  | Yes |

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
| session_id | string |  | No |
| type | string |  | Yes |

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

Accept the legacy single-tag Service API payload while exposing a normalized tag_ids list internally.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| tag_id | string |  | No |
| tag_ids | [ string ] |  | No |
| target_id | string |  | Yes |

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

#### UrlResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| url | string |  | Yes |

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

# Service API
API for application services

## Version: 1.0

### Security
**Bearer**  

| apiKey | *API Key* |
| ------ | --------- |
| Description | Type: Bearer {your-api-key} |
| In | header |
| Name | Authorization |

---
## service_api
Service operations

### /

#### GET
##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success |

### /app/feedbacks

#### GET
##### Summary

Get all feedbacks for the application

##### Description

Get all feedbacks for the application
Returns paginated list of all feedback submitted for messages in this app.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [FeedbackListQuery](#feedbacklistquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Feedbacks retrieved successfully |
| 401 | Unauthorized - invalid API token |

### /apps/annotation-reply/{action}

#### POST
##### Summary

Enable or disable annotation reply feature

##### Description

Enable or disable annotation reply feature

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AnnotationReplyActionPayload](#annotationreplyactionpayload) |
| action | path | Action to perform: 'enable' or 'disable' | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Action completed successfully |
| 401 | Unauthorized - invalid API token |

### /apps/annotation-reply/{action}/status/{job_id}

#### GET
##### Summary

Get the status of an annotation reply action job

##### Description

Get the status of an annotation reply action job

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action type | Yes | string |
| job_id | path | Job ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Job status retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Job not found |

### /apps/annotations

#### GET
##### Summary

List annotations for the application

##### Description

List annotations for the application

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotations retrieved successfully | [AnnotationList](#annotationlist) |
| 401 | Unauthorized - invalid API token |  |

#### POST
##### Summary

Create a new annotation

##### Description

Create a new annotation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AnnotationCreatePayload](#annotationcreatepayload) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | Annotation created successfully | [Annotation](#annotation) |
| 401 | Unauthorized - invalid API token |  |

### /apps/annotations/{annotation_id}

#### DELETE
##### Summary

Delete an annotation

##### Description

Delete an annotation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| annotation_id | path | Annotation ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Annotation deleted successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Annotation not found |

#### PUT
##### Summary

Update an existing annotation

##### Description

Update an existing annotation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [AnnotationCreatePayload](#annotationcreatepayload) |
| annotation_id | path | Annotation ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Annotation updated successfully | [Annotation](#annotation) |
| 401 | Unauthorized - invalid API token |  |
| 403 | Forbidden - insufficient permissions |  |
| 404 | Annotation not found |  |

### /audio-to-text

#### POST
##### Summary

Convert audio to text using speech-to-text

##### Description

Convert audio to text using speech-to-text
Accepts an audio file upload and returns the transcribed text.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Audio successfully transcribed |
| 400 | Bad request - no audio or invalid audio |
| 401 | Unauthorized - invalid API token |
| 413 | Audio file too large |
| 415 | Unsupported audio type |
| 500 | Internal server error |

### /chat-messages

#### POST
##### Summary

Send a message in a chat conversation

##### Description

Send a message in a chat conversation
This endpoint handles chat messages for chat, agent chat, and advanced chat applications.
Supports conversation management and both blocking and streaming response modes.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChatRequestPayload](#chatrequestpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Message sent successfully |
| 400 | Bad request - invalid parameters or workflow issues |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation or workflow not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

### /chat-messages/{task_id}/stop

#### POST
##### Summary

Stop a running chat message generation

##### Description

Stop a running chat message generation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | The ID of the task to stop | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Task stopped successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Task not found |

### /completion-messages

#### POST
##### Summary

Create a completion for the given prompt

##### Description

Create a completion for the given prompt
This endpoint generates a completion based on the provided inputs and query.
Supports both blocking and streaming response modes.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [CompletionRequestPayload](#completionrequestpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Completion created successfully |
| 400 | Bad request - invalid parameters |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation not found |
| 500 | Internal server error |

### /completion-messages/{task_id}/stop

#### POST
##### Summary

Stop a running completion task

##### Description

Stop a running completion task

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | The ID of the task to stop | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Task stopped successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Task not found |

### /conversations

#### GET
##### Summary

List all conversations for the current user

##### Description

List all conversations for the current user
Supports pagination using last_id and limit parameters.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ConversationListQuery](#conversationlistquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Conversations retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Last conversation not found |

### /conversations/{c_id}

#### DELETE
##### Summary

Delete a specific conversation

##### Description

Delete a specific conversation

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| c_id | path | Conversation ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Conversation deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation not found |

### /conversations/{c_id}/name

#### POST
##### Summary

Rename a conversation or auto-generate a name

##### Description

Rename a conversation or auto-generate a name

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ConversationRenamePayload](#conversationrenamepayload) |
| c_id | path | Conversation ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Conversation renamed successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation not found |

### /conversations/{c_id}/variables

#### GET
##### Summary

List all variables for a conversation

##### Description

List all variables for a conversation
Conversational variables are only available for chat applications.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ConversationVariablesQuery](#conversationvariablesquery) |
| c_id | path | Conversation ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variables retrieved successfully | [ConversationVariableInfiniteScrollPaginationResponse](#conversationvariableinfinitescrollpaginationresponse) |
| 401 | Unauthorized - invalid API token |  |
| 404 | Conversation not found |  |

### /conversations/{c_id}/variables/{variable_id}

#### PUT
##### Summary

Update a conversation variable's value

##### Description

Update a conversation variable's value
Allows updating the value of a specific conversation variable.
The value must match the variable's expected type.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ConversationVariableUpdatePayload](#conversationvariableupdatepayload) |
| c_id | path | Conversation ID | Yes | string |
| variable_id | path | Variable ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Variable updated successfully | [ConversationVariableResponse](#conversationvariableresponse) |
| 400 | Bad request - type mismatch |  |
| 401 | Unauthorized - invalid API token |  |
| 404 | Conversation or variable not found |  |

### /datasets

#### GET
##### Summary

Resource for getting datasets

##### Description

List all datasets

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Datasets retrieved successfully |
| 401 | Unauthorized - invalid API token |

#### POST
##### Summary

Resource for creating datasets

##### Description

Create a new dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DatasetCreatePayload](#datasetcreatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Dataset created successfully |
| 400 | Bad request - invalid parameters |
| 401 | Unauthorized - invalid API token |

### /datasets/pipeline/file-upload

#### POST
##### Summary

Upload a file for use in conversations

##### Description

Upload a file to a knowledgebase pipeline
Accepts a single file upload via multipart/form-data.

##### Responses

| Code | Description |
| ---- | ----------- |
| 201 | File uploaded successfully |
| 400 | Bad request - no file or invalid file |
| 401 | Unauthorized - invalid API token |
| 413 | File too large |
| 415 | Unsupported file type |

### /datasets/tags

#### DELETE
##### Summary

Delete a knowledge type tag

##### Description

Delete a knowledge type tag

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TagDeletePayload](#tagdeletepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Tag deleted successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

#### GET
##### Summary

Get all knowledge type tags

##### Description

Get all knowledge type tags

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Tags retrieved successfully |
| 401 | Unauthorized - invalid API token |

#### PATCH
##### Description

Update a knowledge type tag

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TagUpdatePayload](#tagupdatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Tag updated successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

#### POST
##### Summary

Add a knowledge type tag

##### Description

Add a knowledge type tag

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TagCreatePayload](#tagcreatepayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Tag created successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

### /datasets/tags/binding

#### POST
##### Description

Bind tags to a dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TagBindingPayload](#tagbindingpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Tags bound successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

### /datasets/tags/unbinding

#### POST
##### Description

Unbind tags from a dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TagUnbindingPayload](#tagunbindingpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Tags unbound successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |

### /datasets/{dataset_id}

#### DELETE
##### Summary

Deletes a dataset given its ID

##### Description

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

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Dataset deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset not found |
| 409 | Conflict - dataset is in use |

#### GET
##### Description

Get a specific dataset by ID

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Dataset retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Dataset not found |

#### PATCH
##### Description

Update an existing dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DatasetUpdatePayload](#datasetupdatepayload) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Dataset updated successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Dataset not found |

### /datasets/{dataset_id}/document/create-by-file

#### POST
##### Description

Create a new document by uploading a file

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document created successfully |
| 400 | Bad request - invalid file or parameters |
| 401 | Unauthorized - invalid API token |

### /datasets/{dataset_id}/document/create-by-text

#### POST
##### Description

Create a new document by providing text content

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DocumentTextCreatePayload](#documenttextcreatepayload) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document created successfully |
| 400 | Bad request - invalid parameters |
| 401 | Unauthorized - invalid API token |

### /datasets/{dataset_id}/document/create_by_file

#### POST
##### Description

Create a new document by uploading a file

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document created successfully |
| 400 | Bad request - invalid file or parameters |
| 401 | Unauthorized - invalid API token |

### /datasets/{dataset_id}/document/create_by_text

#### POST
***DEPRECATED***
##### Description

Deprecated legacy alias for creating a new document by providing text content. Use /datasets/{dataset_id}/document/create-by-text instead.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DocumentTextCreatePayload](#documenttextcreatepayload) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document created successfully |
| 400 | Bad request - invalid parameters |
| 401 | Unauthorized - invalid API token |

### /datasets/{dataset_id}/documents

#### GET
##### Description

List all documents in a dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Documents retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset not found |

### /datasets/{dataset_id}/documents/download-zip

#### POST
##### Description

Download selected uploaded documents as a single ZIP archive

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DocumentBatchDownloadZipPayload](#documentbatchdownloadzippayload) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | ZIP archive generated successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Document or dataset not found |

### /datasets/{dataset_id}/documents/metadata

#### POST
##### Summary

Update metadata for multiple documents

##### Description

Update metadata for multiple documents

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MetadataOperationData](#metadataoperationdata) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Documents metadata updated successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset not found |

### /datasets/{dataset_id}/documents/status/{action}

#### PATCH
##### Summary

Batch update document status

##### Description

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

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform: 'enable', 'disable', 'archive', or 'un_archive' | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document status updated successfully |
| 400 | Bad request - invalid action |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Dataset not found |

### /datasets/{dataset_id}/documents/{batch}/indexing-status

#### GET
##### Description

Get indexing status for documents in a batch

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| batch | path | Batch ID | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Indexing status retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset or documents not found |

### /datasets/{dataset_id}/documents/{document_id}

#### DELETE
##### Summary

Delete document

##### Description

Delete a document

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Document deleted successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - document is archived |
| 404 | Document not found |

#### GET
##### Description

Get a specific document by ID

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Document not found |

#### PATCH
##### Description

Update an existing document by uploading a file

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document updated successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/download

#### GET
##### Description

Get a signed download URL for a document's original uploaded file

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Download URL generated successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - insufficient permissions |
| 404 | Document or upload file not found |

### /datasets/{dataset_id}/documents/{document_id}/segments

#### GET
##### Description

List segments in a document

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [SegmentListQuery](#segmentlistquery) |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Segments retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset or document not found |

#### POST
##### Description

Create segments in a document

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [SegmentCreatePayload](#segmentcreatepayload) |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Segments created successfully |
| 400 | Bad request - segments data is missing |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset or document not found |

### /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}

#### DELETE
##### Description

Delete a specific segment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Segment ID to delete | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Segment deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset, document, or segment not found |

#### GET
##### Description

Get a specific segment by ID

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| document_id | path |  | Yes | string |
| segment_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Segment retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset, document, or segment not found |

#### POST
##### Description

Update a specific segment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [SegmentUpdatePayload](#segmentupdatepayload) |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Segment ID to update | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Segment updated successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset, document, or segment not found |

### /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks

#### GET
##### Description

List child chunks for a segment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChildChunkListQuery](#childchunklistquery) |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Parent segment ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Child chunks retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset, document, or segment not found |

#### POST
##### Description

Create a new child chunk for a segment

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChildChunkCreatePayload](#childchunkcreatepayload) |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Parent segment ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Child chunk created successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset, document, or segment not found |

### /datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}

#### DELETE
##### Description

Delete a specific child chunk

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| child_chunk_id | path | Child chunk ID to delete | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Parent segment ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Child chunk deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset, document, segment, or child chunk not found |

#### PATCH
##### Description

Update a specific child chunk

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [ChildChunkUpdatePayload](#childchunkupdatepayload) |
| child_chunk_id | path | Child chunk ID to update | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |
| segment_id | path | Parent segment ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Child chunk updated successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset, document, segment, or child chunk not found |

### /datasets/{dataset_id}/documents/{document_id}/update-by-file

#### POST
***DEPRECATED***
##### Description

Deprecated legacy alias for updating an existing document by uploading a file. Use PATCH /datasets/{dataset_id}/documents/{document_id} instead.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document updated successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/update-by-text

#### POST
##### Description

Update an existing document by providing text content

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DocumentTextUpdate](#documenttextupdate) |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document updated successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/update_by_file

#### POST
***DEPRECATED***
##### Description

Deprecated legacy alias for updating an existing document by uploading a file. Use PATCH /datasets/{dataset_id}/documents/{document_id} instead.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document updated successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Document not found |

### /datasets/{dataset_id}/documents/{document_id}/update_by_text

#### POST
***DEPRECATED***
##### Description

Deprecated legacy alias for updating an existing document by providing text content. Use /datasets/{dataset_id}/documents/{document_id}/update-by-text instead.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [DocumentTextUpdate](#documenttextupdate) |
| dataset_id | path | Dataset ID | Yes | string |
| document_id | path | Document ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Document updated successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Document not found |

### /datasets/{dataset_id}/hit-testing

#### POST
##### Summary

Perform hit testing on a dataset

##### Description

Perform hit testing on a dataset
Tests retrieval performance for the specified dataset.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [HitTestingPayload](#hittestingpayload) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Hit testing results |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset not found |

### /datasets/{dataset_id}/metadata

#### GET
##### Summary

Get all metadata for a dataset

##### Description

Get all metadata for a dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Metadata retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset not found |

#### POST
##### Summary

Create metadata for a dataset

##### Description

Create metadata for a dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MetadataArgs](#metadataargs) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 201 | Metadata created successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset not found |

### /datasets/{dataset_id}/metadata/built-in

#### GET
##### Summary

Get all built-in metadata fields

##### Description

Get all built-in metadata fields

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Built-in fields retrieved successfully |
| 401 | Unauthorized - invalid API token |

### /datasets/{dataset_id}/metadata/built-in/{action}

#### POST
##### Summary

Enable or disable built-in metadata field

##### Description

Enable or disable built-in metadata field

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| action | path | Action to perform: 'enable' or 'disable' | Yes | string |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Action completed successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset not found |

### /datasets/{dataset_id}/metadata/{metadata_id}

#### DELETE
##### Summary

Delete metadata

##### Description

Delete metadata

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |
| metadata_id | path | Metadata ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 204 | Metadata deleted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset or metadata not found |

#### PATCH
##### Summary

Update metadata name

##### Description

Update metadata name

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MetadataUpdatePayload](#metadataupdatepayload) |
| dataset_id | path | Dataset ID | Yes | string |
| metadata_id | path | Metadata ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Metadata updated successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset or metadata not found |

### /datasets/{dataset_id}/pipeline/datasource-plugins

#### GET
##### Summary

Resource for getting datasource plugins

##### Description

List all datasource plugins for a rag pipeline

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| is_published | query | Whether to get published or draft datasource plugins (true for published, false for draft, default: true) | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Datasource plugins retrieved successfully |
| 401 | Unauthorized - invalid API token |

### /datasets/{dataset_id}/pipeline/datasource/nodes/{node_id}/run

#### POST
##### Summary

Resource for getting datasource plugins

##### Description

Run a datasource node for a rag pipeline

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |
| node_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Datasource node run successfully |
| 401 | Unauthorized - invalid API token |

### /datasets/{dataset_id}/pipeline/run

#### POST
##### Summary

Resource for running a rag pipeline

##### Description

Run a datasource node for a rag pipeline

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path |  | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Pipeline run successfully |
| 401 | Unauthorized - invalid API token |

### /datasets/{dataset_id}/retrieve

#### POST
##### Summary

Perform hit testing on a dataset

##### Description

Perform hit testing on a dataset
Tests retrieval performance for the specified dataset.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [HitTestingPayload](#hittestingpayload) |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Hit testing results |
| 401 | Unauthorized - invalid API token |
| 404 | Dataset not found |

### /datasets/{dataset_id}/tags

#### GET
##### Summary

Get all knowledge type tags

##### Description

Get tags bound to a specific dataset

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| dataset_id | path | Dataset ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Tags retrieved successfully |
| 401 | Unauthorized - invalid API token |

### /end-users/{end_user_id}

#### GET
##### Summary

Get end user detail

##### Description

Get an end user by ID
This endpoint is scoped to the current app token's tenant/app to prevent
cross-tenant/app access when an end-user ID is known.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| end_user_id | path | End user ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | End user retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | End user not found |

### /files/upload

#### POST
##### Summary

Upload a file for use in conversations

##### Description

Upload a file for use in conversations
Accepts a single file upload via multipart/form-data.

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 201 | File uploaded successfully | [FileResponse](#fileresponse) |
| 400 | Bad request - no file or invalid file |  |
| 401 | Unauthorized - invalid API token |  |
| 413 | File too large |  |
| 415 | Unsupported file type |  |

### /files/{file_id}/preview

#### GET
##### Summary

Preview/Download a file that was uploaded via Service API

##### Description

Preview or download a file uploaded via Service API
Provides secure file preview/download functionality.
Files can only be accessed if they belong to messages within the requesting app's context.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [FilePreviewQuery](#filepreviewquery) |
| file_id | path | UUID of the file to preview | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | File retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - file access denied |
| 404 | File not found |

### /form/human_input/{form_token}

#### GET
##### Description

Get a paused human input form by token

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| form_token | path | Human input form token | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Form retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Form not found |
| 412 | Form already submitted or expired |

#### POST
##### Description

Submit a paused human input form by token

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [HumanInputFormSubmitPayload](#humaninputformsubmitpayload) |
| form_token | path | Human input form token | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Form submitted successfully |
| 400 | Bad request - invalid submission data |
| 401 | Unauthorized - invalid API token |
| 404 | Form not found |
| 412 | Form already submitted or expired |

### /info

#### GET
##### Summary

Get app information

##### Description

Get basic application information
Returns basic information about the application including name, description, tags, and mode.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Application info retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Application not found |

### /messages

#### GET
##### Summary

List messages in a conversation

##### Description

List messages in a conversation
Retrieves messages with pagination support using first_id.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MessageListQuery](#messagelistquery) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Messages retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Conversation or first message not found |

### /messages/{message_id}/feedbacks

#### POST
##### Summary

Submit feedback for a message

##### Description

Submit feedback for a message
Allows users to rate messages as like/dislike and provide optional feedback content.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [MessageFeedbackPayload](#messagefeedbackpayload) |
| message_id | path | Message ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Feedback submitted successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Message not found |

### /messages/{message_id}/suggested

#### GET
##### Summary

Get suggested follow-up questions for a message

##### Description

Get suggested follow-up questions for a message
Returns AI-generated follow-up questions based on the message content.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| message_id | path | Message ID | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Suggested questions retrieved successfully |
| 400 | Suggested questions feature is disabled |
| 401 | Unauthorized - invalid API token |
| 404 | Message not found |
| 500 | Internal server error |

### /meta

#### GET
##### Summary

Get app metadata

##### Description

Get application metadata
Returns metadata about the application including configuration and settings.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Metadata retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Application not found |

### /parameters

#### GET
##### Summary

Retrieve app parameters

##### Description

Retrieve application input parameters and configuration
Returns the input form parameters and configuration for the application.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Parameters retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Application not found |

### /site

#### GET
##### Summary

Retrieve app site info

##### Description

Get application site configuration
Returns the site configuration for the application including theme, icons, and text.

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Site configuration retrieved successfully |
| 401 | Unauthorized - invalid API token |
| 403 | Forbidden - site not found or tenant archived |

### /text-to-audio

#### POST
##### Summary

Convert text to audio using text-to-speech

##### Description

Convert text to audio using text-to-speech
Converts the provided text to audio using the specified voice.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [TextToAudioPayload](#texttoaudiopayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Text successfully converted to audio |
| 400 | Bad request - invalid parameters |
| 401 | Unauthorized - invalid API token |
| 500 | Internal server error |

### /workflow/{task_id}/events

#### GET
##### Description

Get workflow execution events stream after resume

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Workflow run ID | Yes | string |
| continue_on_pause | query | Whether to keep the stream open across workflow_paused events,specify `"true"` to keep the stream open for `workflow_paused` events. | No | string |
| include_state_snapshot | query | Whether to replay from persisted state snapshot, specify `"true"` to include a status snapshot of executed nodes | No | string |
| user | query | End user identifier (query param) | No | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | SSE event stream |
| 401 | Unauthorized - invalid API token |
| 404 | Workflow run not found |

### /workflows/logs

#### GET
##### Summary

Get workflow app logs

##### Description

Get workflow execution logs
Returns paginated workflow execution logs with filtering options.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowLogQuery](#workflowlogquery) |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Logs retrieved successfully | [WorkflowAppLogPaginationResponse](#workflowapplogpaginationresponse) |
| 401 | Unauthorized - invalid API token |  |

### /workflows/run

#### POST
##### Summary

Execute a workflow

##### Description

Execute a workflow
Runs a workflow with the provided inputs and returns the results.
Supports both blocking and streaming response modes.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowRunPayload](#workflowrunpayload) |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow executed successfully |
| 400 | Bad request - invalid parameters or workflow issues |
| 401 | Unauthorized - invalid API token |
| 404 | Workflow not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

### /workflows/run/{workflow_run_id}

#### GET
##### Summary

Get a workflow task running detail

##### Description

Get workflow run details
Returns detailed information about a specific workflow run.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| workflow_run_id | path | Workflow run ID | Yes | string |

##### Responses

| Code | Description | Schema |
| ---- | ----------- | ------ |
| 200 | Workflow run details retrieved successfully | [WorkflowRunResponse](#workflowrunresponse) |
| 401 | Unauthorized - invalid API token |  |
| 404 | Workflow run not found |  |

### /workflows/tasks/{task_id}/stop

#### POST
##### Summary

Stop a running workflow task

##### Description

Stop a running workflow task

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| task_id | path | Task ID to stop | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Task stopped successfully |
| 401 | Unauthorized - invalid API token |
| 404 | Task not found |

### /workflows/{workflow_id}/run

#### POST
##### Summary

Run specific workflow by ID

##### Description

Execute a specific workflow by ID
Executes a specific workflow version identified by its ID.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| payload | body |  | Yes | [WorkflowRunPayload](#workflowrunpayload) |
| workflow_id | path | Workflow ID to execute | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Workflow executed successfully |
| 400 | Bad request - invalid parameters or workflow issues |
| 401 | Unauthorized - invalid API token |
| 404 | Workflow not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

### /workspaces/current/models/model-types/{model_type}

#### GET
##### Summary

Get available models by model type

##### Description

Get available models by model type
Returns a list of available models for the specified model type.

##### Parameters

| Name | Located in | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ------ |
| model_type | path | Type of model to retrieve | Yes | string |

##### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Models retrieved successfully |
| 401 | Unauthorized - invalid API token |

---
### Models

#### Annotation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content |  |  | No |
| created_at |  |  | No |
| hit_count |  |  | No |
| id | string |  | Yes |
| question |  |  | No |

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

#### AnnotationReplyActionPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| embedding_model_name | string | Embedding model name | Yes |
| embedding_provider_name | string | Embedding provider name | Yes |
| score_threshold | number | Score threshold for annotation matching | Yes |

#### ChatRequestPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate_name | boolean | Auto generate conversation name | No |
| conversation_id |  | Conversation UUID | No |
| files |  |  | No |
| inputs | object |  | Yes |
| query | string |  | Yes |
| response_mode |  |  | No |
| retriever_from | string |  | No |
| workflow_id |  | Workflow ID for advanced chat | No |

#### ChildChunkCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |

#### ChildChunkListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword |  |  | No |
| limit | integer |  | No |
| page | integer |  | No |

#### ChildChunkUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content | string |  | Yes |

#### CompletionRequestPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files |  |  | No |
| inputs | object |  | Yes |
| query | string |  | No |
| response_mode |  |  | No |
| retriever_from | string |  | No |

#### Condition

Condition detail

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| comparison_operator | string | *Enum:* `"<"`, `"="`, `">"`, `"after"`, `"before"`, `"contains"`, `"empty"`, `"end with"`, `"in"`, `"is"`, `"is not"`, `"not contains"`, `"not empty"`, `"not in"`, `"start with"`, `"≠"`, `"≤"`, `"≥"` | Yes |
| name | string |  | Yes |
| value |  |  | No |

#### ConversationListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id |  | Last conversation ID for pagination | No |
| limit | integer | Number of conversations to return | No |
| sort_by | string | Sort order for conversations<br>*Enum:* `"-created_at"`, `"-updated_at"`, `"created_at"`, `"updated_at"` | No |

#### ConversationRenamePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| auto_generate | boolean |  | No |
| name |  |  | No |

#### ConversationVariableInfiniteScrollPaginationResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| data | [ [ConversationVariableResponse](#conversationvariableresponse) ] |  | Yes |
| has_more | boolean |  | Yes |
| limit | integer |  | Yes |

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
| value |  |  | Yes |

#### ConversationVariablesQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| last_id |  | Last variable ID for pagination | No |
| limit | integer | Number of variables to return | No |
| variable_name |  | Filter variables by name | No |

#### DataSetTag

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| binding_count |  |  | No |
| id | string |  | Yes |
| name | string |  | Yes |
| type | string |  | Yes |

#### DatasetCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description | string | Dataset description (max 400 chars) | No |
| embedding_model |  |  | No |
| embedding_model_provider |  |  | No |
| external_knowledge_api_id |  |  | No |
| external_knowledge_id |  |  | No |
| indexing_technique |  |  | No |
| name | string |  | Yes |
| permission |  |  | No |
| provider | string |  | No |
| retrieval_model |  |  | No |
| summary_index_setting |  |  | No |

#### DatasetListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| include_all | boolean | Include all datasets | No |
| keyword |  | Search keyword | No |
| limit | integer | Number of items per page | No |
| page | integer | Page number | No |
| tag_ids | [ string ] | Filter by tag IDs | No |

#### DatasetPermissionEnum

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| DatasetPermissionEnum | string |  |  |

#### DatasetUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| description |  | Dataset description (max 400 chars) | No |
| embedding_model |  |  | No |
| embedding_model_provider |  |  | No |
| external_knowledge_api_id |  |  | No |
| external_knowledge_id |  |  | No |
| external_retrieval_model |  |  | No |
| indexing_technique |  |  | No |
| name |  |  | No |
| partial_member_list |  |  | No |
| permission |  |  | No |
| retrieval_model |  |  | No |

#### DatasourceNodeRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| credential_id |  |  | No |
| datasource_type | string |  | Yes |
| inputs | object |  | Yes |
| is_published | boolean |  | Yes |

#### DocumentBatchDownloadZipPayload

Request payload for bulk downloading documents as a zip archive.

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_ids | [ string (uuid) ] |  | Yes |

#### DocumentListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword |  | Search keyword | No |
| limit | integer | Number of items per page | No |
| page | integer | Page number | No |
| status |  | Document status filter | No |

#### DocumentMetadataOperation

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| document_id | string |  | Yes |
| metadata_list | [ [MetadataDetail](#metadatadetail) ] |  | Yes |
| partial_update | boolean |  | No |

#### DocumentTextCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_form | string |  | No |
| doc_language | string |  | No |
| embedding_model |  |  | No |
| embedding_model_provider |  |  | No |
| indexing_technique |  |  | No |
| name | string |  | Yes |
| original_document_id |  |  | No |
| process_rule |  |  | No |
| retrieval_model |  |  | No |
| text | string |  | Yes |

#### DocumentTextUpdate

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| doc_form | string |  | No |
| doc_language | string |  | No |
| name |  |  | No |
| process_rule |  |  | No |
| retrieval_model |  |  | No |
| text |  |  | No |

#### FeedbackListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| limit | integer | Number of feedbacks per page | No |
| page | integer | Page number | No |

#### FilePreviewQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| as_attachment | boolean | Download as attachment | No |

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

#### HitTestingPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| attachment_ids |  |  | No |
| external_retrieval_model |  |  | No |
| query | string |  | Yes |
| retrieval_model |  |  | No |

#### HumanInputFormSubmitPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| action | string |  | Yes |
| inputs | object |  | Yes |

#### JsonValue

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| JsonValue |  |  |  |

#### MessageFeedbackPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| content |  |  | No |
| rating |  |  | No |

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
| mode | string | *Enum:* `"automatic"`, `"custom"`, `"hierarchical"` | Yes |
| rules |  |  | No |

#### RerankingModel

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| reranking_model_name |  |  | No |
| reranking_provider_name |  |  | No |

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

#### SegmentCreatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| segments |  |  | No |

#### SegmentListQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| keyword |  |  | No |
| status | [ string ] |  | No |

#### SegmentUpdateArgs

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| answer |  |  | No |
| attachment_ids |  |  | No |
| content |  |  | No |
| enabled |  |  | No |
| keywords |  |  | No |
| regenerate_child_chunks | boolean |  | No |
| summary |  |  | No |

#### SegmentUpdatePayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| segment | [SegmentUpdateArgs](#segmentupdateargs) |  | Yes |

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
| tag_id |  |  | No |
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
| message_id |  | Message ID | No |
| streaming |  | Enable streaming response | No |
| text |  | Text to convert to audio | No |
| voice |  | Voice to use for TTS | No |

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

#### WorkflowLogQuery

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at__after |  |  | No |
| created_at__before |  |  | No |
| created_by_account |  |  | No |
| created_by_end_user_session_id |  |  | No |
| keyword |  |  | No |
| limit | integer |  | No |
| page | integer |  | No |
| status |  |  | No |

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

#### WorkflowRunPayload

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| files |  |  | No |
| inputs | object |  | Yes |
| response_mode |  |  | No |

#### WorkflowRunResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| created_at |  |  | No |
| elapsed_time |  |  | No |
| error |  |  | No |
| finished_at |  |  | No |
| id | string |  | Yes |
| inputs |  |  | No |
| outputs | object |  | No |
| status | string |  | Yes |
| total_steps |  |  | No |
| total_tokens |  |  | No |
| workflow_id | string |  | Yes |

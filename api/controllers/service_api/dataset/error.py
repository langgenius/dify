from libs.exception import BaseHTTPException


class DatasetNotInitializedError(BaseHTTPException):
    error_code = "dataset_not_initialized"
    description = "The dataset is still being initialized or indexing. Please wait a moment."
    code = 400


class ArchivedDocumentImmutableError(BaseHTTPException):
    error_code = "archived_document_immutable"
    description = "The archived document is not editable."
    code = 403


class DatasetNameDuplicateError(BaseHTTPException):
    error_code = "dataset_name_duplicate"
    description = "The dataset name already exists. Please modify your dataset name."
    code = 409


class InvalidActionError(BaseHTTPException):
    error_code = "invalid_action"
    description = "Invalid action."
    code = 400


class DocumentAlreadyFinishedError(BaseHTTPException):
    error_code = "document_already_finished"
    description = "The document has been processed. Please refresh the page or go to the document details."
    code = 400


class DocumentIndexingError(BaseHTTPException):
    error_code = "document_indexing"
    description = "The document is being processed and cannot be edited."
    code = 400


class InvalidMetadataError(BaseHTTPException):
    error_code = "invalid_metadata"
    description = "The metadata content is incorrect. Please check and verify."
    code = 400


class DatasetInUseError(BaseHTTPException):
    error_code = "dataset_in_use"
    description = "The dataset is being used by some apps. Please remove the dataset from the apps before deleting it."
    code = 409


class PipelineRunError(BaseHTTPException):
    error_code = "pipeline_run_error"
    description = "An error occurred while running the pipeline."
    code = 500

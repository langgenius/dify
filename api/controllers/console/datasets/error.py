from libs.exception import BaseHTTPException


class NoFileUploadedError(BaseHTTPException):
    error_code = "no_file_uploaded"
    description = "Please upload your file."
    code = 400


class TooManyFilesError(BaseHTTPException):
    error_code = "too_many_files"
    description = "Only one file is allowed."
    code = 400


class FileTooLargeError(BaseHTTPException):
    error_code = "file_too_large"
    description = "File size exceeded. {message}"
    code = 413


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = "unsupported_file_type"
    description = "File type not allowed."
    code = 415


class HighQualityDatasetOnlyError(BaseHTTPException):
    error_code = "high_quality_dataset_only"
    description = "Current operation only supports 'high-quality' datasets."
    code = 400


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


class WebsiteCrawlError(BaseHTTPException):
    error_code = "crawl_failed"
    description = "{message}"
    code = 500


class DatasetInUseError(BaseHTTPException):
    error_code = "dataset_in_use"
    description = "The dataset is being used by some apps. Please remove the dataset from the apps before deleting it."
    code = 409


class IndexingEstimateError(BaseHTTPException):
    error_code = "indexing_estimate_error"
    description = "Knowledge indexing estimate failed: {message}"
    code = 500

from libs.exception import BaseHTTPException


class NoFileUploadedError(BaseHTTPException):
    error_code = 'no_file_uploaded'
    description = "No file uploaded."
    code = 400


class TooManyFilesError(BaseHTTPException):
    error_code = 'too_many_files'
    description = "Only one file is allowed."
    code = 400


class FileTooLargeError(BaseHTTPException):
    error_code = 'file_too_large'
    description = "File size exceeded. {message}"
    code = 413


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = 'unsupported_file_type'
    description = "File type not allowed."
    code = 415


class HighQualityDatasetOnlyError(BaseHTTPException):
    error_code = 'high_quality_dataset_only'
    description = "High quality dataset only."
    code = 400


class DatasetNotInitializedError(BaseHTTPException):
    error_code = 'dataset_not_initialized'
    description = "Dataset not initialized."
    code = 400


class ArchivedDocumentImmutableError(BaseHTTPException):
    error_code = 'archived_document_immutable'
    description = "Cannot process an archived document."
    code = 403


class DatasetNameDuplicateError(BaseHTTPException):
    error_code = 'dataset_name_duplicate'
    description = "Dataset name already exists."
    code = 409


class InvalidActionError(BaseHTTPException):
    error_code = 'invalid_action'
    description = "Invalid action."
    code = 400


class DocumentAlreadyFinishedError(BaseHTTPException):
    error_code = 'document_already_finished'
    description = "Document already finished."
    code = 400


class DocumentIndexingError(BaseHTTPException):
    error_code = 'document_indexing'
    description = "Document indexing."
    code = 400


class InvalidMetadataError(BaseHTTPException):
    error_code = 'invalid_metadata'
    description = "Invalid metadata."
    code = 400

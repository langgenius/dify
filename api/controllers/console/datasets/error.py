from typing import Never

from controllers.common.errors import InternalServerError, NotFoundError
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from libs.exception import BaseHTTPException
from services.errors.dataset import DatasetAccessDeniedError, DatasetNotFoundError
from services.errors.index import IndexNotInitializedError
from services.errors.knowledge_retrieval import HitTestingFailedError, HitTestingInvocationError


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


class DatasetAccessDeniedRequestError(BaseHTTPException):
    error_code = "dataset_access_denied"
    description = "Dataset access denied."
    code = 403


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


class IndexingEstimateError(BaseHTTPException):
    error_code = "indexing_estimate_error"
    description = "Knowledge indexing estimate failed: {message}"
    code = 500


class ChildChunkIndexingError(BaseHTTPException):
    error_code = "child_chunk_indexing_error"
    description = "Create child chunk index failed: {message}"
    code = 500


class ChildChunkDeleteIndexError(BaseHTTPException):
    error_code = "child_chunk_delete_index_error"
    description = "Delete child chunk index failed: {message}"
    code = 500


class PipelineNotFoundError(BaseHTTPException):
    error_code = "pipeline_not_found"
    description = "Pipeline not found."
    code = 404


def raise_hit_testing_error(error: Exception) -> Never:
    """Translate knowledge retrieval failures at the HTTP boundary."""
    if isinstance(error, DatasetNotFoundError):
        raise NotFoundError(description="Dataset not found.") from error
    if isinstance(error, DatasetAccessDeniedError):
        raise DatasetAccessDeniedRequestError(description=str(error)) from error
    if isinstance(error, IndexNotInitializedError):
        raise DatasetNotInitializedError() from error
    if isinstance(error, ProviderTokenNotInitError):
        raise ProviderNotInitializeError(error.description) from error
    if isinstance(error, QuotaExceededError):
        raise ProviderQuotaExceededError() from error
    if isinstance(error, ModelCurrentlyNotSupportError):
        raise ProviderModelCurrentlyNotSupportError() from error
    if isinstance(error, LLMBadRequestError):
        raise ProviderNotInitializeError(
            "No Embedding Model or Reranking Model available. Please configure a valid provider "
            "in the Settings -> Model Provider."
        ) from error
    if isinstance(error, HitTestingInvocationError):
        raise CompletionRequestError(str(error)) from error
    if isinstance(error, HitTestingFailedError):
        raise InternalServerError() from error
    raise error

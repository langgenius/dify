"""Service API endpoints for dataset document management.

The canonical Service API paths use hyphenated route segments. Legacy underscore
aliases remain registered for backward compatibility, but they must stay marked
deprecated in generated API docs so clients migrate toward the canonical paths.
"""

import json
from contextlib import ExitStack
from typing import Any, Never
from uuid import UUID

from flask import request, send_file

from controllers.common.controller_schemas import DocumentBatchDownloadZipPayload
from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    ForbiddenError,
    NoFileUploadedError,
    NotFoundError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.fields import UrlResponse
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_enum_models,
    register_response_schema_models,
    register_schema_models,
)
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import (
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.dataset.error import (
    ArchivedDocumentImmutableError,
    InvalidMetadataError,
)
from controllers.service_api.dataset.error import (
    DocumentSourceConflictError as DocumentSourceConflictRequestError,
)
from controllers.service_api.flask_admission import DatasetApiResource, dataset_admission
from controllers.service_api.schema import binary_response
from core.rag.entities import PreProcessingRule, Rule, Segmentation
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_application_services import application_services
from fields.document_fields import (
    DocumentListResponse,
    DocumentResponse,
    DocumentStatusListResponse,
)
from fields.service_api.document import (
    DOCUMENT_CREATE_BY_FILE_PARAMS,
    DOCUMENT_UPDATE_BY_FILE_PARAMS,
    DocumentAndBatchResponse,
    DocumentDetailResponse,
    DocumentGetQuery,
    DocumentListQuery,
    DocumentTextCreatePayload,
    DocumentTextUpdate,
)
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.documents.application import (
    DocumentArchivedError,
    DocumentNotFoundError,
    DocumentProviderError,
    DocumentSourceConflictError,
    DocumentUploadError,
)
from services.knowledge.documents.contracts import DocumentListFilter
from services.knowledge.entities.knowledge_entities import ProcessRule, RetrievalModel


def _document_and_batch_response(result: dict[str, Any]) -> dict[str, Any]:
    return dump_response(
        DocumentAndBatchResponse,
        {"document": result["documents"][0], "batch": result["batch"]},
    )


def _raise_document_error(error: Exception, *, unsupported_file_as_invalid_param: bool = False) -> Never:
    if isinstance(error, DatasetNotFoundError):
        raise NotFoundError(description="Dataset not found.") from error
    if isinstance(error, DocumentNotFoundError):
        raise NotFoundError(description=str(error)) from error
    if isinstance(error, DatasetAccessDeniedError):
        raise ForbiddenError(description=str(error)) from error
    if isinstance(error, DocumentArchivedError):
        raise ArchivedDocumentImmutableError() from error
    if isinstance(error, DocumentProviderError):
        if error.kind == "quota":
            raise ProviderQuotaExceededError() from error
        if error.kind == "unsupported":
            raise ProviderModelCurrentlyNotSupportError() from error
        raise ProviderNotInitializeError(str(error)) from error
    if isinstance(error, DocumentUploadError):
        if error.kind == "too_large":
            raise FileTooLargeError(error.description) from error
        if unsupported_file_as_invalid_param:
            raise ValueError(error.description or "File type not allowed.") from error
        raise UnsupportedFileTypeError() from error
    if isinstance(error, DocumentSourceConflictError):
        raise DocumentSourceConflictRequestError() from error
    raise error


def _multipart_settings() -> dict[str, Any]:
    raw_settings = request.form.get("data")
    if raw_settings is None:
        return {}
    settings = json.loads(raw_settings)
    if not isinstance(settings, dict):
        raise ValueError("data must be a JSON object.")
    return settings


def _uploaded_file(*, required: bool) -> tuple[str | None, bytes | None, str | None]:
    if "file" not in request.files:
        if required:
            raise NoFileUploadedError()
        return None, None, None
    if len(request.files) > 1:
        raise TooManyFilesError()
    upload = request.files["file"]
    if not upload.filename:
        raise FilenameNotExistsError()
    return upload.filename, upload.stream.read(), upload.mimetype or "application/octet-stream"


register_enum_models(service_api_ns, RetrievalMethod)

register_schema_models(
    service_api_ns,
    ProcessRule,
    RetrievalModel,
    DocumentTextCreatePayload,
    DocumentTextUpdate,
    DocumentListQuery,
    DocumentGetQuery,
    DocumentBatchDownloadZipPayload,
    Rule,
    PreProcessingRule,
    Segmentation,
)
register_response_schema_models(
    service_api_ns,
    UrlResponse,
    DocumentResponse,
    DocumentAndBatchResponse,
    DocumentDetailResponse,
    DocumentListResponse,
    DocumentStatusListResponse,
)


@service_api_ns.route("/datasets/<uuid:dataset_id>/document/create-by-text")
class DocumentAddByTextApi(DatasetApiResource):
    """Resource for the canonical text document creation route."""

    @error_responses(
        DocumentSourceConflictRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @service_api_ns.doc(
        summary="Create Document by Text",
        description=(
            "Create a document from raw text content. The document is processed asynchronously — use the "
            "returned `batch` ID with [Get Document Indexing Status](/api-reference/documents/"
            "get-document-indexing-status) to track progress."
        ),
        tags=["Documents"],
        responses={
            200: "Document created successfully.",
            400: (
                "- `provider_not_initialize` : No valid model provider credentials found. Please go to "
                "Settings -> Model Provider to complete your provider credentials.\n"
                "- `invalid_param` : Knowledge base does not exist. / indexing_technique is required. / "
                "Invalid doc_form (must be `text_model`, `hierarchical_model`, or `qa_model`)."
            ),
            404: "`not_found` : Knowledge base not found.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[DocumentTextCreatePayload.__name__])
    @service_api_ns.doc("create_document_by_text")
    @service_api_ns.doc(description="Create a new document by providing text content")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "Document created successfully",
            401: "Unauthorized - invalid API token",
            400: "Bad request - invalid parameters",
        }
    )
    @service_api_ns.response(
        200, "Document created successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space", "documents"))
    def post(self, context: RequestContext, dataset_id: UUID):
        """Create document by text."""
        payload = DocumentTextCreatePayload.model_validate(service_api_ns.payload or {})
        try:
            result = application_services().knowledge.documents.create_by_text(
                context,
                dataset_id=str(dataset_id),
                name=payload.name,
                text=payload.text,
                settings=payload.model_dump(exclude_none=True),
            )
        except Exception as error:
            _raise_document_error(error)
        return _document_and_batch_response(result), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/document/create_by_text")
class DeprecatedDocumentAddByTextApi(DatasetApiResource):
    """Deprecated resource alias for text document creation."""

    @error_responses(
        DocumentSourceConflictRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @service_api_ns.expect(service_api_ns.models[DocumentTextCreatePayload.__name__])
    @service_api_ns.doc("create_document_by_text_deprecated")
    @service_api_ns.doc(deprecated=True)
    @service_api_ns.doc(
        description=(
            "Deprecated legacy alias for creating a new document by providing text content. "
            "Use /datasets/{dataset_id}/document/create-by-text instead."
        )
    )
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "Document created successfully",
            401: "Unauthorized - invalid API token",
            400: "Bad request - invalid parameters",
            404: "`not_found` : Knowledge base not found.",
        }
    )
    @service_api_ns.response(
        200, "Document created successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space", "documents"))
    def post(self, context: RequestContext, dataset_id: UUID):
        """Create document by text through the deprecated underscore alias."""
        payload = DocumentTextCreatePayload.model_validate(service_api_ns.payload or {})
        try:
            result = application_services().knowledge.documents.create_by_text(
                context,
                dataset_id=str(dataset_id),
                name=payload.name,
                text=payload.text,
                settings=payload.model_dump(exclude_none=True),
            )
        except Exception as error:
            _raise_document_error(error)
        return _document_and_batch_response(result), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update-by-text")
class DocumentUpdateByTextApi(DatasetApiResource):
    """Resource for the canonical text document update route."""

    @error_responses(
        DocumentSourceConflictRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @service_api_ns.doc(
        summary="Update Document by Text",
        description=(
            "Update an existing document's text content, name, or processing configuration. Re-triggers "
            "indexing if content changes — use the returned `batch` ID with [Get Document Indexing "
            "Status](/api-reference/documents/get-document-indexing-status) to track progress."
        ),
        tags=["Documents"],
        responses={
            200: "Document updated successfully.",
            400: (
                "- `provider_not_initialize` : No valid model provider credentials found. Please go to "
                "Settings -> Model Provider to complete your provider credentials.\n"
                "- `invalid_param` : Knowledge base does not exist, name is required when text is "
                "provided, or invalid doc_form (must be `text_model`, `hierarchical_model`, or "
                "`qa_model`)."
            ),
        },
    )
    @service_api_ns.expect(service_api_ns.models[DocumentTextUpdate.__name__])
    @service_api_ns.doc("update_document_by_text")
    @service_api_ns.doc(description="Update an existing document by providing text content")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", "document_id": "Document ID."})
    @service_api_ns.doc(
        responses={
            200: "Document updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Document not found",
        }
    )
    @service_api_ns.response(
        200, "Document updated successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space",))
    def post(self, context: RequestContext, dataset_id: UUID, document_id: UUID):
        """Update document by text."""
        payload = DocumentTextUpdate.model_validate(service_api_ns.payload or {})
        try:
            result = application_services().knowledge.documents.update_by_text(
                context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                settings=payload.model_dump(exclude_none=True),
            )
        except Exception as error:
            _raise_document_error(error)
        return _document_and_batch_response(result), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update_by_text")
class DeprecatedDocumentUpdateByTextApi(DatasetApiResource):
    """Deprecated resource alias for text document updates."""

    @error_responses(
        DocumentSourceConflictRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @service_api_ns.expect(service_api_ns.models[DocumentTextUpdate.__name__])
    @service_api_ns.doc("update_document_by_text_deprecated")
    @service_api_ns.doc(deprecated=True)
    @service_api_ns.doc(
        description=(
            "Deprecated legacy alias for updating an existing document by providing text content. "
            "Use /datasets/{dataset_id}/documents/{document_id}/update-by-text instead."
        )
    )
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", "document_id": "Document ID."})
    @service_api_ns.doc(
        responses={
            200: "Document updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Document not found",
        }
    )
    @service_api_ns.response(
        200, "Document updated successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space",))
    def post(self, context: RequestContext, dataset_id: UUID, document_id: UUID):
        """Update document by text through the deprecated underscore alias."""
        payload = DocumentTextUpdate.model_validate(service_api_ns.payload or {})
        try:
            result = application_services().knowledge.documents.update_by_text(
                context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                settings=payload.model_dump(exclude_none=True),
            )
        except Exception as error:
            _raise_document_error(error)
        return _document_and_batch_response(result), 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/document/create_by_file",
    doc={
        "post": {
            "deprecated": True,
            "description": (
                "Deprecated legacy alias for creating a new document by uploading a file. "
                "Use /datasets/{dataset_id}/document/create-by-file instead."
            ),
        }
    },
)
@service_api_ns.route("/datasets/<uuid:dataset_id>/document/create-by-file")
class DocumentAddByFileApi(DatasetApiResource):
    """Resource for documents."""

    @error_responses(
        DocumentSourceConflictRequestError,
        FilenameNotExistsError,
        FileTooLargeError,
        NoFileUploadedError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
        TooManyFilesError,
    )
    @service_api_ns.doc(
        summary="Create Document by File",
        description=(
            "Create a document by uploading a file. Supports common document formats (PDF, TXT, DOCX, "
            "etc.). Processing is asynchronous — use the returned `batch` ID with [Get Document "
            "Indexing Status](/api-reference/documents/get-document-indexing-status) to track progress."
        ),
        tags=["Documents"],
        responses={
            200: "Document created successfully.",
            400: (
                "- `no_file_uploaded` : Please upload your file.\n"
                "- `too_many_files` : Only one file is allowed.\n"
                "- `filename_not_exists_error` : The specified filename does not exist.\n"
                "- `provider_not_initialize` : No valid model provider credentials found. Please go to "
                "Settings -> Model Provider to complete your provider credentials.\n"
                "- `invalid_param` : Knowledge base does not exist, external datasets not supported, "
                "unsupported file type, missing required fields, or invalid doc_form "
                "(must be `text_model`, `hierarchical_model`, or `qa_model`)."
            ),
            413: "`file_too_large` : File size exceeded.",
            404: "`not_found` : Knowledge base not found.",
        },
    )
    @service_api_ns.doc("create_document_by_file")
    @service_api_ns.doc(description="Create a new document by uploading a file")
    @service_api_ns.doc(consumes=["multipart/form-data"], params=DOCUMENT_CREATE_BY_FILE_PARAMS)
    @service_api_ns.doc(
        responses={
            200: "Document created successfully",
            401: "Unauthorized - invalid API token",
            400: "Bad request - invalid file or parameters",
            413: "File too large",
        }
    )
    @service_api_ns.response(
        200, "Document created successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space", "documents"))
    def post(self, context: RequestContext, dataset_id: UUID):
        """Create document by upload file."""
        settings = _multipart_settings()
        filename, content, mimetype = _uploaded_file(required=True)
        assert filename is not None
        assert content is not None
        assert mimetype is not None
        try:
            result = application_services().knowledge.documents.create_by_file(
                context,
                dataset_id=str(dataset_id),
                filename=filename,
                content=content,
                mimetype=mimetype,
                settings=settings,
            )
        except Exception as error:
            _raise_document_error(error, unsupported_file_as_invalid_param=True)
        return _document_and_batch_response(result), 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update_by_file",
)
@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update-by-file")
class DeprecatedDocumentUpdateByFileApi(DatasetApiResource):
    """Deprecated resource aliases for file document updates."""

    @error_responses(
        DocumentSourceConflictRequestError,
        FilenameNotExistsError,
        FileTooLargeError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
        TooManyFilesError,
        UnsupportedFileTypeError,
    )
    @service_api_ns.doc(
        summary="Update Document by File",
        description=(
            "Update an existing document by uploading a new file. Re-triggers indexing — use the returned "
            "`batch` ID with [Get Document Indexing Status](/api-reference/documents/"
            "get-document-indexing-status) to track progress."
        ),
        tags=["Documents"],
        responses={
            200: "Document updated successfully.",
            400: (
                "- `too_many_files` : Only one file is allowed.\n"
                "- `filename_not_exists_error` : The specified filename does not exist.\n"
                "- `provider_not_initialize` : No valid model provider credentials found. Please go to "
                "Settings -> Model Provider to complete your provider credentials.\n"
                "- `invalid_param` : Knowledge base does not exist, external datasets not supported, "
                "unsupported file type, or invalid doc_form (must be `text_model`, `hierarchical_model`, "
                "or `qa_model`)."
            ),
            413: "`file_too_large` : File size exceeded.",
        },
    )
    @service_api_ns.doc("update_document_by_file_deprecated")
    @service_api_ns.doc(deprecated=True)
    @service_api_ns.doc(
        description=(
            "Deprecated legacy alias for updating an existing document by uploading a file. "
            "Use PATCH /datasets/{dataset_id}/documents/{document_id} instead."
        )
    )
    @service_api_ns.doc(consumes=["multipart/form-data"], params=DOCUMENT_UPDATE_BY_FILE_PARAMS)
    @service_api_ns.doc(
        responses={
            200: "Document updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Document not found",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @service_api_ns.response(
        200, "Document updated successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space",))
    def post(self, context: RequestContext, dataset_id: UUID, document_id: UUID):
        """Update document by file through the deprecated file-update aliases."""
        settings = _multipart_settings()
        filename, content, mimetype = _uploaded_file(required=False)
        try:
            result = application_services().knowledge.documents.update_by_file(
                context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                filename=filename,
                content=content,
                mimetype=mimetype,
                settings=settings,
            )
        except Exception as error:
            _raise_document_error(error)
        return _document_and_batch_response(result), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents")
class DocumentListApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="List Documents",
        description=(
            "Returns a paginated list of documents in the knowledge base. Supports filtering by keyword "
            "and indexing status."
        ),
        tags=["Documents"],
        responses={
            200: "List of documents.",
            404: "`not_found` : Knowledge base not found.",
        },
    )
    @service_api_ns.doc("list_documents")
    @service_api_ns.doc(description="List all documents in a dataset")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", **query_params_from_model(DocumentListQuery)})
    @service_api_ns.doc(
        responses={
            200: "Documents retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @service_api_ns.response(
        200, "Documents retrieved successfully", service_api_ns.models[DocumentListResponse.__name__]
    )
    @dataset_admission()
    def get(self, context: RequestContext, dataset_id: UUID):
        query_params = query_params_from_request(DocumentListQuery)
        try:
            result = application_services().knowledge.documents.list_documents(
                context,
                dataset_id=str(dataset_id),
                query=DocumentListFilter(
                    page=query_params.page,
                    limit=query_params.limit,
                    search=query_params.keyword or "",
                    status=query_params.status,
                ),
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DocumentListResponse, result)


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/download-zip")
class DocumentBatchDownloadZipApi(DatasetApiResource):
    """Download multiple uploaded-file documents as a single ZIP archive."""

    @service_api_ns.doc(
        summary="Download Documents as ZIP",
        description=(
            "Download multiple uploaded-file documents as a single ZIP archive. Accepts up to `100` document IDs."
        ),
        tags=["Documents"],
        responses={
            200: "ZIP archive containing the requested documents.",
            403: "`forbidden` : Insufficient permissions.",
            404: "`not_found` : Document or dataset not found.",
        },
    )
    @binary_response(service_api_ns, "application/zip")
    @service_api_ns.expect(service_api_ns.models[DocumentBatchDownloadZipPayload.__name__])
    @service_api_ns.doc("download_documents_as_zip")
    @service_api_ns.doc(description="Download selected uploaded documents as a single ZIP archive")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "ZIP archive generated successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Document or dataset not found",
        }
    )
    @service_api_ns.response(200, "ZIP archive generated successfully")
    @dataset_admission(rate_limit=True)
    def post(self, context: RequestContext, dataset_id: UUID):
        payload = DocumentBatchDownloadZipPayload.model_validate(service_api_ns.payload or {})
        try:
            with ExitStack() as stack:
                archive = stack.enter_context(
                    application_services().knowledge.documents.build_download_zip(
                        context,
                        dataset_id=str(dataset_id),
                        document_ids=[str(document_id) for document_id in payload.document_ids],
                    )
                )
                response = send_file(
                    archive.path,
                    mimetype="application/zip",
                    as_attachment=True,
                    download_name=archive.filename,
                )
                cleanup = stack.pop_all()
                response.call_on_close(cleanup.close)
        except Exception as error:
            _raise_document_error(error)
        # response-contract:ignore binary send_file response
        return response


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<string:batch>/indexing-status")
class DocumentIndexingStatusApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Get Document Indexing Status",
        description=(
            "Check the indexing progress of documents in a batch. Returns the current processing stage "
            "and chunk completion counts for each document. Poll this endpoint until `indexing_status` "
            "reaches `completed` or `error`. The status progresses through: `waiting` → `parsing` → "
            "`cleaning` → `splitting` → `indexing` → `completed`."
        ),
        tags=["Documents"],
        responses={
            200: "Indexing status for documents in the batch.",
            404: "`not_found` : Knowledge base not found. / Documents not found.",
        },
    )
    @service_api_ns.doc("get_document_indexing_status")
    @service_api_ns.doc(description="Get indexing status for documents in a batch")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", "batch": "Batch ID."})
    @service_api_ns.doc(
        responses={
            200: "Indexing status retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset or documents not found",
        }
    )
    @service_api_ns.response(
        200,
        "Indexing status retrieved successfully",
        service_api_ns.models[DocumentStatusListResponse.__name__],
    )
    @dataset_admission()
    def get(self, context: RequestContext, dataset_id: UUID, batch: str):
        try:
            result = application_services().knowledge.documents.get_batch_indexing_status(
                context, dataset_id=str(dataset_id), batch=batch
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DocumentStatusListResponse, result)


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/download")
class DocumentDownloadApi(DatasetApiResource):
    """Return a signed download URL for a document's original uploaded file."""

    @service_api_ns.doc(
        summary="Download Document",
        description="Get a signed download URL for a document's original uploaded file.",
        tags=["Documents"],
        responses={
            200: "Download URL generated successfully.",
            403: "`forbidden` : No permission to access this document.",
            404: "`not_found` : Document not found.",
        },
    )
    @service_api_ns.doc("get_document_download_url")
    @service_api_ns.doc(description="Get a signed download URL for a document's original uploaded file")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", "document_id": "Document ID."})
    @service_api_ns.doc(
        responses={
            200: "Download URL generated successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Document or upload file not found",
        }
    )
    @service_api_ns.response(
        200,
        "Download URL generated successfully",
        service_api_ns.models[UrlResponse.__name__],
    )
    @dataset_admission(rate_limit=True)
    def get(self, context: RequestContext, dataset_id: UUID, document_id: UUID):
        try:
            url = application_services().knowledge.documents.get_download_url(
                context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return UrlResponse(url=url).model_dump(mode="json")


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>")
class DocumentApi(DatasetApiResource):
    METADATA_CHOICES = {"all", "only", "without"}

    @error_responses(InvalidMetadataError)
    @service_api_ns.doc(
        summary="Get Document",
        description=(
            "Retrieve detailed information about a specific document, including its indexing status, "
            "metadata, and processing statistics."
        ),
        tags=["Documents"],
        responses={
            200: (
                "Document details. The response shape varies based on the `metadata` query parameter. When "
                "`metadata` is `only`, only `id`, `doc_type`, and `doc_metadata` are returned. When "
                "`metadata` is `without`, `doc_type` and `doc_metadata` are omitted."
            ),
            400: "`invalid_metadata` : Invalid metadata value for the specified key.",
            403: "`forbidden` : No permission.",
            404: "`not_found` : Document not found.",
        },
    )
    @service_api_ns.doc("get_document")
    @service_api_ns.doc(description="Get a specific document by ID")
    @service_api_ns.doc(
        params={
            "dataset_id": "Knowledge base ID.",
            "document_id": "Document ID.",
            **query_params_from_model(DocumentGetQuery),
        }
    )
    @service_api_ns.doc(
        responses={
            200: "Document retrieved successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Document not found",
        }
    )
    @service_api_ns.response(
        200,
        "Document retrieved successfully",
        service_api_ns.models[DocumentDetailResponse.__name__],
    )
    @dataset_admission()
    def get(self, context: RequestContext, dataset_id: UUID, document_id: UUID):
        try:
            query_params = query_params_from_request(DocumentGetQuery)
        except ValueError as exc:
            metadata = request.args.get("metadata", "all")
            raise InvalidMetadataError(f"Invalid metadata value: {metadata}") from exc
        metadata = query_params.metadata
        try:
            result = application_services().knowledge.documents.get_document(
                context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                metadata_only=metadata == "only",
            )
        except Exception as error:
            _raise_document_error(error)
        if metadata != "only" and "data_source_detail_dict" in result:
            result["data_source_info"] = result.pop("data_source_detail_dict")
        if metadata != "only" and result.get("document_process_rule") is None:
            result["document_process_rule"] = {}
        return DocumentDetailResponse.model_validate(result).model_dump(
            mode="json",
            include={"id", "doc_type", "doc_metadata"} if metadata == "only" else None,
            exclude={"doc_type", "doc_metadata"} if metadata == "without" else None,
        )

    @error_responses(
        DocumentSourceConflictRequestError,
        FilenameNotExistsError,
        FileTooLargeError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
        TooManyFilesError,
        UnsupportedFileTypeError,
    )
    @service_api_ns.doc(
        summary="Update Document by File",
        description=(
            "Update an existing document by uploading a new file. Re-triggers indexing — use the returned "
            "`batch` ID with [Get Document Indexing Status](/api-reference/documents/"
            "get-document-indexing-status) to track progress."
        ),
        tags=["Documents"],
        responses={
            200: "Document updated successfully.",
            400: (
                "- `too_many_files` : Only one file is allowed.\n"
                "- `filename_not_exists_error` : The specified filename does not exist.\n"
                "- `provider_not_initialize` : No valid model provider credentials found. Please go to "
                "Settings -> Model Provider to complete your provider credentials.\n"
                "- `invalid_param` : Knowledge base does not exist, external datasets not supported, "
                "unsupported file type, or invalid doc_form (must be `text_model`, `hierarchical_model`, "
                "or `qa_model`)."
            ),
            413: "`file_too_large` : File size exceeded.",
        },
    )
    @service_api_ns.doc("update_document_by_file")
    @service_api_ns.doc(description="Update an existing document by uploading a file")
    @service_api_ns.doc(consumes=["multipart/form-data"], params=DOCUMENT_UPDATE_BY_FILE_PARAMS)
    @service_api_ns.doc(
        responses={
            200: "Document updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Document not found",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @service_api_ns.response(
        200, "Document updated successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @dataset_admission(rate_limit=True, billing_resources=("vector_space",))
    def patch(self, context: RequestContext, dataset_id: UUID, document_id: UUID):
        """Update document by file on the canonical document resource."""
        settings = _multipart_settings()
        filename, content, mimetype = _uploaded_file(required=False)
        try:
            result = application_services().knowledge.documents.update_by_file(
                context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                filename=filename,
                content=content,
                mimetype=mimetype,
                settings=settings,
            )
        except Exception as error:
            _raise_document_error(error)
        return _document_and_batch_response(result), 200

    @error_responses(ArchivedDocumentImmutableError)
    @service_api_ns.doc(
        summary="Delete Document",
        description="Permanently delete a document and all its chunks from the knowledge base.",
        tags=["Documents"],
        responses={
            204: "Success.",
            403: "`archived_document_immutable` : The archived document is not editable.",
            404: "`not_found` : Document Not Exists.",
        },
    )
    @service_api_ns.doc("delete_document")
    @service_api_ns.doc(description="Delete a document")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", "document_id": "Document ID."})
    @service_api_ns.doc(
        responses={
            204: "Document deleted successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - document is archived",
            404: "Document not found",
        }
    )
    @dataset_admission(rate_limit=True)
    def delete(self, context: RequestContext, dataset_id: UUID, document_id: UUID):
        """Delete document."""
        try:
            application_services().knowledge.documents.delete_document(
                context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return "", 204

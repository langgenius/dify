from contextlib import ExitStack
from datetime import datetime
from typing import Any, Literal, Never
from uuid import UUID

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, Field, JsonValue, field_validator
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.common.controller_schemas import DocumentBatchDownloadZipPayload
from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.common.fields import SimpleResultMessageResponse, SimpleResultResponse, UrlResponse
from controllers.common.rbac import DatasetByDocument, DatasetId, RBACCheck, enforce_rbac_checks
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import (
    ArchivedDocumentImmutableError,
    DatasetAccessDeniedRequestError,
    DocumentAlreadyFinishedError,
    DocumentIndexingError,
    IndexingEstimateError,
    InvalidActionError,
    InvalidMetadataError,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    check_knowledge_rate_limit,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
    model_validate,
)
from core.entities.knowledge_entities import IndexingEstimate
from core.rag.entities import Rule
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.document_fields import (
    DocumentMetadataResponse,
    DocumentResponse,
    DocumentStatusListResponse,
    DocumentStatusResponse,
    normalize_enum,
)
from libs.helper import dump_response, to_timestamp
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.enums import ProcessRuleMode
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.documents.application import (
    DocumentArchivedError,
    DocumentIndexingStateError,
    DocumentInvalidActionError,
    DocumentListFilter,
    DocumentNotFoundError,
    DocumentProviderError,
)
from services.knowledge.entities.knowledge_entities import KnowledgeConfig, ProcessRule, RetrievalModel
from services.knowledge.indexing.estimate import (
    EstimateDocumentAlreadyFinishedError,
    EstimateDocumentNotFoundError,
    EstimateSourceNotFoundError,
    IndexingEstimateCredentialUnavailableError,
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
    UnsupportedEstimateSourceError,
)

_DATASET_EDIT_ROLES = frozenset(
    {
        TenantAccountRole.OWNER,
        TenantAccountRole.ADMIN,
        TenantAccountRole.EDITOR,
        TenantAccountRole.DATASET_OPERATOR,
    }
)


def _raise_document_error(error: Exception) -> Never:
    if isinstance(error, DatasetNotFoundError):
        raise NotFound("Dataset not found.") from error
    if isinstance(error, DocumentNotFoundError):
        raise NotFound(str(error)) from error
    if isinstance(error, DatasetAccessDeniedError):
        raise Forbidden(str(error)) from error
    if isinstance(error, DocumentArchivedError):
        raise ArchivedDocumentImmutableError() from error
    if isinstance(error, DocumentIndexingStateError):
        raise DocumentIndexingError(str(error)) from error
    if isinstance(error, DocumentInvalidActionError):
        raise InvalidActionError(str(error)) from error
    if isinstance(error, DocumentProviderError):
        if error.kind == "quota":
            raise ProviderQuotaExceededError() from error
        if error.kind == "unsupported":
            raise ProviderModelCurrentlyNotSupportError() from error
        raise ProviderNotInitializeError(str(error)) from error
    raise error


class DatasetResponse(ResponseModel):
    id: str
    name: str
    description: str | None = None
    permission: str | None = None
    data_source_type: str | None = None
    indexing_technique: str | None = None
    created_by: str | None = None
    created_at: int | None = None

    @field_validator("data_source_type", "indexing_technique", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> Any:
        return normalize_enum(value)

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class DocumentWithSegmentsResponse(DocumentResponse):
    process_rule_dict: Any = None
    completed_segments: int | None = Field(default=None, exclude_if=lambda value: value is None)
    total_segments: int | None = Field(default=None, exclude_if=lambda value: value is None)


class DatasetAndDocumentResponse(ResponseModel):
    dataset: DatasetResponse
    documents: list[DocumentResponse]
    batch: str


class DocumentRetryPayload(BaseModel):
    document_ids: list[str]


class DocumentRenamePayload(BaseModel):
    name: str


class GenerateSummaryPayload(BaseModel):
    document_list: list[str]


class DocumentMetadataUpdatePayload(BaseModel):
    doc_type: str | None = None
    doc_metadata: Any = None


class DocumentDatasetListParam(BaseModel):
    page: int = Field(1, title="Page", description="Page number.")
    limit: int = Field(20, title="Limit", description="Page size.")
    search: str | None = Field(None, alias="keyword", title="Search", description="Search keyword.")
    sort_by: str = Field("-created_at", alias="sort", title="SortBy", description="Sort by field.")
    status: str | None = Field(None, title="Status", description="Document status.")
    fetch_val: str = Field("false", alias="fetch")


class DocumentWithSegmentsListResponse(ResponseModel):
    data: list[DocumentWithSegmentsResponse]
    has_more: bool
    limit: int
    total: int
    page: int


class IndexingEstimateResponse(IndexingEstimate):
    tokens: int
    total_price: float | int
    currency: str


def _serialize_indexing_estimate(estimate: IndexingEstimate) -> tuple[dict[str, object], int]:
    return (
        IndexingEstimateResponse(
            tokens=0,
            total_price=0,
            currency="USD",
            total_segments=estimate.total_segments,
            preview=estimate.preview,
            qa_preview=estimate.qa_preview,
        ).model_dump(mode="json", exclude_none=True),
        200,
    )


class DocumentDetailResponse(ResponseModel):
    id: str
    position: int | None = None
    data_source_type: str | None = None
    data_source_info: Any = None
    data_source_detail_dict: Any = None
    dataset_process_rule_id: str | None = None
    dataset_process_rule: Any = None
    document_process_rule: Any = None
    name: str | None = None
    created_from: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    tokens: int | None = None
    indexing_status: str | None = None
    completed_at: int | None = None
    updated_at: int | None = None
    indexing_latency: float | None = None
    error: str | None = None
    enabled: bool | None = None
    disabled_at: int | None = None
    disabled_by: str | None = None
    archived: bool | None = None
    doc_type: str | None = None
    doc_metadata: list[DocumentMetadataResponse] | None = None
    segment_count: int | None = None
    average_segment_length: float | None = None
    hit_count: int | None = None
    display_status: str | None = None
    doc_form: str | None = None
    doc_language: str | None = None
    need_summary: bool | None = None

    @field_validator("data_source_type", "indexing_status", "display_status", "doc_form", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> Any:
        return normalize_enum(value)


class SummaryStatusResponse(ResponseModel):
    completed: int = 0
    generating: int = 0
    error: int = 0
    not_started: int = 0
    timeout: int = 0


class SummaryEntryResponse(ResponseModel):
    segment_id: str
    segment_position: int
    status: str
    summary_preview: str | None = None
    error: str | None = None
    created_at: int | None = None
    updated_at: int | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: Any) -> Any:
        return normalize_enum(value)


class DocumentSummaryStatusResponse(ResponseModel):
    total_segments: int
    summary_status: SummaryStatusResponse
    summaries: list[SummaryEntryResponse]


class ProcessRuleResponse(ResponseModel):
    mode: ProcessRuleMode
    rules: Rule | None = None
    limits: dict[str, Any]


class DocumentPipelineExecutionLogResponse(ResponseModel):
    datasource_info: JsonValue | None = None
    datasource_type: str | None = None
    input_data: JsonValue | None = None
    datasource_node_id: str | None = None


register_schema_models(
    console_ns,
    KnowledgeConfig,
    ProcessRule,
    RetrievalModel,
    DocumentRetryPayload,
    DocumentRenamePayload,
    GenerateSummaryPayload,
    DocumentMetadataUpdatePayload,
    DocumentBatchDownloadZipPayload,
)
register_response_schema_models(
    console_ns,
    SimpleResultMessageResponse,
    SimpleResultResponse,
    UrlResponse,
    DatasetResponse,
    DocumentMetadataResponse,
    DocumentResponse,
    DocumentWithSegmentsResponse,
    DatasetAndDocumentResponse,
    DocumentWithSegmentsListResponse,
    IndexingEstimateResponse,
    DocumentDetailResponse,
    DocumentSummaryStatusResponse,
    ProcessRuleResponse,
    DocumentPipelineExecutionLogResponse,
)


@console_ns.route("/datasets/process-rule")
class GetProcessRuleApi(Resource):
    @console_ns.doc("get_process_rule")
    @console_ns.doc(description="Get dataset document processing rules")
    @console_ns.doc(params={"document_id": "Document ID (optional)"})
    @console_ns.response(200, "Process rules retrieved successfully", console_ns.models[ProcessRuleResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        document_id = request.args.get("document_id")
        if document_id:
            enforce_rbac_checks(
                tenant_id=request_context.active_workspace_id,
                account_id=request_context.account_id,
                checks=[RBACCheck(RBACPermission.DATASET_READONLY, DatasetByDocument())],
                path_args={"document_id": document_id},
            )
        try:
            result = application_services().knowledge.documents.get_process_rule(
                request_context, document_id=document_id
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(ProcessRuleResponse, result)


@console_ns.route("/datasets/<uuid:dataset_id>/documents")
class DatasetDocumentListApi(Resource):
    @console_ns.doc("get_dataset_documents")
    @console_ns.doc(description="Get documents in a dataset")
    @console_ns.doc(
        params={
            "dataset_id": "Dataset ID",
            "page": "Page number (default: 1)",
            "limit": "Number of items per page (default: 20)",
            "keyword": "Search keyword",
            "sort": "Sort order (default: -created_at)",
            "fetch": "Fetch full details (default: false)",
            "status": "Filter documents by display status",
        }
    )
    @console_ns.response(
        200,
        "Documents retrieved successfully",
        console_ns.models[DocumentWithSegmentsListResponse.__name__],
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID):
        args = DocumentDatasetListParam.model_validate(request.args.to_dict())
        try:
            result = application_services().knowledge.documents.list_documents(
                request_context,
                dataset_id=str(dataset_id),
                query=DocumentListFilter(
                    page=args.page,
                    limit=args.limit,
                    search=args.search or "",
                    sort=args.sort_by,
                    status=args.status,
                    fetch=args.fetch_val.lower() in {"yes", "true", "t", "y", "1"},
                ),
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DocumentWithSegmentsListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeConfig.__name__])
    @console_ns.response(200, "Documents created successfully", console_ns.models[DatasetAndDocumentResponse.__name__])
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, request_context: RequestContext, dataset_id: UUID):
        config = KnowledgeConfig.model_validate(console_ns.payload or {})
        try:
            result = application_services().knowledge.documents.create_documents(
                request_context, dataset_id=str(dataset_id), settings=config.model_dump()
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DatasetAndDocumentResponse, result)

    @console_ns.response(204, "Documents deleted successfully")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    def delete(self, request_context: RequestContext, dataset_id: UUID):
        check_knowledge_rate_limit()
        try:
            application_services().knowledge.documents.delete_documents(
                request_context, dataset_id=str(dataset_id), document_ids=request.args.getlist("document_id")
            )
        except Exception as error:
            _raise_document_error(error)
        return "", 204


@console_ns.route("/datasets/init")
class DatasetInitApi(Resource):
    @console_ns.doc("init_dataset")
    @console_ns.doc(description="Initialize dataset with documents")
    @console_ns.expect(console_ns.models[KnowledgeConfig.__name__])
    @console_ns.response(
        200, "Dataset initialized successfully", console_ns.models[DatasetAndDocumentResponse.__name__]
    )
    @console_ns.response(400, "Invalid request parameters")
    @console_account_admission(allowed_roles=_DATASET_EDIT_ROLES)
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, request_context: RequestContext):
        config = KnowledgeConfig.model_validate(console_ns.payload or {})
        try:
            result = application_services().knowledge.documents.initialize_dataset(
                request_context, settings=config.model_dump()
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DatasetAndDocumentResponse, result)


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/indexing-estimate")
class DocumentIndexingEstimateApi(Resource):
    @console_ns.doc("estimate_document_indexing")
    @console_ns.doc(description="Estimate document indexing cost")
    @console_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @console_ns.response(
        200,
        "Indexing estimate calculated successfully",
        console_ns.models[IndexingEstimateResponse.__name__],
    )
    @console_ns.response(404, "Document not found")
    @console_ns.response(400, "Document already finished")
    @console_account_admission(
        rbac_checks=(RBACCheck(RBACPermission.DATASET_USE, DatasetId()),),
    )
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        try:
            estimate = application_services().knowledge.indexing_estimates.estimate_document(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
            )
        except (
            DatasetNotFoundError,
            EstimateDocumentNotFoundError,
            EstimateSourceNotFoundError,
            IndexingEstimateCredentialUnavailableError,
        ) as error:
            raise NotFoundError(description=str(error)) from error
        except DatasetAccessDeniedError as error:
            raise DatasetAccessDeniedRequestError(description=str(error)) from error
        except EstimateDocumentAlreadyFinishedError as error:
            raise DocumentAlreadyFinishedError() from error
        except UnsupportedEstimateSourceError as error:
            raise InvalidArgumentError(description=str(error)) from error
        except IndexingEstimateProviderUnavailableError as error:
            raise ProviderNotInitializeError(str(error)) from error
        except IndexingEstimateExecutionError as error:
            raise IndexingEstimateError(str(error)) from error
        return _serialize_indexing_estimate(estimate)


@console_ns.route("/datasets/<uuid:dataset_id>/batch/<string:batch>/indexing-estimate")
class DocumentBatchIndexingEstimateApi(Resource):
    @console_ns.response(
        200,
        "Indexing estimate calculated successfully",
        console_ns.models[IndexingEstimateResponse.__name__],
    )
    @console_account_admission(
        rbac_checks=(RBACCheck(RBACPermission.DATASET_USE, DatasetId()),),
    )
    def get(self, request_context: RequestContext, dataset_id: UUID, batch: str):
        try:
            estimate = application_services().knowledge.indexing_estimates.estimate_batch(
                request_context,
                dataset_id=str(dataset_id),
                batch=batch,
            )
        except (
            DatasetNotFoundError,
            EstimateDocumentNotFoundError,
            EstimateSourceNotFoundError,
            IndexingEstimateCredentialUnavailableError,
        ) as error:
            raise NotFoundError(description=str(error)) from error
        except DatasetAccessDeniedError as error:
            raise DatasetAccessDeniedRequestError(description=str(error)) from error
        except EstimateDocumentAlreadyFinishedError as error:
            raise DocumentAlreadyFinishedError() from error
        except UnsupportedEstimateSourceError as error:
            raise InvalidArgumentError(description=str(error)) from error
        except IndexingEstimateProviderUnavailableError as error:
            raise ProviderNotInitializeError(str(error)) from error
        except IndexingEstimateExecutionError as error:
            raise IndexingEstimateError(str(error)) from error
        return _serialize_indexing_estimate(estimate)


@console_ns.route("/datasets/<uuid:dataset_id>/batch/<string:batch>/indexing-status")
class DocumentBatchIndexingStatusApi(Resource):
    @console_ns.response(
        200, "Indexing status retrieved successfully", console_ns.models[DocumentStatusListResponse.__name__]
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID, batch: str):
        try:
            result = application_services().knowledge.documents.get_batch_indexing_status(
                request_context, dataset_id=str(dataset_id), batch=batch
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DocumentStatusListResponse, result)


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/indexing-status")
class DocumentIndexingStatusApi(Resource):
    @console_ns.doc("get_document_indexing_status")
    @console_ns.doc(description="Get document indexing status")
    @console_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @console_ns.response(
        200, "Indexing status retrieved successfully", console_ns.models[DocumentStatusResponse.__name__]
    )
    @console_ns.response(404, "Document not found")
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        try:
            result = application_services().knowledge.documents.get_indexing_status(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DocumentStatusResponse, result)


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>")
class DocumentApi(Resource):
    METADATA_CHOICES = {"all", "only", "without"}

    @console_ns.doc("get_document")
    @console_ns.doc(description="Get document details")
    @console_ns.doc(
        params={
            "dataset_id": "Dataset ID",
            "document_id": "Document ID",
            "metadata": "Metadata inclusion (all/only/without)",
        }
    )
    @console_ns.response(200, "Document retrieved successfully", console_ns.models[DocumentDetailResponse.__name__])
    @console_ns.response(404, "Document not found")
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        metadata = request.args.get("metadata", "all")
        if metadata not in self.METADATA_CHOICES:
            raise InvalidMetadataError(f"Invalid metadata value: {metadata}")
        try:
            result = application_services().knowledge.documents.get_document(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                metadata_only=metadata == "only",
            )
        except Exception as error:
            _raise_document_error(error)

        metadata_fields = {"doc_type", "doc_metadata"}
        return dump_response(
            DocumentDetailResponse,
            result,
            include={"id", *metadata_fields} if metadata == "only" else None,
            exclude=metadata_fields if metadata == "without" else None,
            exclude_unset=True,
        ), 200

    @console_ns.response(204, "Document deleted successfully")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        try:
            application_services().knowledge.documents.delete_document(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/download")
class DocumentDownloadApi(Resource):
    """Return a signed download URL for a dataset document's original uploaded file."""

    @console_ns.doc("get_dataset_document_download_url")
    @console_ns.doc(description="Get a signed download URL for a dataset document's original uploaded file")
    @console_ns.response(200, "Download URL generated successfully", console_ns.models[UrlResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_DOCUMENT_DOWNLOAD, DatasetId()),))
    @cloud_edition_billing_rate_limit_check("knowledge")
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        try:
            result = application_services().knowledge.documents.get_download_url(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return UrlResponse(url=result).model_dump(mode="json")


@console_ns.route("/datasets/<uuid:dataset_id>/documents/download-zip")
class DocumentBatchDownloadZipApi(Resource):
    """Download multiple uploaded-file documents as a single ZIP (avoids browser multi-download limits)."""

    @console_ns.doc("download_dataset_documents_as_zip")
    @console_ns.doc(description="Download selected dataset documents as a single ZIP archive (upload-file only)")
    @console_ns.response(200, "ZIP archive downloaded successfully")
    @console_ns.expect(console_ns.models[DocumentBatchDownloadZipPayload.__name__])
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, request_context: RequestContext, dataset_id: UUID):
        """Stream a ZIP archive containing the requested uploaded documents."""
        payload = DocumentBatchDownloadZipPayload.model_validate(console_ns.payload or {})
        try:
            with ExitStack() as stack:
                archive = stack.enter_context(
                    application_services().knowledge.documents.build_download_zip(
                        request_context,
                        dataset_id=str(dataset_id),
                        document_ids=[str(value) for value in payload.document_ids],
                    )
                )
                response = send_file(
                    archive.path, mimetype="application/zip", as_attachment=True, download_name=archive.filename
                )
                cleanup = stack.pop_all()
                response.call_on_close(cleanup.close)
        except Exception as error:
            _raise_document_error(error)
        # response-contract:ignore binary ZIP download response
        return response


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/<string:action>")
class DocumentProcessingApi(Resource):
    @console_ns.doc("update_document_processing")
    @console_ns.doc(description="Update document processing status (pause/resume)")
    @console_ns.doc(
        params={"dataset_id": "Dataset ID", "document_id": "Document ID", "action": "Action to perform (pause/resume)"}
    )
    @console_ns.response(
        200,
        "Processing status updated successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @console_ns.response(404, "Document not found")
    @console_ns.response(400, "Invalid action")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(
        self, request_context: RequestContext, dataset_id: UUID, document_id: UUID, action: Literal["pause", "resume"]
    ):
        try:
            application_services().knowledge.documents.update_processing(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id), action=action
            )
        except Exception as error:
            _raise_document_error(error)
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/metadata")
class DocumentMetadataApi(Resource):
    @console_ns.doc("update_document_metadata")
    @console_ns.doc(description="Update document metadata")
    @console_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @console_ns.expect(console_ns.models[DocumentMetadataUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Document metadata updated successfully",
        console_ns.models[SimpleResultMessageResponse.__name__],
    )
    @console_ns.response(404, "Document not found")
    @console_ns.response(403, "Permission denied")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @model_validate(DocumentMetadataUpdatePayload)
    def put(
        self,
        req_data: DocumentMetadataUpdatePayload,
        request_context: RequestContext,
        dataset_id: UUID,
        document_id: UUID,
    ):
        try:
            application_services().knowledge.documents.update_metadata(
                request_context,
                dataset_id=str(dataset_id),
                document_id=str(document_id),
                doc_type=req_data.doc_type,
                doc_metadata=req_data.doc_metadata,
            )
        except Exception as error:
            _raise_document_error(error)
        return SimpleResultMessageResponse(result="success", message="Document metadata updated.").model_dump(
            mode="json"
        ), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/status/<string:action>/batch")
class DocumentStatusApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(
        self,
        request_context: RequestContext,
        dataset_id: UUID,
        action: Literal["enable", "disable", "archive", "un_archive"],
    ):
        try:
            application_services().knowledge.documents.change_status(
                request_context,
                dataset_id=str(dataset_id),
                document_ids=request.args.getlist("document_id"),
                action=action,
            )
        except Exception as error:
            _raise_document_error(error)
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/pause")
class DocumentPauseApi(Resource):
    @console_ns.response(204, "Document paused successfully")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    def patch(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        """pause document."""
        check_knowledge_rate_limit()
        try:
            application_services().knowledge.documents.pause_document(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/resume")
class DocumentRecoverApi(Resource):
    @console_ns.response(204, "Document resumed successfully")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    def patch(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        """recover document."""
        check_knowledge_rate_limit()
        try:
            application_services().knowledge.documents.recover_document(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/retry")
class DocumentRetryApi(Resource):
    @console_ns.expect(console_ns.models[DocumentRetryPayload.__name__])
    @console_ns.response(204, "Documents retry started successfully")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @model_validate(DocumentRetryPayload)
    def post(self, req_data: DocumentRetryPayload, request_context: RequestContext, dataset_id: UUID):
        """retry document."""
        check_knowledge_rate_limit()
        try:
            application_services().knowledge.documents.retry_documents(
                request_context, dataset_id=str(dataset_id), document_ids=req_data.document_ids
            )
        except Exception as error:
            _raise_document_error(error)
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/rename")
class DocumentRenameApi(Resource):
    @console_ns.response(200, "Document renamed successfully", console_ns.models[DocumentResponse.__name__])
    @console_ns.expect(console_ns.models[DocumentRenamePayload.__name__])
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @model_validate(DocumentRenamePayload)
    def post(
        self, req_data: DocumentRenamePayload, request_context: RequestContext, dataset_id: UUID, document_id: UUID
    ):
        try:
            result = application_services().knowledge.documents.rename_document(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id), name=req_data.name
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DocumentResponse, result)


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/website-sync")
class WebsiteDocumentSyncApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        """sync website document."""
        try:
            application_services().knowledge.documents.sync_website(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/pipeline-execution-log")
class DocumentPipelineExecutionLogApi(Resource):
    @console_ns.response(
        200,
        "Pipeline execution log retrieved successfully",
        console_ns.models[DocumentPipelineExecutionLogResponse.__name__],
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        try:
            result = application_services().knowledge.documents.get_execution_log(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DocumentPipelineExecutionLogResponse, result), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/generate-summary")
class DocumentGenerateSummaryApi(Resource):
    @console_ns.doc("generate_summary_for_documents")
    @console_ns.doc(description="Generate summary index for documents")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[GenerateSummaryPayload.__name__])
    @console_ns.response(
        200,
        "Summary generation started successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @console_ns.response(400, "Invalid request or dataset configuration")
    @console_ns.response(403, "Permission denied")
    @console_ns.response(404, "Dataset not found")
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES, rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),)
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    @model_validate(GenerateSummaryPayload)
    def post(self, req_data: GenerateSummaryPayload, request_context: RequestContext, dataset_id: UUID):
        """
        Generate summary index for specified documents.

        This endpoint checks if the dataset configuration supports summary generation
        (indexing_technique must be 'high_quality' and summary_index_setting.enable must be true),
        then asynchronously generates summary indexes for the provided documents.
        """
        if not req_data.document_list:
            raise BadRequest("document_list cannot be empty.")
        try:
            application_services().knowledge.documents.generate_summary(
                request_context, dataset_id=str(dataset_id), document_ids=req_data.document_list
            )
        except Exception as error:
            _raise_document_error(error)
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/summary-status")
class DocumentSummaryStatusApi(Resource):
    @console_ns.doc("get_document_summary_status")
    @console_ns.doc(description="Get summary index generation status for a document")
    @console_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @console_ns.response(
        200,
        "Summary status retrieved successfully",
        console_ns.models[DocumentSummaryStatusResponse.__name__],
    )
    @console_ns.response(404, "Document not found")
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_READONLY, DatasetId()),))
    def get(self, request_context: RequestContext, dataset_id: UUID, document_id: UUID):
        """
        Get summary index generation status for a document.

        Returns:
        - total_segments: Total number of segments in the document
        - summary_status: Dictionary with status counts
          - completed: Number of summaries completed
          - generating: Number of summaries being generated
          - error: Number of summaries with errors
          - not_started: Number of segments without summary records
          - timeout: Number of summaries that timed out
        - summaries: List of summary records with status and content preview
        """
        try:
            result = application_services().knowledge.documents.get_summary_status(
                request_context, dataset_id=str(dataset_id), document_id=str(document_id)
            )
        except Exception as error:
            _raise_document_error(error)
        return dump_response(DocumentSummaryStatusResponse, result), 200

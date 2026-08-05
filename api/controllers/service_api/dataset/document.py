"""Service API endpoints for dataset document management.

The canonical Service API paths use hyphenated route segments. Legacy underscore
aliases remain registered for backward compatibility, but they must stay marked
deprecated in generated API docs so clients migrate toward the canonical paths.
"""

import json
from collections.abc import Mapping
from contextlib import ExitStack
from copy import deepcopy
from typing import Annotated, Any, Literal, Self, override
from uuid import UUID

from flask import request, send_file
from pydantic import (
    BaseModel,
    Field,
    GetJsonSchemaHandler,
    ValidationError,
    WithJsonSchema,
    field_validator,
    model_validator,
)
from pydantic.json_schema import SkipJsonSchema
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.common.controller_schemas import DocumentBatchDownloadZipPayload
from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
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
from controllers.common.session import with_session
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.dataset.error import (
    ArchivedDocumentImmutableError,
    DocumentIndexingError,
    InvalidMetadataError,
)
from controllers.service_api.schema import binary_response
from controllers.service_api.wraps import (
    DatasetApiResource,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
)
from core.errors.error import ProviderTokenNotInitError
from core.rag.entities import PreProcessingRule, Rule, Segmentation
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.document_fields import (
    DocumentListResponse,
    DocumentMetadataResponse,
    DocumentResponse,
    DocumentStatusListResponse,
    document_response,
    document_responses,
    normalize_enum,
)
from libs.helper import dump_response
from libs.login import current_user
from libs.pagination import paginate_query
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import SegmentStatus
from services.dataset_service import DatasetService, DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    DocForm,
    IndexingTechnique,
    KnowledgeConfig,
    ProcessRule,
    RetrievalModel,
)
from services.file_service import FileService
from services.summary_index_service import SummaryIndexService


class DocumentTextCreatePayload(BaseModel):
    name: str = Field(description="Document name.")
    text: str = Field(description="Document text content.")
    process_rule: ProcessRule | None = Field(default=None, description="Processing rules for chunking.")
    original_document_id: str | None = Field(default=None, description="Original document ID for replacement.")
    doc_form: DocForm = Field(
        default="text_model",
        description=(
            "`text_model` for standard text chunking, `hierarchical_model` for parent-child chunk structure, "
            "`qa_model` for question-answer pair extraction."
        ),
    )
    doc_language: str = Field(default="English", description="Language of the document for processing optimization.")
    indexing_technique: IndexingTechnique = Field(
        default=None,
        description=(
            "`high_quality` uses embedding models for precise search; `economy` uses keyword-based indexing. "
            "Required when adding the first document to a knowledge base; subsequent documents inherit the "
            "knowledge base's indexing technique if omitted."
        ),
    )
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description="Retrieval model configuration. Controls how chunks are searched and ranked.",
    )
    embedding_model: str | None = Field(
        default=None,
        description=(
            "Embedding model name. Use the `model` field from "
            "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`."
        ),
    )
    embedding_model_provider: str | None = Field(
        default=None,
        description=(
            "Embedding model provider. Use the `provider` field from "
            "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`."
        ),
    )

    @field_validator("doc_form")
    @classmethod
    def validate_doc_form(cls, value: str) -> str:
        if value not in Dataset.DOC_FORM_LIST:
            raise ValueError("Invalid doc_form.")
        return value


class DocumentTextUpdate(BaseModel):
    name: str | None = Field(default=None, description="Document name. Required when `text` is provided.")
    text: str | None = Field(default=None, description="Document text content.")
    process_rule: ProcessRule | None = Field(default=None, description="Processing rules for chunking.")
    doc_form: DocForm = Field(
        default="text_model",
        description=(
            "`text_model` for standard text chunking, `hierarchical_model` for parent-child chunk structure, "
            "`qa_model` for question-answer pair extraction."
        ),
    )
    doc_language: str = Field(default="English", description="Language of the document for processing optimization.")
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description="Retrieval model configuration. Controls how chunks are searched and ranked.",
    )

    @field_validator("doc_form")
    @classmethod
    def validate_doc_form(cls, value: str) -> str:
        if value not in Dataset.DOC_FORM_LIST:
            raise ValueError("Invalid doc_form.")
        return value

    @classmethod
    @override
    def __get_pydantic_json_schema__(cls, core_schema: Any, handler: GetJsonSchemaHandler) -> dict[str, Any]:
        schema = handler.resolve_ref_schema(handler(core_schema))
        properties = schema.get("properties")
        if not isinstance(properties, dict):
            return schema

        text_branch_properties = deepcopy(properties)
        text_branch_properties["text"] = _non_null_property_schema(properties.get("text"))
        text_branch_properties["name"] = _non_null_property_schema(properties.get("name"))

        no_text_branch_properties = deepcopy(properties)
        no_text_branch_properties["text"] = {"description": "Document text content.", "type": "null"}

        return {
            **schema,
            "anyOf": [
                {
                    "properties": text_branch_properties,
                    "required": ["name", "text"],
                    "type": "object",
                },
                {
                    "properties": no_text_branch_properties,
                    "type": "object",
                },
            ],
        }

    @model_validator(mode="after")
    def check_text_and_name(self) -> Self:
        if self.text is not None and self.name is None:
            raise ValueError("name is required when text is provided")
        return self


def _non_null_property_schema(property_schema: object) -> dict[str, Any]:
    if not isinstance(property_schema, dict):
        return {}

    any_of = property_schema.get("anyOf")
    if isinstance(any_of, list):
        non_null_candidates = [
            candidate for candidate in any_of if isinstance(candidate, dict) and candidate.get("type") != "null"
        ]
        if len(non_null_candidates) == 1:
            return {
                **{key: value for key, value in property_schema.items() if key != "anyOf"},
                **deepcopy(non_null_candidates[0]),
            }

    return deepcopy(property_schema)


DocumentDisplayStatus = Annotated[
    str | None,
    WithJsonSchema(
        {
            "anyOf": [
                {
                    "enum": ["queuing", "indexing", "paused", "error", "available", "disabled", "archived"],
                    "type": "string",
                },
                {"type": "null"},
            ]
        }
    ),
]


class DocumentListQuery(BaseModel):
    page: int = Field(default=1, description="Page number to retrieve.")
    limit: int = Field(default=20, description="Number of items per page. Server caps at `100`.")
    keyword: str | None = Field(default=None, description="Search keyword to filter by document name.")
    status: DocumentDisplayStatus = Field(default=None, description="Filter by display status.")


class DocumentGetQuery(BaseModel):
    metadata: Literal["all", "only", "without"] = Field(
        default="all",
        description=(
            "`all` returns all fields including metadata. `only` returns only `id`, `doc_type`, and "
            "`doc_metadata`. `without` returns all fields except `doc_metadata`."
        ),
    )


DOCUMENT_CREATE_BY_FILE_PARAMS = {
    "dataset_id": "Knowledge base ID.",
    "file": {
        "in": "formData",
        "type": "file",
        "required": True,
        "description": "Document file to upload.",
    },
    "data": {
        "in": "formData",
        "type": "string",
        "required": False,
        "description": (
            "JSON string containing configuration. Accepts the same fields as "
            "[Create Document by Text](/api-reference/documents/create-document-by-text) (`indexing_technique`, "
            "`doc_form`, `doc_language`, `process_rule`, `retrieval_model`, `embedding_model`, "
            "`embedding_model_provider`) except `name` and `text`."
        ),
    },
}
DOCUMENT_UPDATE_BY_FILE_PARAMS = {
    "dataset_id": "Knowledge base ID.",
    "document_id": "Document ID.",
    "file": {
        "in": "formData",
        "type": "file",
        "required": False,
        "description": "Replacement document file to upload.",
    },
    "data": {
        "in": "formData",
        "type": "string",
        "required": False,
        "description": (
            "JSON string containing document update settings such as `doc_form`, `doc_language`, `process_rule`, "
            "`retrieval_model`, `embedding_model`, and `embedding_model_provider`. `name` and `text` are not used "
            "for file updates."
        ),
    },
}


class DocumentAndBatchResponse(ResponseModel):
    document: DocumentResponse
    batch: str


def _document_and_batch_response(document: Document, batch: str, *, session: Session) -> dict[str, Any]:
    return dump_response(
        DocumentAndBatchResponse,
        {"document": document_response(document, session=session), "batch": batch},
    )


# Use SkipJsonSchema to support 3 metadata modes
class DocumentDetailResponse(ResponseModel):
    id: str
    position: int | SkipJsonSchema[None] = None
    data_source_type: str | SkipJsonSchema[None] = None
    data_source_info: dict[str, Any] | SkipJsonSchema[None] = None
    dataset_process_rule_id: str | None = None
    dataset_process_rule: dict[str, Any] | SkipJsonSchema[None] = None
    document_process_rule: dict[str, Any] | SkipJsonSchema[None] = None
    name: str | SkipJsonSchema[None] = None
    created_from: str | SkipJsonSchema[None] = None
    created_by: str | SkipJsonSchema[None] = None
    created_at: int | SkipJsonSchema[None] = None
    tokens: int | None = None
    indexing_status: str | SkipJsonSchema[None] = None
    completed_at: int | None = None
    updated_at: int | None = None
    indexing_latency: float | None = None
    error: str | None = None
    enabled: bool | SkipJsonSchema[None] = None
    disabled_at: int | None = None
    disabled_by: str | None = None
    archived: bool | SkipJsonSchema[None] = None
    doc_type: str | None = None
    doc_metadata: list[DocumentMetadataResponse] | dict[str, Any] | None = None
    segment_count: int | SkipJsonSchema[None] = None
    average_segment_length: int | float | SkipJsonSchema[None] = None
    hit_count: int | SkipJsonSchema[None] = None
    display_status: str | None = None
    doc_form: str | SkipJsonSchema[None] = None
    doc_language: str | None = None
    summary_index_status: str | None = None
    need_summary: bool | SkipJsonSchema[None] = None

    @field_validator("data_source_type", "indexing_status", "display_status", "doc_form", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> Any:
        return normalize_enum(value)


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


def _create_document_by_text(session: Session, tenant_id: str, dataset_id: UUID) -> tuple[Document, str]:
    """Create a document from text for both canonical and legacy routes."""
    payload = DocumentTextCreatePayload.model_validate(service_api_ns.payload or {})
    args = payload.model_dump(exclude_none=True)

    dataset_id_str = str(dataset_id)
    tenant_id_str = str(tenant_id)
    dataset = session.scalar(
        select(Dataset).where(Dataset.tenant_id == tenant_id_str, Dataset.id == dataset_id_str).limit(1)
    )

    if not dataset:
        raise ValueError("Dataset does not exist.")

    if not dataset.indexing_technique and not args.get("indexing_technique"):
        raise ValueError("indexing_technique is required.")

    embedding_model_provider = payload.embedding_model_provider
    embedding_model = payload.embedding_model
    if embedding_model_provider and embedding_model:
        DatasetService.check_embedding_model_setting(tenant_id_str, embedding_model_provider, embedding_model)

    retrieval_model = payload.retrieval_model
    if (
        retrieval_model
        and retrieval_model.reranking_model
        and retrieval_model.reranking_model.reranking_provider_name
        and retrieval_model.reranking_model.reranking_model_name
    ):
        DatasetService.check_reranking_model_setting(
            tenant_id_str,
            retrieval_model.reranking_model.reranking_provider_name,
            retrieval_model.reranking_model.reranking_model_name,
        )

    if not current_user:
        raise ValueError("current_user is required")

    upload_file = FileService(db.engine).upload_text(
        text=payload.text, text_name=payload.name, user_id=current_user.id, tenant_id=tenant_id_str
    )
    data_source = {
        "type": "upload_file",
        "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": [upload_file.id]}},
    }
    args["data_source"] = data_source
    knowledge_config = KnowledgeConfig.model_validate(args)
    DocumentService.document_create_args_validate(knowledge_config)

    if not current_user:
        raise ValueError("current_user is required")

    try:
        documents, batch = DocumentService.save_document_with_dataset_id(
            dataset=dataset,
            knowledge_config=knowledge_config,
            account=current_user,
            dataset_process_rule=dataset.get_latest_process_rule(session=session)
            if "process_rule" not in args
            else None,
            created_from="api",
            session=session,
        )
    except ProviderTokenNotInitError as ex:
        raise ProviderNotInitializeError(ex.description)
    document = documents[0]

    return document, batch


def _update_document_by_text(
    session: Session, tenant_id: str, dataset_id: UUID, document_id: UUID
) -> tuple[Document, str]:
    """Update a document from text for both canonical and legacy routes."""
    payload = DocumentTextUpdate.model_validate(service_api_ns.payload or {})
    dataset = session.scalar(
        select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == str(dataset_id)).limit(1)
    )
    args = payload.model_dump(exclude_none=True)
    if not dataset:
        raise ValueError("Dataset does not exist.")

    retrieval_model = payload.retrieval_model
    if (
        retrieval_model
        and retrieval_model.reranking_model
        and retrieval_model.reranking_model.reranking_provider_name
        and retrieval_model.reranking_model.reranking_model_name
    ):
        DatasetService.check_reranking_model_setting(
            tenant_id,
            retrieval_model.reranking_model.reranking_provider_name,
            retrieval_model.reranking_model.reranking_model_name,
        )

    # indexing_technique is already set in dataset since this is an update
    args["indexing_technique"] = dataset.indexing_technique

    if args.get("text"):
        text = args.get("text")
        name = args.get("name")
        if not current_user:
            raise ValueError("current_user is required")
        upload_file = FileService(db.engine).upload_text(
            text=str(text), text_name=str(name), user_id=current_user.id, tenant_id=tenant_id
        )
        data_source = {
            "type": "upload_file",
            "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": [upload_file.id]}},
        }
        args["data_source"] = data_source

    args["original_document_id"] = str(document_id)
    knowledge_config = KnowledgeConfig.model_validate(args)
    DocumentService.document_create_args_validate(knowledge_config)

    try:
        documents, batch = DocumentService.save_document_with_dataset_id(
            dataset=dataset,
            knowledge_config=knowledge_config,
            account=current_user,
            dataset_process_rule=dataset.get_latest_process_rule(session=session)
            if "process_rule" not in args
            else None,
            created_from="api",
            session=session,
        )
    except ProviderTokenNotInitError as ex:
        raise ProviderNotInitializeError(ex.description)
    document = documents[0]

    return document, batch


@service_api_ns.route("/datasets/<uuid:dataset_id>/document/create-by-text")
class DocumentAddByTextApi(DatasetApiResource):
    """Resource for the canonical text document creation route."""

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
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_resource_check("documents", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session
    def post(self, session: Session, tenant_id: str, dataset_id: UUID):
        """Create document by text."""
        document, batch = _create_document_by_text(session=session, tenant_id=tenant_id, dataset_id=dataset_id)
        return _document_and_batch_response(document, batch, session=session), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/document/create_by_text")
class DeprecatedDocumentAddByTextApi(DatasetApiResource):
    """Deprecated resource alias for text document creation."""

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
        }
    )
    @service_api_ns.response(
        200, "Document created successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_resource_check("documents", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session
    def post(self, session: Session, tenant_id: str, dataset_id: UUID):
        """Create document by text through the deprecated underscore alias."""
        document, batch = _create_document_by_text(session=session, tenant_id=tenant_id, dataset_id=dataset_id)
        return _document_and_batch_response(document, batch, session=session), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update-by-text")
class DocumentUpdateByTextApi(DatasetApiResource):
    """Resource for the canonical text document update route."""

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
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session
    def post(self, session: Session, tenant_id: str, dataset_id: UUID, document_id: UUID):
        """Update document by text."""
        document, batch = _update_document_by_text(
            session=session, tenant_id=tenant_id, dataset_id=dataset_id, document_id=document_id
        )
        return _document_and_batch_response(document, batch, session=session), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update_by_text")
class DeprecatedDocumentUpdateByTextApi(DatasetApiResource):
    """Deprecated resource alias for text document updates."""

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
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session
    def post(self, session: Session, tenant_id: str, dataset_id: UUID, document_id: UUID):
        """Update document by text through the deprecated underscore alias."""
        document, batch = _update_document_by_text(
            session=session, tenant_id=tenant_id, dataset_id=dataset_id, document_id=document_id
        )
        return _document_and_batch_response(document, batch, session=session), 200


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
                "file too large, unsupported file type, missing required fields, or invalid doc_form "
                "(must be `text_model`, `hierarchical_model`, or `qa_model`)."
            ),
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
        }
    )
    @service_api_ns.response(
        200, "Document created successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_resource_check("documents", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session
    def post(self, session: Session, tenant_id, dataset_id: UUID):
        """Create document by upload file."""
        dataset = session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).limit(1)
        )

        if not dataset:
            raise ValueError("Dataset does not exist.")

        if dataset.provider == "external":
            raise ValueError("External datasets are not supported.")

        args = {}
        if "data" in request.form:
            args = json.loads(request.form["data"])
        if "doc_form" not in args:
            args["doc_form"] = dataset.chunk_structure or "text_model"
        if "doc_language" not in args:
            args["doc_language"] = "English"

        # get dataset info
        tenant_id = str(tenant_id)

        indexing_technique = args.get("indexing_technique") or dataset.indexing_technique
        if not indexing_technique:
            raise ValueError("indexing_technique is required.")
        args["indexing_technique"] = indexing_technique

        if "embedding_model_provider" in args:
            DatasetService.check_embedding_model_setting(
                tenant_id, args["embedding_model_provider"], args["embedding_model"]
            )
        if (
            "retrieval_model" in args
            and args["retrieval_model"].get("reranking_model")
            and args["retrieval_model"].get("reranking_model").get("reranking_provider_name")
        ):
            DatasetService.check_reranking_model_setting(
                tenant_id,
                args["retrieval_model"].get("reranking_model").get("reranking_provider_name"),
                args["retrieval_model"].get("reranking_model").get("reranking_model_name"),
            )

        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        # save file info
        file = request.files["file"]
        if not file.filename:
            raise FilenameNotExistsError

        if not current_user:
            raise ValueError("current_user is required")
        upload_file = FileService(db.engine).upload_file(
            filename=file.filename,
            content=file.stream.read(),
            mimetype=file.mimetype,
            user=current_user,
            source="datasets",
        )
        data_source = {
            "type": "upload_file",
            "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": [upload_file.id]}},
        }
        args["data_source"] = data_source
        # validate args
        knowledge_config = KnowledgeConfig.model_validate(args)
        DocumentService.document_create_args_validate(knowledge_config)

        dataset_process_rule = dataset.get_latest_process_rule(session=session) if "process_rule" not in args else None
        if not knowledge_config.original_document_id and not dataset_process_rule and not knowledge_config.process_rule:
            raise ValueError("process_rule is required.")

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                knowledge_config=knowledge_config,
                account=dataset.get_created_by_account(session=session),
                dataset_process_rule=dataset_process_rule,
                created_from="api",
                session=session,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]
        return _document_and_batch_response(document, batch, session=session), 200


def _update_document_by_file(
    session: Session, tenant_id: str, dataset_id: UUID, document_id: UUID
) -> tuple[Document, str]:
    """Update a document from an uploaded file for canonical and deprecated routes."""
    dataset_id_str = str(dataset_id)
    dataset = session.scalar(
        select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
    )

    if not dataset:
        raise ValueError("Dataset does not exist.")

    if dataset.provider == "external":
        raise ValueError("External datasets are not supported.")

    args: dict[str, object] = {}
    if "data" in request.form:
        args = json.loads(request.form["data"])
    if "doc_form" not in args:
        args["doc_form"] = dataset.chunk_structure or "text_model"
    if "doc_language" not in args:
        args["doc_language"] = "English"

    # indexing_technique is already set in dataset since this is an update
    args["indexing_technique"] = dataset.indexing_technique

    if "file" in request.files:
        # save file info
        file = request.files["file"]

        if len(request.files) > 1:
            raise TooManyFilesError()

        if not file.filename:
            raise FilenameNotExistsError

        if not current_user:
            raise ValueError("current_user is required")

        try:
            upload_file = FileService(db.engine).upload_file(
                filename=file.filename,
                content=file.stream.read(),
                mimetype=file.mimetype,
                user=current_user,
                source="datasets",
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()
        data_source = {
            "type": "upload_file",
            "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": [upload_file.id]}},
        }
        args["data_source"] = data_source

    # validate args
    args["original_document_id"] = str(document_id)

    knowledge_config = KnowledgeConfig.model_validate(args)
    DocumentService.document_create_args_validate(knowledge_config)

    try:
        documents, _ = DocumentService.save_document_with_dataset_id(
            dataset=dataset,
            knowledge_config=knowledge_config,
            account=dataset.get_created_by_account(session=session),
            dataset_process_rule=dataset.get_latest_process_rule(session=session)
            if "process_rule" not in args
            else None,
            created_from="api",
            session=session,
        )
    except ProviderTokenNotInitError as ex:
        raise ProviderNotInitializeError(ex.description)
    document = documents[0]
    return document, document.batch


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update_by_file",
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update-by-file",
)
class DeprecatedDocumentUpdateByFileApi(DatasetApiResource):
    """Deprecated resource aliases for file document updates."""

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
                "file too large, unsupported file type, or invalid doc_form (must be `text_model`, "
                "`hierarchical_model`, or `qa_model`)."
            ),
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
        }
    )
    @service_api_ns.response(
        200, "Document updated successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session
    def post(self, session: Session, tenant_id: str, dataset_id: UUID, document_id: UUID):
        """Update document by file through the deprecated file-update aliases."""
        document, batch = _update_document_by_file(
            session=session, tenant_id=tenant_id, dataset_id=dataset_id, document_id=document_id
        )
        return _document_and_batch_response(document, batch, session=session), 200


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
    @with_session(write=False)
    def get(self, session: Session, tenant_id, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        tenant_id = str(tenant_id)
        query_params = query_params_from_request(DocumentListQuery)
        dataset = session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")

        query = select(Document).where(Document.dataset_id == dataset_id_str, Document.tenant_id == tenant_id)

        if query_params.status:
            query = DocumentService.apply_display_status_filter(query, query_params.status)

        if query_params.keyword:
            search = f"%{query_params.keyword}%"
            query = query.where(Document.name.like(search))

        query = query.order_by(desc(Document.created_at), desc(Document.position))

        paginated_documents = paginate_query(
            query, session=session, page=query_params.page, per_page=query_params.limit, max_per_page=100
        )
        documents = paginated_documents.items

        DocumentService.enrich_documents_with_summary_index_status(
            documents=documents,
            dataset=dataset,
            tenant_id=tenant_id,
            session=session,
        )

        response = {
            "data": document_responses(documents, session=session),
            "has_more": len(documents) == query_params.limit,
            "limit": query_params.limit,
            "total": paginated_documents.total,
            "page": query_params.page,
        }

        return dump_response(DocumentListResponse, response)


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
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session(write=False)
    def post(self, session: Session, tenant_id, dataset_id: UUID):
        payload = DocumentBatchDownloadZipPayload.model_validate(service_api_ns.payload or {})

        upload_files, download_name = DocumentService.prepare_document_batch_download_zip(
            dataset_id=str(dataset_id),
            document_ids=[str(document_id) for document_id in payload.document_ids],
            tenant_id=str(tenant_id),
            current_user=current_user,
            session=session,
        )

        with ExitStack() as stack:
            zip_path = stack.enter_context(FileService.build_upload_files_zip_tempfile(upload_files=upload_files))
            response = send_file(
                zip_path,
                mimetype="application/zip",
                as_attachment=True,
                download_name=download_name,
            )
            cleanup = stack.pop_all()
            response.call_on_close(cleanup.close)
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
    @with_session(write=False)
    def get(self, session: Session, tenant_id, dataset_id: UUID, batch: str):
        dataset_id_str = str(dataset_id)
        tenant_id = str(tenant_id)
        # get dataset
        dataset = session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )
        if not dataset:
            raise NotFound("Dataset not found.")
        # get documents
        documents = DocumentService.get_batch_documents(dataset_id_str, batch, session)
        if not documents:
            raise NotFound("Documents not found.")
        documents_status = []
        for document in documents:
            completed_segments = (
                session.scalar(
                    select(func.count(DocumentSegment.id)).where(
                        DocumentSegment.completed_at.isnot(None),
                        DocumentSegment.document_id == str(document.id),
                        DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                    )
                )
                or 0
            )
            total_segments = (
                session.scalar(
                    select(func.count(DocumentSegment.id)).where(
                        DocumentSegment.document_id == str(document.id),
                        DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                    )
                )
                or 0
            )
            # Create a dictionary with document attributes and additional fields
            document_dict = {
                "id": document.id,
                "indexing_status": "paused" if document.is_paused else document.indexing_status,
                "processing_started_at": document.processing_started_at,
                "parsing_completed_at": document.parsing_completed_at,
                "cleaning_completed_at": document.cleaning_completed_at,
                "splitting_completed_at": document.splitting_completed_at,
                "completed_at": document.completed_at,
                "paused_at": document.paused_at,
                "error": document.error,
                "stopped_at": document.stopped_at,
                "completed_segments": completed_segments,
                "total_segments": total_segments,
            }
            documents_status.append(document_dict)
        return dump_response(DocumentStatusListResponse, {"data": documents_status})


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
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session(write=False)
    def get(self, session: Session, tenant_id, dataset_id: UUID, document_id: UUID):
        dataset = DatasetService.get_dataset_for_tenant(str(dataset_id), str(tenant_id), session=session)
        if not dataset:
            raise NotFound("Dataset not found.")
        document = DocumentService.get_document(dataset.id, str(document_id), session=session)

        if not document:
            raise NotFound("Document not found.")

        if document.tenant_id != str(tenant_id):
            raise Forbidden("No permission.")

        return UrlResponse(url=DocumentService.get_document_download_url(document, session)).model_dump(mode="json")


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>")
class DocumentApi(DatasetApiResource):
    METADATA_CHOICES = {"all", "only", "without"}

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
    @with_session(write=False)
    def get(self, session: Session, tenant_id, dataset_id: UUID, document_id: UUID):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)

        dataset = DatasetService.get_dataset_for_tenant(dataset_id_str, str(tenant_id), session=session)
        if not dataset:
            raise NotFound("Dataset not found.")

        document = DocumentService.get_document(dataset.id, document_id_str, session=session)

        if not document:
            raise NotFound("Document not found.")

        if document.tenant_id != str(tenant_id):
            raise Forbidden("No permission.")

        try:
            query_params = query_params_from_request(DocumentGetQuery)
        except ValidationError as exc:
            metadata = request.args.get("metadata", "all")
            raise InvalidMetadataError(f"Invalid metadata value: {metadata}") from exc
        metadata = query_params.metadata
        response_include: set[str] | None = None
        response_exclude: set[str] | None = None

        # Calculate summary_index_status if needed
        summary_index_status = None
        has_summary_index = dataset.summary_index_setting and dataset.summary_index_setting.get("enable") is True
        if has_summary_index and document.need_summary is True:
            summary_index_status = SummaryIndexService.get_document_summary_index_status(
                document_id=document_id_str,
                dataset_id=dataset_id_str,
                tenant_id=tenant_id,
                session=session,
            )

        if metadata == "only":
            response_include = {"id", "doc_type", "doc_metadata"}
            response = {
                "id": document.id,
                "doc_type": document.doc_type,
                "doc_metadata": document.get_doc_metadata_details(session=session),
            }
        elif metadata == "without":
            dataset_process_rules = DatasetService.get_process_rules(dataset_id_str, session)
            response_exclude = {"doc_type", "doc_metadata"}
            document_process_rule = document.get_dataset_process_rule(session=session)
            document_process_rules: Mapping[str, Any] = document_process_rule.to_dict() if document_process_rule else {}
            data_source_info = document.get_data_source_detail_dict(session=session)
            segment_count = document.get_segment_count(session=session)
            response = {
                "id": document.id,
                "position": document.position,
                "data_source_type": document.data_source_type,
                "data_source_info": data_source_info,
                "dataset_process_rule_id": document.dataset_process_rule_id,
                "dataset_process_rule": dataset_process_rules,
                "document_process_rule": document_process_rules,
                "name": document.name,
                "created_from": document.created_from,
                "created_by": document.created_by,
                "created_at": int(document.created_at.timestamp()),
                "tokens": document.tokens,
                "indexing_status": document.indexing_status,
                "completed_at": int(document.completed_at.timestamp()) if document.completed_at else None,
                "updated_at": int(document.updated_at.timestamp()) if document.updated_at else None,
                "indexing_latency": document.indexing_latency,
                "error": document.error,
                "enabled": document.enabled,
                "disabled_at": int(document.disabled_at.timestamp()) if document.disabled_at else None,
                "disabled_by": document.disabled_by,
                "archived": document.archived,
                "segment_count": segment_count,
                "average_segment_length": (document.word_count or 0) // segment_count if segment_count else 0,
                "hit_count": document.get_hit_count(session=session),
                "display_status": document.display_status,
                "doc_form": document.doc_form,
                "doc_language": document.doc_language,
                "summary_index_status": summary_index_status,
                "need_summary": document.need_summary if document.need_summary is not None else False,
            }
        else:
            dataset_process_rules = DatasetService.get_process_rules(dataset_id_str, session)
            document_process_rule = document.get_dataset_process_rule(session=session)
            document_process_rules = document_process_rule.to_dict() if document_process_rule else {}
            data_source_info = document.get_data_source_detail_dict(session=session)
            segment_count = document.get_segment_count(session=session)
            response = {
                "id": document.id,
                "position": document.position,
                "data_source_type": document.data_source_type,
                "data_source_info": data_source_info,
                "dataset_process_rule_id": document.dataset_process_rule_id,
                "dataset_process_rule": dataset_process_rules,
                "document_process_rule": document_process_rules,
                "name": document.name,
                "created_from": document.created_from,
                "created_by": document.created_by,
                "created_at": int(document.created_at.timestamp()),
                "tokens": document.tokens,
                "indexing_status": document.indexing_status,
                "completed_at": int(document.completed_at.timestamp()) if document.completed_at else None,
                "updated_at": int(document.updated_at.timestamp()) if document.updated_at else None,
                "indexing_latency": document.indexing_latency,
                "error": document.error,
                "enabled": document.enabled,
                "disabled_at": int(document.disabled_at.timestamp()) if document.disabled_at else None,
                "disabled_by": document.disabled_by,
                "archived": document.archived,
                "doc_type": document.doc_type,
                "doc_metadata": document.get_doc_metadata_details(session=session),
                "segment_count": segment_count,
                "average_segment_length": (document.word_count or 0) // segment_count if segment_count else 0,
                "hit_count": document.get_hit_count(session=session),
                "display_status": document.display_status,
                "doc_form": document.doc_form,
                "doc_language": document.doc_language,
                "summary_index_status": summary_index_status,
                "need_summary": document.need_summary if document.need_summary is not None else False,
            }

        return DocumentDetailResponse.model_validate(response).model_dump(
            mode="json",
            include=response_include,
            exclude=response_exclude,
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
                "file too large, unsupported file type, or invalid doc_form (must be `text_model`, "
                "`hierarchical_model`, or `qa_model`)."
            ),
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
        }
    )
    @service_api_ns.response(
        200, "Document updated successfully", service_api_ns.models[DocumentAndBatchResponse.__name__]
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session
    def patch(self, session: Session, tenant_id: str, dataset_id: UUID, document_id: UUID):
        """Update document by file on the canonical document resource."""
        document, batch = _update_document_by_file(
            session=session, tenant_id=tenant_id, dataset_id=dataset_id, document_id=document_id
        )
        return _document_and_batch_response(document, batch, session=session), 200

    @service_api_ns.doc(
        summary="Delete Document",
        description="Permanently delete a document and all its chunks from the knowledge base.",
        tags=["Documents"],
        responses={
            204: "Success.",
            400: "`document_indexing` : Cannot delete document during indexing.",
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
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session
    def delete(self, session: Session, tenant_id, dataset_id: UUID, document_id: UUID):
        """Delete document."""
        document_id_str = str(document_id)
        dataset_id_str = str(dataset_id)
        tenant_id = str(tenant_id)

        # get dataset info
        dataset = session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id_str).limit(1)
        )

        if not dataset:
            raise ValueError("Dataset does not exist.")

        document = DocumentService.get_document(dataset.id, document_id_str, session=session)

        # 404 if document not found
        if document is None:
            raise NotFound("Document Not Exists.")

        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()

        try:
            # delete document
            DocumentService.delete_document(document, session)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot delete document during indexing.")

        return "", 204

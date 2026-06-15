import json
import logging
from argparse import ArgumentTypeError
from collections.abc import Sequence
from contextlib import ExitStack
from datetime import datetime
from typing import Any, Literal, cast
from uuid import UUID

import sqlalchemy as sa
from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel, field_validator
from sqlalchemy import asc, desc, func, select
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.common.controller_schemas import DocumentBatchDownloadZipPayload
from controllers.common.fields import BinaryFileResponse, SimpleResultMessageResponse, SimpleResultResponse, UrlResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import RBACPermission, RBACResourceScope, rbac_permission_required
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.indexing_runner import IndexingRunner
from core.model_manager import ModelManager
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.entity.extract_setting import ExtractSetting, NotionInfo, WebsiteInfo
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.document_fields import (
    DocumentMetadataResponse,
    DocumentResponse,
    DocumentStatusListResponse,
    DocumentStatusResponse,
    normalize_enum,
)
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from libs.datetime_utils import naive_utc_now
from libs.helper import dump_response, to_timestamp
from libs.login import login_required
from models import Account, DatasetProcessRule, Document, DocumentSegment, UploadFile
from models.dataset import DocumentPipelineExecutionLog
from models.enums import IndexingStatus, SegmentStatus
from services.dataset_service import DatasetService, DocumentService
from services.entities.knowledge_entities.knowledge_entities import KnowledgeConfig, ProcessRule, RetrievalModel
from services.file_service import FileService
from tasks.generate_summary_index_task import generate_summary_index_task

from ..app.error import (
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from ..datasets.error import (
    ArchivedDocumentImmutableError,
    DocumentAlreadyFinishedError,
    DocumentIndexingError,
    IndexingEstimateError,
    InvalidActionError,
    InvalidMetadataError,
)
from ..wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)

logger = logging.getLogger(__name__)


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


class OpaqueObjectResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]


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
    BinaryFileResponse,
    SimpleResultMessageResponse,
    SimpleResultResponse,
    UrlResponse,
    DatasetResponse,
    DocumentMetadataResponse,
    DocumentResponse,
    DocumentWithSegmentsResponse,
    DatasetAndDocumentResponse,
    DocumentWithSegmentsListResponse,
    OpaqueObjectResponse,
)


class DocumentResource(Resource):
    def get_document(
        self, dataset_id: str, document_id: str, current_user: Account, current_tenant_id: str
    ) -> Document:
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        document = DocumentService.get_document(dataset_id, document_id)

        if not document:
            raise NotFound("Document not found.")

        if document.tenant_id != current_tenant_id:
            raise Forbidden("No permission.")

        return document

    def get_batch_documents(self, dataset_id: str, batch: str, current_user: Account) -> Sequence[Document]:
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        documents = DocumentService.get_batch_documents(dataset_id, batch)

        if not documents:
            raise NotFound("Documents not found.")

        return documents


@console_ns.route("/datasets/process-rule")
class GetProcessRuleApi(Resource):
    @console_ns.doc("get_process_rule")
    @console_ns.doc(description="Get dataset document processing rules")
    @console_ns.doc(params={"document_id": "Document ID (optional)"})
    @console_ns.response(200, "Process rules retrieved successfully", console_ns.models[OpaqueObjectResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def get(self, current_user: Account):
        req_data = request.args

        document_id = req_data.get("document_id")

        # get default rules
        mode = DocumentService.DEFAULT_RULES["mode"]
        rules = DocumentService.DEFAULT_RULES["rules"]
        limits = DocumentService.DEFAULT_RULES["limits"]
        if document_id:
            # get the latest process rule
            document = db.get_or_404(Document, document_id)

            dataset = DatasetService.get_dataset(document.dataset_id)

            if not dataset:
                raise NotFound("Dataset not found.")

            try:
                DatasetService.check_dataset_permission(dataset, current_user)
            except services.errors.account.NoPermissionError as e:
                raise Forbidden(str(e))

            # get the latest process rule
            dataset_process_rule = db.session.scalar(
                select(DatasetProcessRule)
                .where(DatasetProcessRule.dataset_id == document.dataset_id)
                .order_by(DatasetProcessRule.created_at.desc())
                .limit(1)
            )
            if dataset_process_rule:
                mode = dataset_process_rule.mode
                rules = dataset_process_rule.rules_dict

        return {"mode": mode, "rules": rules, "limits": limits}


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
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, current_tenant_id: str, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        raw_args = request.args.to_dict()
        param = DocumentDatasetListParam.model_validate(raw_args)
        page = param.page
        limit = param.limit
        search = param.search
        sort = param.sort_by
        status = param.status
        # "yes", "true", "t", "y", "1" convert to True, while others convert to False.
        try:
            fetch_val = param.fetch_val
            if isinstance(fetch_val, bool):
                fetch = fetch_val
            else:
                if fetch_val.lower() in ("yes", "true", "t", "y", "1"):
                    fetch = True
                elif fetch_val.lower() in ("no", "false", "f", "n", "0"):
                    fetch = False
                else:
                    raise ArgumentTypeError(
                        f"Truthy value expected: got {fetch_val} but expected one of yes/no, true/false, t/f, y/n, 1/0 "
                        f"(case insensitive)."
                    )
        except (ArgumentTypeError, ValueError, Exception):
            fetch = False
        dataset = DatasetService.get_dataset(dataset_id_str)
        if not dataset:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        query = select(Document).where(Document.dataset_id == dataset_id_str, Document.tenant_id == current_tenant_id)

        if status:
            query = DocumentService.apply_display_status_filter(query, status)

        if search:
            search = f"%{search}%"
            query = query.where(Document.name.like(search))

        if sort.startswith("-"):
            sort_logic = desc
            sort = sort[1:]
        else:
            sort_logic = asc

        match sort:
            case "hit_count":
                sub_query = (
                    sa.select(
                        DocumentSegment.document_id, sa.func.sum(DocumentSegment.hit_count).label("total_hit_count")
                    )
                    .where(DocumentSegment.dataset_id == dataset_id_str)
                    .group_by(DocumentSegment.document_id)
                    .subquery()
                )

                query = query.outerjoin(sub_query, sub_query.c.document_id == Document.id).order_by(
                    sort_logic(sa.func.coalesce(sub_query.c.total_hit_count, 0)),
                    sort_logic(Document.position),
                )
            case "created_at":
                query = query.order_by(
                    sort_logic(Document.created_at),
                    sort_logic(Document.position),
                )
            case _:
                query = query.order_by(
                    desc(Document.created_at),
                    desc(Document.position),
                )

        paginated_documents = db.paginate(select=query, page=page, per_page=limit, max_per_page=100, error_out=False)
        documents = paginated_documents.items

        DocumentService.enrich_documents_with_summary_index_status(
            documents=documents,
            dataset=dataset,
            tenant_id=current_tenant_id,
        )

        if fetch:
            for document in documents:
                completed_segments = (
                    db.session.scalar(
                        select(func.count(DocumentSegment.id)).where(
                            DocumentSegment.completed_at.isnot(None),
                            DocumentSegment.document_id == str(document.id),
                            DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                        )
                    )
                    or 0
                )
                total_segments = (
                    db.session.scalar(
                        select(func.count(DocumentSegment.id)).where(
                            DocumentSegment.document_id == str(document.id),
                            DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                        )
                    )
                    or 0
                )
                document.completed_segments = completed_segments
                document.total_segments = total_segments
        response = {
            "data": documents,
            "has_more": len(documents) == limit,
            "limit": limit,
            "total": paginated_documents.total,
            "page": page,
        }

        return dump_response(DocumentWithSegmentsListResponse, response)

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[KnowledgeConfig.__name__])
    @console_ns.response(200, "Documents created successfully", console_ns.models[DatasetAndDocumentResponse.__name__])
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def post(self, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)

        dataset = DatasetService.get_dataset(dataset_id_str)

        if not dataset:
            raise NotFound("Dataset not found.")

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        knowledge_config = KnowledgeConfig.model_validate(console_ns.payload or {})

        if not dataset.indexing_technique and not knowledge_config.indexing_technique:
            raise ValueError("indexing_technique is required.")

        # validate args
        DocumentService.document_create_args_validate(knowledge_config)

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, current_user)
            dataset = DatasetService.get_dataset(dataset_id_str)

        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()

        return dump_response(DatasetAndDocumentResponse, {"dataset": dataset, "documents": documents, "batch": batch})

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.response(204, "Documents deleted successfully")
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def delete(self, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        try:
            document_ids = request.args.getlist("document_id")
            DocumentService.delete_documents(dataset, document_ids)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot delete document during indexing.")

        return "", 204


@console_ns.route("/datasets/init")
class DatasetInitApi(Resource):
    @console_ns.doc("init_dataset")
    @console_ns.doc(description="Initialize dataset with documents")
    @console_ns.expect(console_ns.models[KnowledgeConfig.__name__])
    @console_ns.response(
        201, "Dataset initialized successfully", console_ns.models[DatasetAndDocumentResponse.__name__]
    )
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        knowledge_config = KnowledgeConfig.model_validate(console_ns.payload or {})
        if knowledge_config.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            if knowledge_config.embedding_model is None or knowledge_config.embedding_model_provider is None:
                raise ValueError("embedding model and embedding model provider are required for high quality indexing.")
            try:
                model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=knowledge_config.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=knowledge_config.embedding_model,
                )
                is_multimodal = DatasetService.check_is_multimodal_model(
                    current_tenant_id, knowledge_config.embedding_model_provider, knowledge_config.embedding_model
                )
                knowledge_config.is_multimodal = is_multimodal  # pyrefly: ignore[bad-assignment]
            except InvokeAuthorizationError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)

        # validate args
        DocumentService.document_create_args_validate(knowledge_config)

        try:
            dataset, documents, batch = DocumentService.save_document_without_dataset_id(
                tenant_id=current_tenant_id,
                knowledge_config=knowledge_config,
                account=current_user,
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()

        return dump_response(DatasetAndDocumentResponse, {"dataset": dataset, "documents": documents, "batch": batch})


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/indexing-estimate")
class DocumentIndexingEstimateApi(DocumentResource):
    @console_ns.doc("estimate_document_indexing")
    @console_ns.doc(description="Estimate document indexing cost")
    @console_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @console_ns.response(
        200,
        "Indexing estimate calculated successfully",
        console_ns.models[OpaqueObjectResponse.__name__],
    )
    @console_ns.response(404, "Document not found")
    @console_ns.response(400, "Document already finished")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, current_tenant_id: str, current_user: Account, dataset_id: UUID, document_id: UUID):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        document = self.get_document(dataset_id_str, document_id_str, current_user, current_tenant_id)

        if document.indexing_status in {IndexingStatus.COMPLETED, IndexingStatus.ERROR}:
            raise DocumentAlreadyFinishedError()

        data_process_rule = document.dataset_process_rule
        data_process_rule_dict = data_process_rule.to_dict() if data_process_rule else {}

        response = {"tokens": 0, "total_price": 0, "currency": "USD", "total_segments": 0, "preview": []}

        if document.data_source_type == "upload_file":
            data_source_info = document.data_source_info_dict
            if data_source_info and "upload_file_id" in data_source_info:
                file_id = data_source_info["upload_file_id"]

                file = db.session.scalar(
                    select(UploadFile)
                    .where(UploadFile.tenant_id == document.tenant_id, UploadFile.id == file_id)
                    .limit(1)
                )

                # raise error if file not found
                if not file:
                    raise NotFound("File not found.")

                extract_setting = ExtractSetting(
                    datasource_type=DatasourceType.FILE, upload_file=file, document_model=document.doc_form
                )

                indexing_runner = IndexingRunner()

                try:
                    estimate_response = indexing_runner.indexing_estimate(
                        current_tenant_id,
                        [extract_setting],
                        data_process_rule_dict,
                        document.doc_form,
                        "English",
                        dataset_id_str,
                    )
                    return estimate_response.model_dump(), 200
                except LLMBadRequestError:
                    raise ProviderNotInitializeError(
                        "No Embedding Model available. Please configure a valid provider "
                        "in the Settings -> Model Provider."
                    )
                except ProviderTokenNotInitError as ex:
                    raise ProviderNotInitializeError(ex.description)
                except PluginDaemonClientSideError as ex:
                    raise ProviderNotInitializeError(ex.description)
                except Exception as e:
                    raise IndexingEstimateError(str(e))

        return response, 200


@console_ns.route("/datasets/<uuid:dataset_id>/batch/<string:batch>/indexing-estimate")
class DocumentBatchIndexingEstimateApi(DocumentResource):
    @console_ns.response(
        200,
        "Batch indexing estimate calculated successfully",
        console_ns.models[OpaqueObjectResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, current_tenant_id: str, current_user: Account, dataset_id: UUID, batch: str):
        dataset_id_str = str(dataset_id)
        documents = self.get_batch_documents(dataset_id_str, batch, current_user)
        if not documents:
            return {"tokens": 0, "total_price": 0, "currency": "USD", "total_segments": 0, "preview": []}, 200
        data_process_rule = documents[0].dataset_process_rule
        data_process_rule_dict = data_process_rule.to_dict() if data_process_rule else {}
        extract_settings = []
        for document in documents:
            if document.indexing_status in {IndexingStatus.COMPLETED, IndexingStatus.ERROR}:
                raise DocumentAlreadyFinishedError()
            data_source_info = document.data_source_info_dict
            match document.data_source_type:
                case "upload_file":
                    if not data_source_info:
                        continue
                    file_id = data_source_info["upload_file_id"]
                    file_detail = db.session.scalar(
                        select(UploadFile)
                        .where(UploadFile.tenant_id == current_tenant_id, UploadFile.id == file_id)
                        .limit(1)
                    )

                    if file_detail is None:
                        raise NotFound("File not found.")

                    extract_setting = ExtractSetting(
                        datasource_type=DatasourceType.FILE, upload_file=file_detail, document_model=document.doc_form
                    )
                    extract_settings.append(extract_setting)
                case "notion_import":
                    if not data_source_info:
                        continue
                    extract_setting = ExtractSetting(
                        datasource_type=DatasourceType.NOTION,
                        notion_info=NotionInfo.model_validate(
                            {
                                "credential_id": data_source_info.get("credential_id"),
                                "notion_workspace_id": data_source_info["notion_workspace_id"],
                                "notion_obj_id": data_source_info["notion_page_id"],
                                "notion_page_type": data_source_info["type"],
                                "tenant_id": current_tenant_id,
                            }
                        ),
                        document_model=document.doc_form,
                    )
                    extract_settings.append(extract_setting)
                case "website_crawl":
                    if not data_source_info:
                        continue
                    extract_setting = ExtractSetting(
                        datasource_type=DatasourceType.WEBSITE,
                        website_info=WebsiteInfo.model_validate(
                            {
                                "provider": data_source_info["provider"],
                                "job_id": data_source_info["job_id"],
                                "url": data_source_info["url"],
                                "tenant_id": current_tenant_id,
                                "mode": data_source_info["mode"],
                                "only_main_content": data_source_info["only_main_content"],
                            }
                        ),
                        document_model=document.doc_form,
                    )
                    extract_settings.append(extract_setting)

                case _:
                    raise ValueError("Data source type not support")
            indexing_runner = IndexingRunner()
            try:
                response = indexing_runner.indexing_estimate(
                    current_tenant_id,
                    extract_settings,
                    data_process_rule_dict,
                    document.doc_form,
                    "English",
                    dataset_id_str,
                )
                return response.model_dump(), 200
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
            except PluginDaemonClientSideError as ex:
                raise ProviderNotInitializeError(ex.description)
            except Exception as e:
                raise IndexingEstimateError(str(e))


@console_ns.route("/datasets/<uuid:dataset_id>/batch/<string:batch>/indexing-status")
class DocumentBatchIndexingStatusApi(DocumentResource):
    @console_ns.response(
        200, "Indexing status retrieved successfully", console_ns.models[DocumentStatusListResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, current_user: Account, dataset_id: UUID, batch: str):
        dataset_id_str = str(dataset_id)
        documents = self.get_batch_documents(dataset_id_str, batch, current_user)
        documents_status = []
        for document in documents:
            completed_segments = (
                db.session.scalar(
                    select(func.count(DocumentSegment.id)).where(
                        DocumentSegment.completed_at.isnot(None),
                        DocumentSegment.document_id == str(document.id),
                        DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                    )
                )
                or 0
            )
            total_segments = (
                db.session.scalar(
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
                "indexing_status": IndexingStatus.PAUSED if document.is_paused else document.indexing_status,
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


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/indexing-status")
class DocumentIndexingStatusApi(DocumentResource):
    @console_ns.doc("get_document_indexing_status")
    @console_ns.doc(description="Get document indexing status")
    @console_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @console_ns.response(
        200, "Indexing status retrieved successfully", console_ns.models[DocumentStatusResponse.__name__]
    )
    @console_ns.response(404, "Document not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, current_tenant_id: str, current_user: Account, dataset_id: UUID, document_id: UUID):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        document = self.get_document(dataset_id_str, document_id_str, current_user, current_tenant_id)

        completed_segments = (
            db.session.scalar(
                select(func.count(DocumentSegment.id)).where(
                    DocumentSegment.completed_at.isnot(None),
                    DocumentSegment.document_id == document_id_str,
                    DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                )
            )
            or 0
        )
        total_segments = (
            db.session.scalar(
                select(func.count(DocumentSegment.id)).where(
                    DocumentSegment.document_id == document_id_str,
                    DocumentSegment.status != SegmentStatus.RE_SEGMENT,
                )
            )
            or 0
        )

        # Create a dictionary with document attributes and additional fields
        document_dict = {
            "id": document.id,
            "indexing_status": IndexingStatus.PAUSED if document.is_paused else document.indexing_status,
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
        return dump_response(DocumentStatusResponse, document_dict)


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>")
class DocumentApi(DocumentResource):
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
    @console_ns.response(200, "Document retrieved successfully", console_ns.models[OpaqueObjectResponse.__name__])
    @console_ns.response(404, "Document not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, current_tenant_id: str, current_user: Account, dataset_id: UUID, document_id: UUID):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        document = self.get_document(dataset_id_str, document_id_str, current_user, current_tenant_id)

        metadata = request.args.get("metadata", "all")
        if metadata not in self.METADATA_CHOICES:
            raise InvalidMetadataError(f"Invalid metadata value: {metadata}")

        if metadata == "only":
            response = {"id": document.id, "doc_type": document.doc_type, "doc_metadata": document.doc_metadata_details}
        elif metadata == "without":
            dataset_process_rules = DatasetService.get_process_rules(dataset_id_str)
            document_process_rules = document.dataset_process_rule.to_dict() if document.dataset_process_rule else {}
            response = {
                "id": document.id,
                "position": document.position,
                "data_source_type": document.data_source_type,
                "data_source_info": document.data_source_info_dict,
                "data_source_detail_dict": document.data_source_detail_dict,
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
                "segment_count": document.segment_count,
                "average_segment_length": document.average_segment_length,
                "hit_count": document.hit_count,
                "display_status": document.display_status,
                "doc_form": document.doc_form,
                "doc_language": document.doc_language,
                "need_summary": document.need_summary if document.need_summary is not None else False,
            }
        else:
            dataset_process_rules = DatasetService.get_process_rules(dataset_id_str)
            document_process_rules = document.dataset_process_rule.to_dict() if document.dataset_process_rule else {}
            response = {
                "id": document.id,
                "position": document.position,
                "data_source_type": document.data_source_type,
                "data_source_info": document.data_source_info_dict,
                "data_source_detail_dict": document.data_source_detail_dict,
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
                "doc_metadata": document.doc_metadata_details,
                "segment_count": document.segment_count,
                "average_segment_length": document.average_segment_length,
                "hit_count": document.hit_count,
                "display_status": document.display_status,
                "doc_form": document.doc_form,
                "doc_language": document.doc_language,
                "need_summary": document.need_summary if document.need_summary is not None else False,
            }

        return response, 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.response(204, "Document deleted successfully")
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def delete(self, current_tenant_id: str, current_user: Account, dataset_id: UUID, document_id: UUID):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        document = self.get_document(dataset_id_str, document_id_str, current_user, current_tenant_id)

        try:
            DocumentService.delete_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot delete document during indexing.")

        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/download")
class DocumentDownloadApi(DocumentResource):
    """Return a signed download URL for a dataset document's original uploaded file."""

    @console_ns.doc("get_dataset_document_download_url")
    @console_ns.doc(description="Get a signed download URL for a dataset document's original uploaded file")
    @console_ns.response(200, "Download URL generated successfully", console_ns.models[UrlResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_DOCUMENT_DOWNLOAD)
    def get(self, current_tenant_id: str, current_user: Account, dataset_id: UUID, document_id: UUID) -> dict[str, Any]:
        # Reuse the shared permission/tenant checks implemented in DocumentResource.
        document = self.get_document(str(dataset_id), str(document_id), current_user, current_tenant_id)
        return {"url": DocumentService.get_document_download_url(document)}


@console_ns.route("/datasets/<uuid:dataset_id>/documents/download-zip")
class DocumentBatchDownloadZipApi(DocumentResource):
    """Download multiple uploaded-file documents as a single ZIP (avoids browser multi-download limits)."""

    @console_ns.doc("download_dataset_documents_as_zip")
    @console_ns.doc(description="Download selected dataset documents as a single ZIP archive (upload-file only)")
    @console_ns.response(200, "ZIP archive generated successfully", console_ns.models[BinaryFileResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[DocumentBatchDownloadZipPayload.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def post(self, current_tenant_id: str, current_user: Account, dataset_id: UUID):
        """Stream a ZIP archive containing the requested uploaded documents."""
        # Parse and validate request payload.
        payload = DocumentBatchDownloadZipPayload.model_validate(console_ns.payload or {})

        dataset_id_str = str(dataset_id)
        document_ids: list[str] = [str(document_id) for document_id in payload.document_ids]
        upload_files, download_name = DocumentService.prepare_document_batch_download_zip(
            dataset_id=dataset_id_str,
            document_ids=document_ids,
            tenant_id=current_tenant_id,
            current_user=current_user,
        )

        # Delegate ZIP packing to FileService, but keep Flask response+cleanup in the route.
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
        return response


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/<string:action>")
class DocumentProcessingApi(DocumentResource):
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
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def patch(
        self,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
        action: Literal["pause", "resume"],
    ):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        document = self.get_document(dataset_id_str, document_id_str, current_user, current_tenant_id)

        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        match action:
            case "pause":
                if document.indexing_status != IndexingStatus.INDEXING:
                    raise InvalidActionError("Document not in indexing state.")

                document.paused_by = current_user.id
                document.paused_at = naive_utc_now()
                document.is_paused = True
                db.session.commit()

            case "resume":
                if document.indexing_status not in {IndexingStatus.PAUSED, IndexingStatus.ERROR}:
                    raise InvalidActionError("Document not in paused or error state.")

                document.paused_by = None
                document.paused_at = None
                document.is_paused = False
                db.session.commit()

        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/metadata")
class DocumentMetadataApi(DocumentResource):
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
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def put(self, current_tenant_id: str, current_user: Account, dataset_id: UUID, document_id: UUID):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        document = self.get_document(dataset_id_str, document_id_str, current_user, current_tenant_id)

        req_data = DocumentMetadataUpdatePayload.model_validate(request.get_json() or {})

        doc_type = req_data.doc_type
        doc_metadata = req_data.doc_metadata

        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        if doc_type is None or doc_metadata is None:
            raise ValueError("Both doc_type and doc_metadata must be provided.")

        if doc_type not in DocumentService.DOCUMENT_METADATA_SCHEMA:
            raise ValueError("Invalid doc_type.")

        if not isinstance(doc_metadata, dict):
            raise ValueError("doc_metadata must be a dictionary.")
        metadata_schema: dict[str, Any] = cast(dict[str, Any], DocumentService.DOCUMENT_METADATA_SCHEMA[doc_type])

        document.doc_metadata = {}
        if doc_type == "others":
            document.doc_metadata = doc_metadata
        else:
            for key, value_type in metadata_schema.items():
                value = doc_metadata.get(key)
                if value is not None and isinstance(value, value_type):
                    document.doc_metadata[key] = value

        document.doc_type = doc_type
        document.updated_at = naive_utc_now()
        db.session.commit()

        return {"result": "success", "message": "Document metadata updated."}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/status/<string:action>/batch")
class DocumentStatusApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def patch(
        self, current_user: Account, dataset_id: UUID, action: Literal["enable", "disable", "archive", "un_archive"]
    ):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)

        # check user's permission
        DatasetService.check_dataset_permission(dataset, current_user)

        document_ids = request.args.getlist("document_id")

        try:
            DocumentService.batch_update_document_status(dataset, document_ids, action, current_user)
        except services.errors.document.DocumentIndexingError as e:
            raise InvalidActionError(str(e))
        except ValueError as e:
            raise InvalidActionError(str(e))
        except NotFound as e:
            raise NotFound(str(e))

        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/pause")
class DocumentPauseApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.response(204, "Document paused successfully")
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def patch(self, dataset_id: UUID, document_id: UUID):
        """pause document."""
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)

        dataset = DatasetService.get_dataset(dataset_id_str)
        if not dataset:
            raise NotFound("Dataset not found.")

        document = DocumentService.get_document(dataset.id, document_id_str)

        # 404 if document not found
        if document is None:
            raise NotFound("Document Not Exists.")

        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()

        try:
            # pause document
            DocumentService.pause_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot pause completed document.")

        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/processing/resume")
class DocumentRecoverApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.response(204, "Document resumed successfully")
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def patch(self, dataset_id: UUID, document_id: UUID):
        """recover document."""
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if not dataset:
            raise NotFound("Dataset not found.")
        document = DocumentService.get_document(dataset.id, document_id_str)

        # 404 if document not found
        if document is None:
            raise NotFound("Document Not Exists.")

        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()
        try:
            # pause document
            DocumentService.recover_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Document is not in paused status.")

        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/retry")
class DocumentRetryApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[DocumentRetryPayload.__name__])
    @console_ns.response(204, "Documents retry started successfully")
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def post(self, dataset_id: UUID):
        """retry document."""
        payload = DocumentRetryPayload.model_validate(console_ns.payload or {})
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        retry_documents = []
        if not dataset:
            raise NotFound("Dataset not found.")
        for document_id in payload.document_ids:
            try:
                document = DocumentService.get_document(dataset.id, document_id)

                # 404 if document not found
                if document is None:
                    raise NotFound("Document Not Exists.")

                # 403 if document is archived
                if DocumentService.check_archived(document):
                    raise ArchivedDocumentImmutableError()

                # 400 if document is completed
                if document.indexing_status == IndexingStatus.COMPLETED:
                    raise DocumentAlreadyFinishedError()
                retry_documents.append(document)
            except Exception:
                logger.exception("Failed to retry document, document id: %s", document_id)
                continue
        # retry document
        DocumentService.retry_document(dataset_id_str, retry_documents)

        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/rename")
class DocumentRenameApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Document renamed successfully", console_ns.models[DocumentResponse.__name__])
    @console_ns.expect(console_ns.models[DocumentRenamePayload.__name__])
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def post(self, current_user: Account, dataset_id: UUID, document_id: UUID):
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_operator_permission(current_user, dataset)
        payload = DocumentRenamePayload.model_validate(console_ns.payload or {})

        try:
            document = DocumentService.rename_document(str(dataset_id), str(document_id), payload.name)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot delete document during indexing.")

        return dump_response(DocumentResponse, document)


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/website-sync")
class WebsiteDocumentSyncApi(DocumentResource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, current_tenant_id: str, dataset_id: UUID, document_id: UUID):
        """sync website document."""
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if not dataset:
            raise NotFound("Dataset not found.")
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset.id, document_id_str)
        if not document:
            raise NotFound("Document not found.")
        if document.tenant_id != current_tenant_id:
            raise Forbidden("No permission.")
        if document.data_source_type != "website_crawl":
            raise ValueError("Document is not a website document.")
        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()
        # sync document
        DocumentService.sync_website_document(dataset_id_str, document)

        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/pipeline-execution-log")
class DocumentPipelineExecutionLogApi(DocumentResource):
    @console_ns.response(
        200,
        "Document pipeline execution log retrieved successfully",
        console_ns.models[OpaqueObjectResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, dataset_id: UUID, document_id: UUID):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)

        dataset = DatasetService.get_dataset(dataset_id_str)
        if not dataset:
            raise NotFound("Dataset not found.")
        document = DocumentService.get_document(dataset.id, document_id_str)
        if not document:
            raise NotFound("Document not found.")
        log = db.session.scalar(
            select(DocumentPipelineExecutionLog)
            .where(DocumentPipelineExecutionLog.document_id == document_id_str)
            .order_by(DocumentPipelineExecutionLog.created_at.desc())
            .limit(1)
        )
        if not log:
            return {
                "datasource_info": None,
                "datasource_type": None,
                "input_data": None,
                "datasource_node_id": None,
            }, 200
        return {
            "datasource_info": json.loads(log.datasource_info),
            "datasource_type": log.datasource_type,
            "input_data": log.input_data,
            "datasource_node_id": log.datasource_node_id,
        }, 200


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
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def post(self, current_user: Account, dataset_id: UUID):
        """
        Generate summary index for specified documents.

        This endpoint checks if the dataset configuration supports summary generation
        (indexing_technique must be 'high_quality' and summary_index_setting.enable must be true),
        then asynchronously generates summary indexes for the provided documents.
        """
        dataset_id_str = str(dataset_id)

        # Get dataset
        dataset = DatasetService.get_dataset(dataset_id_str)
        if not dataset:
            raise NotFound("Dataset not found.")

        # Check permissions
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        # Validate request payload
        payload = GenerateSummaryPayload.model_validate(console_ns.payload or {})
        document_list = payload.document_list

        if not document_list:
            from werkzeug.exceptions import BadRequest

            raise BadRequest("document_list cannot be empty.")

        # Check if dataset configuration supports summary generation
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            raise ValueError(
                f"Summary generation is only available for 'high_quality' indexing technique. "
                f"Current indexing technique: {dataset.indexing_technique}"
            )

        summary_index_setting = dataset.summary_index_setting
        if not summary_index_setting or not summary_index_setting.get("enable"):
            raise ValueError("Summary index is not enabled for this dataset. Please enable it in the dataset settings.")

        # Verify all documents exist and belong to the dataset
        documents = DocumentService.get_documents_by_ids(dataset_id_str, document_list)

        if len(documents) != len(document_list):
            found_ids = {doc.id for doc in documents}
            missing_ids = set(document_list) - found_ids
            raise NotFound(f"Some documents not found: {list(missing_ids)}")

        # Update need_summary to True for documents that don't have it set
        # This handles the case where documents were created when summary_index_setting was disabled
        documents_to_update = [doc for doc in documents if not doc.need_summary and doc.doc_form != "qa_model"]

        if documents_to_update:
            document_ids_to_update = [str(doc.id) for doc in documents_to_update]
            DocumentService.update_documents_need_summary(
                dataset_id=dataset_id_str,
                document_ids=document_ids_to_update,
                need_summary=True,
            )

        # Dispatch async tasks for each document
        for document in documents:
            # Skip qa_model documents as they don't generate summaries
            if document.doc_form == "qa_model":
                logger.info("Skipping summary generation for qa_model document %s", document.id)
                continue

            # Dispatch async task
            generate_summary_index_task.delay(dataset_id_str, document.id)
            logger.info(
                "Dispatched summary generation task for document %s in dataset %s",
                document.id,
                dataset_id_str,
            )

        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/summary-status")
class DocumentSummaryStatusApi(DocumentResource):
    @console_ns.doc("get_document_summary_status")
    @console_ns.doc(description="Get summary index generation status for a document")
    @console_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @console_ns.response(200, "Summary status retrieved successfully", console_ns.models[OpaqueObjectResponse.__name__])
    @console_ns.response(404, "Document not found")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, current_user: Account, dataset_id: UUID, document_id: UUID):
        """
        Get summary index generation status for a document.

        Returns:
        - total_segments: Total number of segments in the document
        - summary_status: Dictionary with status counts
          - completed: Number of summaries completed
          - generating: Number of summaries being generated
          - error: Number of summaries with errors
          - not_started: Number of segments without summary records
        - summaries: List of summary records with status and content preview
        """
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)

        # Get dataset
        dataset = DatasetService.get_dataset(dataset_id_str)
        if not dataset:
            raise NotFound("Dataset not found.")

        # Check permissions
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        # Get summary status detail from service
        from services.summary_index_service import SummaryIndexService

        result = SummaryIndexService.get_document_summary_status_detail(
            document_id=document_id_str,
            dataset_id=dataset_id_str,
        )

        return result, 200

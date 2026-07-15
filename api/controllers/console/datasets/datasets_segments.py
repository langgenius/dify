import uuid
from typing import Literal
from typing import cast as type_cast
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy import String, case, cast, func, literal, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

import services
from configs import dify_config
from controllers.common.controller_schemas import ChildChunkCreatePayload, ChildChunkUpdatePayload
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import (
    ChildChunkDeleteIndexError,
    ChildChunkIndexingError,
    InvalidActionError,
)
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    cloud_edition_billing_knowledge_limit_check,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_redis import redis_client
from fields.base import ResponseModel
from fields.segment_fields import (
    ChildChunkDetailResponse,
    ChildChunkListResponse,
    ChildChunkResponse,
    SegmentDetailResponse,
    SegmentResponse,
    segment_response_with_summary,
    segment_responses_with_summaries,
)
from graphon.model_runtime.entities.model_entities import ModelType
from libs.helper import dump_response, escape_like_pattern
from libs.login import login_required
from libs.pagination import paginate_query
from models import Account
from models.dataset import Dataset, Document, DocumentSegment
from models.model import UploadFile
from services.dataset_ref_service import DatasetRefService, SegmentRef
from services.dataset_service import DatasetService, DocumentService, SegmentService
from services.entities.knowledge_entities.knowledge_entities import ChildChunkUpdateArgs, SegmentUpdateArgs
from services.errors.chunk import ChildChunkDeleteIndexError as ChildChunkDeleteIndexServiceError
from services.errors.chunk import ChildChunkIndexingError as ChildChunkIndexingServiceError
from services.summary_index_service import SummaryIndexService
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task


class SegmentListQuery(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    status: list[str] = Field(default_factory=list)
    hit_count_gte: int | None = None
    enabled: str = Field(default="all")
    keyword: str | None = None
    page: int = Field(default=1, ge=1)


class SegmentIdListQuery(BaseModel):
    segment_id: list[str] = Field(default_factory=list, description="Segment IDs")


class ChildChunkListQuery(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    keyword: str | None = None
    page: int = Field(default=1, ge=1)


class SegmentCreatePayload(BaseModel):
    content: str
    answer: str | None = None
    keywords: list[str] | None = None
    attachment_ids: list[str] | None = None


class SegmentUpdatePayload(BaseModel):
    content: str
    answer: str | None = None
    keywords: list[str] | None = None
    regenerate_child_chunks: bool = False
    attachment_ids: list[str] | None = None
    summary: str | None = None  # Summary content for summary index


class BatchImportPayload(BaseModel):
    upload_file_id: str


class SegmentBatchImportStatusResponse(ResponseModel):
    job_id: str
    job_status: str


class ConsoleSegmentListResponse(ResponseModel):
    data: list[SegmentResponse]
    limit: int
    total: int
    total_pages: int
    page: int


class ChildChunkBatchUpdateResponse(ResponseModel):
    data: list[ChildChunkResponse]


class ChildChunkBatchUpdatePayload(BaseModel):
    chunks: list[ChildChunkUpdateArgs]


class SegmentDocParams:
    DATASET_DOCUMENT = {"dataset_id": "Dataset ID", "document_id": "Document ID"}
    DATASET_DOCUMENT_ACTION = {**DATASET_DOCUMENT, "action": "Action"}
    DATASET_DOCUMENT_SEGMENT = {**DATASET_DOCUMENT, "segment_id": "Segment ID"}
    DATASET_DOCUMENT_PARENT_SEGMENT = {**DATASET_DOCUMENT, "segment_id": "Parent segment ID"}
    DATASET_DOCUMENT_CHILD_CHUNK = {**DATASET_DOCUMENT_PARENT_SEGMENT, "child_chunk_id": "Child chunk ID"}


register_schema_models(
    console_ns,
    SegmentListQuery,
    SegmentIdListQuery,
    ChildChunkListQuery,
    SegmentCreatePayload,
    SegmentUpdatePayload,
    BatchImportPayload,
    ChildChunkCreatePayload,
    ChildChunkUpdatePayload,
    ChildChunkBatchUpdatePayload,
    ChildChunkUpdateArgs,
)
register_response_schema_models(
    console_ns,
    SegmentResponse,
    ConsoleSegmentListResponse,
    SegmentDetailResponse,
    ChildChunkDetailResponse,
    ChildChunkListResponse,
    ChildChunkBatchUpdateResponse,
    SegmentBatchImportStatusResponse,
    SimpleResultResponse,
)


def _get_segment_for_document(
    session: Session, dataset: Dataset, document: Document, segment_id: str
) -> tuple[SegmentRef, DocumentSegment]:
    dataset_ref = DatasetRefService.create_dataset_ref(dataset)
    document_ref = DatasetRefService.create_document_ref(dataset_ref, document)
    if document_ref is None:
        raise NotFound("Document not found.")

    segment_ref = DatasetRefService.create_segment_ref(document_ref, segment_id)
    segment = SegmentService.get_segment_by_ref(segment_ref, session=session)
    if not segment:
        raise NotFound("Segment not found.")
    return segment_ref, segment


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
class DatasetDocumentSegmentListApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT)
    @console_ns.doc(params=query_params_from_model(SegmentListQuery))
    @console_ns.response(200, "Segments retrieved successfully", console_ns.models[ConsoleSegmentListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    @with_session(write=False)
    def get(self, session: Session, current_tenant_id: str, current_user: Account, dataset_id: UUID, document_id: UUID):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)

        if not document:
            raise NotFound("Document not found.")

        args = query_params_from_request(SegmentListQuery, list_fields=("status",))

        page = args.page
        limit = min(args.limit, 100)
        status_list = args.status
        hit_count_gte = args.hit_count_gte
        keyword = args.keyword

        query = (
            select(DocumentSegment)
            .where(
                DocumentSegment.document_id == document_id_str,
                DocumentSegment.tenant_id == current_tenant_id,
            )
            .order_by(DocumentSegment.position.asc())
        )

        if status_list:
            query = query.where(DocumentSegment.status.in_(status_list))

        if hit_count_gte is not None:
            query = query.where(DocumentSegment.hit_count >= hit_count_gte)

        if keyword:
            # Escape special characters in keyword to prevent SQL injection via LIKE wildcards
            escaped_keyword = escape_like_pattern(keyword)
            # Search in both content and keywords fields
            # Use database-specific methods for JSON array search
            if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
                # PostgreSQL: Use jsonb_array_elements_text to properly handle Unicode/Chinese text
                # Feed the set-returning function a JSON array in every row. Filtering in
                # the subquery is not enough because PostgreSQL can still evaluate the
                # SRF on scalar JSON before applying the predicate.
                keywords_jsonb = cast(DocumentSegment.keywords, JSONB)
                keywords_array = case(
                    (func.jsonb_typeof(keywords_jsonb) == "array", keywords_jsonb),
                    else_=cast(literal("[]"), JSONB),
                )
                keywords_condition = func.array_to_string(
                    func.array(
                        select(func.jsonb_array_elements_text(keywords_array))
                        .correlate(DocumentSegment)
                        .scalar_subquery()
                    ),
                    ",",
                ).ilike(f"%{escaped_keyword}%", escape="\\")
            else:
                # MySQL: Cast JSON to string for pattern matching
                # MySQL stores Chinese text directly in JSON without Unicode escaping
                keywords_condition = cast(DocumentSegment.keywords, String).ilike(f"%{escaped_keyword}%", escape="\\")

            query = query.where(
                or_(
                    DocumentSegment.content.ilike(f"%{escaped_keyword}%", escape="\\"),
                    keywords_condition,
                )
            )

        if args.enabled.lower() != "all":
            if args.enabled.lower() == "true":
                query = query.where(DocumentSegment.enabled == True)
            elif args.enabled.lower() == "false":
                query = query.where(DocumentSegment.enabled == False)

        segments = paginate_query(query, session=session, page=page, per_page=limit, max_per_page=100)

        segment_list = list(segments.items)
        segment_ids = [segment.id for segment in segment_list]
        summaries: dict[str, str | None] = {}
        if segment_ids:
            summary_records = SummaryIndexService.get_segments_summaries(
                segment_ids=segment_ids, dataset_id=dataset_id_str, session=session
            )
            summaries = {chunk_id: summary.summary_content for chunk_id, summary in summary_records.items()}

        response = {
            "data": segment_responses_with_summaries(segment_list, summaries, session=session),
            "limit": limit,
            "total": segments.total,
            "total_pages": segments.pages,
            "page": page,
        }
        return dump_response(ConsoleSegmentListResponse, response), 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT)
    @console_ns.doc(params=query_params_from_model(SegmentIdListQuery))
    @console_ns.response(204, "Segments deleted successfully")
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def delete(self, session: Session, current_user: Account, dataset_id: UUID, document_id: UUID):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        segment_ids = request.args.getlist("segment_id")

        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        SegmentService.delete_segments(segment_ids, document, dataset, session)
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segment/<string:action>")
class DatasetDocumentSegmentApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_ACTION)
    @console_ns.doc(params=query_params_from_model(SegmentIdListQuery))
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def patch(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
        action: Literal["enable", "disable"],
    ):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            # check embedding model setting
            try:
                model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
        segment_ids = request.args.getlist("segment_id")

        document_indexing_cache_key = f"document_{document.id}_indexing"
        cache_result = redis_client.get(document_indexing_cache_key)
        if cache_result is not None:
            raise InvalidActionError("Document is being indexed, please try again later")
        try:
            SegmentService.update_segments_status(segment_ids, action, dataset, document, session)
        except Exception as e:
            raise InvalidActionError(str(e))
        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segment")
class DatasetDocumentSegmentAddApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT)
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[SegmentCreatePayload.__name__])
    @console_ns.response(200, "Segment created successfully", console_ns.models[SegmentDetailResponse.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def post(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
    ):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        if not current_user.is_dataset_editor:
            raise Forbidden()
        # check embedding model setting
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            try:
                model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        # validate args
        payload = SegmentCreatePayload.model_validate(console_ns.payload or {})
        payload_dict = payload.model_dump(exclude_none=True)
        SegmentService.segment_create_args_validate(payload_dict, document)
        segment = type_cast(DocumentSegment, SegmentService.create_segment(payload_dict, document, dataset, session))
        summary = SummaryIndexService.get_segment_summary(
            segment_id=segment.id, dataset_id=dataset_id_str, session=session
        )
        response = {
            "data": segment_response_with_summary(
                segment, summary.summary_content if summary else None, session=session
            ),
            "doc_form": document.doc_form,
        }
        return dump_response(SegmentDetailResponse, response), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>")
class DatasetDocumentSegmentUpdateApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_SEGMENT)
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[SegmentUpdatePayload.__name__])
    @console_ns.response(200, "Segment updated successfully", console_ns.models[SegmentDetailResponse.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def patch(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
    ):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            # check embedding model setting
            try:
                model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
        segment_id_str = str(segment_id)
        _, segment = _get_segment_for_document(session, dataset, document, segment_id_str)
        # validate args
        payload = SegmentUpdatePayload.model_validate(console_ns.payload or {})
        payload_dict = payload.model_dump(exclude_none=True)
        SegmentService.segment_create_args_validate(payload_dict, document)

        # Update segment (summary update with change detection is handled in SegmentService.update_segment)
        segment = SegmentService.update_segment(
            SegmentUpdateArgs.model_validate(payload.model_dump(exclude_none=True)),
            segment,
            document,
            dataset,
            session,
        )
        summary = SummaryIndexService.get_segment_summary(
            segment_id=segment.id, dataset_id=dataset_id_str, session=session
        )
        response = {
            "data": segment_response_with_summary(
                segment, summary.summary_content if summary else None, session=session
            ),
            "doc_form": document.doc_form,
        }
        return dump_response(SegmentDetailResponse, response), 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_SEGMENT)
    @console_ns.response(204, "Segment deleted successfully")
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def delete(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
    ):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        segment_id_str = str(segment_id)
        _, segment = _get_segment_for_document(session, dataset, document, segment_id_str)
        SegmentService.delete_segment(segment, document, dataset, session)
        return "", 204


@console_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/batch_import",
    "/datasets/batch_import_status/<uuid:job_id>",
)
class DatasetDocumentSegmentBatchImportApi(Resource):
    @console_ns.response(200, "Batch import started", console_ns.models[SegmentBatchImportStatusResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[BatchImportPayload.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def post(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
    ):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")

        payload = BatchImportPayload.model_validate(console_ns.payload or {})
        upload_file_id = payload.upload_file_id

        upload_file = session.scalar(select(UploadFile).where(UploadFile.id == upload_file_id).limit(1))
        if not upload_file:
            raise NotFound("UploadFile not found.")

        # check file type
        if not upload_file.name or not upload_file.name.lower().endswith(".csv"):
            raise ValueError("Invalid file type. Only CSV files are allowed")

        try:
            # async job
            job_id = str(uuid.uuid4())
            indexing_cache_key = f"segment_batch_import_{job_id}"
            # send batch add segments task
            redis_client.setnx(indexing_cache_key, "waiting")
            batch_create_segment_to_index_task.delay(
                job_id,
                upload_file_id,
                dataset_id_str,
                document_id_str,
                current_tenant_id,
                current_user.id,
            )
        except Exception as e:
            return {"error": str(e)}, 500
        return dump_response(SegmentBatchImportStatusResponse, {"job_id": job_id, "job_status": "waiting"}), 200

    @console_ns.response(200, "Batch import status", console_ns.models[SegmentBatchImportStatusResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    def get(self, job_id=None, dataset_id: UUID | None = None, document_id: UUID | None = None):
        if job_id is None:
            raise NotFound("The job does not exist.")
        job_id = str(job_id)
        indexing_cache_key = f"segment_batch_import_{job_id}"
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is None:
            raise ValueError("The job does not exist.")

        response = {"job_id": job_id, "job_status": cache_result.decode()}
        return dump_response(SegmentBatchImportStatusResponse, response), 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks")
class ChildChunkAddApi(Resource):
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_PARENT_SEGMENT)
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[ChildChunkCreatePayload.__name__])
    @console_ns.response(200, "Child chunk created successfully", console_ns.models[ChildChunkDetailResponse.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def post(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
    ):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        # check embedding model setting
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            try:
                model_manager = ModelManager.for_tenant(tenant_id=current_tenant_id)
                model_manager.get_model_instance(
                    tenant_id=current_tenant_id,
                    provider=dataset.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=dataset.embedding_model,
                )
            except LLMBadRequestError:
                raise ProviderNotInitializeError(
                    "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)
        segment_id_str = str(segment_id)
        _, segment = _get_segment_for_document(session, dataset, document, segment_id_str)
        # validate args
        try:
            payload = ChildChunkCreatePayload.model_validate(console_ns.payload or {})
            child_chunk = SegmentService.create_child_chunk(payload.content, segment, document, dataset, session)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))
        return dump_response(ChildChunkDetailResponse, {"data": child_chunk}), 200

    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_PARENT_SEGMENT)
    @console_ns.doc(params=query_params_from_model(ChildChunkListQuery))
    @console_ns.response(200, "Child chunks retrieved successfully", console_ns.models[ChildChunkListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    @with_session(write=False)
    def get(self, session: Session, current_tenant_id: str, dataset_id: UUID, document_id: UUID, segment_id: UUID):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        segment_id_str = str(segment_id)
        _get_segment_for_document(session, dataset, document, segment_id_str)
        args = query_params_from_request(ChildChunkListQuery, use_defaults_for_malformed_ints=True)

        page = args.page
        limit = min(args.limit, 100)
        keyword = args.keyword

        child_chunks = SegmentService.get_child_chunks(
            segment_id_str,
            document_id_str,
            dataset_id_str,
            page,
            limit,
            keyword,
            session=session,
        )
        response = {
            "data": child_chunks.items,
            "total": child_chunks.total,
            "total_pages": child_chunks.pages,
            "page": page,
            "limit": limit,
        }
        return dump_response(ChildChunkListResponse, response), 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_PARENT_SEGMENT)
    @console_ns.response(
        200,
        "Child chunks updated successfully",
        console_ns.models[ChildChunkBatchUpdateResponse.__name__],
    )
    @console_ns.expect(console_ns.models[ChildChunkBatchUpdatePayload.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def patch(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
    ):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        segment_id_str = str(segment_id)
        _, segment = _get_segment_for_document(session, dataset, document, segment_id_str)
        # validate args
        payload = ChildChunkBatchUpdatePayload.model_validate(console_ns.payload or {})
        try:
            child_chunks = SegmentService.update_child_chunks(payload.chunks, segment, document, dataset, session)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))
        return dump_response(ChildChunkBatchUpdateResponse, {"data": child_chunks}), 200


@console_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks/<uuid:child_chunk_id>"
)
class ChildChunkUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_CHILD_CHUNK)
    @console_ns.response(204, "Child chunk deleted successfully")
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def delete(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
        child_chunk_id: UUID,
    ):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        segment_id_str = str(segment_id)
        segment_ref, _ = _get_segment_for_document(session, dataset, document, segment_id_str)
        child_chunk_id_str = str(child_chunk_id)
        child_chunk = SegmentService.get_child_chunk_by_segment_ref(child_chunk_id_str, segment_ref, session=session)
        if not child_chunk:
            raise NotFound("Child chunk not found.")
        try:
            SegmentService.delete_child_chunk(child_chunk, dataset, session)
        except ChildChunkDeleteIndexServiceError as e:
            raise ChildChunkDeleteIndexError(str(e))
        return "", 204

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.doc(params=SegmentDocParams.DATASET_DOCUMENT_CHILD_CHUNK)
    @console_ns.expect(console_ns.models[ChildChunkUpdatePayload.__name__])
    @console_ns.response(200, "Child chunk updated successfully", console_ns.models[ChildChunkDetailResponse.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    @with_session
    def patch(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        dataset_id: UUID,
        document_id: UUID,
        segment_id: UUID,
        child_chunk_id: UUID,
    ):
        # check dataset
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, session)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id_str = str(document_id)
        document = DocumentService.get_document(dataset_id_str, document_id_str, session=session)
        if not document:
            raise NotFound("Document not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        segment_id_str = str(segment_id)
        segment_ref, segment = _get_segment_for_document(session, dataset, document, segment_id_str)
        child_chunk_id_str = str(child_chunk_id)
        child_chunk = SegmentService.get_child_chunk_by_segment_ref(child_chunk_id_str, segment_ref, session=session)
        if not child_chunk:
            raise NotFound("Child chunk not found.")
        # validate args
        try:
            payload = ChildChunkUpdatePayload.model_validate(console_ns.payload or {})
            child_chunk = SegmentService.update_child_chunk(
                payload.content, child_chunk, segment, document, dataset, session
            )
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))
        return dump_response(ChildChunkDetailResponse, {"data": child_chunk}), 200

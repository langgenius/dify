import uuid

from flask import request
from flask_restx import Resource, marshal
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from werkzeug.exceptions import Forbidden, NotFound

import services
from configs import dify_config
from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import (
    ChildChunkDeleteIndexError,
    ChildChunkIndexingError,
    InvalidActionError,
)
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_knowledge_limit_check,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
    setup_required,
)
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from fields.segment_fields import child_chunk_fields, segment_fields
from libs.helper import escape_like_pattern
from libs.login import current_account_with_tenant, login_required
from models.dataset import ChildChunk, DocumentSegment
from models.model import UploadFile
from services.dataset_service import DatasetService, DocumentService, SegmentService
from services.entities.knowledge_entities.knowledge_entities import ChildChunkUpdateArgs, SegmentUpdateArgs
from services.errors.chunk import ChildChunkDeleteIndexError as ChildChunkDeleteIndexServiceError
from services.errors.chunk import ChildChunkIndexingError as ChildChunkIndexingServiceError
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task


class SegmentListQuery(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    status: list[str] = Field(default_factory=list)
    hit_count_gte: int | None = None
    enabled: str = Field(default="all")
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


class BatchImportPayload(BaseModel):
    upload_file_id: str


class ChildChunkCreatePayload(BaseModel):
    content: str


class ChildChunkUpdatePayload(BaseModel):
    content: str


class ChildChunkBatchUpdatePayload(BaseModel):
    chunks: list[ChildChunkUpdateArgs]


register_schema_models(
    console_ns,
    SegmentListQuery,
    SegmentCreatePayload,
    SegmentUpdatePayload,
    BatchImportPayload,
    ChildChunkCreatePayload,
    ChildChunkUpdatePayload,
    ChildChunkBatchUpdatePayload,
    ChildChunkUpdateArgs,
)


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
class DatasetDocumentSegmentListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        current_user, current_tenant_id = current_account_with_tenant()

        dataset_id = str(dataset_id)
        document_id = str(document_id)
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

        args = SegmentListQuery.model_validate(
            {
                **request.args.to_dict(),
                "status": request.args.getlist("status"),
            }
        )

        page = args.page
        limit = min(args.limit, 100)
        status_list = args.status
        hit_count_gte = args.hit_count_gte
        keyword = args.keyword

        query = (
            select(DocumentSegment)
            .where(
                DocumentSegment.document_id == str(document_id),
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
                keywords_condition = func.array_to_string(
                    func.array(
                        select(func.jsonb_array_elements_text(cast(DocumentSegment.keywords, JSONB)))
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

        segments = db.paginate(select=query, page=page, per_page=limit, max_per_page=100, error_out=False)

        response = {
            "data": marshal(segments.items, segment_fields),
            "limit": limit,
            "total": segments.total,
            "total_pages": segments.pages,
            "page": page,
        }
        return response, 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, dataset_id, document_id):
        current_user, _ = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        segment_ids = request.args.getlist("segment_id")

        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        SegmentService.delete_segments(segment_ids, document, dataset)
        return {"result": "success"}, 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segment/<string:action>")
class DatasetDocumentSegmentApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id, document_id, action):
        current_user, current_tenant_id = current_account_with_tenant()

        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        if dataset.indexing_technique == "high_quality":
            # check embedding model setting
            try:
                model_manager = ModelManager()
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
            SegmentService.update_segments_status(segment_ids, action, dataset, document)
        except Exception as e:
            raise InvalidActionError(str(e))
        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segment")
class DatasetDocumentSegmentAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[SegmentCreatePayload.__name__])
    def post(self, dataset_id, document_id):
        current_user, current_tenant_id = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        if not current_user.is_dataset_editor:
            raise Forbidden()
        # check embedding model setting
        if dataset.indexing_technique == "high_quality":
            try:
                model_manager = ModelManager()
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
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        # validate args
        payload = SegmentCreatePayload.model_validate(console_ns.payload or {})
        payload_dict = payload.model_dump(exclude_none=True)
        SegmentService.segment_create_args_validate(payload_dict, document)
        segment = SegmentService.create_segment(payload_dict, document, dataset)
        return {"data": marshal(segment, segment_fields), "doc_form": document.doc_form}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>")
class DatasetDocumentSegmentUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[SegmentUpdatePayload.__name__])
    def patch(self, dataset_id, document_id, segment_id):
        current_user, current_tenant_id = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        if dataset.indexing_technique == "high_quality":
            # check embedding model setting
            try:
                model_manager = ModelManager()
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
            # check segment
        segment_id = str(segment_id)
        segment = (
            db.session.query(DocumentSegment)
            .where(DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_tenant_id)
            .first()
        )
        if not segment:
            raise NotFound("Segment not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        # validate args
        payload = SegmentUpdatePayload.model_validate(console_ns.payload or {})
        payload_dict = payload.model_dump(exclude_none=True)
        SegmentService.segment_create_args_validate(payload_dict, document)
        segment = SegmentService.update_segment(
            SegmentUpdateArgs.model_validate(payload.model_dump(exclude_none=True)), segment, document, dataset
        )
        return {"data": marshal(segment, segment_fields), "doc_form": document.doc_form}, 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, dataset_id, document_id, segment_id):
        current_user, current_tenant_id = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check segment
        segment_id = str(segment_id)
        segment = (
            db.session.query(DocumentSegment)
            .where(DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_tenant_id)
            .first()
        )
        if not segment:
            raise NotFound("Segment not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        SegmentService.delete_segment(segment, document, dataset)
        return {"result": "success"}, 204


@console_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/batch_import",
    "/datasets/batch_import_status/<uuid:job_id>",
)
class DatasetDocumentSegmentBatchImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[BatchImportPayload.__name__])
    def post(self, dataset_id, document_id):
        current_user, current_tenant_id = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")

        payload = BatchImportPayload.model_validate(console_ns.payload or {})
        upload_file_id = payload.upload_file_id

        upload_file = db.session.query(UploadFile).where(UploadFile.id == upload_file_id).first()
        if not upload_file:
            raise NotFound("UploadFile not found.")

        # check file type
        if not upload_file.name or not upload_file.name.lower().endswith(".csv"):
            raise ValueError("Invalid file type. Only CSV files are allowed")

        try:
            # async job
            job_id = str(uuid.uuid4())
            indexing_cache_key = f"segment_batch_import_{str(job_id)}"
            # send batch add segments task
            redis_client.setnx(indexing_cache_key, "waiting")
            batch_create_segment_to_index_task.delay(
                str(job_id),
                upload_file_id,
                dataset_id,
                document_id,
                current_tenant_id,
                current_user.id,
            )
        except Exception as e:
            return {"error": str(e)}, 500
        return {"job_id": job_id, "job_status": "waiting"}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, job_id=None, dataset_id=None, document_id=None):
        if job_id is None:
            raise NotFound("The job does not exist.")
        job_id = str(job_id)
        indexing_cache_key = f"segment_batch_import_{job_id}"
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is None:
            raise ValueError("The job does not exist.")

        return {"job_id": job_id, "job_status": cache_result.decode()}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks")
class ChildChunkAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[ChildChunkCreatePayload.__name__])
    def post(self, dataset_id, document_id, segment_id):
        current_user, current_tenant_id = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check segment
        segment_id = str(segment_id)
        segment = (
            db.session.query(DocumentSegment)
            .where(DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_tenant_id)
            .first()
        )
        if not segment:
            raise NotFound("Segment not found.")
        if not current_user.is_dataset_editor:
            raise Forbidden()
        # check embedding model setting
        if dataset.indexing_technique == "high_quality":
            try:
                model_manager = ModelManager()
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
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        # validate args
        try:
            payload = ChildChunkCreatePayload.model_validate(console_ns.payload or {})
            child_chunk = SegmentService.create_child_chunk(payload.content, segment, document, dataset)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))
        return {"data": marshal(child_chunk, child_chunk_fields)}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id, segment_id):
        _, current_tenant_id = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check segment
        segment_id = str(segment_id)
        segment = (
            db.session.query(DocumentSegment)
            .where(DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_tenant_id)
            .first()
        )
        if not segment:
            raise NotFound("Segment not found.")
        args = SegmentListQuery.model_validate(
            {
                "limit": request.args.get("limit", default=20, type=int),
                "keyword": request.args.get("keyword"),
                "page": request.args.get("page", default=1, type=int),
            }
        )

        page = args.page
        limit = min(args.limit, 100)
        keyword = args.keyword

        child_chunks = SegmentService.get_child_chunks(segment_id, document_id, dataset_id, page, limit, keyword)
        return {
            "data": marshal(child_chunks.items, child_chunk_fields),
            "total": child_chunks.total,
            "total_pages": child_chunks.pages,
            "page": page,
            "limit": limit,
        }, 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id, document_id, segment_id):
        current_user, current_tenant_id = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
            # check segment
        segment_id = str(segment_id)
        segment = (
            db.session.query(DocumentSegment)
            .where(DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_tenant_id)
            .first()
        )
        if not segment:
            raise NotFound("Segment not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        # validate args
        payload = ChildChunkBatchUpdatePayload.model_validate(console_ns.payload or {})
        try:
            child_chunks = SegmentService.update_child_chunks(payload.chunks, segment, document, dataset)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))
        return {"data": marshal(child_chunks, child_chunk_fields)}, 200


@console_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks/<uuid:child_chunk_id>"
)
class ChildChunkUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, dataset_id, document_id, segment_id, child_chunk_id):
        current_user, current_tenant_id = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check segment
        segment_id = str(segment_id)
        segment = (
            db.session.query(DocumentSegment)
            .where(DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_tenant_id)
            .first()
        )
        if not segment:
            raise NotFound("Segment not found.")
        # check child chunk
        child_chunk_id = str(child_chunk_id)
        child_chunk = (
            db.session.query(ChildChunk)
            .where(
                ChildChunk.id == str(child_chunk_id),
                ChildChunk.tenant_id == current_tenant_id,
                ChildChunk.segment_id == segment.id,
                ChildChunk.document_id == document_id,
            )
            .first()
        )
        if not child_chunk:
            raise NotFound("Child chunk not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        try:
            SegmentService.delete_child_chunk(child_chunk, dataset)
        except ChildChunkDeleteIndexServiceError as e:
            raise ChildChunkDeleteIndexError(str(e))
        return {"result": "success"}, 204

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    @console_ns.expect(console_ns.models[ChildChunkUpdatePayload.__name__])
    def patch(self, dataset_id, document_id, segment_id, child_chunk_id):
        current_user, current_tenant_id = current_account_with_tenant()

        # check dataset
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset_id, document_id)
        if not document:
            raise NotFound("Document not found.")
            # check segment
        segment_id = str(segment_id)
        segment = (
            db.session.query(DocumentSegment)
            .where(DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_tenant_id)
            .first()
        )
        if not segment:
            raise NotFound("Segment not found.")
        # check child chunk
        child_chunk_id = str(child_chunk_id)
        child_chunk = (
            db.session.query(ChildChunk)
            .where(
                ChildChunk.id == str(child_chunk_id),
                ChildChunk.tenant_id == current_tenant_id,
                ChildChunk.segment_id == segment.id,
                ChildChunk.document_id == document_id,
            )
            .first()
        )
        if not child_chunk:
            raise NotFound("Child chunk not found.")
        # The role of the current user in the ta table must be admin, owner, dataset_operator, or editor
        if not current_user.is_dataset_editor:
            raise Forbidden()
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        # validate args
        try:
            payload = ChildChunkUpdatePayload.model_validate(console_ns.payload or {})
            child_chunk = SegmentService.update_child_chunk(payload.content, child_chunk, segment, document, dataset)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))
        return {"data": marshal(child_chunk, child_chunk_fields)}, 200

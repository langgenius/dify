import uuid

import pandas as pd
from flask import request
from flask_login import current_user  # type: ignore
from flask_restful import Resource, marshal, reqparse  # type: ignore
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import (
    ChildChunkDeleteIndexError,
    ChildChunkIndexingError,
    InvalidActionError,
    NoFileUploadedError,
    TooManyFilesError,
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
from extensions.ext_redis import redis_client
from fields.segment_fields import child_chunk_fields, segment_fields
from libs.login import login_required
from models.dataset import ChildChunk, DocumentSegment
from services.dataset_service import DatasetService, DocumentService, SegmentService
from services.entities.knowledge_entities.knowledge_entities import ChildChunkUpdateArgs, SegmentUpdateArgs
from services.errors.chunk import ChildChunkDeleteIndexError as ChildChunkDeleteIndexServiceError
from services.errors.chunk import ChildChunkIndexingError as ChildChunkIndexingServiceError
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task


class DatasetDocumentSegmentListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
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

        parser = reqparse.RequestParser()
        parser.add_argument("limit", type=int, default=20, location="args")
        parser.add_argument("status", type=str, action="append", default=[], location="args")
        parser.add_argument("hit_count_gte", type=int, default=None, location="args")
        parser.add_argument("enabled", type=str, default="all", location="args")
        parser.add_argument("keyword", type=str, default=None, location="args")
        parser.add_argument("page", type=int, default=1, location="args")

        args = parser.parse_args()

        page = args["page"]
        limit = min(args["limit"], 100)
        status_list = args["status"]
        hit_count_gte = args["hit_count_gte"]
        keyword = args["keyword"]

        query = DocumentSegment.query.filter(
            DocumentSegment.document_id == str(document_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).order_by(DocumentSegment.position.asc())

        if status_list:
            query = query.filter(DocumentSegment.status.in_(status_list))

        if hit_count_gte is not None:
            query = query.filter(DocumentSegment.hit_count >= hit_count_gte)

        if keyword:
            query = query.where(DocumentSegment.content.ilike(f"%{keyword}%"))

        if args["enabled"].lower() != "all":
            if args["enabled"].lower() == "true":
                query = query.filter(DocumentSegment.enabled == True)
            elif args["enabled"].lower() == "false":
                query = query.filter(DocumentSegment.enabled == False)

        segments = query.paginate(page=page, per_page=limit, max_per_page=100, error_out=False)

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
        return {"result": "success"}, 200


class DatasetDocumentSegmentApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id, document_id, action):
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
                    tenant_id=current_user.current_tenant_id,
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

        document_indexing_cache_key = "document_{}_indexing".format(document.id)
        cache_result = redis_client.get(document_indexing_cache_key)
        if cache_result is not None:
            raise InvalidActionError("Document is being indexed, please try again later")
        try:
            SegmentService.update_segments_status(segment_ids, action, dataset, document)
        except Exception as e:
            raise InvalidActionError(str(e))
        return {"result": "success"}, 200


class DatasetDocumentSegmentAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, dataset_id, document_id):
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
                    tenant_id=current_user.current_tenant_id,
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
        parser = reqparse.RequestParser()
        parser.add_argument("content", type=str, required=True, nullable=False, location="json")
        parser.add_argument("answer", type=str, required=False, nullable=True, location="json")
        parser.add_argument("keywords", type=list, required=False, nullable=True, location="json")
        args = parser.parse_args()
        SegmentService.segment_create_args_validate(args, document)
        segment = SegmentService.create_segment(args, document, dataset)
        return {"data": marshal(segment, segment_fields), "doc_form": document.doc_form}, 200


class DatasetDocumentSegmentUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id, document_id, segment_id):
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
                    tenant_id=current_user.current_tenant_id,
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
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()
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
        parser = reqparse.RequestParser()
        parser.add_argument("content", type=str, required=True, nullable=False, location="json")
        parser.add_argument("answer", type=str, required=False, nullable=True, location="json")
        parser.add_argument("keywords", type=list, required=False, nullable=True, location="json")
        parser.add_argument(
            "regenerate_child_chunks", type=bool, required=False, nullable=True, default=False, location="json"
        )
        args = parser.parse_args()
        SegmentService.segment_create_args_validate(args, document)
        segment = SegmentService.update_segment(SegmentUpdateArgs(**args), segment, document, dataset)
        return {"data": marshal(segment, segment_fields), "doc_form": document.doc_form}, 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, dataset_id, document_id, segment_id):
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
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()
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
        return {"result": "success"}, 200


class DatasetDocumentSegmentBatchImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, dataset_id, document_id):
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
        # get file from request
        file = request.files["file"]
        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()
        # check file type
        if not file.filename.endswith(".csv"):
            raise ValueError("Invalid file type. Only CSV files are allowed")

        try:
            # Skip the first row
            df = pd.read_csv(file)
            result = []
            for index, row in df.iterrows():
                if document.doc_form == "qa_model":
                    data = {"content": row.iloc[0], "answer": row.iloc[1]}
                else:
                    data = {"content": row.iloc[0]}
                result.append(data)
            if len(result) == 0:
                raise ValueError("The CSV file is empty.")
            # async job
            job_id = str(uuid.uuid4())
            indexing_cache_key = "segment_batch_import_{}".format(str(job_id))
            # send batch add segments task
            redis_client.setnx(indexing_cache_key, "waiting")
            batch_create_segment_to_index_task.delay(
                str(job_id), result, dataset_id, document_id, current_user.current_tenant_id, current_user.id
            )
        except Exception as e:
            return {"error": str(e)}, 500
        return {"job_id": job_id, "job_status": "waiting"}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, job_id):
        job_id = str(job_id)
        indexing_cache_key = "segment_batch_import_{}".format(job_id)
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is None:
            raise ValueError("The job is not exist.")

        return {"job_id": job_id, "job_status": cache_result.decode()}, 200


class ChildChunkAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, dataset_id, document_id, segment_id):
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
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()
        if not segment:
            raise NotFound("Segment not found.")
        if not current_user.is_dataset_editor:
            raise Forbidden()
        # check embedding model setting
        if dataset.indexing_technique == "high_quality":
            try:
                model_manager = ModelManager()
                model_manager.get_model_instance(
                    tenant_id=current_user.current_tenant_id,
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
        parser = reqparse.RequestParser()
        parser.add_argument("content", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        try:
            child_chunk = SegmentService.create_child_chunk(args.get("content"), segment, document, dataset)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))
        return {"data": marshal(child_chunk, child_chunk_fields)}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id, segment_id):
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
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()
        if not segment:
            raise NotFound("Segment not found.")
        parser = reqparse.RequestParser()
        parser.add_argument("limit", type=int, default=20, location="args")
        parser.add_argument("keyword", type=str, default=None, location="args")
        parser.add_argument("page", type=int, default=1, location="args")

        args = parser.parse_args()

        page = args["page"]
        limit = min(args["limit"], 100)
        keyword = args["keyword"]

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
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()
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
        parser = reqparse.RequestParser()
        parser.add_argument("chunks", type=list, required=True, nullable=False, location="json")
        args = parser.parse_args()
        try:
            chunks = [ChildChunkUpdateArgs(**chunk) for chunk in args.get("chunks")]
            child_chunks = SegmentService.update_child_chunks(chunks, segment, document, dataset)
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))
        return {"data": marshal(child_chunks, child_chunk_fields)}, 200


class ChildChunkUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def delete(self, dataset_id, document_id, segment_id, child_chunk_id):
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
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()
        if not segment:
            raise NotFound("Segment not found.")
        # check child chunk
        child_chunk_id = str(child_chunk_id)
        child_chunk = ChildChunk.query.filter(
            ChildChunk.id == str(child_chunk_id), ChildChunk.tenant_id == current_user.current_tenant_id
        ).first()
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
        return {"result": "success"}, 200

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_rate_limit_check("knowledge")
    def patch(self, dataset_id, document_id, segment_id, child_chunk_id):
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
        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()
        if not segment:
            raise NotFound("Segment not found.")
        # check child chunk
        child_chunk_id = str(child_chunk_id)
        child_chunk = ChildChunk.query.filter(
            ChildChunk.id == str(child_chunk_id), ChildChunk.tenant_id == current_user.current_tenant_id
        ).first()
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
        parser = reqparse.RequestParser()
        parser.add_argument("content", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        try:
            child_chunk = SegmentService.update_child_chunk(
                args.get("content"), child_chunk, segment, document, dataset
            )
        except ChildChunkIndexingServiceError as e:
            raise ChildChunkIndexingError(str(e))
        return {"data": marshal(child_chunk, child_chunk_fields)}, 200


api.add_resource(DatasetDocumentSegmentListApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
api.add_resource(
    DatasetDocumentSegmentApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segment/<string:action>"
)
api.add_resource(DatasetDocumentSegmentAddApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segment")
api.add_resource(
    DatasetDocumentSegmentUpdateApi,
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>",
)
api.add_resource(
    DatasetDocumentSegmentBatchImportApi,
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/batch_import",
    "/datasets/batch_import_status/<uuid:job_id>",
)
api.add_resource(
    ChildChunkAddApi,
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks",
)
api.add_resource(
    ChildChunkUpdateApi,
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments/<uuid:segment_id>/child_chunks/<uuid:child_chunk_id>",
)

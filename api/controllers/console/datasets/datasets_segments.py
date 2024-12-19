import uuid
from datetime import UTC, datetime

import pandas as pd
from flask import request
from flask_login import current_user
from flask_restful import Resource, marshal, reqparse
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import InvalidActionError, NoFileUploadedError, TooManyFilesError
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_knowledge_limit_check,
    cloud_edition_billing_resource_check,
    setup_required,
)
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from fields.segment_fields import segment_fields
from libs.login import login_required
from models import DocumentSegment
from services.dataset_service import DatasetService, DocumentService, SegmentService
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task
from tasks.disable_segment_from_index_task import disable_segment_from_index_task
from tasks.enable_segment_to_index_task import enable_segment_to_index_task


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
        parser.add_argument("last_id", type=str, default=None, location="args")
        parser.add_argument("limit", type=int, default=20, location="args")
        parser.add_argument("status", type=str, action="append", default=[], location="args")
        parser.add_argument("hit_count_gte", type=int, default=None, location="args")
        parser.add_argument("enabled", type=str, default="all", location="args")
        parser.add_argument("keyword", type=str, default=None, location="args")
        args = parser.parse_args()

        last_id = args["last_id"]
        limit = min(args["limit"], 100)
        status_list = args["status"]
        hit_count_gte = args["hit_count_gte"]
        keyword = args["keyword"]

        query = DocumentSegment.query.filter(
            DocumentSegment.document_id == str(document_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        )

        if last_id is not None:
            last_segment = db.session.get(DocumentSegment, str(last_id))
            if last_segment:
                query = query.filter(DocumentSegment.position > last_segment.position)
            else:
                return {"data": [], "has_more": False, "limit": limit}, 200

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

        total = query.count()
        segments = query.order_by(DocumentSegment.position).limit(limit + 1).all()

        has_more = False
        if len(segments) > limit:
            has_more = True
            segments = segments[:-1]

        return {
            "data": marshal(segments, segment_fields),
            "doc_form": document.doc_form,
            "has_more": has_more,
            "limit": limit,
            "total": total,
        }, 200


class DatasetDocumentSegmentApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    def patch(self, dataset_id, segment_id, action):
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound("Dataset not found.")
        # check user's model setting
        DatasetService.check_dataset_model_setting(dataset)
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
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
                    "No Embedding Model available. Please configure a valid provider "
                    "in the Settings -> Model Provider."
                )
            except ProviderTokenNotInitError as ex:
                raise ProviderNotInitializeError(ex.description)

        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id), DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()

        if not segment:
            raise NotFound("Segment not found.")

        if segment.status != "completed":
            raise NotFound("Segment is not completed, enable or disable function is not allowed")

        document_indexing_cache_key = "document_{}_indexing".format(segment.document_id)
        cache_result = redis_client.get(document_indexing_cache_key)
        if cache_result is not None:
            raise InvalidActionError("Document is being indexed, please try again later")

        indexing_cache_key = "segment_{}_indexing".format(segment.id)
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is not None:
            raise InvalidActionError("Segment is being indexed, please try again later")

        if action == "enable":
            if segment.enabled:
                raise InvalidActionError("Segment is already enabled.")

            segment.enabled = True
            segment.disabled_at = None
            segment.disabled_by = None
            db.session.commit()

            # Set cache to prevent indexing the same segment multiple times
            redis_client.setex(indexing_cache_key, 600, 1)

            enable_segment_to_index_task.delay(segment.id)

            return {"result": "success"}, 200
        elif action == "disable":
            if not segment.enabled:
                raise InvalidActionError("Segment is already disabled.")

            segment.enabled = False
            segment.disabled_at = datetime.now(UTC).replace(tzinfo=None)
            segment.disabled_by = current_user.id
            db.session.commit()

            # Set cache to prevent indexing the same segment multiple times
            redis_client.setex(indexing_cache_key, 600, 1)

            disable_segment_from_index_task.delay(segment.id)

            return {"result": "success"}, 200
        else:
            raise InvalidActionError()


class DatasetDocumentSegmentAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("vector_space")
    @cloud_edition_billing_knowledge_limit_check("add_segment")
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
        if not current_user.is_editor:
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
                    "No Embedding Model available. Please configure a valid provider "
                    "in the Settings -> Model Provider."
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
                    "No Embedding Model available. Please configure a valid provider "
                    "in the Settings -> Model Provider."
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
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
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
        args = parser.parse_args()
        SegmentService.segment_create_args_validate(args, document)
        segment = SegmentService.update_segment(args, segment, document, dataset)
        return {"data": marshal(segment, segment_fields), "doc_form": document.doc_form}, 200

    @setup_required
    @login_required
    @account_initialization_required
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
        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_editor:
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
                    data = {"content": row[0], "answer": row[1]}
                else:
                    data = {"content": row[0]}
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


api.add_resource(DatasetDocumentSegmentListApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments")
api.add_resource(DatasetDocumentSegmentApi, "/datasets/<uuid:dataset_id>/segments/<uuid:segment_id>/<string:action>")
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

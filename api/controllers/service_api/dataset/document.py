import json
from typing import Self
from uuid import UUID

from flask import request
from flask_restx import marshal
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import desc, select
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import register_enum_models, register_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.dataset.error import (
    ArchivedDocumentImmutableError,
    DocumentIndexingError,
    InvalidMetadataError,
)
from controllers.service_api.wraps import (
    DatasetApiResource,
    cloud_edition_billing_rate_limit_check,
    cloud_edition_billing_resource_check,
)
from core.errors.error import ProviderTokenNotInitError
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from fields.document_fields import document_fields, document_status_fields
from libs.login import current_user
from models.dataset import Dataset, Document, DocumentSegment
from services.dataset_service import DatasetService, DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    KnowledgeConfig,
    PreProcessingRule,
    ProcessRule,
    RetrievalModel,
    Rule,
    Segmentation,
)
from services.file_service import FileService


class DocumentTextCreatePayload(BaseModel):
    name: str
    text: str
    process_rule: ProcessRule | None = None
    original_document_id: str | None = None
    doc_form: str = Field(default="text_model")
    doc_language: str = Field(default="English")
    indexing_technique: str | None = None
    retrieval_model: RetrievalModel | None = None
    embedding_model: str | None = None
    embedding_model_provider: str | None = None


DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class DocumentTextUpdate(BaseModel):
    name: str | None = None
    text: str | None = None
    process_rule: ProcessRule | None = None
    doc_form: str = "text_model"
    doc_language: str = "English"
    retrieval_model: RetrievalModel | None = None

    @model_validator(mode="after")
    def check_text_and_name(self) -> Self:
        if self.text is not None and self.name is None:
            raise ValueError("name is required when text is provided")
        return self


class DocumentListQuery(BaseModel):
    page: int = Field(default=1, description="Page number")
    limit: int = Field(default=20, description="Number of items per page")
    keyword: str | None = Field(default=None, description="Search keyword")
    status: str | None = Field(default=None, description="Document status filter")


register_enum_models(service_api_ns, RetrievalMethod)

register_schema_models(
    service_api_ns,
    ProcessRule,
    RetrievalModel,
    DocumentTextCreatePayload,
    DocumentTextUpdate,
    DocumentListQuery,
    Rule,
    PreProcessingRule,
    Segmentation,
)


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/document/create_by_text",
    "/datasets/<uuid:dataset_id>/document/create-by-text",
)
class DocumentAddByTextApi(DatasetApiResource):
    """Resource for documents."""

    @service_api_ns.expect(service_api_ns.models[DocumentTextCreatePayload.__name__])
    @service_api_ns.doc("create_document_by_text")
    @service_api_ns.doc(description="Create a new document by providing text content")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            200: "Document created successfully",
            401: "Unauthorized - invalid API token",
            400: "Bad request - invalid parameters",
        }
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_resource_check("documents", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id):
        """Create document by text."""
        payload = DocumentTextCreatePayload.model_validate(service_api_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

        if not dataset:
            raise ValueError("Dataset does not exist.")

        if not dataset.indexing_technique and not args["indexing_technique"]:
            raise ValueError("indexing_technique is required.")

        embedding_model_provider = payload.embedding_model_provider
        embedding_model = payload.embedding_model
        if embedding_model_provider and embedding_model:
            DatasetService.check_embedding_model_setting(tenant_id, embedding_model_provider, embedding_model)

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

        if not current_user:
            raise ValueError("current_user is required")

        upload_file = FileService(db.engine).upload_text(
            text=payload.text, text_name=payload.name, user_id=current_user.id, tenant_id=tenant_id
        )
        data_source = {
            "type": "upload_file",
            "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": [upload_file.id]}},
        }
        args["data_source"] = data_source
        knowledge_config = KnowledgeConfig.model_validate(args)
        # validate args
        DocumentService.document_create_args_validate(knowledge_config)

        if not current_user:
            raise ValueError("current_user is required")

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                knowledge_config=knowledge_config,
                account=current_user,
                dataset_process_rule=dataset.latest_process_rule if "process_rule" not in args else None,
                created_from="api",
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]

        documents_and_batch_fields = {"document": marshal(document, document_fields), "batch": batch}
        return documents_and_batch_fields, 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update_by_text",
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update-by-text",
)
class DocumentUpdateByTextApi(DatasetApiResource):
    """Resource for update documents."""

    @service_api_ns.expect(service_api_ns.models[DocumentTextUpdate.__name__])
    @service_api_ns.doc("update_document_by_text")
    @service_api_ns.doc(description="Update an existing document by providing text content")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @service_api_ns.doc(
        responses={
            200: "Document updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Document not found",
        }
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id: str, dataset_id: UUID, document_id: UUID):
        """Update document by text."""
        payload = DocumentTextUpdate.model_validate(service_api_ns.payload or {})
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == str(dataset_id)).first()
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
        # validate args
        args["original_document_id"] = str(document_id)
        knowledge_config = KnowledgeConfig.model_validate(args)
        DocumentService.document_create_args_validate(knowledge_config)

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                knowledge_config=knowledge_config,
                account=current_user,
                dataset_process_rule=dataset.latest_process_rule if "process_rule" not in args else None,
                created_from="api",
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]

        documents_and_batch_fields = {"document": marshal(document, document_fields), "batch": batch}
        return documents_and_batch_fields, 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/document/create_by_file",
    "/datasets/<uuid:dataset_id>/document/create-by-file",
)
class DocumentAddByFileApi(DatasetApiResource):
    """Resource for documents."""

    @service_api_ns.doc("create_document_by_file")
    @service_api_ns.doc(description="Create a new document by uploading a file")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            200: "Document created successfully",
            401: "Unauthorized - invalid API token",
            400: "Bad request - invalid file or parameters",
        }
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_resource_check("documents", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id):
        """Create document by upload file."""
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

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
        dataset_id = str(dataset_id)
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
            content=file.read(),
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

        dataset_process_rule = dataset.latest_process_rule if "process_rule" not in args else None
        if not knowledge_config.original_document_id and not dataset_process_rule and not knowledge_config.process_rule:
            raise ValueError("process_rule is required.")

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                knowledge_config=knowledge_config,
                account=dataset.created_by_account,
                dataset_process_rule=dataset_process_rule,
                created_from="api",
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]
        documents_and_batch_fields = {"document": marshal(document, document_fields), "batch": batch}
        return documents_and_batch_fields, 200


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update_by_file",
    "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update-by-file",
)
class DocumentUpdateByFileApi(DatasetApiResource):
    """Resource for update documents."""

    @service_api_ns.doc("update_document_by_file")
    @service_api_ns.doc(description="Update an existing document by uploading a file")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @service_api_ns.doc(
        responses={
            200: "Document updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Document not found",
        }
    )
    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id, document_id):
        """Update document by upload file."""
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

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
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)

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
                    content=file.read(),
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
                account=dataset.created_by_account,
                dataset_process_rule=dataset.latest_process_rule if "process_rule" not in args else None,
                created_from="api",
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]
        documents_and_batch_fields = {"document": marshal(document, document_fields), "batch": document.batch}
        return documents_and_batch_fields, 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents")
class DocumentListApi(DatasetApiResource):
    @service_api_ns.doc("list_documents")
    @service_api_ns.doc(description="List all documents in a dataset")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            200: "Documents retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    def get(self, tenant_id, dataset_id):
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        query_params = DocumentListQuery.model_validate(request.args.to_dict())
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        query = select(Document).filter_by(dataset_id=str(dataset_id), tenant_id=tenant_id)

        if query_params.status:
            query = DocumentService.apply_display_status_filter(query, query_params.status)

        if query_params.keyword:
            search = f"%{query_params.keyword}%"
            query = query.where(Document.name.like(search))

        query = query.order_by(desc(Document.created_at), desc(Document.position))

        paginated_documents = db.paginate(
            select=query, page=query_params.page, per_page=query_params.limit, max_per_page=100, error_out=False
        )
        documents = paginated_documents.items

        response = {
            "data": marshal(documents, document_fields),
            "has_more": len(documents) == query_params.limit,
            "limit": query_params.limit,
            "total": paginated_documents.total,
            "page": query_params.page,
        }

        return response


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<string:batch>/indexing-status")
class DocumentIndexingStatusApi(DatasetApiResource):
    @service_api_ns.doc("get_document_indexing_status")
    @service_api_ns.doc(description="Get indexing status for documents in a batch")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "batch": "Batch ID"})
    @service_api_ns.doc(
        responses={
            200: "Indexing status retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset or documents not found",
        }
    )
    def get(self, tenant_id, dataset_id, batch):
        dataset_id = str(dataset_id)
        batch = str(batch)
        tenant_id = str(tenant_id)
        # get dataset
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # get documents
        documents = DocumentService.get_batch_documents(dataset_id, batch)
        if not documents:
            raise NotFound("Documents not found.")
        documents_status = []
        for document in documents:
            completed_segments = (
                db.session.query(DocumentSegment)
                .where(
                    DocumentSegment.completed_at.isnot(None),
                    DocumentSegment.document_id == str(document.id),
                    DocumentSegment.status != "re_segment",
                )
                .count()
            )
            total_segments = (
                db.session.query(DocumentSegment)
                .where(DocumentSegment.document_id == str(document.id), DocumentSegment.status != "re_segment")
                .count()
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
            documents_status.append(marshal(document_dict, document_status_fields))
        data = {"data": documents_status}
        return data


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>")
class DocumentApi(DatasetApiResource):
    METADATA_CHOICES = {"all", "only", "without"}

    @service_api_ns.doc("get_document")
    @service_api_ns.doc(description="Get a specific document by ID")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @service_api_ns.doc(
        responses={
            200: "Document retrieved successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Document not found",
        }
    )
    def get(self, tenant_id, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)

        dataset = self.get_dataset(dataset_id, tenant_id)

        document = DocumentService.get_document(dataset.id, document_id)

        if not document:
            raise NotFound("Document not found.")

        if document.tenant_id != str(tenant_id):
            raise Forbidden("No permission.")

        metadata = request.args.get("metadata", "all")
        if metadata not in self.METADATA_CHOICES:
            raise InvalidMetadataError(f"Invalid metadata value: {metadata}")

        if metadata == "only":
            response = {"id": document.id, "doc_type": document.doc_type, "doc_metadata": document.doc_metadata_details}
        elif metadata == "without":
            dataset_process_rules = DatasetService.get_process_rules(dataset_id)
            document_process_rules = document.dataset_process_rule.to_dict() if document.dataset_process_rule else {}
            data_source_info = document.data_source_detail_dict
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
                "segment_count": document.segment_count,
                "average_segment_length": document.average_segment_length,
                "hit_count": document.hit_count,
                "display_status": document.display_status,
                "doc_form": document.doc_form,
                "doc_language": document.doc_language,
            }
        else:
            dataset_process_rules = DatasetService.get_process_rules(dataset_id)
            document_process_rules = document.dataset_process_rule.to_dict() if document.dataset_process_rule else {}
            data_source_info = document.data_source_detail_dict
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
                "doc_metadata": document.doc_metadata_details,
                "segment_count": document.segment_count,
                "average_segment_length": document.average_segment_length,
                "hit_count": document.hit_count,
                "display_status": document.display_status,
                "doc_form": document.doc_form,
                "doc_language": document.doc_language,
            }

        return response

    @service_api_ns.doc("delete_document")
    @service_api_ns.doc(description="Delete a document")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "document_id": "Document ID"})
    @service_api_ns.doc(
        responses={
            204: "Document deleted successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - document is archived",
            404: "Document not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def delete(self, tenant_id, dataset_id, document_id):
        """Delete document."""
        document_id = str(document_id)
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)

        # get dataset info
        dataset = db.session.query(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

        if not dataset:
            raise ValueError("Dataset does not exist.")

        document = DocumentService.get_document(dataset.id, document_id)

        # 404 if document not found
        if document is None:
            raise NotFound("Document Not Exists.")

        # 403 if document is archived
        if DocumentService.check_archived(document):
            raise ArchivedDocumentImmutableError()

        try:
            # delete document
            DocumentService.delete_document(document)
        except services.errors.document.DocumentIndexingError:
            raise DocumentIndexingError("Cannot delete document during indexing.")

        return 204

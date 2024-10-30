import json

from flask import request
from flask_restful import marshal, reqparse
from sqlalchemy import desc
from werkzeug.exceptions import NotFound

import services.dataset_service
from controllers.service_api import api
from controllers.service_api.app.error import ProviderNotInitializeError
from controllers.service_api.dataset.error import (
    ArchivedDocumentImmutableError,
    DocumentIndexingError,
    NoFileUploadedError,
    TooManyFilesError,
)
from controllers.service_api.wraps import DatasetApiResource, cloud_edition_billing_resource_check
from core.errors.error import ProviderTokenNotInitError
from extensions.ext_database import db
from fields.document_fields import document_fields, document_status_fields
from libs.login import current_user
from models.dataset import Dataset, Document, DocumentSegment
from services.dataset_service import DocumentService
from services.file_service import FileService


class DocumentAddByTextApi(DatasetApiResource):
    """Resource for documents."""

    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_resource_check("documents", "dataset")
    def post(self, tenant_id, dataset_id):
        """Create document by text."""
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, nullable=False, location="json")
        parser.add_argument("text", type=str, required=True, nullable=False, location="json")
        parser.add_argument("process_rule", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("original_document_id", type=str, required=False, location="json")
        parser.add_argument("doc_form", type=str, default="text_model", required=False, nullable=False, location="json")
        parser.add_argument(
            "doc_language", type=str, default="English", required=False, nullable=False, location="json"
        )
        parser.add_argument(
            "indexing_technique", type=str, choices=Dataset.INDEXING_TECHNIQUE_LIST, nullable=False, location="json"
        )
        parser.add_argument("retrieval_model", type=dict, required=False, nullable=False, location="json")
        args = parser.parse_args()
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

        if not dataset:
            raise ValueError("Dataset is not exist.")

        if not dataset.indexing_technique and not args["indexing_technique"]:
            raise ValueError("indexing_technique is required.")

        upload_file = FileService.upload_text(args.get("text"), args.get("name"))
        data_source = {
            "type": "upload_file",
            "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": [upload_file.id]}},
        }
        args["data_source"] = data_source
        # validate args
        DocumentService.document_create_args_validate(args)

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                document_data=args,
                account=current_user,
                dataset_process_rule=dataset.latest_process_rule if "process_rule" not in args else None,
                created_from="api",
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]

        documents_and_batch_fields = {"document": marshal(document, document_fields), "batch": batch}
        return documents_and_batch_fields, 200


class DocumentUpdateByTextApi(DatasetApiResource):
    """Resource for update documents."""

    @cloud_edition_billing_resource_check("vector_space", "dataset")
    def post(self, tenant_id, dataset_id, document_id):
        """Update document by text."""
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=False, nullable=True, location="json")
        parser.add_argument("text", type=str, required=False, nullable=True, location="json")
        parser.add_argument("process_rule", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("doc_form", type=str, default="text_model", required=False, nullable=False, location="json")
        parser.add_argument(
            "doc_language", type=str, default="English", required=False, nullable=False, location="json"
        )
        parser.add_argument("retrieval_model", type=dict, required=False, nullable=False, location="json")
        args = parser.parse_args()
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

        if not dataset:
            raise ValueError("Dataset is not exist.")

        if args["text"]:
            upload_file = FileService.upload_text(args.get("text"), args.get("name"))
            data_source = {
                "type": "upload_file",
                "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": [upload_file.id]}},
            }
            args["data_source"] = data_source
        # validate args
        args["original_document_id"] = str(document_id)
        DocumentService.document_create_args_validate(args)

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                document_data=args,
                account=current_user,
                dataset_process_rule=dataset.latest_process_rule if "process_rule" not in args else None,
                created_from="api",
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]

        documents_and_batch_fields = {"document": marshal(document, document_fields), "batch": batch}
        return documents_and_batch_fields, 200


class DocumentAddByFileApi(DatasetApiResource):
    """Resource for documents."""

    @cloud_edition_billing_resource_check("vector_space", "dataset")
    @cloud_edition_billing_resource_check("documents", "dataset")
    def post(self, tenant_id, dataset_id):
        """Create document by upload file."""
        args = {}
        if "data" in request.form:
            args = json.loads(request.form["data"])
        if "doc_form" not in args:
            args["doc_form"] = "text_model"
        if "doc_language" not in args:
            args["doc_language"] = "English"
        # get dataset info
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

        if not dataset:
            raise ValueError("Dataset is not exist.")
        if not dataset.indexing_technique and not args.get("indexing_technique"):
            raise ValueError("indexing_technique is required.")

        # save file info
        file = request.files["file"]
        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        upload_file = FileService.upload_file(file, current_user)
        data_source = {"type": "upload_file", "info_list": {"file_info_list": {"file_ids": [upload_file.id]}}}
        args["data_source"] = data_source
        # validate args
        DocumentService.document_create_args_validate(args)

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                document_data=args,
                account=dataset.created_by_account,
                dataset_process_rule=dataset.latest_process_rule if "process_rule" not in args else None,
                created_from="api",
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]
        documents_and_batch_fields = {"document": marshal(document, document_fields), "batch": batch}
        return documents_and_batch_fields, 200


class DocumentUpdateByFileApi(DatasetApiResource):
    """Resource for update documents."""

    @cloud_edition_billing_resource_check("vector_space", "dataset")
    def post(self, tenant_id, dataset_id, document_id):
        """Update document by upload file."""
        args = {}
        if "data" in request.form:
            args = json.loads(request.form["data"])
        if "doc_form" not in args:
            args["doc_form"] = "text_model"
        if "doc_language" not in args:
            args["doc_language"] = "English"

        # get dataset info
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

        if not dataset:
            raise ValueError("Dataset is not exist.")
        if "file" in request.files:
            # save file info
            file = request.files["file"]

            if len(request.files) > 1:
                raise TooManyFilesError()

            upload_file = FileService.upload_file(file, current_user)
            data_source = {"type": "upload_file", "info_list": {"file_info_list": {"file_ids": [upload_file.id]}}}
            args["data_source"] = data_source
        # validate args
        args["original_document_id"] = str(document_id)
        DocumentService.document_create_args_validate(args)

        try:
            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                document_data=args,
                account=dataset.created_by_account,
                dataset_process_rule=dataset.latest_process_rule if "process_rule" not in args else None,
                created_from="api",
            )
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        document = documents[0]
        documents_and_batch_fields = {"document": marshal(document, document_fields), "batch": document.batch}
        return documents_and_batch_fields, 200


class DocumentDeleteApi(DatasetApiResource):
    def delete(self, tenant_id, dataset_id, document_id):
        """Delete document."""
        document_id = str(document_id)
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)

        # get dataset info
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

        if not dataset:
            raise ValueError("Dataset is not exist.")

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

        return {"result": "success"}, 200


class DocumentListApi(DatasetApiResource):
    def get(self, tenant_id, dataset_id):
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        search = request.args.get("keyword", default=None, type=str)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")

        query = Document.query.filter_by(dataset_id=str(dataset_id), tenant_id=tenant_id)

        if search:
            search = f"%{search}%"
            query = query.filter(Document.name.like(search))

        query = query.order_by(desc(Document.created_at))

        paginated_documents = query.paginate(page=page, per_page=limit, max_per_page=100, error_out=False)
        documents = paginated_documents.items

        response = {
            "data": marshal(documents, document_fields),
            "has_more": len(documents) == limit,
            "limit": limit,
            "total": paginated_documents.total,
            "page": page,
        }

        return response


class DocumentIndexingStatusApi(DatasetApiResource):
    def get(self, tenant_id, dataset_id, batch):
        dataset_id = str(dataset_id)
        batch = str(batch)
        tenant_id = str(tenant_id)
        # get dataset
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # get documents
        documents = DocumentService.get_batch_documents(dataset_id, batch)
        if not documents:
            raise NotFound("Documents not found.")
        documents_status = []
        for document in documents:
            completed_segments = DocumentSegment.query.filter(
                DocumentSegment.completed_at.isnot(None),
                DocumentSegment.document_id == str(document.id),
                DocumentSegment.status != "re_segment",
            ).count()
            total_segments = DocumentSegment.query.filter(
                DocumentSegment.document_id == str(document.id), DocumentSegment.status != "re_segment"
            ).count()
            document.completed_segments = completed_segments
            document.total_segments = total_segments
            if document.is_paused:
                document.indexing_status = "paused"
            documents_status.append(marshal(document, document_status_fields))
        data = {"data": documents_status}
        return data


api.add_resource(DocumentAddByTextApi, "/datasets/<uuid:dataset_id>/document/create_by_text")
api.add_resource(DocumentAddByFileApi, "/datasets/<uuid:dataset_id>/document/create_by_file")
api.add_resource(DocumentUpdateByTextApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update_by_text")
api.add_resource(DocumentUpdateByFileApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/update_by_file")
api.add_resource(DocumentDeleteApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>")
api.add_resource(DocumentListApi, "/datasets/<uuid:dataset_id>/documents")
api.add_resource(DocumentIndexingStatusApi, "/datasets/<uuid:dataset_id>/documents/<string:batch>/indexing-status")

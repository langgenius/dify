from werkzeug.exceptions import NotFound

from controllers.service_api import api
from controllers.service_api.wraps import (
    DatasetApiResource,
)
from core.file import helpers as file_helpers
from extensions.ext_database import db
from models.dataset import Dataset
from models.model import UploadFile
from services.dataset_service import DocumentService


class UploadFileApi(DatasetApiResource):
    def get(self, tenant_id, dataset_id, document_id):
        """Get upload file."""
        # check dataset
        dataset_id = str(dataset_id)
        tenant_id = str(tenant_id)
        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise NotFound("Dataset not found.")
        # check document
        document_id = str(document_id)
        document = DocumentService.get_document(dataset.id, document_id)
        if not document:
            raise NotFound("Document not found.")
        # check upload file
        if document.data_source_type != "upload_file":
            raise ValueError(f"Document data source type ({document.data_source_type}) is not upload_file.")
        data_source_info = document.data_source_info_dict
        if data_source_info and "upload_file_id" in data_source_info:
            file_id = data_source_info["upload_file_id"]
            upload_file = db.session.query(UploadFile).filter(UploadFile.id == file_id).first()
            if not upload_file:
                raise NotFound("UploadFile not found.")
        else:
            raise ValueError("Upload file id not found in document data source info.")

        url = file_helpers.get_signed_file_url(upload_file_id=upload_file.id)
        return {
            "id": upload_file.id,
            "name": upload_file.name,
            "size": upload_file.size,
            "extension": upload_file.extension,
            "url": url,
            "download_url": f"{url}&as_attachment=true",
            "mime_type": upload_file.mime_type,
            "created_by": upload_file.created_by,
            "created_at": upload_file.created_at.timestamp(),
        }, 200


api.add_resource(UploadFileApi, "/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/upload-file")

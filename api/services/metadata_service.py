import copy
import logging

from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    MetadataArgs,
    MetadataOperationData,
)

logger = logging.getLogger(__name__)


class MetadataService:
    @staticmethod
    def create_metadata(dataset_id: str, metadata_args: MetadataArgs) -> DatasetMetadata:
        # check if metadata name is too long
        if len(metadata_args.name) > 255:
            raise ValueError("Metadata name cannot exceed 255 characters.")
        current_user, current_tenant_id = current_account_with_tenant()
        # check if metadata name already exists
        if (
            db.session.query(DatasetMetadata)
            .filter_by(tenant_id=current_tenant_id, dataset_id=dataset_id, name=metadata_args.name)
            .first()
        ):
            raise ValueError("Metadata name already exists.")
        for field in BuiltInField:
            if field.value == metadata_args.name:
                raise ValueError("Metadata name already exists in Built-in fields.")
        metadata = DatasetMetadata(
            tenant_id=current_tenant_id,
            dataset_id=dataset_id,
            type=metadata_args.type,
            name=metadata_args.name,
            created_by=current_user.id,
        )
        db.session.add(metadata)
        db.session.commit()
        return metadata

    @staticmethod
    def update_metadata_name(dataset_id: str, metadata_id: str, name: str) -> DatasetMetadata:  # type: ignore
        # check if metadata name is too long
        if len(name) > 255:
            raise ValueError("Metadata name cannot exceed 255 characters.")

        lock_key = f"dataset_metadata_lock_{dataset_id}"
        # check if metadata name already exists
        current_user, current_tenant_id = current_account_with_tenant()
        if (
            db.session.query(DatasetMetadata)
            .filter_by(tenant_id=current_tenant_id, dataset_id=dataset_id, name=name)
            .first()
        ):
            raise ValueError("Metadata name already exists.")
        for field in BuiltInField:
            if field.value == name:
                raise ValueError("Metadata name already exists in Built-in fields.")
        try:
            MetadataService.knowledge_base_metadata_lock_check(dataset_id, None)
            metadata = db.session.query(DatasetMetadata).filter_by(id=metadata_id).first()
            if metadata is None:
                raise ValueError("Metadata not found.")
            old_name = metadata.name
            metadata.name = name
            metadata.updated_by = current_user.id
            metadata.updated_at = naive_utc_now()

            # update related documents
            dataset_metadata_bindings = (
                db.session.query(DatasetMetadataBinding).filter_by(metadata_id=metadata_id).all()
            )
            if dataset_metadata_bindings:
                document_ids = [binding.document_id for binding in dataset_metadata_bindings]
                documents = DocumentService.get_document_by_ids(document_ids)
                for document in documents:
                    if not document.doc_metadata:
                        doc_metadata = {}
                    else:
                        doc_metadata = copy.deepcopy(document.doc_metadata)
                    value = doc_metadata.pop(old_name, None)
                    doc_metadata[name] = value
                    document.doc_metadata = doc_metadata
                    db.session.add(document)
            db.session.commit()
            return metadata
        except Exception:
            logger.exception("Update metadata name failed")
        finally:
            redis_client.delete(lock_key)

    @staticmethod
    def delete_metadata(dataset_id: str, metadata_id: str):
        lock_key = f"dataset_metadata_lock_{dataset_id}"
        try:
            MetadataService.knowledge_base_metadata_lock_check(dataset_id, None)
            metadata = db.session.query(DatasetMetadata).filter_by(id=metadata_id).first()
            if metadata is None:
                raise ValueError("Metadata not found.")
            db.session.delete(metadata)

            # deal related documents
            dataset_metadata_bindings = (
                db.session.query(DatasetMetadataBinding).filter_by(metadata_id=metadata_id).all()
            )
            if dataset_metadata_bindings:
                document_ids = [binding.document_id for binding in dataset_metadata_bindings]
                documents = DocumentService.get_document_by_ids(document_ids)
                for document in documents:
                    if not document.doc_metadata:
                        doc_metadata = {}
                    else:
                        doc_metadata = copy.deepcopy(document.doc_metadata)
                    doc_metadata.pop(metadata.name, None)
                    document.doc_metadata = doc_metadata
                    db.session.add(document)
            db.session.commit()
            return metadata
        except Exception:
            logger.exception("Delete metadata failed")
        finally:
            redis_client.delete(lock_key)

    @staticmethod
    def get_built_in_fields():
        return [
            {"name": BuiltInField.document_name, "type": "string"},
            {"name": BuiltInField.uploader, "type": "string"},
            {"name": BuiltInField.upload_date, "type": "time"},
            {"name": BuiltInField.last_update_date, "type": "time"},
            {"name": BuiltInField.source, "type": "string"},
        ]

    @staticmethod
    def enable_built_in_field(dataset: Dataset):
        if dataset.built_in_field_enabled:
            return
        lock_key = f"dataset_metadata_lock_{dataset.id}"
        try:
            MetadataService.knowledge_base_metadata_lock_check(dataset.id, None)
            db.session.add(dataset)
            documents = DocumentService.get_working_documents_by_dataset_id(dataset.id)
            if documents:
                for document in documents:
                    if not document.doc_metadata:
                        doc_metadata = {}
                    else:
                        doc_metadata = copy.deepcopy(document.doc_metadata)
                    doc_metadata[BuiltInField.document_name] = document.name
                    doc_metadata[BuiltInField.uploader] = document.uploader
                    doc_metadata[BuiltInField.upload_date] = document.upload_date.timestamp()
                    doc_metadata[BuiltInField.last_update_date] = document.last_update_date.timestamp()
                    doc_metadata[BuiltInField.source] = MetadataDataSource[document.data_source_type]
                    document.doc_metadata = doc_metadata
                    db.session.add(document)
            dataset.built_in_field_enabled = True
            db.session.commit()
        except Exception:
            logger.exception("Enable built-in field failed")
        finally:
            redis_client.delete(lock_key)

    @staticmethod
    def disable_built_in_field(dataset: Dataset):
        if not dataset.built_in_field_enabled:
            return
        lock_key = f"dataset_metadata_lock_{dataset.id}"
        try:
            MetadataService.knowledge_base_metadata_lock_check(dataset.id, None)
            db.session.add(dataset)
            documents = DocumentService.get_working_documents_by_dataset_id(dataset.id)
            document_ids = []
            if documents:
                for document in documents:
                    if not document.doc_metadata:
                        doc_metadata = {}
                    else:
                        doc_metadata = copy.deepcopy(document.doc_metadata)
                    doc_metadata.pop(BuiltInField.document_name, None)
                    doc_metadata.pop(BuiltInField.uploader, None)
                    doc_metadata.pop(BuiltInField.upload_date, None)
                    doc_metadata.pop(BuiltInField.last_update_date, None)
                    doc_metadata.pop(BuiltInField.source, None)
                    document.doc_metadata = doc_metadata
                    db.session.add(document)
                    document_ids.append(document.id)
            dataset.built_in_field_enabled = False
            db.session.commit()
        except Exception:
            logger.exception("Disable built-in field failed")
        finally:
            redis_client.delete(lock_key)

    @staticmethod
    def update_documents_metadata(dataset: Dataset, metadata_args: MetadataOperationData):
        for operation in metadata_args.operation_data:
            lock_key = f"document_metadata_lock_{operation.document_id}"
            try:
                MetadataService.knowledge_base_metadata_lock_check(None, operation.document_id)
                document = DocumentService.get_document(dataset.id, operation.document_id)
                if document is None:
                    raise ValueError("Document not found.")
                doc_metadata = {}
                for metadata_value in operation.metadata_list:
                    doc_metadata[metadata_value.name] = metadata_value.value
                if dataset.built_in_field_enabled:
                    doc_metadata[BuiltInField.document_name] = document.name
                    doc_metadata[BuiltInField.uploader] = document.uploader
                    doc_metadata[BuiltInField.upload_date] = document.upload_date.timestamp()
                    doc_metadata[BuiltInField.last_update_date] = document.last_update_date.timestamp()
                    doc_metadata[BuiltInField.source] = MetadataDataSource[document.data_source_type]
                document.doc_metadata = doc_metadata
                db.session.add(document)
                db.session.commit()
                # deal metadata binding
                db.session.query(DatasetMetadataBinding).filter_by(document_id=operation.document_id).delete()
                current_user, current_tenant_id = current_account_with_tenant()
                for metadata_value in operation.metadata_list:
                    dataset_metadata_binding = DatasetMetadataBinding(
                        tenant_id=current_tenant_id,
                        dataset_id=dataset.id,
                        document_id=operation.document_id,
                        metadata_id=metadata_value.id,
                        created_by=current_user.id,
                    )
                    db.session.add(dataset_metadata_binding)
                db.session.commit()
            except Exception:
                logger.exception("Update documents metadata failed")
            finally:
                redis_client.delete(lock_key)

    @staticmethod
    def knowledge_base_metadata_lock_check(dataset_id: str | None, document_id: str | None):
        if dataset_id:
            lock_key = f"dataset_metadata_lock_{dataset_id}"
            if redis_client.get(lock_key):
                raise ValueError("Another knowledge base metadata operation is running, please wait a moment.")
            redis_client.set(lock_key, 1, ex=3600)
        if document_id:
            lock_key = f"document_metadata_lock_{document_id}"
            if redis_client.get(lock_key):
                raise ValueError("Another document metadata operation is running, please wait a moment.")
            redis_client.set(lock_key, 1, ex=3600)

    @staticmethod
    def get_dataset_metadatas(dataset: Dataset):
        return {
            "doc_metadata": [
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "type": item.get("type"),
                    "count": db.session.query(DatasetMetadataBinding)
                    .filter_by(metadata_id=item.get("id"), dataset_id=dataset.id)
                    .count(),
                }
                for item in dataset.doc_metadata or []
                if item.get("id") != "built-in"
            ],
            "built_in_field_enabled": dataset.built_in_field_enabled,
        }

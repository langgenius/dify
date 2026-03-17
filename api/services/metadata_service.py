import copy
import json
import logging
from collections.abc import Mapping

from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding
from models.model import App, AppModelConfig
from models.workflow import Workflow
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    MetadataArgs,
    MetadataOperationData,
)
from services.errors.metadata_service import MetadataInUseError

logger = logging.getLogger(__name__)


_PIPELINE_REF_CACHE_TTL = 60  # seconds


class MetadataService:
    @staticmethod
    def _collect_referenced_metadata_ids(payload: object, referenced_ids: set[str]) -> None:
        """Collect all metadata IDs referenced by persisted pipeline JSON payloads."""
        if isinstance(payload, Mapping):
            metadata_id = payload.get("metadata_id")
            if isinstance(metadata_id, str):
                referenced_ids.add(metadata_id)

            for value in payload.values():
                MetadataService._collect_referenced_metadata_ids(value, referenced_ids)
            return

        if isinstance(payload, list):
            for item in payload:
                MetadataService._collect_referenced_metadata_ids(item, referenced_ids)

    @staticmethod
    def _load_reference_payload(raw_payload: str | None, source_name: str) -> object | None:
        if not raw_payload:
            return None

        try:
            return json.loads(raw_payload)
        except json.JSONDecodeError:
            logger.warning("Failed to decode metadata reference payload from %s", source_name)
            return None

    @staticmethod
    def _scan_all_referenced_metadata_ids(tenant_id: str) -> set[str]:
        """Scan app configs and workflow graphs to collect all referenced metadata IDs."""
        all_referenced: set[str] = set()

        app_model_config_rows = (
            db.session.query(AppModelConfig.dataset_configs)
            .join(App, App.id == AppModelConfig.app_id)
            .filter(
                App.tenant_id == tenant_id,
                AppModelConfig.dataset_configs.isnot(None),
                AppModelConfig.dataset_configs.contains('"metadata_id"'),
            )
            .all()
        )

        workflow_rows = (
            db.session.query(Workflow.graph)
            .filter(
                Workflow.tenant_id == tenant_id,
                Workflow.graph.contains('"metadata_id"'),
            )
            .all()
        )

        for (raw_payload,) in app_model_config_rows:
            payload = MetadataService._load_reference_payload(raw_payload, "app_model_configs.dataset_configs")
            if payload is not None:
                MetadataService._collect_referenced_metadata_ids(payload, all_referenced)

        for (raw_payload,) in workflow_rows:
            payload = MetadataService._load_reference_payload(raw_payload, "workflows.graph")
            if payload is not None:
                MetadataService._collect_referenced_metadata_ids(payload, all_referenced)

        return all_referenced

    @staticmethod
    def _get_referenced_metadata_ids(
        tenant_id: str, metadata_ids: set[str], *, bypass_cache: bool = False
    ) -> set[str]:
        """Return metadata IDs (from the given set) that are referenced by pipeline configurations.

        Results are cached per-tenant for _PIPELINE_REF_CACHE_TTL seconds.
        Pass bypass_cache=True for write paths (e.g. delete) that require fresh data.
        """
        if not metadata_ids:
            return set()

        cache_key = f"metadata:pipeline_refs:{tenant_id}"

        if not bypass_cache:
            raw = redis_client.get(cache_key)
            if raw:
                all_referenced = set(json.loads(raw))
                return all_referenced & metadata_ids

        all_referenced = MetadataService._scan_all_referenced_metadata_ids(tenant_id)
        redis_client.setex(cache_key, _PIPELINE_REF_CACHE_TTL, json.dumps(list(all_referenced)))
        return all_referenced & metadata_ids

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
            _, current_tenant_id = current_account_with_tenant()
            referenced_metadata_ids = MetadataService._get_referenced_metadata_ids(
                current_tenant_id, {metadata_id}, bypass_cache=True
            )
            if metadata_id in referenced_metadata_ids:
                raise MetadataInUseError("This metadata is referenced by a pipeline and cannot be deleted.")
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
        except MetadataInUseError:
            raise
        except Exception:
            logger.exception("Delete metadata failed")
            raise
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
                if operation.partial_update:
                    doc_metadata = copy.deepcopy(document.doc_metadata) if document.doc_metadata else {}
                else:
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

                # deal metadata binding (in the same transaction as the doc_metadata update)
                if not operation.partial_update:
                    db.session.query(DatasetMetadataBinding).filter_by(document_id=operation.document_id).delete()

                current_user, current_tenant_id = current_account_with_tenant()
                for metadata_value in operation.metadata_list:
                    # check if binding already exists
                    if operation.partial_update:
                        existing_binding = (
                            db.session.query(DatasetMetadataBinding)
                            .filter_by(document_id=operation.document_id, metadata_id=metadata_value.id)
                            .first()
                        )
                        if existing_binding:
                            continue

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
                db.session.rollback()
                logger.exception("Update documents metadata failed")
                raise
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
        metadata_items = [item for item in dataset.doc_metadata or [] if item.get("id") != "built-in"]
        metadata_ids: set[str] = {mid for item in metadata_items if (mid := item.get("id")) is not None}
        referenced_metadata_ids = MetadataService._get_referenced_metadata_ids(dataset.tenant_id, metadata_ids)
        return {
            "doc_metadata": [
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "type": item.get("type"),
                    "count": db.session.query(DatasetMetadataBinding)
                    .filter_by(metadata_id=item.get("id"), dataset_id=dataset.id)
                    .count(),
                    "is_referenced_by_pipeline": item.get("id") in referenced_metadata_ids,
                }
                for item in metadata_items
            ],
            "built_in_field_enabled": dataset.built_in_field_enabled,
        }

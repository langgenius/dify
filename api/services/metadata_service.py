import copy
import logging
import time
from collections.abc import Sequence

from sqlalchemy import or_

from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding, Pipeline
from models.workflow import Workflow
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    MetadataArgs,
    MetadataOperationData,
)

logger = logging.getLogger(__name__)

KNOWLEDGE_INDEX_NODE_TYPE = "knowledge-index"


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

    # ------------------------------------------------------------------
    # Pipeline workflow guard helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_pipeline_for_dataset(dataset_id: str) -> Pipeline | None:
        """Return the Pipeline associated with *dataset_id*, or ``None``."""
        dataset = db.session.query(Dataset).filter_by(id=dataset_id).first()
        if not dataset or not dataset.pipeline_id:
            return None
        return db.session.query(Pipeline).filter_by(id=dataset.pipeline_id).first()

    @staticmethod
    def _get_pipeline_workflows(pipeline: Pipeline, *, published_only: bool = False) -> Sequence[Workflow]:
        """Fetch the relevant workflows for *pipeline*.

        Args:
            pipeline: The pipeline whose workflows to fetch.
            published_only: When ``True`` only the current published workflow is
                returned.  When ``False`` both the draft **and** the published
                workflow are returned (used for stricter deletion guards).
        """
        if published_only:
            if not pipeline.workflow_id:
                return []
            wf = db.session.query(Workflow).filter_by(id=pipeline.workflow_id).first()
            return [wf] if wf else []

        draft_condition = (Workflow.app_id == pipeline.id) & (Workflow.version == Workflow.VERSION_DRAFT)
        if pipeline.workflow_id:
            return db.session.query(Workflow).where(or_(draft_condition, Workflow.id == pipeline.workflow_id)).all()
        return db.session.query(Workflow).where(draft_condition).all()

    @staticmethod
    def iter_knowledge_index_nodes(workflow: Workflow):
        """Yield each ``knowledge-index`` node data dict from *workflow*.

        Raises on malformed ``graph_dict`` so callers can apply fail-closed
        logic in their own ``except`` blocks.
        """
        graph_dict = workflow.graph_dict
        for node in graph_dict.get("nodes", []):
            node_data = node.get("data", {})
            if node_data.get("type") == KNOWLEDGE_INDEX_NODE_TYPE:
                yield node_data

    # ------------------------------------------------------------------
    # Public pipeline guard checks
    # ------------------------------------------------------------------

    @staticmethod
    def check_built_in_enabled_in_published_pipeline(dataset_id: str) -> tuple[bool, str | None]:
        """Check if built-in metadata is enabled in the current **published** Pipeline workflow.

        Used when users disable built-in metadata from the Documents page.
        Only the published workflow is checked because the Documents page
        should not block on unpublished draft changes.

        Returns:
            ``(is_enabled, pipeline_name)``
        """
        pipeline = MetadataService._get_pipeline_for_dataset(dataset_id)
        if not pipeline:
            return False, None

        workflows = MetadataService._get_pipeline_workflows(pipeline, published_only=True)
        if not workflows:
            return False, None

        for workflow in workflows:
            try:
                for node_data in MetadataService.iter_knowledge_index_nodes(workflow):
                    if node_data.get("enable_built_in_metadata") is True:
                        return True, pipeline.name
            except Exception:
                logger.exception("Error checking built-in metadata in published pipeline workflow %s", workflow.id)
                return True, pipeline.name

        return False, None

    @staticmethod
    def check_metadata_used_in_pipeline(dataset_id: str, metadata_id: str) -> tuple[bool, str | None]:
        """Check if a custom metadata field is referenced in the Pipeline's Knowledge Base node.

        Both draft **and** published workflows are inspected to prevent
        deletion of metadata that is actively used or about to be published.

        Returns:
            ``(is_used, pipeline_name)``
        """
        pipeline = MetadataService._get_pipeline_for_dataset(dataset_id)
        if not pipeline:
            return False, None

        workflows = MetadataService._get_pipeline_workflows(pipeline, published_only=False)
        if not workflows:
            return False, None

        for workflow in workflows:
            try:
                for node_data in MetadataService.iter_knowledge_index_nodes(workflow):
                    for item in node_data.get("doc_metadata") or []:
                        if item.get("metadata_id") == metadata_id:
                            return True, pipeline.name
            except Exception:
                logger.exception("Error checking metadata usage in pipeline workflow %s", workflow.id)
                return True, pipeline.name

        return False, None

    @staticmethod
    def delete_metadata(dataset_id: str, metadata_id: str):
        lock_key = f"dataset_metadata_lock_{dataset_id}"
        try:
            MetadataService.knowledge_base_metadata_lock_check(dataset_id, None)
            metadata = db.session.query(DatasetMetadata).filter_by(id=metadata_id, dataset_id=dataset_id).first()
            if metadata is None:
                raise ValueError("Metadata not found.")

            # Check if metadata is used in Pipeline before deletion
            is_used, pipeline_name = MetadataService.check_metadata_used_in_pipeline(dataset_id, metadata_id)
            if is_used:
                raise ValueError(
                    f"Cannot delete metadata '{metadata.name}' because it is currently used in "
                    f"Pipeline '{pipeline_name}'."
                )

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
        except ValueError:
            raise
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
    def disable_built_in_field(dataset: Dataset) -> None:
        if not dataset.built_in_field_enabled:
            return

        lock_key = f"dataset_metadata_lock_{dataset.id}"
        try:
            MetadataService.knowledge_base_metadata_lock_check(dataset.id, None)

            # Guard runs under the lock so a concurrent publish cannot change
            # the published workflow between the check and the actual disable.
            is_enabled, pipeline_name = MetadataService.check_built_in_enabled_in_published_pipeline(dataset.id)
            if is_enabled:
                raise ValueError(
                    "Cannot disable built-in metadata because current published "
                    f"Pipeline '{pipeline_name}' is using it."
                )

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
        except ValueError:
            raise
        except Exception:
            logger.exception("Disable built-in field failed")
        finally:
            redis_client.delete(lock_key)

    @staticmethod
    def sync_built_in_field_on_publish(
        dataset_id: str,
        enable_built_in_metadata: bool,
        *,
        max_retries: int = 3,
        retry_interval: float = 0.2,
    ) -> None:
        """Sync dataset.built_in_field_enabled with the published workflow's node config.

        Called **after** the publish transaction commits so that
        ``pipeline.workflow_id`` already points to the new workflow.

        Unlike ``enable_built_in_field`` / ``disable_built_in_field`` this
        method does **not** populate or strip built-in fields on existing
        documents — that is intentional because the publish action only
        changes the *future* indexing behaviour.  The flag sync ensures the
        Documents page reflects the published pipeline's intent.

        Retries on lock contention because a concurrent disable may hold the
        lock briefly; giving up would leave the dataset flag stale.
        """
        lock_key = f"dataset_metadata_lock_{dataset_id}"

        for attempt in range(max_retries + 1):
            lock_acquired = False
            try:
                MetadataService.knowledge_base_metadata_lock_check(dataset_id, None)
                lock_acquired = True

                dataset = db.session.query(Dataset).filter_by(id=dataset_id).first()
                if not dataset:
                    logger.warning("sync_built_in_field_on_publish: dataset %s not found", dataset_id)
                    return

                if dataset.built_in_field_enabled == enable_built_in_metadata:
                    return

                logger.info(
                    "sync_built_in_field_on_publish: dataset=%s, %s -> %s",
                    dataset_id,
                    dataset.built_in_field_enabled,
                    enable_built_in_metadata,
                )
                dataset.built_in_field_enabled = enable_built_in_metadata
                db.session.add(dataset)
                db.session.commit()
                return
            except ValueError:
                if lock_acquired:
                    raise
                # Lock contention — retry after a short wait
                if attempt < max_retries:
                    logger.info(
                        "sync_built_in_field_on_publish: lock contention for dataset %s, retrying (%d/%d)",
                        dataset_id,
                        attempt + 1,
                        max_retries,
                    )
                    time.sleep(retry_interval)
                else:
                    raise
            finally:
                if lock_acquired:
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
            if not redis_client.set(lock_key, 1, nx=True, ex=3600):
                raise ValueError("Another knowledge base metadata operation is running, please wait a moment.")
        if document_id:
            lock_key = f"document_metadata_lock_{document_id}"
            if not redis_client.set(lock_key, 1, nx=True, ex=3600):
                raise ValueError("Another document metadata operation is running, please wait a moment.")

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

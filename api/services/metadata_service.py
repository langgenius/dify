import copy
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from core.rag.index_processor.constant.built_in_field import BuiltInField
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from libs.login import resolve_account_fallback
from models import Account
from models.dataset import DatasetMetadata, DatasetMetadataBinding
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    MetadataArgs,
)

logger = logging.getLogger(__name__)


class MetadataService:
    @staticmethod
    def create_metadata(
        dataset_id: str,
        metadata_args: MetadataArgs,
        current_user: Account | None = None,
        current_tenant_id: str | None = None,
        *,
        session: Session,
    ) -> DatasetMetadata:
        if len(metadata_args.name) > 255:
            raise ValueError("Metadata name cannot exceed 255 characters.")
        current_user, current_tenant_id = resolve_account_fallback(current_user, current_tenant_id)
        if session.scalar(
            select(DatasetMetadata)
            .where(
                DatasetMetadata.tenant_id == current_tenant_id,
                DatasetMetadata.dataset_id == dataset_id,
                DatasetMetadata.name == metadata_args.name,
            )
            .limit(1)
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
        session.add(metadata)
        session.commit()
        return metadata

    @staticmethod
    def update_metadata_name(
        dataset_id: str,
        metadata_id: str,
        name: str,
        current_user: Account | None = None,
        current_tenant_id: str | None = None,
        *,
        session: Session,
    ) -> DatasetMetadata | None:
        if len(name) > 255:
            raise ValueError("Metadata name cannot exceed 255 characters.")

        lock_key = f"dataset_metadata_lock_{dataset_id}"
        current_user, current_tenant_id = resolve_account_fallback(current_user, current_tenant_id)
        if session.scalar(
            select(DatasetMetadata)
            .where(
                DatasetMetadata.tenant_id == current_tenant_id,
                DatasetMetadata.dataset_id == dataset_id,
                DatasetMetadata.name == name,
            )
            .limit(1)
        ):
            raise ValueError("Metadata name already exists.")
        for field in BuiltInField:
            if field.value == name:
                raise ValueError("Metadata name already exists in Built-in fields.")
        try:
            MetadataService.knowledge_base_metadata_lock_check(dataset_id, None)
            metadata = session.scalar(
                select(DatasetMetadata)
                .where(DatasetMetadata.id == metadata_id, DatasetMetadata.dataset_id == dataset_id)
                .limit(1)
            )
            if metadata is None:
                raise NotFound("Metadata not found.")
            old_name = metadata.name
            metadata.name = name
            metadata.updated_by = current_user.id
            metadata.updated_at = naive_utc_now()

            dataset_metadata_bindings = session.scalars(
                select(DatasetMetadataBinding).where(DatasetMetadataBinding.metadata_id == metadata_id)
            ).all()
            if dataset_metadata_bindings:
                document_ids = [binding.document_id for binding in dataset_metadata_bindings]
                documents = DocumentService.get_document_by_ids(document_ids, session)
                for document in documents:
                    if not document.doc_metadata:
                        doc_metadata = {}
                    else:
                        doc_metadata = copy.deepcopy(document.doc_metadata)
                    value = doc_metadata.pop(old_name, None)
                    doc_metadata[name] = value
                    document.doc_metadata = doc_metadata
                    session.add(document)
            session.commit()
            return metadata
        except Exception:
            logger.exception("Update metadata name failed")
            return None
        finally:
            redis_client.delete(lock_key)

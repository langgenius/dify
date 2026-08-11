import copy
import logging
from collections import defaultdict
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any, cast
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from libs.login import resolve_account_fallback
from models import Account
from models.dataset import (
    Dataset,
    DatasetMetadata,
    DatasetMetadataBinding,
    Document,
    DocumentSegment,
    SegmentMetadataBinding,
)
from models.enums import DatasetMetadataType
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    MetadataArgs,
    MetadataOperationData,
    MetadataUpdateArgs,
)

logger = logging.getLogger(__name__)


class MetadataService:
    _LOCK_TTL_SECONDS = 3600
    _LOCK_RELEASE_SCRIPT = """
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('del', KEYS[1])
        end
        return 0
    """

    @staticmethod
    def _get_built_in_metadata(document: Document, *, session: Session) -> dict[str, Any]:
        return {
            BuiltInField.document_name: document.name,
            BuiltInField.uploader: document.get_uploader(session=session),
            BuiltInField.upload_date: document.upload_date.timestamp(),
            BuiltInField.last_update_date: document.last_update_date.timestamp(),
            BuiltInField.source: MetadataDataSource[document.data_source_type],
        }

    @staticmethod
    def _get_document_default_metadata(dataset: Dataset, document: Document, *, session: Session) -> dict[str, Any]:
        metadata: dict[str, Any] = (
            copy.deepcopy(cast(dict[str, Any], document.doc_metadata)) if document.doc_metadata else {}
        )
        if dataset.built_in_field_enabled:
            built_in_names = {field.value for field in BuiltInField}
            missing_names = built_in_names.difference(metadata)
            if missing_names:
                built_in_metadata = MetadataService._get_built_in_metadata(document, session=session)
                metadata.update({name: built_in_metadata[name] for name in missing_names})
        return metadata

    @staticmethod
    def _get_metadata_name_map(session: Session, dataset_id: str) -> dict[str, str]:
        metadatas = session.scalars(select(DatasetMetadata).where(DatasetMetadata.dataset_id == dataset_id)).all()
        return {metadata.id: metadata.name for metadata in metadatas}

    @staticmethod
    def _group_segment_overrides(
        session: Session, document_id: str, segment_ids: list[str] | None = None
    ) -> dict[str, list[SegmentMetadataBinding]]:
        stmt = select(SegmentMetadataBinding).where(SegmentMetadataBinding.document_id == document_id)
        if segment_ids is not None:
            if not segment_ids:
                return {}
            stmt = stmt.where(SegmentMetadataBinding.segment_id.in_(segment_ids))
        grouped: dict[str, list[SegmentMetadataBinding]] = defaultdict(list)
        for binding in session.scalars(stmt).all():
            grouped[binding.segment_id].append(binding)
        return grouped

    @staticmethod
    def _refresh_document_override_summary(session: Session, document: Document) -> None:
        override_segment_count = (
            session.scalar(
                select(func.count(func.distinct(SegmentMetadataBinding.segment_id))).where(
                    SegmentMetadataBinding.document_id == document.id
                )
            )
            or 0
        )
        document.segment_metadata_override_count = int(override_segment_count)
        document.has_segment_metadata_override = override_segment_count > 0
        session.add(document)

    @staticmethod
    def rebuild_segment_effective_metadata(
        session: Session,
        dataset: Dataset,
        document: Document,
        segment_ids: list[str] | None = None,
        changed_fields: list[str] | None = None,
    ) -> None:
        del changed_fields  # Reserved for a future partial JSON update implementation.
        stmt = select(DocumentSegment).where(DocumentSegment.document_id == document.id)
        if segment_ids is not None:
            if not segment_ids:
                MetadataService._refresh_document_override_summary(session, document)
                return
            stmt = stmt.where(DocumentSegment.id.in_(segment_ids))
        segments = session.scalars(stmt).all()
        if not segments:
            MetadataService._refresh_document_override_summary(session, document)
            return

        metadata_name_map = MetadataService._get_metadata_name_map(session, dataset.id)
        override_groups = MetadataService._group_segment_overrides(session, document.id, segment_ids)
        built_in_names = {field["name"] for field in MetadataService.get_built_in_fields()}
        default_metadata = MetadataService._get_document_default_metadata(dataset, document, session=session)

        for segment in segments:
            effective_metadata = copy.deepcopy(default_metadata)
            valid_override_count = 0
            for binding in override_groups.get(segment.id, []):
                metadata_name = metadata_name_map.get(binding.metadata_id)
                if not metadata_name or metadata_name in built_in_names:
                    continue
                effective_metadata[metadata_name] = binding.value_json
                valid_override_count += 1

            security_level = effective_metadata.get("security_level")
            segment.effective_metadata = effective_metadata
            segment.metadata_override_count = valid_override_count
            segment.effective_security_level = security_level if isinstance(security_level, str) else None
            session.add(segment)

        MetadataService._refresh_document_override_summary(session, document)

    @staticmethod
    def apply_document_metadata_to_segments(
        session: Session,
        dataset: Dataset,
        document: Document,
        changed_fields: list[str] | None = None,
    ) -> None:
        MetadataService.rebuild_segment_effective_metadata(
            session=session,
            dataset=dataset,
            document=document,
            changed_fields=changed_fields,
        )

    @staticmethod
    def get_segment_metadata_details(
        session: Session, dataset: Dataset, document: Document, segment: DocumentSegment
    ) -> list[dict[str, Any]]:
        metadata_definitions = session.scalars(
            select(DatasetMetadata).where(DatasetMetadata.dataset_id == dataset.id)
        ).all()
        override_bindings = session.scalars(
            select(SegmentMetadataBinding).where(SegmentMetadataBinding.segment_id == segment.id)
        ).all()
        override_by_metadata_id = {binding.metadata_id: binding for binding in override_bindings}
        document_metadata = MetadataService._get_document_default_metadata(dataset, document, session=session)
        effective_metadata = segment.effective_metadata or {}

        details: list[dict[str, Any]] = []
        for metadata in metadata_definitions:
            details.append(
                {
                    "id": metadata.id,
                    "name": metadata.name,
                    "type": metadata.type,
                    "value": effective_metadata.get(metadata.name, document_metadata.get(metadata.name)),
                    "source": "override" if metadata.id in override_by_metadata_id else "inherited",
                }
            )

        if dataset.built_in_field_enabled:
            for built_in_field in MetadataService.get_built_in_fields():
                details.append(
                    {
                        "id": "built-in",
                        "name": built_in_field["name"],
                        "type": built_in_field["type"],
                        "value": document_metadata.get(built_in_field["name"]),
                        "source": "built_in",
                    }
                )
        return details

    @staticmethod
    def _write_segment_metadata_overrides(
        session: Session,
        dataset: Dataset,
        document: Document,
        segment: DocumentSegment,
        metadata_updates: list[MetadataUpdateArgs],
        current_user: Account,
        current_tenant_id: str,
    ) -> None:
        if segment.dataset_id != dataset.id or segment.document_id != document.id:
            raise ValueError("Segment does not belong to the specified document.")

        built_in_names = {field["name"] for field in MetadataService.get_built_in_fields()}
        metadata_by_name = {
            metadata.name: metadata
            for metadata in session.scalars(
                select(DatasetMetadata).where(DatasetMetadata.dataset_id == dataset.id)
            ).all()
        }
        document_metadata = MetadataService._get_document_default_metadata(dataset, document, session=session)

        for metadata_update in metadata_updates:
            metadata_name = metadata_update.name
            if metadata_name in built_in_names:
                raise ValueError(f"Built-in metadata '{metadata_name}' cannot be overridden at segment level.")
            metadata = metadata_by_name.get(metadata_name)
            if metadata is None:
                raise ValueError(f"Metadata '{metadata_name}' is not defined in this dataset.")

            existing_binding = session.scalar(
                select(SegmentMetadataBinding)
                .where(
                    SegmentMetadataBinding.segment_id == segment.id,
                    SegmentMetadataBinding.metadata_id == metadata.id,
                )
                .limit(1)
            )
            if (
                metadata_update.value is not None
                and metadata_name in document_metadata
                and metadata_update.value == document_metadata[metadata_name]
            ):
                if existing_binding:
                    session.delete(existing_binding)
                continue

            if existing_binding:
                existing_binding.value_json = metadata_update.value
                existing_binding.updated_by = current_user.id
                existing_binding.updated_at = naive_utc_now()
                session.add(existing_binding)
            else:
                session.add(
                    SegmentMetadataBinding(
                        tenant_id=current_tenant_id,
                        dataset_id=dataset.id,
                        document_id=document.id,
                        segment_id=segment.id,
                        metadata_id=metadata.id,
                        value_json=metadata_update.value,
                        created_by=current_user.id,
                        updated_by=current_user.id,
                    )
                )

    @staticmethod
    def apply_segment_metadata_override(
        session: Session,
        dataset: Dataset,
        document: Document,
        segment: DocumentSegment,
        metadata_updates: list[MetadataUpdateArgs],
        current_user: Account | None = None,
        current_tenant_id: str | None = None,
    ) -> None:
        current_user, current_tenant_id = resolve_account_fallback(
            current_user, current_tenant_id, fallback_tenant_id=dataset.tenant_id
        )
        MetadataService._write_segment_metadata_overrides(
            session, dataset, document, segment, metadata_updates, current_user, current_tenant_id
        )
        session.flush()
        MetadataService.rebuild_segment_effective_metadata(session, dataset, document, segment_ids=[segment.id])

    @staticmethod
    def reset_segment_metadata_fields_to_document(
        session: Session,
        dataset: Dataset,
        document: Document,
        segment: DocumentSegment,
        field_names: list[str],
    ) -> None:
        metadata_by_name = {
            metadata.name: metadata.id
            for metadata in session.scalars(
                select(DatasetMetadata).where(DatasetMetadata.dataset_id == dataset.id)
            ).all()
        }
        metadata_ids = [metadata_by_name[name] for name in field_names if name in metadata_by_name]
        if metadata_ids:
            session.execute(
                delete(SegmentMetadataBinding).where(
                    SegmentMetadataBinding.segment_id == segment.id,
                    SegmentMetadataBinding.metadata_id.in_(metadata_ids),
                )
            )
        session.flush()
        MetadataService.rebuild_segment_effective_metadata(session, dataset, document, segment_ids=[segment.id])

    @staticmethod
    def batch_update_segments_metadata(
        session: Session,
        dataset: Dataset,
        document: Document,
        segment_ids: list[str],
        metadata_updates: list[MetadataUpdateArgs],
        current_user: Account | None = None,
        current_tenant_id: str | None = None,
    ) -> None:
        current_user, current_tenant_id = resolve_account_fallback(
            current_user, current_tenant_id, fallback_tenant_id=dataset.tenant_id
        )
        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.document_id == document.id,
                DocumentSegment.id.in_(segment_ids),
            )
        ).all()
        found_ids = {segment.id for segment in segments}
        missing_ids = sorted(set(segment_ids) - found_ids)
        if missing_ids:
            raise ValueError(f"Segments not found in document: {', '.join(missing_ids)}")
        for segment in segments:
            MetadataService._write_segment_metadata_overrides(
                session, dataset, document, segment, metadata_updates, current_user, current_tenant_id
            )
        session.flush()
        MetadataService.rebuild_segment_effective_metadata(session, dataset, document, segment_ids=segment_ids)

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
        if any(field.value == metadata_args.name for field in BuiltInField):
            raise ValueError("Metadata name already exists in Built-in fields.")
        metadata = DatasetMetadata(
            tenant_id=current_tenant_id,
            dataset_id=dataset_id,
            type=metadata_args.type,
            name=metadata_args.name,
            created_by=current_user.id,
        )
        session.add(metadata)
        session.flush()
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
        current_user, current_tenant_id = resolve_account_fallback(current_user, current_tenant_id)
        if session.scalar(
            select(DatasetMetadata)
            .where(
                DatasetMetadata.tenant_id == current_tenant_id,
                DatasetMetadata.dataset_id == dataset_id,
                DatasetMetadata.name == name,
                DatasetMetadata.id != metadata_id,
            )
            .limit(1)
        ):
            raise ValueError("Metadata name already exists.")
        if any(field.value == name for field in BuiltInField):
            raise ValueError("Metadata name already exists in Built-in fields.")

        try:
            with MetadataService.metadata_lock(dataset_id=dataset_id):
                metadata = session.scalar(
                    select(DatasetMetadata)
                    .where(DatasetMetadata.id == metadata_id, DatasetMetadata.dataset_id == dataset_id)
                    .limit(1)
                )
                if metadata is None:
                    raise ValueError("Metadata not found.")
                old_name = metadata.name
                metadata.name = name
                metadata.updated_by = current_user.id
                metadata.updated_at = naive_utc_now()

                document_ids = set(
                    session.scalars(
                        select(DatasetMetadataBinding.document_id).where(
                            DatasetMetadataBinding.metadata_id == metadata_id
                        )
                    ).all()
                )
                document_ids.update(
                    session.scalars(
                        select(SegmentMetadataBinding.document_id).where(
                            SegmentMetadataBinding.metadata_id == metadata_id
                        )
                    ).all()
                )
                session.flush()
                for document in DocumentService.get_document_by_ids(list(document_ids), session):
                    doc_metadata = copy.deepcopy(document.doc_metadata) if document.doc_metadata else {}
                    if old_name in doc_metadata:
                        doc_metadata[name] = doc_metadata.pop(old_name)
                        document.doc_metadata = doc_metadata
                        session.add(document)
                    dataset = session.get(Dataset, document.dataset_id)
                    if dataset:
                        MetadataService.rebuild_segment_effective_metadata(session, dataset, document)
                session.commit()
                return metadata
        except Exception:
            session.rollback()
            logger.exception("Update metadata name failed")
            return None

    @staticmethod
    def delete_metadata(dataset_id: str, metadata_id: str, session: Session):
        try:
            with MetadataService.metadata_lock(dataset_id=dataset_id):
                metadata = session.scalar(
                    select(DatasetMetadata)
                    .where(DatasetMetadata.id == metadata_id, DatasetMetadata.dataset_id == dataset_id)
                    .limit(1)
                )
                if metadata is None:
                    raise ValueError("Metadata not found.")
                document_ids = set(
                    session.scalars(
                        select(DatasetMetadataBinding.document_id).where(
                            DatasetMetadataBinding.metadata_id == metadata_id
                        )
                    ).all()
                )
                document_ids.update(
                    session.scalars(
                        select(SegmentMetadataBinding.document_id).where(
                            SegmentMetadataBinding.metadata_id == metadata_id
                        )
                    ).all()
                )
                session.execute(delete(SegmentMetadataBinding).where(SegmentMetadataBinding.metadata_id == metadata_id))
                session.execute(delete(DatasetMetadataBinding).where(DatasetMetadataBinding.metadata_id == metadata_id))
                session.flush()
                for document in DocumentService.get_document_by_ids(list(document_ids), session):
                    doc_metadata = copy.deepcopy(document.doc_metadata) if document.doc_metadata else {}
                    doc_metadata.pop(metadata.name, None)
                    document.doc_metadata = doc_metadata
                    session.add(document)
                    dataset = session.get(Dataset, document.dataset_id)
                    if dataset:
                        MetadataService.rebuild_segment_effective_metadata(session, dataset, document)
                session.delete(metadata)
                session.commit()
                return metadata
        except Exception:
            session.rollback()
            logger.exception("Delete metadata failed")
            return None

    @staticmethod
    def get_built_in_fields() -> list[dict[str, str]]:
        return [
            {"name": BuiltInField.document_name, "type": DatasetMetadataType.STRING},
            {"name": BuiltInField.uploader, "type": DatasetMetadataType.STRING},
            {"name": BuiltInField.upload_date, "type": DatasetMetadataType.TIME},
            {"name": BuiltInField.last_update_date, "type": DatasetMetadataType.TIME},
            {"name": BuiltInField.source, "type": DatasetMetadataType.STRING},
        ]

    @staticmethod
    def enable_built_in_field(dataset: Dataset, session: Session) -> None:
        if dataset.built_in_field_enabled:
            return
        try:
            with MetadataService.metadata_lock(dataset_id=dataset.id):
                dataset.built_in_field_enabled = True
                session.add(dataset)
                for document in DocumentService.get_working_documents_by_dataset_id(dataset.id, session):
                    doc_metadata = copy.deepcopy(document.doc_metadata) if document.doc_metadata else {}
                    doc_metadata.update(MetadataService._get_built_in_metadata(document, session=session))
                    document.doc_metadata = doc_metadata
                    session.add(document)
                    MetadataService.rebuild_segment_effective_metadata(session, dataset, document)
                session.commit()
        except Exception:
            session.rollback()
            logger.exception("Enable built-in field failed")

    @staticmethod
    def disable_built_in_field(dataset: Dataset, session: Session) -> None:
        if not dataset.built_in_field_enabled:
            return
        try:
            with MetadataService.metadata_lock(dataset_id=dataset.id):
                dataset.built_in_field_enabled = False
                session.add(dataset)
                for document in DocumentService.get_working_documents_by_dataset_id(dataset.id, session):
                    doc_metadata = copy.deepcopy(document.doc_metadata) if document.doc_metadata else {}
                    for field in BuiltInField:
                        doc_metadata.pop(field.value, None)
                    document.doc_metadata = doc_metadata
                    session.add(document)
                    MetadataService.rebuild_segment_effective_metadata(session, dataset, document)
                session.commit()
        except Exception:
            session.rollback()
            logger.exception("Disable built-in field failed")

    @staticmethod
    def update_documents_metadata(
        dataset: Dataset,
        metadata_args: MetadataOperationData,
        current_user: Account | None = None,
        current_tenant_id: str | None = None,
        *,
        session: Session,
    ) -> None:
        current_user, current_tenant_id = resolve_account_fallback(
            current_user, current_tenant_id, fallback_tenant_id=dataset.tenant_id
        )
        for operation in metadata_args.operation_data:
            try:
                with MetadataService.metadata_lock(dataset_id=dataset.id, document_id=operation.document_id):
                    document = DocumentService.get_document(dataset.id, operation.document_id, session=session)
                    if document is None:
                        raise ValueError("Document not found.")
                    doc_metadata = (
                        copy.deepcopy(document.doc_metadata)
                        if operation.partial_update and document.doc_metadata
                        else {}
                    )
                    for metadata_value in operation.metadata_list:
                        doc_metadata[metadata_value.name] = metadata_value.value
                    if dataset.built_in_field_enabled:
                        doc_metadata.update(MetadataService._get_built_in_metadata(document, session=session))
                    document.doc_metadata = doc_metadata
                    session.add(document)

                    if not operation.partial_update:
                        session.execute(
                            delete(DatasetMetadataBinding).where(
                                DatasetMetadataBinding.document_id == operation.document_id
                            )
                        )
                    for metadata_value in operation.metadata_list:
                        existing_binding = session.scalar(
                            select(DatasetMetadataBinding)
                            .where(
                                DatasetMetadataBinding.document_id == operation.document_id,
                                DatasetMetadataBinding.metadata_id == metadata_value.id,
                            )
                            .limit(1)
                        )
                        if existing_binding:
                            continue
                        session.add(
                            DatasetMetadataBinding(
                                tenant_id=current_tenant_id,
                                dataset_id=dataset.id,
                                document_id=operation.document_id,
                                metadata_id=metadata_value.id,
                                created_by=current_user.id,
                            )
                        )
                    MetadataService.apply_document_metadata_to_segments(
                        session,
                        dataset,
                        document,
                        changed_fields=[item.name for item in operation.metadata_list],
                    )
                    session.commit()
            except Exception:
                session.rollback()
                logger.exception("Update documents metadata failed")
                raise

    @staticmethod
    def knowledge_base_metadata_lock_check(dataset_id: str | None, document_id: str | None) -> list[tuple[str, str]]:
        lock_specs: list[tuple[str, str]] = []
        if dataset_id:
            lock_specs.append((f"dataset_metadata_lock_{dataset_id}", "knowledge base"))
        if document_id:
            lock_specs.append((f"document_metadata_lock_{document_id}", "document"))

        acquired: list[tuple[str, str]] = []
        for lock_key, scope_name in lock_specs:
            token = str(uuid4())
            if redis_client.set(lock_key, token, nx=True, ex=MetadataService._LOCK_TTL_SECONDS):
                acquired.append((lock_key, token))
                continue
            MetadataService._release_metadata_locks(acquired)
            raise ValueError(f"Another {scope_name} metadata operation is running, please wait a moment.")
        return acquired

    @staticmethod
    def _release_metadata_locks(acquired: list[tuple[str, str]]) -> None:
        for lock_key, token in reversed(acquired):
            redis_client.eval(MetadataService._LOCK_RELEASE_SCRIPT, 1, lock_key, token)

    @staticmethod
    @contextmanager
    def metadata_lock(dataset_id: str | None = None, document_id: str | None = None) -> Generator[None, None, None]:
        acquired = MetadataService.knowledge_base_metadata_lock_check(dataset_id, document_id)
        try:
            yield
        finally:
            MetadataService._release_metadata_locks(acquired)

    @staticmethod
    def get_dataset_metadatas(dataset: Dataset, session: Session):
        return {
            "doc_metadata": [
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "type": item.get("type"),
                    "count": session.scalar(
                        select(func.count(DatasetMetadataBinding.id)).where(
                            DatasetMetadataBinding.metadata_id == item.get("id"),
                            DatasetMetadataBinding.dataset_id == dataset.id,
                        )
                    )
                    or 0,
                }
                for item in dataset.get_doc_metadata(session=session)
                if item.get("id") != "built-in"
            ],
            "built_in_field_enabled": dataset.built_in_field_enabled,
        }

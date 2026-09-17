"""Session-owning adapters for document queries and existing document operations."""

import copy
import json
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any, Literal

from sqlalchemy import asc, desc, func, select, update
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound

from configs import dify_config
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_manager import ModelManager
from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from libs.pagination import paginate_query
from machinery.context import RequestContext
from models import Account, Dataset, Document, DocumentSegment, UploadFile
from models.dataset import DatasetPermissionEnum, DocumentPipelineExecutionLog
from models.enums import IndexingStatus
from repositories.knowledge.dataset_read_repository import (
    get_dataset_doc_form,
    get_document_hit_count,
    get_document_process_rule,
    get_document_segment_count,
    get_latest_dataset_process_rule,
)
from repositories.knowledge.dataset_repository import _get_dataset
from repositories.knowledge.document_repository import _get_document
from services.enterprise import rbac_service
from services.errors.account import NoPermissionError
from services.errors.document import DocumentIndexingError
from services.file_service import FileService
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.dataset_read_service import (
    get_document_metadata_details,
    get_document_source_detail,
    load_document_detail,
    load_document_details,
)
from services.knowledge.dataset_service import DatasetService, DocumentService
from services.knowledge.documents.application import (
    DocumentIndexingStateError,
    DocumentInvalidActionError,
    DocumentListFilter,
    DocumentNotFoundError,
    DocumentProviderError,
    DocumentState,
    DocumentZip,
)
from services.knowledge.entities.knowledge_entities import KnowledgeConfig
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.summaries.adapters import SummaryIndexAdapter
from services.vector_space_admission_service import get_vector_space_admission_error_fields
from tasks.generate_summary_index_task import generate_summary_index_task
from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task


@contextmanager
def _translate_errors() -> Generator[None, None, None]:
    try:
        yield
    except NotFound as error:
        raise DocumentNotFoundError(error.description) from error
    except NoPermissionError as error:
        raise DatasetAccessDeniedError() from error
    except DocumentIndexingError as error:
        raise DocumentIndexingStateError(str(error)) from error
    except (ProviderTokenNotInitError, InvokeAuthorizationError) as error:
        raise DocumentProviderError(str(error), kind="uninitialized") from error
    except QuotaExceededError as error:
        raise DocumentProviderError(str(error), kind="quota") from error
    except ModelCurrentlyNotSupportError as error:
        raise DocumentProviderError(str(error), kind="unsupported") from error


def _require_dataset(session: Session, ref: DatasetRef) -> Dataset:
    dataset = _get_dataset(session, ref)
    if dataset is None:
        raise DatasetNotFoundError()
    return dataset


def _require_document(session: Session, ref: DocumentRef) -> Document:
    document = _get_document(session, ref)
    if document is None:
        raise DocumentNotFoundError("Document not found.")
    return document


def _state(document: Document) -> DocumentState:
    return DocumentState(
        id=document.id,
        archived=bool(document.archived),
        indexing_status=str(document.indexing_status),
        is_paused=bool(document.is_paused),
        data_source_type=str(document.data_source_type),
        doc_form=str(document.doc_form),
        need_summary=bool(document.need_summary),
    )


def _created_response(dataset: Dataset, documents: Sequence[Document], batch: str, session: Session) -> dict[str, Any]:
    return {
        "dataset": {
            key: getattr(dataset, key)
            for key in (
                "id",
                "name",
                "description",
                "permission",
                "data_source_type",
                "indexing_technique",
                "created_by",
                "created_at",
            )
        },
        "documents": load_document_details(documents, session=session),
        "batch": batch,
    }


def _indexing_status(document: Document, counts: tuple[int, int]) -> dict[str, Any]:
    return {
        **{
            key: getattr(document, key)
            for key in (
                "id",
                "processing_started_at",
                "parsing_completed_at",
                "cleaning_completed_at",
                "splitting_completed_at",
                "completed_at",
                "paused_at",
                "error",
                "stopped_at",
            )
        },
        "indexing_status": IndexingStatus.PAUSED if document.is_paused else document.indexing_status,
        **get_vector_space_admission_error_fields(document.error),
        "completed_segments": counts[0],
        "total_segments": counts[1],
    }


class SQLAlchemyDocumentOperations:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def find_document(self, *, workspace_id: str, document_id: str) -> DocumentRef | None:
        with self._sessions() as session:
            document = session.scalar(
                select(Document).where(Document.id == document_id, Document.tenant_id == workspace_id)
            )
            return DatasetRef(workspace_id, document.dataset_id).document(document.id) if document else None

    def get_state(self, ref: DocumentRef) -> DocumentState | None:
        with self._sessions() as session:
            document = _get_document(session, ref)
            return _state(document) if document else None

    def get_states(self, ref: DatasetRef, document_ids: Sequence[str]) -> Sequence[DocumentState]:
        with self._sessions() as session:
            return tuple(
                _state(document) for document in DocumentService.get_documents_by_ids(ref, document_ids, session)
            )

    def get_process_rule(self, ref: DatasetRef | None) -> dict[str, Any]:
        result = copy.deepcopy(DocumentService.DEFAULT_RULES)
        if ref is not None:
            with self._sessions() as session:
                rule = get_latest_dataset_process_rule(_require_dataset(session, ref), session=session)
                if rule is not None:
                    result.update(mode=rule.mode, rules=rule.rules_dict)
        return result

    def list_documents(self, ref: DatasetRef, query: DocumentListFilter) -> dict[str, Any]:
        with self._sessions() as session:
            dataset = _require_dataset(session, ref)
            statement = select(Document).where(
                Document.dataset_id == ref.dataset_id, Document.tenant_id == ref.tenant_id
            )
            statement = DocumentService.apply_display_status_filter(statement, query.status)
            if query.search:
                statement = statement.where(Document.name.like(f"%{query.search}%"))
            direction = desc if query.sort.startswith("-") else asc
            sort = query.sort.removeprefix("-")
            if sort == "hit_count":
                hits = (
                    select(DocumentSegment.document_id, func.sum(DocumentSegment.hit_count).label("total_hit_count"))
                    .where(DocumentSegment.dataset_id == ref.dataset_id, DocumentSegment.tenant_id == ref.tenant_id)
                    .group_by(DocumentSegment.document_id)
                    .subquery()
                )
                statement = statement.outerjoin(hits, hits.c.document_id == Document.id).order_by(
                    direction(func.coalesce(hits.c.total_hit_count, 0)), direction(Document.position)
                )
            elif sort == "created_at":
                statement = statement.order_by(direction(Document.created_at), direction(Document.position))
            else:
                statement = statement.order_by(desc(Document.created_at), desc(Document.position))
            page = paginate_query(statement, session=session, page=query.page, per_page=query.limit, max_per_page=100)
            DocumentService.enrich_documents_with_summary_index_status(
                documents=page.items, dataset=dataset, tenant_id=ref.tenant_id, session=session
            )
            if query.fetch:
                counts = DocumentService.get_document_segment_counts(page.items, session=session)
                for document in page.items:
                    document.completed_segments, document.total_segments = counts.get(document.id, (0, 0))
            return {
                "data": load_document_details(page.items, session=session),
                "has_more": page.has_next,
                "limit": page.per_page,
                "total": page.total,
                "page": page.page,
            }

    def get_detail(self, ref: DocumentRef, *, metadata_only: bool) -> dict[str, Any]:
        with self._sessions() as session:
            document = _require_document(session, ref)
            result = {
                "id": document.id,
                "doc_type": document.doc_type,
                "doc_metadata": get_document_metadata_details(document, session=session),
            }
            if metadata_only:
                return result
            rule = get_document_process_rule(document, session=session)
            segment_count = get_document_segment_count(document, session=session)
            result.update(
                {
                    key: getattr(document, key)
                    for key in (
                        "position",
                        "data_source_type",
                        "dataset_process_rule_id",
                        "name",
                        "created_from",
                        "created_by",
                        "tokens",
                        "indexing_status",
                        "indexing_latency",
                        "error",
                        "enabled",
                        "disabled_by",
                        "archived",
                        "display_status",
                        "doc_form",
                        "doc_language",
                    )
                }
            )
            result.update(
                {
                    key: int(value.timestamp()) if (value := getattr(document, key)) else None
                    for key in ("created_at", "completed_at", "updated_at", "disabled_at")
                }
            )
            result.update(
                data_source_info=document.data_source_info_dict,
                data_source_detail_dict=get_document_source_detail(document, session=session),
                dataset_process_rule=DatasetService.get_process_rules(ref.dataset.dataset_id, session),
                document_process_rule=dict(rule.to_dict()) if rule else {},
                segment_count=segment_count,
                average_segment_length=(document.word_count or 0) // segment_count if segment_count else 0,
                hit_count=get_document_hit_count(document, session=session),
                need_summary=bool(document.need_summary),
            )
            return result

    def get_indexing_status(self, ref: DocumentRef) -> dict[str, Any]:
        with self._sessions() as session:
            document = _require_document(session, ref)
            counts = DocumentService.get_document_segment_counts([document], session=session)
            return _indexing_status(document, counts.get(document.id, (0, 0)))

    def get_batch_indexing_status(self, ref: DatasetRef, batch: str) -> dict[str, Any]:
        with self._sessions() as session:
            documents = session.scalars(
                select(Document).where(
                    Document.tenant_id == ref.tenant_id, Document.dataset_id == ref.dataset_id, Document.batch == batch
                )
            ).all()
            if not documents:
                raise DocumentNotFoundError("Documents not found.")
            counts = DocumentService.get_document_segment_counts(documents, session=session)
            return {"data": [_indexing_status(document, counts.get(document.id, (0, 0))) for document in documents]}

    def get_execution_log(self, ref: DocumentRef) -> dict[str, Any]:
        with self._sessions() as session:
            _require_document(session, ref)
            log = session.scalar(
                select(DocumentPipelineExecutionLog)
                .where(DocumentPipelineExecutionLog.document_id == ref.document_id)
                .order_by(DocumentPipelineExecutionLog.created_at.desc())
                .limit(1)
            )
            if log is None:
                return {}
            return {
                "datasource_info": json.loads(log.datasource_info),
                "datasource_type": log.datasource_type,
                "input_data": log.input_data,
                "datasource_node_id": log.datasource_node_id,
            }

    def get_summary_status(self, ref: DocumentRef) -> dict[str, Any]:
        with self._sessions() as session:
            _require_document(session, ref)
            return dict(
                SummaryIndexAdapter.get_document_summary_status_detail(
                    tenant_id=ref.dataset.tenant_id,
                    document_id=ref.document_id,
                    dataset_id=ref.dataset.dataset_id,
                    session=session,
                )
            )

    def get_download_url(self, ref: DocumentRef) -> str:
        with _translate_errors(), self._sessions() as session:
            return DocumentService.get_document_download_url(_require_document(session, ref), session)

    @contextmanager
    def build_download_zip(self, ref: DatasetRef, document_ids: Sequence[str]) -> Generator[DocumentZip, None, None]:
        with _translate_errors(), self._sessions() as session:
            files_by_document = DocumentService._get_upload_files_by_document_id_for_zip_download(
                dataset_id=ref.dataset_id, document_ids=document_ids, tenant_id=ref.tenant_id, session=session
            )
            files = [files_by_document[document_id] for document_id in document_ids]
            filename = DocumentService._generate_document_batch_download_zip_filename()
        # The read transaction is closed before reading storage or streaming the response.
        with FileService.build_upload_files_zip_tempfile(upload_files=files) as path:
            yield DocumentZip(path=path, filename=filename)

    @staticmethod
    def _actor(session: Session, context: RequestContext) -> Account:
        account = session.get(Account, context.account_id)
        if account is None:
            raise DatasetAccessDeniedError()
        account.set_tenant_id_with_session(context.active_workspace_id, session=session)
        return account

    def create_documents(self, context: RequestContext, ref: DatasetRef, settings: Mapping[str, Any]) -> dict[str, Any]:
        config = KnowledgeConfig.model_validate(settings)
        DocumentService.document_create_args_validate(config)
        with _translate_errors(), self._sessions() as session:
            dataset = _require_dataset(session, ref)
            if not dataset.indexing_technique and not config.indexing_technique:
                raise ValueError("indexing_technique is required.")
            account = self._actor(session, context)
            documents, batch = DocumentService.save_document_with_dataset_id(dataset, config, account, session=session)
            result = _created_response(dataset, documents, batch, session)
            session.commit()
            return result

    def initialize_dataset(self, context: RequestContext, settings: Mapping[str, Any]) -> dict[str, Any]:
        config = KnowledgeConfig.model_validate(settings)
        with _translate_errors():
            if config.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
                if config.embedding_model is None or config.embedding_model_provider is None:
                    raise ValueError(
                        "embedding model and embedding model provider are required for high quality indexing."
                    )
                ModelManager.for_tenant(tenant_id=context.active_workspace_id).get_model_instance(
                    tenant_id=context.active_workspace_id,
                    provider=config.embedding_model_provider,
                    model_type=ModelType.TEXT_EMBEDDING,
                    model=config.embedding_model,
                )
                config = config.model_copy(
                    update={
                        "is_multimodal": DatasetService.check_is_multimodal_model(
                            context.active_workspace_id, config.embedding_model_provider, config.embedding_model
                        )
                    }
                )
            DocumentService.document_create_args_validate(config)
            with self._sessions() as session:
                dataset, documents, batch = DocumentService.save_document_without_dataset_id(
                    tenant_id=context.active_workspace_id,
                    knowledge_config=config,
                    account=self._actor(session, context),
                    session=session,
                )
                dataset.permission = (
                    DatasetPermissionEnum.ALL_TEAM if dify_config.RBAC_ENABLED else DatasetPermissionEnum.ONLY_ME
                )
                session.flush()
                result = _created_response(dataset, documents, batch, session)
                dataset_id = dataset.id
                session.commit()
            if dify_config.RBAC_ENABLED:
                rbac_service.RBACService.DatasetAccess.replace_whitelist(
                    context.active_workspace_id,
                    context.account_id,
                    dataset_id,
                    rbac_service.ReplaceMemberBindings(automatic_include_workspace_members=True),
                )
                initialize_created_app_rbac_access_task.delay(
                    context.active_workspace_id, context.account_id, dataset_id=dataset_id
                )
            return result

    def _check_model(self, ref: DatasetRef) -> None:
        with self._sessions() as session:
            dataset = _require_dataset(session, ref)
        DatasetService.check_dataset_model_setting(dataset)

    def delete_document(self, ref: DocumentRef) -> None:
        self._check_model(ref.dataset)
        with _translate_errors(), self._sessions() as session:
            DocumentService.delete_document(_require_document(session, ref), session)

    def delete_documents(self, ref: DatasetRef, document_ids: Sequence[str]) -> None:
        with _translate_errors(), self._sessions() as session:
            dataset = _require_dataset(session, ref)
            DocumentService.delete_documents(
                ref, list(document_ids), get_dataset_doc_form(dataset, session=session), session
            )

    def update_document(self, ref: DocumentRef, values: Mapping[str, object]) -> None:
        with self._sessions.begin() as session:
            document = _require_document(session, ref)
            for name, value in values.items():
                setattr(document, name, value)

    def rename_document(self, ref: DocumentRef, name: str) -> dict[str, Any]:
        with self._sessions.begin() as session:
            dataset = _require_dataset(session, ref.dataset)
            document = _require_document(session, ref)
            if dataset.built_in_field_enabled and document.doc_metadata:
                document.doc_metadata = {**document.doc_metadata, BuiltInField.document_name: name}
            document.name = name
            if document.data_source_info_dict and (file_id := document.data_source_info_dict.get("upload_file_id")):
                session.execute(
                    update(UploadFile)
                    .where(UploadFile.id == file_id, UploadFile.tenant_id == ref.dataset.tenant_id)
                    .values(name=name)
                )
            session.flush()
            return load_document_detail(document, session=session)

    def pause_document(self, ref: DocumentRef, *, actor_id: str) -> None:
        with _translate_errors(), self._sessions() as session:
            DocumentService.pause_document(_require_document(session, ref), session, actor_id=actor_id)

    def recover_document(self, ref: DocumentRef) -> None:
        with _translate_errors(), self._sessions() as session:
            DocumentService.recover_document(_require_document(session, ref), session)

    def retry_documents(self, ref: DatasetRef, document_ids: Sequence[str], *, actor_id: str) -> None:
        with _translate_errors(), self._sessions() as session:
            documents = DocumentService.get_documents_by_ids(ref, document_ids, session)
            DocumentService.retry_document(ref.dataset_id, list(documents), session, actor_id=actor_id)

    def change_status(
        self,
        context: RequestContext,
        ref: DatasetRef,
        document_ids: Sequence[str],
        action: Literal["enable", "disable", "archive", "un_archive"],
    ) -> None:
        self._check_model(ref)
        with _translate_errors(), self._sessions() as session:
            dataset = _require_dataset(session, ref)
            account = self._actor(session, context)
            documents = DocumentService.get_documents_by_ids(ref, document_ids, session)
            try:
                DocumentService.batch_update_document_status(
                    dataset, [doc.id for doc in documents], action, account, session
                )
            except (ValueError, DocumentIndexingError) as error:
                raise DocumentInvalidActionError(str(error)) from error

    def sync_website(self, ref: DocumentRef) -> None:
        with _translate_errors(), self._sessions() as session:
            DocumentService.sync_website_document(
                _require_dataset(session, ref.dataset), _require_document(session, ref), session
            )

    def require_summary_enabled(self, ref: DatasetRef) -> None:
        with self._sessions() as session:
            dataset = _require_dataset(session, ref)
            if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
                raise ValueError(
                    "Summary generation is only available for 'high_quality' indexing technique. "
                    f"Current indexing technique: {dataset.indexing_technique}"
                )
            if not dataset.summary_index_setting or not dataset.summary_index_setting.get("enable"):
                raise ValueError(
                    "Summary index is not enabled for this dataset. Please enable it in the dataset settings."
                )

    def enable_summary(self, ref: DatasetRef, document_ids: Sequence[str]) -> None:
        if document_ids:
            with self._sessions.begin() as session:
                session.execute(
                    update(Document)
                    .where(
                        Document.tenant_id == ref.tenant_id,
                        Document.dataset_id == ref.dataset_id,
                        Document.id.in_(document_ids),
                    )
                    .values(need_summary=True)
                )

    def dispatch_summary(self, ref: DocumentRef) -> None:
        generate_summary_index_task.delay(ref.dataset.dataset_id, ref.document_id)

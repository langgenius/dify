"""Infrastructure adapters for indexing estimates."""

import json
import logging
from collections.abc import Mapping
from typing import cast

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.credit_usage import CreditUsageCreatedBy
from core.entities.knowledge_entities import IndexingEstimate, PreviewDetail, QAPreviewDetail
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelInstance, ModelManager
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from enums import DeploymentEdition
from extensions.ext_storage import storage
from graphon.model_runtime.entities.model_entities import ModelType
from repositories.knowledge.dataset_read_repository import get_dataset_process_rule_by_id
from repositories.knowledge.dataset_repository import _get_dataset
from repositories.knowledge.upload_file_repository import (
    claim_orphan_upload_files,
    delete_orphan_upload_files,
    recheck_claimed_orphan_upload_files,
    track_created_upload_files,
)
from services.knowledge.file_cleanup_gate import physical_file_cleanup_enabled
from services.knowledge.indexing.cleanup import UploadFileCleanup
from services.knowledge.indexing.estimate import (
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
)
from services.knowledge.resource_scope import DatasetRef

logger = logging.getLogger(__name__)


class SQLAlchemyProcessRuleReader:
    """Load one tenant-owned process rule in a bounded read session."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_by_id(self, *, dataset_ref: DatasetRef, process_rule_id: str) -> Mapping[str, object] | None:
        with self._session_factory() as session:
            process_rule = get_dataset_process_rule_by_id(
                session,
                tenant_id=dataset_ref.tenant_id,
                dataset_id=dataset_ref.dataset_id,
                process_rule_id=process_rule_id,
            )
            if process_rule is None:
                return None
            rules = json.loads(process_rule.rules) if process_rule.rules else {}
            return {"mode": str(process_rule.mode), "rules": rules}


class IndexingEstimateAdapter:
    """Extract previews without depending on the document indexing execution flow."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
    ) -> None:
        self._session_factory = session_factory

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def run(
        self,
        tenant_id: str,
        extract_settings: list[ExtractSetting],
        tmp_processing_rule: Mapping[str, object],
        doc_form: str | None = None,
        doc_language: str = "English",
        dataset_id: str | None = None,
        indexing_technique: str = "economy",
    ) -> IndexingEstimate:
        try:
            return self._estimate(
                tenant_id, extract_settings, tmp_processing_rule, doc_form, doc_language, dataset_id, indexing_technique
            )
        except (LLMBadRequestError, ProviderTokenNotInitError, PluginDaemonClientSideError) as error:
            raise IndexingEstimateProviderUnavailableError(error.description) from error
        except Exception as error:
            raise IndexingEstimateExecutionError(str(error)) from error

    def _estimate(
        self,
        tenant_id: str,
        extract_settings: list[ExtractSetting],
        processing_rule: Mapping[str, object],
        doc_form: str | None,
        doc_language: str,
        dataset_id: str | None,
        indexing_technique: str,
    ) -> IndexingEstimate:
        if (
            dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD
            and len(extract_settings) > dify_config.BATCH_UPLOAD_LIMIT
        ):
            raise ValueError(f"You have reached the batch upload limit of {dify_config.BATCH_UPLOAD_LIMIT}.")

        model = self._embedding_model(tenant_id, dataset_id, indexing_technique)
        processor = IndexProcessorFactory(doc_form).init_index_processor()
        previews: list[PreviewDetail] = []
        qa_previews: list[QAPreviewDetail] = []
        total_segments = 0
        # Legacy processors need a local session for extraction artifacts. No
        # document-state transaction is shared with this preview operation.
        created_uploads: dict[str, UploadFileCleanup] = {}
        try:
            with track_created_upload_files(tenant_id=tenant_id) as created_uploads:
                with self._session_factory() as session:
                    for setting in extract_settings:
                        texts = processor.extract(setting, process_rule_mode=processing_rule["mode"], session=session)
                        documents = processor.transform(
                            texts,
                            current_user=None,
                            embedding_model_instance=model,
                            process_rule={"mode": processing_rule["mode"], "rules": processing_rule.get("rules")},
                            tenant_id=tenant_id,
                            doc_language=doc_language,
                            preview=True,
                            session=session,
                        )
                        total_segments += len(documents)
                        for document in documents:
                            if doc_form == "qa_model":
                                if len(qa_previews) < 10:
                                    qa_previews.append(
                                        QAPreviewDetail(
                                            question=document.page_content,
                                            answer=document.metadata.get("answer") or "",
                                        )
                                    )
                            elif len(previews) < 10:
                                preview = PreviewDetail(content=document.page_content)
                                if document.children:
                                    preview.child_chunks = [child.page_content for child in document.children]
                                previews.append(preview)
                    session.commit()
        except Exception:
            try:
                self._cleanup_preview_uploads(tenant_id=tenant_id, files=tuple(created_uploads.values()))
            except Exception:
                logger.exception("Failed to retain preview cleanup intent after extraction failure")
            raise
        else:
            self._cleanup_preview_uploads(tenant_id=tenant_id, files=tuple(created_uploads.values()))

        if doc_form == "qa_model":
            return IndexingEstimate(total_segments=total_segments * 20, qa_preview=qa_previews, preview=[])
        summary = processing_rule.get("summary_index_setting")
        if isinstance(summary, Mapping) and summary.get("enable") and previews:
            with self._session_factory() as session:
                previews = processor.generate_summary_preview(
                    tenant_id, previews, cast(SummaryIndexSettingDict, summary), doc_language, session=session
                )
        return IndexingEstimate(total_segments=total_segments, preview=previews)

    def _cleanup_preview_uploads(self, *, tenant_id: str, files: tuple[UploadFileCleanup, ...]) -> None:
        # The tracker is the provenance proof. Markdown references can include
        # pre-existing user files and therefore never define this candidate set.
        if not files:
            return
        with self._session_factory.begin() as session:
            claimed = claim_orphan_upload_files(session, tenant_id=tenant_id, files=files)
        if not physical_file_cleanup_enabled():
            return
        with self._session_factory.begin() as session:
            claimed = recheck_claimed_orphan_upload_files(session, tenant_id=tenant_id, files=claimed)
        for file in claimed:
            if not file.key:
                continue
            if not physical_file_cleanup_enabled():
                return
            try:
                storage.delete(file.key)
            except FileNotFoundError:
                continue
            except Exception:
                logger.exception("Delete image file failed while estimating indexing, upload_file_id: %s", file.id)
                raise
        with self._session_factory.begin() as session:
            delete_orphan_upload_files(session, tenant_id=tenant_id, files=claimed)

    def _embedding_model(self, tenant_id: str, dataset_id: str | None, technique: str) -> ModelInstance | None:
        provider = None
        model_name = None
        if dataset_id:
            with self._session_factory() as session:
                dataset = _get_dataset(session, DatasetRef(tenant_id, dataset_id))
                if dataset is None:
                    raise ValueError("Dataset not found.")
                if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
                    technique = IndexTechniqueType.HIGH_QUALITY
                provider, model_name = dataset.embedding_model_provider, dataset.embedding_model
        if technique != IndexTechniqueType.HIGH_QUALITY:
            return None
        manager = ModelManager.for_tenant(tenant_id=tenant_id)
        if provider:
            if not model_name:
                raise ValueError("Embedding model is not configured.")
            return manager.get_model_instance(
                tenant_id=tenant_id, provider=provider, model_type=ModelType.TEXT_EMBEDDING, model=model_name
            )
        return manager.get_default_model_instance(tenant_id=tenant_id, model_type=ModelType.TEXT_EMBEDDING)

"""Infrastructure adapters for indexing estimates."""

import json
import logging
from collections.abc import Mapping
from typing import cast

from sqlalchemy import select
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
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.tools.utils.web_reader_tool import get_image_upload_file_ids
from enums import DeploymentEdition
from extensions.ext_storage import storage
from graphon.model_runtime.entities.model_entities import ModelType
from models.dataset import Dataset, DatasetProcessRule
from repositories.knowledge.dataset_repository import _get_dataset
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
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
            process_rule = session.scalar(
                select(DatasetProcessRule)
                .join(Dataset, Dataset.id == DatasetProcessRule.dataset_id)
                .where(
                    DatasetProcessRule.id == process_rule_id,
                    DatasetProcessRule.dataset_id == dataset_ref.dataset_id,
                    Dataset.tenant_id == dataset_ref.tenant_id,
                )
                .limit(1)
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
        self._uploads = SQLAlchemyKnowledgeUploadRepository(session_factory=session_factory)

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
        image_ids: set[str] = set()
        total_segments = 0
        # Legacy processors need a local session for extraction artifacts. No
        # document-state transaction is shared with this preview operation.
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
                                    question=document.page_content, answer=document.metadata.get("answer") or ""
                                )
                            )
                    elif len(previews) < 10:
                        preview = PreviewDetail(content=document.page_content)
                        if document.children:
                            preview.child_chunks = [child.page_content for child in document.children]
                        previews.append(preview)
                    image_ids.update(get_image_upload_file_ids(document.page_content))
            session.commit()

        # Storage I/O takes place after extraction commits and outside the
        # upload-record deletion transaction. Foreign tenant files are excluded.
        uploads = self._uploads.get_files(workspace_id=tenant_id, file_ids=tuple(image_ids))
        for upload in uploads.values():
            try:
                storage.delete(upload.key)
            except Exception:
                logger.exception("Delete image file failed while estimating indexing, upload_file_id: %s", upload.id)
        self._uploads.delete_files(workspace_id=tenant_id, file_ids=tuple(uploads))

        if doc_form == "qa_model":
            return IndexingEstimate(total_segments=total_segments * 20, qa_preview=qa_previews, preview=[])
        summary = processing_rule.get("summary_index_setting")
        if isinstance(summary, Mapping) and summary.get("enable") and previews:
            with self._session_factory() as session:
                previews = processor.generate_summary_preview(
                    tenant_id, previews, cast(SummaryIndexSettingDict, summary), doc_language, session=session
                )
        return IndexingEstimate(total_segments=total_segments, preview=previews)

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

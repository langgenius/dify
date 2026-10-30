"""Infrastructure adapters for indexing estimates."""

import json
import logging
from collections.abc import Mapping, Sequence
from typing import cast

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.credit_usage import CreditUsageCreatedBy
from core.entities.knowledge_entities import IndexingEstimate, PreviewDetail, QAPreviewDetail
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelInstance, ModelManager
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from enums import DeploymentEdition
from extensions.ext_storage import storage
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from repositories.file.upload_file_repository import UploadFileRepository
from repositories.knowledge.dataset_read_repository import get_dataset_process_rule_by_id
from repositories.knowledge.dataset_repository import _get_dataset
from services.data_source.website_service import WebsiteService
from services.entities.upload_file import CreatedUploadArtifact
from services.extraction.contracts import ExtractSetting
from services.extraction.images import ExtractionImageWriter
from services.extraction.processor import ExtractProcessor
from services.file_service import FileService
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.estimate import (
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
)

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
        files: FileService,
        website: WebsiteService,
    ) -> None:
        self._session_factory = session_factory
        self._files = files
        self._website = website

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
        processor = IndexProcessorFactory(doc_form, files=self._files).init_index_processor()
        previews: list[PreviewDetail] = []
        qa_previews: list[QAPreviewDetail] = []
        total_segments = 0
        # Extractor-created UploadFile rows join this preview transaction.
        # FileService uploads created during transform commit independently and
        # are tracked separately below.
        created_artifacts: dict[str, CreatedUploadArtifact] = {}
        created_published_file_ids: list[str] = []
        commit_started = False

        def record_artifact(artifact: CreatedUploadArtifact) -> None:
            created_artifacts[artifact.id] = artifact

        try:
            with self._session_factory() as session:
                for setting in extract_settings:
                    image_writer = (
                        ExtractionImageWriter(
                            session=session,
                            files=UploadFileRepository(session_factory=self._session_factory),
                            tenant_id=setting.upload_file.tenant_id,
                            user_id=setting.upload_file.created_by,
                            storage_type=dify_config.STORAGE_TYPE,
                            files_url=dify_config.FILES_URL,
                            save_blob=storage.save,
                            on_artifact_created=record_artifact,
                            clock=naive_utc_now,
                        )
                        if setting.upload_file is not None
                        else None
                    )
                    extraction = ExtractProcessor.extract(
                        setting,
                        is_automatic=processing_rule["mode"] in ("automatic", "hierarchical"),
                        image_writer=image_writer,
                        website_service=self._website,
                    )
                    created_artifacts.update(
                        (artifact.id, artifact) for artifact in extraction.created_upload_artifacts
                    )
                    documents = processor.transform(
                        extraction.documents,
                        current_user=None,
                        embedding_model_instance=model,
                        process_rule={"mode": processing_rule["mode"], "rules": processing_rule.get("rules")},
                        tenant_id=tenant_id,
                        doc_language=doc_language,
                        preview=True,
                        session=session,
                        on_upload_file_created=created_published_file_ids.append,
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
                # A commit exception has an unknown outcome. From this point,
                # cleanup must use the published file identity, never the raw key.
                commit_started = True
                session.commit()
        except Exception:
            self._cleanup_preview_uploads(tenant_id=tenant_id, file_ids=created_published_file_ids)
            if commit_started:
                self._cleanup_preview_uploads(tenant_id=tenant_id, file_ids=tuple(created_artifacts))
            else:
                self._cleanup_uncommitted_artifacts(tuple(created_artifacts.values()))
            raise
        else:
            self._cleanup_preview_uploads(
                tenant_id=tenant_id,
                file_ids=(*created_artifacts, *created_published_file_ids),
            )

        if doc_form == "qa_model":
            return IndexingEstimate(total_segments=total_segments * 20, qa_preview=qa_previews, preview=[])
        summary = processing_rule.get("summary_index_setting")
        if isinstance(summary, Mapping) and summary.get("enable") and previews:
            with self._session_factory() as session:
                previews = processor.generate_summary_preview(
                    tenant_id, previews, cast(SummaryIndexSettingDict, summary), doc_language, session=session
                )
        return IndexingEstimate(total_segments=total_segments, preview=previews)

    def _cleanup_preview_uploads(self, *, tenant_id: str, file_ids: Sequence[str]) -> None:
        for file_id in dict.fromkeys(file_ids):
            try:
                self._files.delete_file(tenant_id=tenant_id, file_id=file_id)
            except Exception:
                logger.exception("Delete image file failed while estimating indexing, upload_file_id: %s", file_id)

    def _cleanup_uncommitted_artifacts(self, artifacts: Sequence[CreatedUploadArtifact]) -> None:
        for artifact in {artifact.key: artifact for artifact in artifacts}.values():
            try:
                self._files.delete_uncommitted_artifact(artifact=artifact)
            except Exception:
                logger.exception(
                    "Failed to clean uncommitted preview artifact: file_id=%s, key=%s",
                    artifact.id,
                    artifact.key,
                )

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

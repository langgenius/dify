"""Infrastructure adapters for indexing estimates."""

import json
from collections.abc import Callable, Mapping
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.entities.knowledge_entities import IndexingEstimate
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.indexing_runner import IndexingRunner
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.entities.extraction import ExtractSetting
from models.dataset import Dataset, DatasetProcessRule
from services.knowledge.indexing.estimate import (
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
)
from services.knowledge.resource_scope import DatasetRef


class _ExistingIndexingRunner(Protocol):
    def indexing_estimate(
        self,
        tenant_id: str,
        extract_settings: list[ExtractSetting],
        tmp_processing_rule: Mapping[str, object],
        doc_form: str | None = None,
        doc_language: str = "English",
        dataset_id: str | None = None,
        indexing_technique: str = "economy",
        *,
        session: Session,
    ) -> IndexingEstimate: ...


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


class IndexingRunnerEstimateAdapter:
    """Call the existing indexing runner with application-prepared inputs."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        runner_factory: Callable[[], _ExistingIndexingRunner] = IndexingRunner,
    ) -> None:
        self._session_factory = session_factory
        self._runner_factory = runner_factory

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
            with self._session_factory() as session:
                return self._runner_factory().indexing_estimate(
                    tenant_id=tenant_id,
                    extract_settings=extract_settings,
                    tmp_processing_rule=tmp_processing_rule,
                    doc_form=doc_form,
                    doc_language=doc_language,
                    dataset_id=dataset_id,
                    indexing_technique=indexing_technique,
                    session=session,
                )
        except (LLMBadRequestError, ProviderTokenNotInitError, PluginDaemonClientSideError) as error:
            raise IndexingEstimateProviderUnavailableError(error.description) from error
        except Exception as error:
            raise IndexingEstimateExecutionError(str(error)) from error

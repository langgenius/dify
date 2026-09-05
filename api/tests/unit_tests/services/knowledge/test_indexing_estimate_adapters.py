from collections.abc import Mapping
from dataclasses import dataclass

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.entities.knowledge_entities import IndexingEstimate
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.entities.extraction import ExtractSetting, NotionInfo
from core.rag.extractor.entity.datasource_type import DatasourceType
from models.dataset import Dataset, DatasetProcessRule
from models.enums import ProcessRuleMode
from services.knowledge.indexing.adapters.estimate import (
    IndexingRunnerEstimateAdapter,
    SQLAlchemyProcessRuleReader,
)
from services.knowledge.indexing.estimate import (
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
)
from services.knowledge.resource_scope import DatasetRef


def _dataset(dataset_id: str, workspace_id: str) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=workspace_id,
        name=f"Dataset {dataset_id}",
        description="",
        provider="vendor",
        permission="only_me",
        created_by="account-1",
        maintainer="account-1",
        data_source_type="upload_file",
        indexing_technique="economy",
    )


def test_notion_access_token_is_excluded_from_model_serialization_and_repr() -> None:
    notion_info = NotionInfo(
        credential_id="credential-1",
        notion_workspace_id="workspace-1",
        notion_obj_id="page-1",
        notion_page_type="page",
        tenant_id="tenant-1",
        notion_access_token="secret",
    )

    assert "notion_access_token" not in notion_info.model_dump()
    assert "secret" not in repr(notion_info)


def test_process_rule_reader_loads_tenant_scoped_rule(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        rule = DatasetProcessRule(
            dataset_id="dataset-1",
            mode=ProcessRuleMode.CUSTOM,
            rules='{"segmentation": {"separator": "\\n", "max_tokens": 100}}',
            created_by="account-1",
        )
        rule.id = "rule-1"
        session.add(rule)

    reader = SQLAlchemyProcessRuleReader(session_factory=sqlite_session_factory)

    assert reader.get_by_id(dataset_ref=DatasetRef("workspace-1", "dataset-1"), process_rule_id="rule-1") == {
        "mode": "custom",
        "rules": {"segmentation": {"separator": "\n", "max_tokens": 100}},
    }
    assert reader.get_by_id(dataset_ref=DatasetRef("workspace-2", "dataset-1"), process_rule_id="rule-1") is None


@dataclass
class RecordingRunner:
    error: Exception | None = None
    called: bool = False

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
    ) -> IndexingEstimate:
        del doc_form, doc_language, dataset_id, indexing_technique
        if self.error is not None:
            raise self.error
        assert tenant_id == "workspace-1"
        assert len(extract_settings) == 1
        assert tmp_processing_rule["mode"] == "automatic"
        assert session.is_active
        self.called = True
        return IndexingEstimate(total_segments=1, preview=[])


def test_runner_adapter_delegates_with_a_session(sqlite_session_factory: sessionmaker[Session]) -> None:
    runner = RecordingRunner()
    setting = ExtractSetting(datasource_type=DatasourceType.WEBSITE)

    result = IndexingRunnerEstimateAdapter(
        session_factory=sqlite_session_factory,
        runner_factory=lambda: runner,
    ).run("workspace-1", [setting], {"mode": "automatic", "rules": {}})

    assert result.total_segments == 1
    assert runner.called


@pytest.mark.parametrize(
    ("runner_error", "expected_error"),
    [
        (LLMBadRequestError("provider unavailable"), IndexingEstimateProviderUnavailableError),
        (ProviderTokenNotInitError("provider unavailable"), IndexingEstimateProviderUnavailableError),
        (PluginDaemonClientSideError("provider unavailable"), IndexingEstimateProviderUnavailableError),
        (RuntimeError("processor failed"), IndexingEstimateExecutionError),
    ],
)
def test_runner_adapter_translates_infrastructure_errors(
    sqlite_session_factory: sessionmaker[Session],
    runner_error: Exception,
    expected_error: type[Exception],
) -> None:
    adapter = IndexingRunnerEstimateAdapter(
        session_factory=sqlite_session_factory,
        runner_factory=lambda: RecordingRunner(error=runner_error),
    )

    with pytest.raises(expected_error, match="provider unavailable|processor failed"):
        adapter.run(
            "workspace-1",
            [ExtractSetting(datasource_type=DatasourceType.WEBSITE)],
            {"mode": "automatic", "rules": {}},
        )

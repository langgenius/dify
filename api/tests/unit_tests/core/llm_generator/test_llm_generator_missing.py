import sys
from collections.abc import Iterator
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import core.llm_generator.llm_generator as generator_module
from core.app.app_config.entities import ModelConfig
from core.llm_generator.llm_generator import LLMGenerator, _parse_string_list
from models.dataset import Dataset


class _DatabaseBinding:
    """Expose the real SQLite session used by suggestion-context queries."""

    session: Session

    def __init__(self, session: Session) -> None:
        self.session = session


@pytest.fixture
def dataset_session(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    """Create only the legacy Dataset table and bind its query session."""

    Dataset.__table__.create(sqlite_engine)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        monkeypatch.setattr(generator_module, "db", _DatabaseBinding(session))
        yield session


def _dataset(*, dataset_id: str, tenant_id: str, name: str, created_at: datetime) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=name,
        created_by="account-id",
        created_at=created_at,
    )


class TestParseStringList:
    def test_empty(self):
        assert _parse_string_list("") == []

    def test_no_match(self):
        assert _parse_string_list("no list here") == []

    def test_valid_json(self):
        assert _parse_string_list('["item1", "item2"]') == ["item1", "item2"]

    def test_with_surrounding_text(self):
        assert _parse_string_list('Here is the list: ["a", "b"] enjoy!') == ["a", "b"]

    def test_invalid_json_fallback(self):
        # json_repair can fix missing quotes
        assert _parse_string_list("[item1, item2]") == ["item1", "item2"]

    def test_completely_invalid_json(self):
        assert _parse_string_list("[{}}]") == []

    def test_not_a_list(self):
        assert _parse_string_list('{"a": "b"}') == []

    def test_filter_non_strings(self):
        assert _parse_string_list('["a", 1, "b", {"foo": "bar"}]') == ["a", "b"]


class TestGenerateWorkflowInstructionSuggestions:
    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    def test_no_default_model(self, mock_for_tenant):
        mock_for_tenant.return_value.get_default_model_instance.side_effect = Exception("No model")
        assert LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow") == []

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    @patch("core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context")
    def test_llm_success(self, mock_build_context, mock_for_tenant):
        mock_build_context.return_value = "context"

        mock_model = MagicMock()
        mock_model.invoke_llm.return_value = MagicMock()
        mock_model.invoke_llm.return_value.message.get_text_content.return_value = '["idea 1", "idea 2"]'

        mock_for_tenant.return_value.get_default_model_instance.return_value = mock_model

        result = LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow")
        assert result == ["idea 1", "idea 2"]

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    @patch("core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context")
    def test_llm_error(self, mock_build_context, mock_for_tenant):
        mock_build_context.return_value = "context"

        mock_model = MagicMock()
        mock_model.invoke_llm.side_effect = Exception("API error")

        mock_for_tenant.return_value.get_default_model_instance.return_value = mock_model

        assert LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow") == []

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    @patch("core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context")
    def test_llm_bad_output(self, mock_build_context, mock_for_tenant):
        mock_build_context.return_value = "context"

        mock_model = MagicMock()
        mock_model.invoke_llm.return_value = MagicMock()
        mock_model.invoke_llm.return_value.message.get_text_content.return_value = "Not a list"

        mock_for_tenant.return_value.get_default_model_instance.return_value = mock_model

        assert LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow") == []


class TestBuildSuggestionContext:
    def test_both_success(self, dataset_session: Session, monkeypatch: pytest.MonkeyPatch):
        now = datetime.now()
        dataset_session.add_all(
            (
                _dataset(dataset_id="kb-1", tenant_id="tenant", name="kb1", created_at=now),
                _dataset(
                    dataset_id="kb-2",
                    tenant_id="tenant",
                    name="kb2",
                    created_at=now - timedelta(seconds=1),
                ),
                _dataset(dataset_id="other-kb", tenant_id="other", name="private", created_at=now),
            )
        )
        dataset_session.commit()

        # ``_build_suggestion_context`` imports the tool catalogue lazily, so we
        # stub the module in ``sys.modules``. Use ``monkeypatch.setitem`` so the
        # ORIGINAL module is RESTORED on teardown — a bare ``del`` would evict it
        # from sys.modules entirely, after which a sibling test that imported
        # ``build_tool_catalogue`` at collection time (e.g. test_tool_catalogue)
        # diverges from a freshly re-imported module and its @patch targets stop
        # applying, silently breaking it under xdist.
        mock_tool_catalogue = MagicMock()
        mock_tool_catalogue.build_tool_catalogue.return_value = "catalog"
        mock_tool_catalogue.format_tool_catalogue.return_value = "tool1\ntool2"
        monkeypatch.setitem(sys.modules, "core.workflow.generator.tool_catalogue", mock_tool_catalogue)

        result = LLMGenerator._build_suggestion_context("tenant")
        assert "Knowledge bases:\n- kb1\n- kb2" in result
        assert "Installed tools:\ntool1\ntool2" in result

    def test_both_fail(self, dataset_session: Session, monkeypatch: pytest.MonkeyPatch):
        def fail_query(_orm_execute_state: object) -> None:
            raise SQLAlchemyError("DB error")

        event.listen(dataset_session, "do_orm_execute", fail_query)

        # See ``test_both_success``: restore the original module via monkeypatch
        # rather than ``del``-ing it, so we don't evict it for sibling tests.
        mock_tool_catalogue = MagicMock()
        mock_tool_catalogue.build_tool_catalogue.side_effect = Exception("Tool error")
        monkeypatch.setitem(sys.modules, "core.workflow.generator.tool_catalogue", mock_tool_catalogue)

        try:
            assert LLMGenerator._build_suggestion_context("tenant") == ""
        finally:
            event.remove(dataset_session, "do_orm_execute", fail_query)


class TestClassifyWorkflowMode:
    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    def test_model_error(self, mock_for_tenant):
        mock_for_tenant.return_value.get_model_instance.side_effect = Exception("API error")

        model_config = ModelConfig(provider="test", name="test", mode="chat")
        assert LLMGenerator.classify_workflow_mode("tenant", "instruction", model_config) == "advanced-chat"

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    def test_workflow_match(self, mock_for_tenant):
        mock_model = MagicMock()
        mock_model.invoke_llm.return_value = MagicMock()
        mock_model.invoke_llm.return_value.message.get_text_content.return_value = "  workflow "

        mock_for_tenant.return_value.get_model_instance.return_value = mock_model

        model_config = ModelConfig(provider="test", name="test", mode="chat")
        assert LLMGenerator.classify_workflow_mode("tenant", "instruction", model_config) == "workflow"

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    def test_other_match(self, mock_for_tenant):
        mock_model = MagicMock()
        mock_model.invoke_llm.return_value = MagicMock()
        mock_model.invoke_llm.return_value.message.get_text_content.return_value = "chatflow"

        mock_for_tenant.return_value.get_model_instance.return_value = mock_model

        model_config = ModelConfig(provider="test", name="test", mode="chat")
        assert LLMGenerator.classify_workflow_mode("tenant", "instruction", model_config) == "advanced-chat"


class TestWorkflowServiceInterface:
    def test_protocol_methods(self):
        # Just to cover the 'pass' statements in the Protocol definition
        from core.llm_generator.llm_generator import WorkflowServiceInterface

        class MockService(WorkflowServiceInterface):
            def get_draft_workflow(self, app_model, workflow_id=None, *, session):
                return super().get_draft_workflow(app_model, workflow_id, session=session)

            def get_node_last_run(self, app_model, workflow, node_id):
                return super().get_node_last_run(app_model, workflow, node_id)

        service = MockService()
        service.get_draft_workflow(None, session=None)
        service.get_node_last_run(None, None, "node")

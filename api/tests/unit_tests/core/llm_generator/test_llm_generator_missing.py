from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

import core.llm_generator.llm_generator as generator_module
from core.llm_generator.llm_generator import LLMGenerator, _parse_string_list
from core.model_manager import ModelInstance, ModelManager
from core.workflow.generator import tool_catalogue as tool_catalogue_module
from core.workflow.generator.tool_catalogue import ToolCatalogueEntry
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from models.dataset import Dataset
from services.workflow_service import WorkflowService


@pytest.fixture
def dataset_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Session:
    """Bind the real SQLite session to the production database extension."""

    monkeypatch.setattr(generator_module.db, "session", sqlite_session)
    return sqlite_session


def _llm_result(content: str) -> LLMResult:
    """Build a real non-streaming LLM response around deterministic test content."""

    return LLMResult(
        model="test-model",
        message=AssistantPromptMessage(content=content),
        usage=LLMUsage.empty_usage(),
    )


def _model_manager() -> tuple[MagicMock, MagicMock]:
    """Build spec-constrained mocks for the model-manager boundary and its default model."""

    model_manager = MagicMock(spec=ModelManager)
    model_instance = MagicMock(spec=ModelInstance)
    model_manager.get_default_model_instance.return_value = model_instance
    return model_manager, model_instance


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
        model_manager, _ = _model_manager()
        model_manager.get_default_model_instance.side_effect = RuntimeError("no default model")
        mock_for_tenant.return_value = model_manager

        assert LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow") == []

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    @patch("core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context")
    def test_llm_success(self, mock_build_context, mock_for_tenant):
        mock_build_context.return_value = "context"
        model_manager, model_instance = _model_manager()
        model_instance.invoke_llm.return_value = _llm_result('["idea 1", "idea 2"]')
        mock_for_tenant.return_value = model_manager

        result = LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow")
        assert result == ["idea 1", "idea 2"]
        model_instance.invoke_llm.assert_called_once()

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    @patch("core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context")
    def test_llm_error(self, mock_build_context, mock_for_tenant):
        mock_build_context.return_value = "context"
        model_manager, model_instance = _model_manager()
        model_instance.invoke_llm.side_effect = RuntimeError("API error")
        mock_for_tenant.return_value = model_manager

        result = LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow")
        assert result == []
        model_instance.invoke_llm.assert_called_once()

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    @patch("core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context")
    def test_llm_bad_output(self, mock_build_context, mock_for_tenant):
        mock_build_context.return_value = "context"
        model_manager, model_instance = _model_manager()
        model_instance.invoke_llm.return_value = _llm_result("Not a list")
        mock_for_tenant.return_value = model_manager

        result = LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow")
        assert result == []
        model_instance.invoke_llm.assert_called_once()


@pytest.mark.parametrize("sqlite_session", [(Dataset,)], indirect=True)
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

        def build_tool_catalogue(_tenant_id: str) -> list[ToolCatalogueEntry]:
            return [
                ToolCatalogueEntry(
                    provider_name="provider",
                    provider_type="builtin",
                    plugin_id="",
                    tool_name="tool1",
                    tool_label="tool1",
                    description="First tool",
                ),
                ToolCatalogueEntry(
                    provider_name="provider",
                    provider_type="builtin",
                    plugin_id="",
                    tool_name="tool2",
                    tool_label="tool2",
                    description="Second tool",
                ),
            ]

        # Keep the real module and formatter; only isolate provider/plugin discovery.
        monkeypatch.setattr(tool_catalogue_module, "build_tool_catalogue", build_tool_catalogue)

        result = LLMGenerator._build_suggestion_context("tenant")
        assert "Knowledge bases:\n- kb1\n- kb2" in result
        assert (
            'Installed tools:\n- provider/tool1 [provider_id="provider"; tool_name="tool1"] — First tool\n'
            '- provider/tool2 [provider_id="provider"; tool_name="tool2"] — Second tool'
        ) in result

    def test_both_fail(self, dataset_session: Session, monkeypatch: pytest.MonkeyPatch):
        def fail_query(_orm_execute_state: object) -> None:
            raise SQLAlchemyError("DB error")

        def fail_tool_catalogue(_tenant_id: str) -> list[ToolCatalogueEntry]:
            raise RuntimeError("Tool error")

        event.listen(dataset_session, "do_orm_execute", fail_query)
        monkeypatch.setattr(tool_catalogue_module, "build_tool_catalogue", fail_tool_catalogue)

        try:
            assert LLMGenerator._build_suggestion_context("tenant") == ""
        finally:
            event.remove(dataset_session, "do_orm_execute", fail_query)


class TestWorkflowServiceInterface:
    def test_real_workflow_service_exposes_protocol_methods(self):
        from core.llm_generator.llm_generator import WorkflowServiceInterface

        service: WorkflowServiceInterface = WorkflowService(sessionmaker())

        assert callable(service.get_draft_workflow)
        assert callable(service.get_node_last_run)

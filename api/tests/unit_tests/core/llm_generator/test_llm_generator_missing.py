from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

import core.llm_generator.llm_generator as generator_module
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
from core.llm_generator.llm_generator import LLMGenerator, _parse_string_list
from core.model_manager import ModelInstance, ModelManager
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.plugin_service import PluginService
from core.provider_manager import ProviderManager
from core.workflow.generator import tool_catalogue as tool_catalogue_module
from core.workflow.generator.tool_catalogue import ToolCatalogueEntry
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from models.dataset import Dataset
from models.provider import ProviderType, TenantDefaultModel
from models.provider_ids import ModelProviderID
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


def _provider_entity() -> ProviderEntity:
    """Build the provider schema returned by the isolated plugin-daemon boundary."""

    return ProviderEntity(
        provider="test-provider",
        label=I18nObject(en_US="Test Provider"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[],
    )


def _model_manager(sqlite_session: Session, *, has_default_model: bool = True) -> ModelManager:
    """Build the production runtime/provider/model stack around test configuration."""

    provider = _provider_entity()
    model_runtime = PluginModelRuntime(
        tenant_id="tenant",
        user_id=None,
        client=PluginModelClient(),
        plugin_service=PluginService,
    )
    configuration = ProviderConfiguration(
        tenant_id="tenant",
        provider=provider,
        preferred_provider_type=ProviderType.SYSTEM,
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(enabled=True, credentials={"api_key": "test"}),
        custom_configuration=CustomConfiguration(),
        model_settings=[],
    )
    configuration.bind_model_runtime(model_runtime)

    configurations = ProviderConfigurations(tenant_id="tenant")
    configurations[str(ModelProviderID(provider.provider))] = configuration

    provider_manager = ProviderManager(model_runtime)
    provider_manager._configurations_cache["tenant"] = configurations

    if has_default_model:
        sqlite_session.add(
            TenantDefaultModel(
                tenant_id="tenant",
                model_type=ModelType.LLM,
                provider_name=provider.provider,
                model_name="test-model",
            )
        )
        sqlite_session.commit()

    return ModelManager(provider_manager)


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


@pytest.mark.parametrize("sqlite_session", [(TenantDefaultModel,)], indirect=True)
class TestGenerateWorkflowInstructionSuggestions:
    @pytest.fixture(autouse=True)
    def bind_database_session(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        """Bind SQLite and isolate only plugin-daemon provider discovery."""

        monkeypatch.setattr(generator_module.db, "session", sqlite_session)
        monkeypatch.setattr(
            PluginService,
            "fetch_plugin_model_providers",
            classmethod(lambda cls, *, tenant_id, client: [_provider_entity()]),
        )

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    def test_no_default_model(self, mock_for_tenant, sqlite_session: Session):
        mock_for_tenant.return_value = _model_manager(sqlite_session, has_default_model=False)

        assert LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow") == []

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    @patch("core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context")
    def test_llm_success(self, mock_build_context, mock_for_tenant, sqlite_session: Session):
        mock_build_context.return_value = "context"
        mock_for_tenant.return_value = _model_manager(sqlite_session)

        with patch.object(
            ModelInstance,
            "invoke_llm",
            return_value=_llm_result('["idea 1", "idea 2"]'),
        ) as mock_invoke:
            result = LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow")

        assert result == ["idea 1", "idea 2"]
        mock_invoke.assert_called_once()

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    @patch("core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context")
    def test_llm_error(self, mock_build_context, mock_for_tenant, sqlite_session: Session):
        mock_build_context.return_value = "context"
        mock_for_tenant.return_value = _model_manager(sqlite_session)

        with patch.object(ModelInstance, "invoke_llm", side_effect=Exception("API error")) as mock_invoke:
            result = LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow")

        assert result == []
        mock_invoke.assert_called_once()

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    @patch("core.llm_generator.llm_generator.LLMGenerator._build_suggestion_context")
    def test_llm_bad_output(self, mock_build_context, mock_for_tenant, sqlite_session: Session):
        mock_build_context.return_value = "context"
        mock_for_tenant.return_value = _model_manager(sqlite_session)

        with patch.object(ModelInstance, "invoke_llm", return_value=_llm_result("Not a list")) as mock_invoke:
            result = LLMGenerator.generate_workflow_instruction_suggestions("tenant", mode="workflow")

        assert result == []
        mock_invoke.assert_called_once()


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
        assert "Installed tools:\n- provider/tool1 — First tool\n- provider/tool2 — Second tool" in result

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
    @pytest.mark.parametrize("sqlite_session", [()], indirect=True)
    def test_real_workflow_service_exposes_protocol_methods(self, sqlite_session: Session):
        from core.llm_generator.llm_generator import WorkflowServiceInterface

        service: WorkflowServiceInterface = WorkflowService(
            sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
        )

        assert callable(service.get_draft_workflow)
        assert callable(service.get_node_last_run)

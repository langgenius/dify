"""
Unit tests for ``WorkflowGeneratorService``.

The service is a thin facade — its job is (1) hand the tenant model_config to
``ModelManager`` to get a model_instance, (2) build the tool catalogue, and
(3) delegate to ``WorkflowGenerator``. We mock both dependencies so the tests
stay fast and focus on the wiring itself.
"""

from unittest.mock import MagicMock, patch

from core.app.app_config.entities import ModelConfig
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from graphon.model_runtime.entities.llm_entities import LLMMode
from services.workflow_generator_service import WorkflowGeneratorService


def _model_config() -> ModelConfig:
    return ModelConfig(
        provider="openai",
        name="gpt-4o",
        mode=LLMMode.CHAT,
        completion_params={"temperature": 0.4},
    )


class TestWorkflowGeneratorService:
    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_forwards_model_instance_and_complete_catalogue_to_generator(
        self,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """Happy path: the runner receives the complete catalogue for dynamic routing."""
        # Arrange
        instance = MagicMock(name="model_instance")
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = instance
        mock_build_catalogue.return_value = [
            {
                "provider_name": "google",
                "provider_type": "builtin",
                "plugin_id": "",
                "tool_name": "search",
                "tool_label": "Search",
                "description": "Search.",
            }
        ]
        mock_workflow_generator.generate_workflow_graph.return_value = {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "ok",
            "error": "",
        }

        # Act
        result = WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="workflow",
            instruction="Summarize a URL",
            model_config=_model_config(),
            ideal_output="A 3-sentence summary",
        )

        # Assert
        mock_model_manager.for_tenant.assert_called_once_with(
            tenant_id="t-1",
            request_metadata={
                "app_type": CreditUsageAppType.WORKFLOW,
                "created_by": CreditUsageCreatedBy.WORKFLOW_GENERATION,
            },
        )
        mock_workflow_generator.generate_workflow_graph.assert_called_once()
        call_kwargs = mock_workflow_generator.generate_workflow_graph.call_args.kwargs
        assert call_kwargs["model_instance"] is instance
        assert call_kwargs["provider"] == "openai"
        assert call_kwargs["model_name"] == "gpt-4o"
        assert call_kwargs["mode"] == "workflow"
        assert call_kwargs["instruction"] == "Summarize a URL"
        assert call_kwargs["ideal_output"] == "A 3-sentence summary"
        assert call_kwargs["tool_catalogue_text"] == ""
        assert call_kwargs["tool_catalogue_entries"] == mock_build_catalogue.return_value
        assert call_kwargs["model_parameters"] == {"temperature": 0.4}
        assert result["error"] == ""

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_catalogue_build_failure_falls_back_to_empty_text(
        self,
        mock_build_catalogue,
        mock_model_manager,
        mock_workflow_generator,
    ):
        """
        A plugin-daemon outage must not block generation — the catalogue helper
        is wrapped in try/except so a failure downgrades to an empty catalogue.
        """
        # Arrange
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.side_effect = RuntimeError("plugin daemon unreachable")
        mock_workflow_generator.generate_workflow_graph.return_value = {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }

        # Act
        WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="workflow",
            instruction="Summarize a URL",
            model_config=_model_config(),
        )

        # Assert: generation still ran, catalogue text was empty.
        call_kwargs = mock_workflow_generator.generate_workflow_graph.call_args.kwargs
        assert call_kwargs["tool_catalogue_text"] == ""

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_defaults_ideal_output_to_empty_string(
        self,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """Callers can omit ideal_output; the runner should still receive ""."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_workflow_generator.generate_workflow_graph.return_value = {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }

        WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="advanced-chat",
            instruction="A chat bot",
            model_config=_model_config(),
        )

        call_kwargs = mock_workflow_generator.generate_workflow_graph.call_args.kwargs
        assert call_kwargs["ideal_output"] == ""
        assert call_kwargs["mode"] == "advanced-chat"

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_forwards_current_graph_for_refine(
        self,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """The cmd+k `/refine` path passes the existing draft graph through to the runner."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_workflow_generator.generate_workflow_graph.return_value = {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }
        current_graph = {"nodes": [{"id": "node1"}], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}}

        WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="workflow",
            instruction="Add a translation step",
            model_config=_model_config(),
            current_graph=current_graph,
        )

        call_kwargs = mock_workflow_generator.generate_workflow_graph.call_args.kwargs
        assert call_kwargs["current_graph"] is current_graph

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_defaults_current_graph_to_none_for_create(
        self,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """Omitting current_graph (the `/create` path) forwards None to the runner."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_workflow_generator.generate_workflow_graph.return_value = {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }

        WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="workflow",
            instruction="Summarize a URL",
            model_config=_model_config(),
        )

        call_kwargs = mock_workflow_generator.generate_workflow_graph.call_args.kwargs
        assert call_kwargs["current_graph"] is None

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_auto_mode_forwards_sentinel_to_runner(
        self,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """``mode="auto"`` passes straight through — the planner resolves it, no extra LLM call."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_workflow_generator.generate_workflow_graph.return_value = {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }

        WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="auto",
            instruction="Summarize a URL",
            model_config=_model_config(),
        )

        assert mock_workflow_generator.generate_workflow_graph.call_args.kwargs["mode"] == "auto"
        # the model registry is consulted exactly once — no classifier resolution
        mock_model_manager.for_tenant.return_value.get_model_instance.assert_called_once()

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_explicit_mode_passes_through_unchanged(
        self,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """A concrete mode reaches the runner verbatim."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_workflow_generator.generate_workflow_graph.return_value = {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }

        WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="advanced-chat",
            instruction="A chat bot",
            model_config=_model_config(),
        )

        assert mock_workflow_generator.generate_workflow_graph.call_args.kwargs["mode"] == "advanced-chat"

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_stream_delegates_to_runner_stream(
        self,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """Task 2b: the streaming facade resolves context and yields the runner's events through."""
        instance = MagicMock(name="model_instance")
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = instance
        mock_build_catalogue.return_value = []

        def _runner_stream(**_kwargs):
            yield ("plan", {"mode": "workflow"})
            yield ("result", {"error": "", "mode": "workflow"})

        mock_workflow_generator.generate_workflow_graph_stream.side_effect = _runner_stream

        events = list(
            WorkflowGeneratorService.generate_workflow_graph_stream(
                tenant_id="t-1",
                mode="workflow",
                instruction="Summarize a URL",
                model_config=_model_config(),
            )
        )

        assert [name for name, _ in events] == ["plan", "result"]
        call_kwargs = mock_workflow_generator.generate_workflow_graph_stream.call_args.kwargs
        assert call_kwargs["model_instance"] is instance
        assert call_kwargs["mode"] == "workflow"
        assert call_kwargs["provider"] == "openai"


def _catalogue_entry(provider_name: str, tool_name: str, *, needs_credentials: bool) -> dict:
    return {
        "provider_name": provider_name,
        "provider_type": "builtin",
        "plugin_id": provider_name.rsplit("/", 1)[0] if "/" in provider_name else "",
        "tool_name": tool_name,
        "tool_label": tool_name,
        "description": f"{tool_name} description",
        "needs_credentials": needs_credentials,
    }


_EMPTY_GRAPH_RESULT = {
    "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
    "message": "",
    "error": "",
}


class TestReadyToolAllowlist:
    """ENG-1191: the Builder hands the generator only the tools it may execute.

    ``ready_tool_keys=None`` (every cmd+K caller) keeps the full installed
    catalogue; a set restricts both the routed catalogue and the validator's
    installed-tool keys, so a missing_config tool can neither be routed nor
    survive validation.
    """

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_allowlist_filters_catalogue_and_validator_keys(
        self, mock_build_catalogue, mock_model_manager, mock_workflow_generator
    ):
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = [
            _catalogue_entry("time", "current_time", needs_credentials=False),
            _catalogue_entry("acme/huddle/huddle", "post", needs_credentials=True),
        ]
        mock_workflow_generator.generate_workflow_graph.return_value = _EMPTY_GRAPH_RESULT

        WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="workflow",
            instruction="Post the time to the team chat",
            model_config=_model_config(),
            ready_tool_keys=frozenset({("time", "current_time")}),
        )

        call_kwargs = mock_workflow_generator.generate_workflow_graph.call_args.kwargs
        assert [(e["provider_name"], e["tool_name"]) for e in call_kwargs["tool_catalogue_entries"]] == [
            ("time", "current_time")
        ]
        assert call_kwargs["installed_tools"] == {("time", "current_time")}

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_empty_allowlist_means_no_executable_tools(
        self, mock_build_catalogue, mock_model_manager, mock_workflow_generator
    ):
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = [_catalogue_entry("acme/huddle/huddle", "post", needs_credentials=True)]
        mock_workflow_generator.generate_workflow_graph.return_value = _EMPTY_GRAPH_RESULT

        WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="workflow",
            instruction="Post to the team chat",
            model_config=_model_config(),
            ready_tool_keys=frozenset(),
        )

        call_kwargs = mock_workflow_generator.generate_workflow_graph.call_args.kwargs
        assert call_kwargs["tool_catalogue_entries"] == []
        # an empty set (not the None "unknown inventory" sentinel) keeps tool
        # validation on, so any generated tool node is rejected
        assert call_kwargs["installed_tools"] == set()

    @patch("services.workflow_generator_service.WorkflowGenerator")
    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.build_tool_catalogue")
    def test_allowlist_keeps_validation_on_when_the_catalogue_fails(
        self, mock_build_catalogue, mock_model_manager, mock_workflow_generator
    ):
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.side_effect = RuntimeError("plugin daemon unreachable")
        mock_workflow_generator.generate_workflow_graph.return_value = _EMPTY_GRAPH_RESULT

        WorkflowGeneratorService.generate_workflow_graph(
            tenant_id="t-1",
            mode="workflow",
            instruction="Post to the team chat",
            model_config=_model_config(),
            ready_tool_keys=frozenset({("time", "current_time")}),
        )

        call_kwargs = mock_workflow_generator.generate_workflow_graph.call_args.kwargs
        assert call_kwargs["tool_catalogue_entries"] == []
        assert call_kwargs["installed_tools"] is not None
        assert call_kwargs["installed_tools"] <= {("time", "current_time")}

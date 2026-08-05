"""
Unit tests for ``WorkflowGeneratorService``.

The service is a thin facade — its job is (1) hand the tenant model_config to
``ModelManager`` to get a model_instance, (2) build the tool catalogue, and
(3) delegate to ``WorkflowGenerator``. We mock both dependencies so the tests
stay fast and focus on the wiring itself.
"""

from unittest.mock import MagicMock, patch

from core.app.app_config.entities import ModelConfig
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
    @patch("services.workflow_generator_service.format_tool_catalogue")
    def test_forwards_model_instance_and_catalogue_text_to_generator(
        self,
        mock_format_catalogue: MagicMock,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """Happy path: model_instance + catalogue text + payload flow through."""
        # Arrange
        instance = MagicMock(name="model_instance")
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = instance
        mock_build_catalogue.return_value = [{"provider_name": "google"}]
        mock_format_catalogue.return_value = "- google/search — Search."
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
        mock_model_manager.for_tenant.assert_called_once_with(tenant_id="t-1")
        mock_workflow_generator.generate_workflow_graph.assert_called_once()
        call_kwargs = mock_workflow_generator.generate_workflow_graph.call_args.kwargs
        assert call_kwargs["model_instance"] is instance
        assert call_kwargs["provider"] == "openai"
        assert call_kwargs["model_name"] == "gpt-4o"
        assert call_kwargs["mode"] == "workflow"
        assert call_kwargs["instruction"] == "Summarize a URL"
        assert call_kwargs["ideal_output"] == "A 3-sentence summary"
        assert call_kwargs["tool_catalogue_text"] == "- google/search — Search."
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
    @patch("services.workflow_generator_service.format_tool_catalogue")
    def test_defaults_ideal_output_to_empty_string(
        self,
        mock_format_catalogue: MagicMock,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """Callers can omit ideal_output; the runner should still receive ""."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_format_catalogue.return_value = ""
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
    @patch("services.workflow_generator_service.format_tool_catalogue")
    def test_forwards_current_graph_for_refine(
        self,
        mock_format_catalogue: MagicMock,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """The cmd+k `/refine` path passes the existing draft graph through to the runner."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_format_catalogue.return_value = ""
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
    @patch("services.workflow_generator_service.format_tool_catalogue")
    def test_defaults_current_graph_to_none_for_create(
        self,
        mock_format_catalogue: MagicMock,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """Omitting current_graph (the `/create` path) forwards None to the runner."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_format_catalogue.return_value = ""
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
    @patch("services.workflow_generator_service.format_tool_catalogue")
    def test_auto_mode_forwards_sentinel_to_runner(
        self,
        mock_format_catalogue: MagicMock,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """``mode="auto"`` passes straight through — the planner resolves it, no extra LLM call."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_format_catalogue.return_value = ""
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
    @patch("services.workflow_generator_service.format_tool_catalogue")
    def test_explicit_mode_passes_through_unchanged(
        self,
        mock_format_catalogue: MagicMock,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """A concrete mode reaches the runner verbatim."""
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = MagicMock()
        mock_build_catalogue.return_value = []
        mock_format_catalogue.return_value = ""
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
    @patch("services.workflow_generator_service.format_tool_catalogue")
    def test_stream_delegates_to_runner_stream(
        self,
        mock_format_catalogue: MagicMock,
        mock_build_catalogue: MagicMock,
        mock_model_manager: MagicMock,
        mock_workflow_generator: MagicMock,
    ):
        """Task 2b: the streaming facade resolves context and yields the runner's events through."""
        instance = MagicMock(name="model_instance")
        mock_model_manager.for_tenant.return_value.get_model_instance.return_value = instance
        mock_build_catalogue.return_value = []
        mock_format_catalogue.return_value = ""

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

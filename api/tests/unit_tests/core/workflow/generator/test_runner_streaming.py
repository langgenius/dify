"""Tests for WorkflowGenerator streaming functionality."""

from unittest.mock import MagicMock, patch

from core.workflow.generator.core.planner import PlannerOutput
from core.workflow.generator.runner import WorkflowGenerator
from core.workflow.generator.types.constants import INTENT_GENERATE, INTENT_OFF_TOPIC
from core.workflow.generator.types.streaming import STAGE_BUILDING, STAGE_PLANNING


class TestWorkflowGeneratorStreaming:
    """Tests for streaming workflow generation."""

    @patch("core.workflow.generator.runner.WorkflowGenerator._generate_workflow_internal")
    @patch("core.workflow.generator.runner.Planner")
    @patch("core.workflow.generator.runner.ModelManager")
    def test_generate_workflow_stream_yields_stages(self, mock_model_manager, mock_planner_class, mock_internal):
        """Test that streaming generation yields stage events."""
        # Mock model instance
        mock_instance = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        # Mock planner to return generate intent
        mock_planner = MagicMock()
        mock_planner.plan.return_value = PlannerOutput(
            intent=INTENT_GENERATE,
            analysis={"plan_thought": "test"},
            execution_plan=[],
            tool_selection={"required": [], "optional": []},
        )
        mock_planner_class.return_value = mock_planner

        # Mock internal method to return a successful workflow
        mock_internal.return_value = {
            "intent": INTENT_GENERATE,
            "nodes": [{"id": "start", "data": {"type": "start"}}],
            "edges": [],
            "flowchart": "flowchart TD",
            "message": "Generated workflow",
            "warnings": [],
        }

        # Call streaming generator
        events = list(
            WorkflowGenerator.generate_workflow_stream(
                tenant_id="test-tenant",
                instruction="Create a workflow",
                model_config={"provider": "openai", "name": "gpt-4"},
                available_nodes=[],
                preferred_language="en",
            )
        )

        # Should have stage events + complete event
        stage_events = [e for e in events if e.get("event") == "stage"]
        complete_events = [e for e in events if e.get("event") == "complete"]

        assert len(stage_events) >= 2  # At least planning and building
        assert len(complete_events) == 1

        # Check stage order
        stages = [e["stage"] for e in stage_events]
        assert STAGE_PLANNING in stages
        assert STAGE_BUILDING in stages

    @patch("core.workflow.generator.runner.Planner")
    @patch("core.workflow.generator.runner.ModelManager")
    def test_generate_workflow_stream_off_topic(self, mock_model_manager, mock_planner_class):
        """Test that off-topic intent yields complete event directly."""
        mock_instance = MagicMock()
        mock_model_manager.return_value.get_model_instance.return_value = mock_instance

        # Mock planner to return off_topic intent
        mock_planner = MagicMock()
        mock_planner.plan.return_value = PlannerOutput(
            intent=INTENT_OFF_TOPIC,
            message="I can only help with workflows.",
            suggestions=[],
            analysis={},
            execution_plan=[],
            tool_selection={"required": [], "optional": []},
        )
        mock_planner_class.return_value = mock_planner

        events = list(
            WorkflowGenerator.generate_workflow_stream(
                tenant_id="test-tenant",
                instruction="Tell me a joke",
                model_config={"provider": "openai", "name": "gpt-4"},
                available_nodes=[],
            )
        )

        # Should have planning stage then complete (off_topic)
        complete_events = [e for e in events if e.get("event") == "complete"]
        assert len(complete_events) == 1
        assert complete_events[0]["intent"] == "off_topic"

    @patch("core.workflow.generator.runner.ModelManager")
    def test_generate_workflow_stream_error(self, mock_model_manager):
        """Test that errors yield error event."""
        mock_model_manager.return_value.get_model_instance.side_effect = Exception("Model unavailable")

        events = list(
            WorkflowGenerator.generate_workflow_stream(
                tenant_id="test-tenant",
                instruction="Create a workflow",
                model_config={"provider": "openai", "name": "gpt-4"},
                available_nodes=[],
            )
        )

        # Should have error event
        error_events = [e for e in events if e.get("event") == "error"]
        assert len(error_events) == 1
        assert "error" in error_events[0]

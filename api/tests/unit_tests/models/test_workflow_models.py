"""
Comprehensive unit tests for Workflow models.

This test suite covers:
- Workflow model validation
- WorkflowRun state transitions
- NodeExecution relationships
- Graph configuration validation
"""

import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from core.workflow.enums import (
    NodeType,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionStatus,
)
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)


class TestWorkflowModelValidation:
    """Test suite for Workflow model validation and basic operations."""

    def test_workflow_creation_with_required_fields(self):
        """Test creating a workflow with all required fields."""
        # Arrange
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        created_by = str(uuid4())
        graph = json.dumps({"nodes": [], "edges": []})
        features = json.dumps({"file_upload": {"enabled": True}})

        # Act
        workflow = Workflow.new(
            tenant_id=tenant_id,
            app_id=app_id,
            type=WorkflowType.WORKFLOW.value,
            version="draft",
            graph=graph,
            features=features,
            created_by=created_by,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        # Assert
        assert workflow.tenant_id == tenant_id
        assert workflow.app_id == app_id
        assert workflow.type == WorkflowType.WORKFLOW.value
        assert workflow.version == "draft"
        assert workflow.graph == graph
        assert workflow.created_by == created_by
        assert workflow.created_at is not None
        assert workflow.updated_at is not None

    def test_workflow_type_enum_values(self):
        """Test WorkflowType enum values."""
        # Assert
        assert WorkflowType.WORKFLOW.value == "workflow"
        assert WorkflowType.CHAT.value == "chat"
        assert WorkflowType.RAG_PIPELINE.value == "rag-pipeline"

    def test_workflow_type_value_of(self):
        """Test WorkflowType.value_of method."""
        # Act & Assert
        assert WorkflowType.value_of("workflow") == WorkflowType.WORKFLOW
        assert WorkflowType.value_of("chat") == WorkflowType.CHAT
        assert WorkflowType.value_of("rag-pipeline") == WorkflowType.RAG_PIPELINE

        with pytest.raises(ValueError, match="invalid workflow type value"):
            WorkflowType.value_of("invalid_type")

    def test_workflow_graph_dict_property(self):
        """Test graph_dict property parses JSON correctly."""
        # Arrange
        graph_data = {"nodes": [{"id": "start", "type": "start"}], "edges": []}
        workflow = Workflow.new(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            version="draft",
            graph=json.dumps(graph_data),
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        # Act
        result = workflow.graph_dict

        # Assert
        assert result == graph_data
        assert "nodes" in result
        assert len(result["nodes"]) == 1

    def test_workflow_features_dict_property(self):
        """Test features_dict property parses JSON correctly."""
        # Arrange
        features_data = {"file_upload": {"enabled": True, "max_files": 5}}
        workflow = Workflow.new(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            version="draft",
            graph="{}",
            features=json.dumps(features_data),
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        # Act
        result = workflow.features_dict

        # Assert
        assert result == features_data
        assert result["file_upload"]["enabled"] is True
        assert result["file_upload"]["max_files"] == 5

    def test_workflow_with_marked_name_and_comment(self):
        """Test workflow creation with marked name and comment."""
        # Arrange & Act
        workflow = Workflow.new(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            version="v1.0",
            graph="{}",
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
            marked_name="Production Release",
            marked_comment="Initial production version",
        )

        # Assert
        assert workflow.marked_name == "Production Release"
        assert workflow.marked_comment == "Initial production version"

    def test_workflow_version_draft_constant(self):
        """Test VERSION_DRAFT constant."""
        # Assert
        assert Workflow.VERSION_DRAFT == "draft"


class TestWorkflowRunStateTransitions:
    """Test suite for WorkflowRun state transitions and lifecycle."""

    def test_workflow_run_creation_with_required_fields(self):
        """Test creating a workflow run with required fields."""
        # Arrange
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        created_by = str(uuid4())

        # Act
        workflow_run = WorkflowRun(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING.value,
            version="draft",
            status=WorkflowExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=created_by,
        )

        # Assert
        assert workflow_run.tenant_id == tenant_id
        assert workflow_run.app_id == app_id
        assert workflow_run.workflow_id == workflow_id
        assert workflow_run.type == WorkflowType.WORKFLOW.value
        assert workflow_run.triggered_from == WorkflowRunTriggeredFrom.DEBUGGING.value
        assert workflow_run.status == WorkflowExecutionStatus.RUNNING.value
        assert workflow_run.created_by == created_by

    def test_workflow_run_state_transition_running_to_succeeded(self):
        """Test state transition from running to succeeded."""
        # Arrange
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.END_USER.value,
            created_by=str(uuid4()),
        )

        # Act
        workflow_run.status = WorkflowExecutionStatus.SUCCEEDED.value
        workflow_run.finished_at = datetime.now(UTC)
        workflow_run.elapsed_time = 2.5

        # Assert
        assert workflow_run.status == WorkflowExecutionStatus.SUCCEEDED.value
        assert workflow_run.finished_at is not None
        assert workflow_run.elapsed_time == 2.5

    def test_workflow_run_state_transition_running_to_failed(self):
        """Test state transition from running to failed with error."""
        # Arrange
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
        )

        # Act
        workflow_run.status = WorkflowExecutionStatus.FAILED.value
        workflow_run.error = "Node execution failed: Invalid input"
        workflow_run.finished_at = datetime.now(UTC)

        # Assert
        assert workflow_run.status == WorkflowExecutionStatus.FAILED.value
        assert workflow_run.error == "Node execution failed: Invalid input"
        assert workflow_run.finished_at is not None

    def test_workflow_run_state_transition_running_to_stopped(self):
        """Test state transition from running to stopped."""
        # Arrange
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING.value,
            version="draft",
            status=WorkflowExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
        )

        # Act
        workflow_run.status = WorkflowExecutionStatus.STOPPED.value
        workflow_run.finished_at = datetime.now(UTC)

        # Assert
        assert workflow_run.status == WorkflowExecutionStatus.STOPPED.value
        assert workflow_run.finished_at is not None

    def test_workflow_run_state_transition_running_to_paused(self):
        """Test state transition from running to paused."""
        # Arrange
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.END_USER.value,
            created_by=str(uuid4()),
        )

        # Act
        workflow_run.status = WorkflowExecutionStatus.PAUSED.value

        # Assert
        assert workflow_run.status == WorkflowExecutionStatus.PAUSED.value
        assert workflow_run.finished_at is None  # Not finished when paused

    def test_workflow_run_state_transition_paused_to_running(self):
        """Test state transition from paused back to running."""
        # Arrange
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.PAUSED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
        )

        # Act
        workflow_run.status = WorkflowExecutionStatus.RUNNING.value

        # Assert
        assert workflow_run.status == WorkflowExecutionStatus.RUNNING.value

    def test_workflow_run_with_partial_succeeded_status(self):
        """Test workflow run with partial-succeeded status."""
        # Arrange & Act
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.PARTIAL_SUCCEEDED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            exceptions_count=2,
        )

        # Assert
        assert workflow_run.status == WorkflowExecutionStatus.PARTIAL_SUCCEEDED.value
        assert workflow_run.exceptions_count == 2

    def test_workflow_run_with_inputs_and_outputs(self):
        """Test workflow run with inputs and outputs as JSON."""
        # Arrange
        inputs = {"query": "What is AI?", "context": "technology"}
        outputs = {"answer": "AI is Artificial Intelligence", "confidence": 0.95}

        # Act
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.SUCCEEDED.value,
            created_by_role=CreatorUserRole.END_USER.value,
            created_by=str(uuid4()),
            inputs=json.dumps(inputs),
            outputs=json.dumps(outputs),
        )

        # Assert
        assert workflow_run.inputs_dict == inputs
        assert workflow_run.outputs_dict == outputs

    def test_workflow_run_graph_dict_property(self):
        """Test graph_dict property for workflow run."""
        # Arrange
        graph = {"nodes": [{"id": "start", "type": "start"}], "edges": []}
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING.value,
            version="draft",
            status=WorkflowExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            graph=json.dumps(graph),
        )

        # Act
        result = workflow_run.graph_dict

        # Assert
        assert result == graph
        assert "nodes" in result

    def test_workflow_run_to_dict_serialization(self):
        """Test WorkflowRun to_dict method."""
        # Arrange
        workflow_run_id = str(uuid4())
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        created_by = str(uuid4())

        workflow_run = WorkflowRun(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.SUCCEEDED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=created_by,
            total_tokens=1500,
            total_steps=5,
        )
        workflow_run.id = workflow_run_id

        # Act
        result = workflow_run.to_dict()

        # Assert
        assert result["id"] == workflow_run_id
        assert result["tenant_id"] == tenant_id
        assert result["app_id"] == app_id
        assert result["workflow_id"] == workflow_id
        assert result["status"] == WorkflowExecutionStatus.SUCCEEDED.value
        assert result["total_tokens"] == 1500
        assert result["total_steps"] == 5

    def test_workflow_run_from_dict_deserialization(self):
        """Test WorkflowRun from_dict method."""
        # Arrange
        data = {
            "id": str(uuid4()),
            "tenant_id": str(uuid4()),
            "app_id": str(uuid4()),
            "workflow_id": str(uuid4()),
            "type": WorkflowType.WORKFLOW.value,
            "triggered_from": WorkflowRunTriggeredFrom.APP_RUN.value,
            "version": "v1.0",
            "graph": {"nodes": [], "edges": []},
            "inputs": {"query": "test"},
            "status": WorkflowExecutionStatus.SUCCEEDED.value,
            "outputs": {"result": "success"},
            "error": None,
            "elapsed_time": 3.5,
            "total_tokens": 2000,
            "total_steps": 10,
            "created_by_role": CreatorUserRole.ACCOUNT.value,
            "created_by": str(uuid4()),
            "created_at": datetime.now(UTC),
            "finished_at": datetime.now(UTC),
            "exceptions_count": 0,
        }

        # Act
        workflow_run = WorkflowRun.from_dict(data)

        # Assert
        assert workflow_run.id == data["id"]
        assert workflow_run.workflow_id == data["workflow_id"]
        assert workflow_run.status == WorkflowExecutionStatus.SUCCEEDED.value
        assert workflow_run.total_tokens == 2000


class TestNodeExecutionRelationships:
    """Test suite for WorkflowNodeExecutionModel relationships and data."""

    def test_node_execution_creation_with_required_fields(self):
        """Test creating a node execution with required fields."""
        # Arrange
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        workflow_run_id = str(uuid4())
        created_by = str(uuid4())

        # Act
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=workflow_run_id,
            index=1,
            node_id="start",
            node_type=NodeType.START.value,
            title="Start Node",
            status=WorkflowNodeExecutionStatus.SUCCEEDED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=created_by,
        )

        # Assert
        assert node_execution.tenant_id == tenant_id
        assert node_execution.app_id == app_id
        assert node_execution.workflow_id == workflow_id
        assert node_execution.workflow_run_id == workflow_run_id
        assert node_execution.node_id == "start"
        assert node_execution.node_type == NodeType.START.value
        assert node_execution.index == 1

    def test_node_execution_with_predecessor_relationship(self):
        """Test node execution with predecessor node relationship."""
        # Arrange
        predecessor_node_id = "start"
        current_node_id = "llm_1"

        # Act
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=str(uuid4()),
            index=2,
            predecessor_node_id=predecessor_node_id,
            node_id=current_node_id,
            node_type=NodeType.LLM.value,
            title="LLM Node",
            status=WorkflowNodeExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
        )

        # Assert
        assert node_execution.predecessor_node_id == predecessor_node_id
        assert node_execution.node_id == current_node_id
        assert node_execution.index == 2

    def test_node_execution_single_step_debugging(self):
        """Test node execution for single-step debugging (no workflow_run_id)."""
        # Arrange & Act
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP.value,
            workflow_run_id=None,  # Single-step has no workflow run
            index=1,
            node_id="llm_test",
            node_type=NodeType.LLM.value,
            title="Test LLM",
            status=WorkflowNodeExecutionStatus.SUCCEEDED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
        )

        # Assert
        assert node_execution.triggered_from == WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP.value
        assert node_execution.workflow_run_id is None

    def test_node_execution_with_inputs_outputs_process_data(self):
        """Test node execution with inputs, outputs, and process_data."""
        # Arrange
        inputs = {"query": "What is AI?", "temperature": 0.7}
        outputs = {"answer": "AI is Artificial Intelligence"}
        process_data = {"tokens_used": 150, "model": "gpt-4"}

        # Act
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=str(uuid4()),
            index=1,
            node_id="llm_1",
            node_type=NodeType.LLM.value,
            title="LLM Node",
            status=WorkflowNodeExecutionStatus.SUCCEEDED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            inputs=json.dumps(inputs),
            outputs=json.dumps(outputs),
            process_data=json.dumps(process_data),
        )

        # Assert
        assert node_execution.inputs_dict == inputs
        assert node_execution.outputs_dict == outputs
        assert node_execution.process_data_dict == process_data

    def test_node_execution_status_transitions(self):
        """Test node execution status transitions."""
        # Arrange
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=str(uuid4()),
            index=1,
            node_id="code_1",
            node_type=NodeType.CODE.value,
            title="Code Node",
            status=WorkflowNodeExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
        )

        # Act - transition to succeeded
        node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED.value
        node_execution.elapsed_time = 1.2
        node_execution.finished_at = datetime.now(UTC)

        # Assert
        assert node_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED.value
        assert node_execution.elapsed_time == 1.2
        assert node_execution.finished_at is not None

    def test_node_execution_with_error(self):
        """Test node execution with error status."""
        # Arrange
        error_message = "Code execution failed: SyntaxError on line 5"

        # Act
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=str(uuid4()),
            index=3,
            node_id="code_1",
            node_type=NodeType.CODE.value,
            title="Code Node",
            status=WorkflowNodeExecutionStatus.FAILED.value,
            error=error_message,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
        )

        # Assert
        assert node_execution.status == WorkflowNodeExecutionStatus.FAILED.value
        assert node_execution.error == error_message

    def test_node_execution_with_metadata(self):
        """Test node execution with execution metadata."""
        # Arrange
        metadata = {
            "total_tokens": 500,
            "total_price": 0.01,
            "currency": "USD",
            "tool_info": {"provider": "openai", "tool": "gpt-4"},
        }

        # Act
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=str(uuid4()),
            index=1,
            node_id="llm_1",
            node_type=NodeType.LLM.value,
            title="LLM Node",
            status=WorkflowNodeExecutionStatus.SUCCEEDED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            execution_metadata=json.dumps(metadata),
        )

        # Assert
        assert node_execution.execution_metadata_dict == metadata
        assert node_execution.execution_metadata_dict["total_tokens"] == 500

    def test_node_execution_metadata_dict_empty(self):
        """Test execution_metadata_dict returns empty dict when metadata is None."""
        # Arrange
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=str(uuid4()),
            index=1,
            node_id="start",
            node_type=NodeType.START.value,
            title="Start",
            status=WorkflowNodeExecutionStatus.SUCCEEDED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            execution_metadata=None,
        )

        # Act
        result = node_execution.execution_metadata_dict

        # Assert
        assert result == {}

    def test_node_execution_different_node_types(self):
        """Test node execution with different node types."""
        # Test various node types
        node_types = [
            (NodeType.START, "Start Node"),
            (NodeType.LLM, "LLM Node"),
            (NodeType.CODE, "Code Node"),
            (NodeType.TOOL, "Tool Node"),
            (NodeType.IF_ELSE, "Conditional Node"),
            (NodeType.END, "End Node"),
        ]

        for node_type, title in node_types:
            # Act
            node_execution = WorkflowNodeExecutionModel(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
                workflow_run_id=str(uuid4()),
                index=1,
                node_id=f"{node_type.value}_1",
                node_type=node_type.value,
                title=title,
                status=WorkflowNodeExecutionStatus.SUCCEEDED.value,
                created_by_role=CreatorUserRole.ACCOUNT.value,
                created_by=str(uuid4()),
            )

            # Assert
            assert node_execution.node_type == node_type.value
            assert node_execution.title == title


class TestGraphConfigurationValidation:
    """Test suite for graph configuration validation."""

    def test_workflow_graph_with_nodes_and_edges(self):
        """Test workflow graph configuration with nodes and edges."""
        # Arrange
        graph_config = {
            "nodes": [
                {"id": "start", "type": "start", "data": {"title": "Start"}},
                {"id": "llm_1", "type": "llm", "data": {"title": "LLM Node", "model": "gpt-4"}},
                {"id": "end", "type": "end", "data": {"title": "End"}},
            ],
            "edges": [
                {"source": "start", "target": "llm_1"},
                {"source": "llm_1", "target": "end"},
            ],
        }

        # Act
        workflow = Workflow.new(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            version="draft",
            graph=json.dumps(graph_config),
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        # Assert
        graph_dict = workflow.graph_dict
        assert len(graph_dict["nodes"]) == 3
        assert len(graph_dict["edges"]) == 2
        assert graph_dict["nodes"][0]["id"] == "start"
        assert graph_dict["edges"][0]["source"] == "start"
        assert graph_dict["edges"][0]["target"] == "llm_1"

    def test_workflow_graph_empty_configuration(self):
        """Test workflow with empty graph configuration."""
        # Arrange
        graph_config = {"nodes": [], "edges": []}

        # Act
        workflow = Workflow.new(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            version="draft",
            graph=json.dumps(graph_config),
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        # Assert
        graph_dict = workflow.graph_dict
        assert graph_dict["nodes"] == []
        assert graph_dict["edges"] == []

    def test_workflow_graph_complex_node_data(self):
        """Test workflow graph with complex node data structures."""
        # Arrange
        graph_config = {
            "nodes": [
                {
                    "id": "llm_1",
                    "type": "llm",
                    "data": {
                        "title": "Advanced LLM",
                        "model": {"provider": "openai", "name": "gpt-4", "mode": "chat"},
                        "prompt_template": [
                            {"role": "system", "text": "You are a helpful assistant"},
                            {"role": "user", "text": "{{query}}"},
                        ],
                        "model_parameters": {"temperature": 0.7, "max_tokens": 2000},
                    },
                }
            ],
            "edges": [],
        }

        # Act
        workflow = Workflow.new(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            version="draft",
            graph=json.dumps(graph_config),
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        # Assert
        graph_dict = workflow.graph_dict
        node_data = graph_dict["nodes"][0]["data"]
        assert node_data["model"]["provider"] == "openai"
        assert node_data["model_parameters"]["temperature"] == 0.7
        assert len(node_data["prompt_template"]) == 2

    def test_workflow_run_graph_preservation(self):
        """Test that WorkflowRun preserves graph configuration from Workflow."""
        # Arrange
        original_graph = {
            "nodes": [
                {"id": "start", "type": "start"},
                {"id": "end", "type": "end"},
            ],
            "edges": [{"source": "start", "target": "end"}],
        }

        # Act
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            graph=json.dumps(original_graph),
        )

        # Assert
        assert workflow_run.graph_dict == original_graph
        assert len(workflow_run.graph_dict["nodes"]) == 2

    def test_workflow_graph_with_conditional_branches(self):
        """Test workflow graph with conditional branching (if-else)."""
        # Arrange
        graph_config = {
            "nodes": [
                {"id": "start", "type": "start"},
                {"id": "if_else_1", "type": "if-else", "data": {"conditions": []}},
                {"id": "branch_true", "type": "llm"},
                {"id": "branch_false", "type": "code"},
                {"id": "end", "type": "end"},
            ],
            "edges": [
                {"source": "start", "target": "if_else_1"},
                {"source": "if_else_1", "sourceHandle": "true", "target": "branch_true"},
                {"source": "if_else_1", "sourceHandle": "false", "target": "branch_false"},
                {"source": "branch_true", "target": "end"},
                {"source": "branch_false", "target": "end"},
            ],
        }

        # Act
        workflow = Workflow.new(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            version="draft",
            graph=json.dumps(graph_config),
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        # Assert
        graph_dict = workflow.graph_dict
        assert len(graph_dict["nodes"]) == 5
        assert len(graph_dict["edges"]) == 5
        # Verify conditional edges
        conditional_edges = [e for e in graph_dict["edges"] if "sourceHandle" in e]
        assert len(conditional_edges) == 2

    def test_workflow_graph_with_loop_structure(self):
        """Test workflow graph with loop/iteration structure."""
        # Arrange
        graph_config = {
            "nodes": [
                {"id": "start", "type": "start"},
                {"id": "iteration_1", "type": "iteration", "data": {"iterator": "items"}},
                {"id": "loop_body", "type": "llm"},
                {"id": "end", "type": "end"},
            ],
            "edges": [
                {"source": "start", "target": "iteration_1"},
                {"source": "iteration_1", "target": "loop_body"},
                {"source": "loop_body", "target": "iteration_1"},
                {"source": "iteration_1", "target": "end"},
            ],
        }

        # Act
        workflow = Workflow.new(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            version="draft",
            graph=json.dumps(graph_config),
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        # Assert
        graph_dict = workflow.graph_dict
        iteration_node = next(n for n in graph_dict["nodes"] if n["type"] == "iteration")
        assert iteration_node["data"]["iterator"] == "items"

    def test_workflow_graph_dict_with_null_graph(self):
        """Test graph_dict property when graph is None."""
        # Arrange
        workflow = Workflow.new(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            version="draft",
            graph=None,
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )

        # Act
        result = workflow.graph_dict

        # Assert
        assert result == {}

    def test_workflow_run_inputs_dict_with_null_inputs(self):
        """Test inputs_dict property when inputs is None."""
        # Arrange
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            inputs=None,
        )

        # Act
        result = workflow_run.inputs_dict

        # Assert
        assert result == {}

    def test_workflow_run_outputs_dict_with_null_outputs(self):
        """Test outputs_dict property when outputs is None."""
        # Arrange
        workflow_run = WorkflowRun(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=WorkflowType.WORKFLOW.value,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
            version="v1.0",
            status=WorkflowExecutionStatus.RUNNING.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            outputs=None,
        )

        # Act
        result = workflow_run.outputs_dict

        # Assert
        assert result == {}

    def test_node_execution_inputs_dict_with_null_inputs(self):
        """Test node execution inputs_dict when inputs is None."""
        # Arrange
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=str(uuid4()),
            index=1,
            node_id="start",
            node_type=NodeType.START.value,
            title="Start",
            status=WorkflowNodeExecutionStatus.SUCCEEDED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            inputs=None,
        )

        # Act
        result = node_execution.inputs_dict

        # Assert
        assert result is None

    def test_node_execution_outputs_dict_with_null_outputs(self):
        """Test node execution outputs_dict when outputs is None."""
        # Arrange
        node_execution = WorkflowNodeExecutionModel(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=str(uuid4()),
            index=1,
            node_id="start",
            node_type=NodeType.START.value,
            title="Start",
            status=WorkflowNodeExecutionStatus.SUCCEEDED.value,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=str(uuid4()),
            outputs=None,
        )

        # Act
        result = node_execution.outputs_dict

        # Assert
        assert result is None

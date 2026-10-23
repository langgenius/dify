import json
from collections import UserString
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, sentinel

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.credit_usage import CreditUsageAppType
from core.helper.code_executor.code_executor import CodeLanguage
from core.repositories.human_input_repository import (
    HumanInputFormRepository,
    HumanInputFormRepositoryImpl,
)
from core.workflow import workflow_entry
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.system_variables import build_system_variables, default_system_variables
from core.workflow.variable_prefixes import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
)
from core.workflow.workflow_entry import WorkflowEntry, iter_dify_graph_engine_events
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel, RedisChannel
from graphon.engine.filter import EngineEventFilterContext, ResponseStreamFilter, filter_engine_events
from graphon.engine_events import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import NodeType, WorkflowNodeExecutionStatus
from graphon.errors import WorkflowNodeRunFailedError
from graphon.file import File, FileTransferMethod, FileType
from graphon.file.runtime import peek_workflow_file_runtime, use_workflow_file_runtime
from graphon.graph import Graph
from graphon.node_events import NodeRunResult
from graphon.nodes import BuiltinNodeTypes
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.code.code_node import CodeNode
from graphon.nodes.code.limits import CodeNodeLimits
from graphon.nodes.human_input.entities import HumanInputNodeData as GraphonHumanInputNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.nodes.if_else.entities import IfElseNodeData
from graphon.nodes.if_else.if_else_node import IfElseNode
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import RuntimeState, VariablePool
from graphon.utils.condition.entities import Condition
from graphon.variables.variables import StringVariable
from libs.datetime_utils import naive_utc_now
from models.human_input import HumanInputForm
from models.workflow import Workflow, WorkflowType
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_workflow
from tests.helpers.workflow.mock_config import MockConfig, MockConfigBuilder
from tests.helpers.workflow.table_runner import WorkflowRunner
from tests.unit_tests.core.workflow.test_workflow_tool_container_handler import (
    _workflow_tool_container_outer_graph as _outer_graph,
)
from tests.unit_tests.core.workflow.test_workflow_tool_container_handler import (
    _workflow_tool_container_workflow_tool_node as _workflow_tool_node,
)
from tests.unit_tests.core.workflow.test_workflow_tool_container_handler import (
    _workflow_tool_container_workflow_tool_source as _workflow_tool_source,
)
from tests.workflow_test_utils import build_test_graph_init_params

"""Unit coverage for Dify's in-memory ResponseStreamFilter boundary behavior."""


def _build_issue_170_mock_config() -> tuple[WorkflowRunner, MockConfig]:
    runner = WorkflowRunner()
    mock_config = (
        MockConfigBuilder()
        .with_node_output(
            "llm",
            {
                "text": "Quiet Night Thought",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
                "finish_reason": "stop",
            },
        )
        .with_node_output(
            "dufu",
            {
                "text": "Spring View",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
                "finish_reason": "stop",
            },
        )
        .build()
    )

    return runner, mock_config


class TestResponseStreamFilterIssue170Cases:
    @staticmethod
    def test_dify_response_stream_filter_handles_issue_170_shape() -> None:
        runner, mock_config = _build_issue_170_mock_config()
        fixture_data = runner.load_fixture("response_stream_filter_issue_170_workflow")
        graph, graph_runtime_state = runner.create_graph_from_fixture(
            fixture_data=fixture_data,
            query="1",
            use_mock_factory=True,
            mock_config=mock_config,
        )

        expected_answer = "# Du Fu\n\nSpring View\n\n# Li Bai\n\nQuiet Night Thought"

        engine = Engine(
            graph=graph,
            runtime_state=graph_runtime_state,
            command_channel=InMemoryChannel(),
        )
        events = list(iter_dify_graph_engine_events(engine))

        stream_chunk_events = [event for event in events if isinstance(event, NodeRunStreamChunkEvent)]
        success_events = [event for event in events if isinstance(event, GraphRunSucceededEvent)]

        assert success_events
        assert stream_chunk_events
        actual_answer = "".join(event.chunk for event in stream_chunk_events)
        assert actual_answer.strip() == expected_answer
        assert stream_chunk_events[-1].is_final is True
        final_answer = success_events[-1].outputs["answer"]
        assert isinstance(final_answer, str)
        assert final_answer.strip() == expected_answer
        assert actual_answer.strip() == final_answer.strip()


"""In-memory regression test: if-else branch + human_input pause + downstream answer nodes.

Reproduces https://github.com/langgenius/dify/issues/38525 at the
iter_dify_graph_engine_events layer: without a restored ResponseStreamFilter,
answer nodes downstream of a pre-pause branch never unlock for streaming on
resume, even though the graph executes correctly.
"""


WORKFLOW_EXECUTION_ID = "wf-exec-38525"


def _build_graph(runtime_state: RuntimeState, form_repository: HumanInputFormRepository) -> Graph:
    params = build_test_graph_init_params(
        workflow_id="wf",
        graph_config={"nodes": [], "edges": []},
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )

    start_node = StartNode(
        node_id="start",
        data=StartNodeData(title="start", variables=[]),
        init_params=params,
        runtime_state=runtime_state,
    )

    if_else_node = IfElseNode(
        node_id="if_else",
        data=IfElseNodeData(
            title="if-else",
            cases=[
                IfElseNodeData.Case(
                    case_id="true",
                    logical_operator="and",
                    conditions=[
                        Condition(
                            variable_selector=["start", "category"],
                            comparison_operator="is",
                            value="fruit",
                        )
                    ],
                )
            ],
        ),
        init_params=params,
        runtime_state=runtime_state,
    )

    human_data = HumanInputNodeData(
        title="human",
        form_content="Awaiting human input",
        inputs=[],
        user_actions=[UserActionConfig(id="continue", title="Continue")],
    )
    human_node = HumanInputNode(
        node_id="human_input",
        data=GraphonHumanInputNodeData.model_validate(human_data.model_dump()),
        init_params=params,
        runtime_state=runtime_state,
        hitl_callback=DifyHITLCallback(form_repository=form_repository, node_data=human_data),
    )

    answer_false_node = AnswerNode(
        node_id="answer_false",
        data=AnswerNodeData(title="answer_false", answer="unreachable branch"),
        init_params=params,
        runtime_state=runtime_state,
    )

    answer_after_pause = AnswerNode(
        node_id="answer_after_pause",
        data=AnswerNodeData(title="answer_after_pause", answer="Post-branch answer chunk 1"),
        init_params=params,
        runtime_state=runtime_state,
    )

    answer_after_pause_2 = AnswerNode(
        node_id="answer_after_pause_2",
        data=AnswerNodeData(title="answer_after_pause_2", answer="Post-branch answer chunk 2"),
        init_params=params,
        runtime_state=runtime_state,
    )

    return (
        Graph.new()
        .add_root(start_node)
        .add_node(if_else_node, from_node_id="start")
        .add_node(human_node, from_node_id="if_else", source_handle="true")
        .add_node(answer_false_node, from_node_id="if_else", source_handle="false")
        .add_node(answer_after_pause, from_node_id="human_input", source_handle="continue")
        .add_node(answer_after_pause_2, from_node_id="answer_after_pause")
        .build()
    )


def _build_runtime_state() -> RuntimeState:
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(
            workflow_execution_id=WORKFLOW_EXECUTION_ID,
            app_id="app",
            workflow_id="wf",
            user_id="user",
        ),
        user_inputs={},
        conversation_variables=[],
    )
    variable_pool.add(("start", "category"), "fruit")  # drives the if-else "true" branch
    return RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0)


class TestResponseStreamFilterPauseResumeCases:
    @staticmethod
    def test_if_else_human_input_pause_resume_answer_chunks_survive_resume(
        sqlite_session_factory: sessionmaker[Session],
        mocker: MockerFixture,
    ) -> None:
        mocker.patch(
            "core.repositories.human_input_repository.session_factory.create_session",
            side_effect=sqlite_session_factory,
        )
        repository = HumanInputFormRepositoryImpl(
            tenant_id="tenant", app_id="app", workflow_execution_id=WORKFLOW_EXECUTION_ID
        )
        # ---- Phase 1: run to GraphRunPausedEvent ----
        runtime_state_1 = _build_runtime_state()
        graph_1 = _build_graph(runtime_state_1, repository)
        engine_1 = Engine(
            graph=graph_1,
            runtime_state=runtime_state_1,
            command_channel=InMemoryChannel(),
        )
        filter_1 = ResponseStreamFilter()
        phase1_events = list(
            filter_engine_events(
                engine_1.run(),
                context=EngineEventFilterContext.from_engine(engine_1),
                filters=[filter_1],
            )
        )

        assert any(isinstance(e, GraphRunPausedEvent) for e in phase1_events)
        phase1_chunks = [e for e in phase1_events if isinstance(e, NodeRunStreamChunkEvent)]
        assert not any(e.node_id in ("answer_after_pause", "answer_after_pause_2") for e in phase1_chunks)

        response_filter_snapshot = filter_1.dumps()
        runtime_snapshot = runtime_state_1.dumps()

        with sqlite_session_factory.begin() as session:
            form = session.scalar(select(HumanInputForm).where(HumanInputForm.workflow_run_id == WORKFLOW_EXECUTION_ID))
            assert form is not None
            assert form.status == HumanInputFormStatus.WAITING
            form.selected_action_id = "continue"
            form.submitted_data = "{}"
            form.submitted_at = naive_utc_now()
            form.status = HumanInputFormStatus.SUBMITTED

        # ---- Phase 2: rebuild engine + filter from snapshots, resume to completion ----
        runtime_state_2 = RuntimeState.from_snapshot(runtime_snapshot)
        graph_2 = _build_graph(runtime_state_2, repository)
        engine_2 = Engine(
            graph=graph_2,
            runtime_state=runtime_state_2,
            command_channel=InMemoryChannel(),
        )
        filter_2 = ResponseStreamFilter()
        filter_2.loads(response_filter_snapshot)

        phase2_events = list(iter_dify_graph_engine_events(engine_2, filter_2))

        assert any(isinstance(e, GraphRunSucceededEvent) for e in phase2_events)

        phase2_chunks = [e for e in phase2_events if isinstance(e, NodeRunStreamChunkEvent)]
        answer_1_chunks = [e for e in phase2_chunks if e.node_id == "answer_after_pause"]
        answer_2_chunks = [e for e in phase2_chunks if e.node_id == "answer_after_pause_2"]

        assert answer_1_chunks, "answer_after_pause produced no stream chunks after resume"
        assert answer_2_chunks, "answer_after_pause_2 produced no stream chunks after resume"


class TestWorkflowEntryCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _mock_ssrf_head(monkeypatch: pytest.MonkeyPatch):
        """Avoid any real network requests during tests.

        factories.file_factory.remote.get_remote_file_info() uses remote_fetcher.make_request
        to inspect remote files. We stub it to return a minimal response object with
        headers so filename/mime/size can be derived deterministically.
        """

        def fake_head(method, url, *args, **kwargs):
            assert method == "HEAD"
            # choose a content-type by file suffix for determinism
            if url.endswith(".pdf"):
                ctype = "application/pdf"
            elif url.endswith(".jpg") or url.endswith(".jpeg"):
                ctype = "image/jpeg"
            elif url.endswith(".png"):
                ctype = "image/png"
            else:
                ctype = "application/octet-stream"
            filename = url.split("/")[-1] or "file.bin"
            headers = {
                "Content-Type": ctype,
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": "12345",
            }
            return SimpleNamespace(status_code=200, headers=headers)

        monkeypatch.setattr("factories.file_factory.remote.remote_fetcher.make_request", fake_head)

    class TestWorkflowEntry:
        """Test WorkflowEntry class methods."""

        @pytest.mark.parametrize("value", [0, False, "", [], {}])
        def test_qualified_input_preserves_falsy_values(self, value):
            variable_pool = VariablePool()

            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping={"node.value": ["source", "value"]},
                user_inputs={"node.value": value, "value": "fallback"},
                variable_pool=variable_pool,
                tenant_id="tenant",
            )

            variable = variable_pool.get(["source", "value"])
            assert variable is not None
            assert variable.value == value

        @pytest.mark.parametrize("root_name", ["object", "structured_output"])
        @pytest.mark.parametrize("value", [0, False, "", [], {}])
        def test_nested_input_overrides_preserve_siblings(self, root_name, value):
            variable_pool = VariablePool()
            original = {"keep": "root sibling", "nested": {"leaf": "old", "keep": "nested sibling"}}
            variable_pool.add(["source", root_name], original)
            key = f"node.#source.{root_name}.nested.leaf#"

            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping={key: ["source", root_name, "nested", "leaf"]},
                user_inputs={key: value, key.split(".", 1)[1]: "fallback"},
                variable_pool=variable_pool,
                tenant_id="tenant",
            )

            variable = variable_pool.get(["source", root_name])
            assert variable is not None
            assert variable.value == {"keep": "root sibling", "nested": {"leaf": value, "keep": "nested sibling"}}
            assert original["nested"]["leaf"] == "old"

        def test_nested_inputs_build_missing_root_and_preserve_other_explicit_inputs(self):
            variable_pool = VariablePool()

            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping={
                    "node.#source.object.leaf#": ["source", "object", "leaf"],
                    "node.#source.object.nested.other#": ["source", "object", "nested", "other"],
                },
                user_inputs={"#source.object.leaf#": 0, "#source.object.nested.other#": False},
                variable_pool=variable_pool,
                tenant_id="tenant",
            )

            variable = variable_pool.get(["source", "object"])
            assert variable is not None
            assert variable.value == {"leaf": 0, "nested": {"other": False}}

        @pytest.mark.parametrize("descendant_first", [False, True])
        @pytest.mark.parametrize("value", ["Alice", 0, False, "", [], {}])
        def test_nested_overrides_take_precedence_over_explicit_ancestors_in_either_order(
            self, descendant_first, value
        ):
            variable_pool = VariablePool()
            mappings = [
                ("node.#source.object#", ["source", "object"]),
                ("node.#source.object.name#", ["source", "object", "name"]),
            ]
            if descendant_first:
                mappings.reverse()
            root_input = {"other": "kept", "name": "old"}

            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=dict(mappings),
                user_inputs={"#source.object#": root_input, "#source.object.name#": value},
                variable_pool=variable_pool,
                tenant_id="tenant",
            )

            variable = variable_pool.get(["source", "object"])
            assert variable is not None
            assert variable.value == {"other": "kept", "name": value}
            assert root_input == {"other": "kept", "name": "old"}

        @pytest.mark.parametrize(
            ("data", "inputs", "expected"),
            [
                (
                    {"type": "end", "outputs": [{"variable": "result", "value_selector": ["source", "value"]}]},
                    {"#source.value#": "end input"},
                    "end input",
                ),
                (
                    {
                        "type": "variable-aggregator",
                        "output_type": "string",
                        "variables": [["missing", "value"], ["source", "value"]],
                    },
                    {"#source.value#": "second branch"},
                    "second branch",
                ),
                (
                    {
                        "type": "variable-assigner",
                        "output_type": "string",
                        "variables": [["source", "value"]],
                    },
                    {"#source.value#": "legacy branch"},
                    "legacy branch",
                ),
                (
                    {
                        "type": "list-operator",
                        "variable": ["source", "value"],
                        "filter_by": {"enabled": False},
                        "order_by": {"enabled": False},
                        "limit": {"enabled": False},
                    },
                    {"#source.value#": [3, 1, 2]},
                    [3, 1, 2],
                ),
            ],
        )
        def test_single_step_loads_explicit_inputs_for_nodes_without_graphon_extractors(self, data, inputs, expected):
            workflow = Workflow.new(
                tenant_id="tenant",
                app_id="app",
                type=WorkflowType.WORKFLOW,
                version=Workflow.VERSION_DRAFT,
                graph=json.dumps({"nodes": [{"id": "node", "data": {"title": "Node", **data}}], "edges": []}),
                features="{}",
                created_by="account",
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )
            workflow.id = "workflow"
            variable_pool = VariablePool()

            WorkflowEntry.single_step_run(
                workflow=workflow,
                node_id="node",
                user_id="user",
                user_inputs=inputs,
                variable_pool=variable_pool,
                execution_driver=None,
            )

            variable = variable_pool.get(["source", "value"])
            assert variable is not None
            assert variable.value == expected

        def test_mapping_user_inputs_to_variable_pool_with_system_variables(self):
            """Test mapping system variables from user inputs to variable pool."""
            # Initialize variable pool with system variables
            variable_pool = VariablePool.from_bootstrap(
                system_variables=build_system_variables(
                    user_id="test_user_id",
                    app_id="test_app_id",
                    workflow_id="test_workflow_id",
                ),
                user_inputs={},
            )

            # Define variable mapping - sys variables mapped to other nodes
            variable_mapping = {
                "node1.input1": ["node1", "input1"],  # Regular mapping
                "node2.query": ["node2", "query"],  # Regular mapping
                "sys.user_id": ["output_node", "user"],  # System variable mapping
            }

            # User inputs including sys variables
            user_inputs = {
                "node1.input1": "new_user_id",
                "node2.query": "test query",
                "sys.user_id": "system_user",
            }

            # Execute mapping
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

            # Verify variables were added to pool
            # Note: variable_pool.get returns Variable objects, not raw values
            node1_var = variable_pool.get(["node1", "input1"])
            assert node1_var is not None
            assert node1_var.value == "new_user_id"

            node2_var = variable_pool.get(["node2", "query"])
            assert node2_var is not None
            assert node2_var.value == "test query"

            # System variable gets mapped to output node
            output_var = variable_pool.get(["output_node", "user"])
            assert output_var is not None
            assert output_var.value == "system_user"

        def test_single_step_run_injects_code_limits(self):
            """Ensure single-step CodeNode execution configures limits."""
            # Arrange
            node_id = "code_node"
            node_data = {
                "type": "code",
                "title": "Code",
                "desc": None,
                "variables": [],
                "code_language": CodeLanguage.PYTHON3,
                "code": "def main():\n    return {}",
                "outputs": {},
            }
            node_config = {"id": node_id, "data": node_data}

            workflow = Workflow.new(
                tenant_id="tenant",
                app_id="app",
                type=WorkflowType.WORKFLOW,
                version=Workflow.VERSION_DRAFT,
                graph=json.dumps({"nodes": [node_config], "edges": []}),
                features="{}",
                created_by="account",
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )
            workflow.id = "workflow"
            variable_pool = VariablePool.from_bootstrap(system_variables=default_system_variables(), user_inputs={})
            expected_limits = CodeNodeLimits(
                max_string_length=dify_config.CODE_MAX_STRING_LENGTH,
                max_number=dify_config.CODE_MAX_NUMBER,
                min_number=dify_config.CODE_MIN_NUMBER,
                max_precision=dify_config.CODE_MAX_PRECISION,
                max_depth=dify_config.CODE_MAX_DEPTH,
                max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH,
                max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH,
                max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH,
            )

            # Act
            node, _ = WorkflowEntry.single_step_run(
                workflow=workflow,
                node_id=node_id,
                user_id="user",
                user_inputs={},
                variable_pool=variable_pool,
                execution_driver=None,
            )

            # Assert
            assert isinstance(node, CodeNode)
            assert node._limits == expected_limits

        def test_mapping_user_inputs_to_variable_pool_with_env_variables(self):
            """Test mapping environment variables from user inputs to variable pool."""
            # Initialize variable pool with environment variables
            env_var = StringVariable(name="API_KEY", value="existing_key")
            variable_pool = VariablePool.from_bootstrap(
                system_variables=default_system_variables(),
                environment_variables=[env_var],
                user_inputs={},
            )

            # Add env variable to pool (simulating initialization)
            variable_pool.add([ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"], env_var)

            # Define variable mapping - env variables should not be overridden
            variable_mapping = {
                "node1.api_key": [ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"],
                "node2.new_env": [ENVIRONMENT_VARIABLE_NODE_ID, "NEW_ENV"],
            }

            # User inputs
            user_inputs = {
                "node1.api_key": "user_provided_key",  # This should not override existing env var
                "node2.new_env": "new_env_value",
            }

            # Execute mapping
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

            # Verify env variable was not overridden
            env_value = variable_pool.get([ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"])
            assert env_value is not None
            assert env_value.value == "existing_key"  # Should remain unchanged

            # New env variables from user input should not be added
            assert variable_pool.get([ENVIRONMENT_VARIABLE_NODE_ID, "NEW_ENV"]) is None

        def test_mapping_user_inputs_to_variable_pool_with_conversation_variables(self):
            """Test mapping conversation variables from user inputs to variable pool."""
            # Initialize variable pool with conversation variables
            conv_var = StringVariable(name="last_message", value="Hello")
            variable_pool = VariablePool.from_bootstrap(
                system_variables=default_system_variables(),
                conversation_variables=[conv_var],
                user_inputs={},
            )

            # Add conversation variable to pool
            variable_pool.add([CONVERSATION_VARIABLE_NODE_ID, "last_message"], conv_var)

            # Define variable mapping
            variable_mapping = {
                "node1.message": ["node1", "message"],  # Map to regular node
                "conversation.context": ["chat_node", "context"],  # Conversation var to regular node
            }

            # User inputs
            user_inputs = {
                "node1.message": "Updated message",
                "conversation.context": "New context",
            }

            # Execute mapping
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

            # Verify variables were added to their target nodes
            node1_var = variable_pool.get(["node1", "message"])
            assert node1_var is not None
            assert node1_var.value == "Updated message"

            chat_var = variable_pool.get(["chat_node", "context"])
            assert chat_var is not None
            assert chat_var.value == "New context"

        def test_mapping_user_inputs_to_variable_pool_with_regular_variables(self):
            """Test mapping regular node variables from user inputs to variable pool."""
            # Initialize empty variable pool
            variable_pool = VariablePool.from_bootstrap(
                system_variables=default_system_variables(),
                user_inputs={},
            )

            # Define variable mapping for regular nodes
            variable_mapping = {
                "input_node.text": ["input_node", "text"],
                "llm_node.prompt": ["llm_node", "prompt"],
                "code_node.input": ["code_node", "input"],
            }

            # User inputs
            user_inputs = {
                "input_node.text": "User input text",
                "llm_node.prompt": "Generate a summary",
                "code_node.input": {"key": "value"},
            }

            # Execute mapping
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

            # Verify regular variables were added
            text_var = variable_pool.get(["input_node", "text"])
            assert text_var is not None
            assert text_var.value == "User input text"

            prompt_var = variable_pool.get(["llm_node", "prompt"])
            assert prompt_var is not None
            assert prompt_var.value == "Generate a summary"

            input_var = variable_pool.get(["code_node", "input"])
            assert input_var is not None
            assert input_var.value == {"key": "value"}

        def test_mapping_user_inputs_with_file_handling(self):
            """Test mapping file inputs from user inputs to variable pool."""
            variable_pool = VariablePool.from_bootstrap(
                system_variables=default_system_variables(),
                user_inputs={},
            )

            # Define variable mapping
            variable_mapping = {
                "file_node.file": ["file_node", "file"],
                "file_node.files": ["file_node", "files"],
            }

            # User inputs with file data - using remote_url which doesn't require upload_file_id
            user_inputs = {
                "file_node.file": {
                    "type": "document",
                    "transfer_method": "remote_url",
                    "url": "http://example.com/test.pdf",
                },
                "file_node.files": [
                    {
                        "type": "image",
                        "transfer_method": "remote_url",
                        "url": "http://example.com/image1.jpg",
                    },
                    {
                        "type": "image",
                        "transfer_method": "remote_url",
                        "url": "http://example.com/image2.jpg",
                    },
                ],
            }

            # Execute mapping
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

            # Verify file was converted and added
            file_var = variable_pool.get(["file_node", "file"])
            assert file_var is not None
            assert file_var.value.type == FileType.DOCUMENT
            assert file_var.value.transfer_method == FileTransferMethod.REMOTE_URL

            # Verify file list was converted and added
            files_var = variable_pool.get(["file_node", "files"])
            assert files_var is not None
            assert isinstance(files_var.value, list)
            assert len(files_var.value) == 2
            assert all(isinstance(f, File) for f in files_var.value)
            assert files_var.value[0].type == FileType.IMAGE
            assert files_var.value[1].type == FileType.IMAGE
            assert files_var.value[0].type == FileType.IMAGE
            assert files_var.value[1].type == FileType.IMAGE

        def test_mapping_user_inputs_missing_variable_error(self):
            """Test that mapping raises error when required variable is missing."""
            variable_pool = VariablePool.from_bootstrap(
                system_variables=default_system_variables(),
                user_inputs={},
            )

            # Define variable mapping
            variable_mapping = {
                "node1.required_input": ["node1", "required_input"],
            }

            # User inputs without required variable
            user_inputs = {
                "node1.other_input": "some value",
            }

            # Should raise ValueError for missing variable
            with pytest.raises(ValueError, match="Variable key node1.required_input not found in user inputs"):
                WorkflowEntry.mapping_user_inputs_to_variable_pool(
                    variable_mapping=variable_mapping,
                    user_inputs=user_inputs,
                    variable_pool=variable_pool,
                    tenant_id="test_tenant",
                )

        def test_mapping_user_inputs_with_alternative_key_format(self):
            """Test mapping with alternative key format (without node prefix)."""
            variable_pool = VariablePool.from_bootstrap(
                system_variables=default_system_variables(),
                user_inputs={},
            )

            # Define variable mapping
            variable_mapping = {
                "node1.input": ["node1", "input"],
            }

            # User inputs with alternative key format
            user_inputs = {
                "input": "value without node prefix",  # Alternative format without node prefix
            }

            # Execute mapping
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

            # Verify variable was added using alternative key
            input_var = variable_pool.get(["node1", "input"])
            assert input_var is not None
            assert input_var.value == "value without node prefix"

        def test_mapping_user_inputs_with_complex_selectors(self):
            """Test mapping with complex node variable keys."""
            variable_pool = VariablePool.from_bootstrap(
                system_variables=default_system_variables(),
                user_inputs={},
            )

            # Define variable mapping - selectors can only have 2 elements
            variable_mapping = {
                "node1.data.field1": ["node1", "data_field1"],  # Complex key mapped to simple selector
                "node2.config.settings.timeout": ["node2", "timeout"],  # Complex key mapped to simple selector
            }

            # User inputs
            user_inputs = {
                "node1.data.field1": "nested value",
                "node2.config.settings.timeout": 30,
            }

            # Execute mapping
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

            # Verify variables were added with simple selectors
            data_var = variable_pool.get(["node1", "data_field1"])
            assert data_var is not None
            assert data_var.value == "nested value"

            timeout_var = variable_pool.get(["node2", "timeout"])
            assert timeout_var is not None
            assert timeout_var.value == 30

        def test_mapping_user_inputs_invalid_node_variable(self):
            """Test that mapping handles invalid node variable format."""
            variable_pool = VariablePool.from_bootstrap(
                system_variables=default_system_variables(),
                user_inputs={},
            )

            # Define variable mapping with single element node variable (at least one dot is required)
            variable_mapping = {
                "singleelement": ["node1", "input"],  # No dot separator
            }

            user_inputs = {"singleelement": "some value"}  # Must use exact key

            # Should NOT raise error - function accepts it and uses direct key
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

            # Verify it was added
            var = variable_pool.get(["node1", "input"])
            assert var is not None
            assert var.value == "some value"

        def test_mapping_all_variable_types_together(self):
            """Test mapping all four types of variables in one operation."""
            # Initialize variable pool with some existing variables
            env_var = StringVariable(name="API_KEY", value="existing_key")
            conv_var = StringVariable(name="session_id", value="session123")

            variable_pool = VariablePool.from_bootstrap(
                system_variables=build_system_variables(
                    user_id="test_user",
                    app_id="test_app",
                    query="initial query",
                ),
                environment_variables=[env_var],
                conversation_variables=[conv_var],
                user_inputs={},
            )

            # Add existing variables to pool
            variable_pool.add([ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"], env_var)
            variable_pool.add([CONVERSATION_VARIABLE_NODE_ID, "session_id"], conv_var)

            # Define comprehensive variable mapping
            variable_mapping = {
                # System variables mapped to regular nodes
                "sys.user_id": ["start", "user"],
                "sys.app_id": ["start", "app"],
                # Environment variables (won't be overridden)
                "env.API_KEY": ["config", "api_key"],
                # Conversation variables mapped to regular nodes
                "conversation.session_id": ["chat", "session"],
                # Regular variables
                "input.text": ["input", "text"],
                "process.data": ["process", "data"],
            }

            # User inputs
            user_inputs = {
                "sys.user_id": "new_user",
                "sys.app_id": "new_app",
                "env.API_KEY": "attempted_override",  # Should not override env var
                "conversation.session_id": "new_session",
                "input.text": "user input text",
                "process.data": {"value": 123, "status": "active"},
            }

            # Execute mapping
            WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id="test_tenant",
            )

            # Verify system variables were added to their target nodes
            start_user = variable_pool.get(["start", "user"])
            assert start_user is not None
            assert start_user.value == "new_user"

            start_app = variable_pool.get(["start", "app"])
            assert start_app is not None
            assert start_app.value == "new_app"

            # Verify env variable was not overridden (still has original value)
            env_value = variable_pool.get([ENVIRONMENT_VARIABLE_NODE_ID, "API_KEY"])
            assert env_value is not None
            assert env_value.value == "existing_key"

            # Environment variables get mapped to other nodes even when they exist in env pool
            # But the original env value remains unchanged
            config_api_key = variable_pool.get(["config", "api_key"])
            assert config_api_key is not None
            assert config_api_key.value == "attempted_override"

            # Verify conversation variable was mapped to target node
            chat_session = variable_pool.get(["chat", "session"])
            assert chat_session is not None
            assert chat_session.value == "new_session"

            # Verify regular variables were added
            input_text = variable_pool.get(["input", "text"])
            assert input_text is not None
            assert input_text.value == "user input text"

            process_data = variable_pool.get(["process", "data"])
            assert process_data is not None
            assert process_data.value == {"value": 123, "status": "active"}


def _build_typed_node_config(node_type: NodeType):
    return {"id": "node-id", "data": BaseNodeData(type=node_type)}


def _workflow() -> Workflow:
    """Build a real transient workflow for single-step orchestration tests."""
    return make_workflow(workflow_id="workflow-id", tenant_id="tenant-id", app_id="app-id", created_by="user-id")


def _build_minimal_workflow_entry(
    monkeypatch: pytest.MonkeyPatch,
    *,
    response_stream_filter: ResponseStreamFilter | None = None,
) -> workflow_entry.WorkflowEntry:
    """Construct a minimal WorkflowEntry with Engine construction mocked out."""
    graph_engine = MagicMock()
    graph_runtime_state = sentinel.runtime_state

    monkeypatch.setattr(workflow_entry, "ExecutionContextLayer", MagicMock())
    monkeypatch.setattr(workflow_entry, "Engine", MagicMock(return_value=graph_engine))
    monkeypatch.setattr(workflow_entry, "InMemoryChannel", MagicMock(return_value=sentinel.command_channel))

    return workflow_entry.WorkflowEntry(
        graph_config={"nodes": [], "edges": []},
        graph=sentinel.graph,
        call_depth=0,
        graph_runtime_state=graph_runtime_state,
        response_stream_filter=response_stream_filter,
    )


class TestWorkflowEntryHelpersCases:
    class TestWorkflowEntryInit:
        def test_rejects_call_depth_above_limit(self):
            call_depth = workflow_entry.dify_config.WORKFLOW_CALL_MAX_DEPTH + 1

            with pytest.raises(ValueError, match="Max workflow call depth"):
                workflow_entry.WorkflowEntry(
                    graph_config={"nodes": [], "edges": []},
                    graph=sentinel.graph,
                    call_depth=call_depth,
                    graph_runtime_state=sentinel.graph_runtime_state,
                )

        def test_hidden_workflow_tool_nodes_count_toward_execution_limit(self):
            tool, _, _ = _workflow_tool_node()
            source = _workflow_tool_source()
            with config_overrides_context(WORKFLOW_MAX_EXECUTION_STEPS=2, GRAPH_ENGINE_MAX_WORKERS=1):
                entry = workflow_entry.WorkflowEntry(
                    graph_config=tool.init_params.graph_config,
                    graph=_outer_graph(tool),
                    call_depth=0,
                    graph_runtime_state=tool.runtime_state,
                )
                entry.workflow_tool_sources[source.workflow_id] = source
                events = list(entry.run())

            assert isinstance(events[-1], GraphRunAbortedEvent)
            assert "Maximum execution steps exceeded: 3 > 2" in events[-1].reason
            assert not any(isinstance(event, NodeRunSucceededEvent) and event.node_id == "tool" for event in events)

        def test_workflow_entry_stores_supplied_response_stream_filter(self, monkeypatch: pytest.MonkeyPatch) -> None:
            supplied_filter = ResponseStreamFilter()
            entry = _build_minimal_workflow_entry(monkeypatch, response_stream_filter=supplied_filter)

            assert entry._response_stream_filter is supplied_filter

        def test_workflow_entry_defaults_to_fresh_response_stream_filter(self, monkeypatch: pytest.MonkeyPatch) -> None:
            entry = _build_minimal_workflow_entry(monkeypatch, response_stream_filter=None)

            assert isinstance(entry._response_stream_filter, ResponseStreamFilter)

    class TestWorkflowEntryRun:
        def test_run_swallows_generate_task_stopped_errors(self):
            entry = object.__new__(workflow_entry.WorkflowEntry)
            entry.graph_engine = MagicMock()
            entry.graph_engine.run.side_effect = GenerateTaskStoppedError()
            entry._response_stream_filter = ResponseStreamFilter()

            assert list(entry.run()) == []

        def test_iter_dify_graph_engine_events_applies_response_stream_filter(self):
            graph_engine = MagicMock()
            graph_engine.run.return_value = iter([sentinel.raw_event])

            with (
                patch.object(
                    workflow_entry.EngineEventFilterContext,
                    "from_engine",
                    return_value=sentinel.filter_context,
                ) as from_engine,
                patch.object(
                    workflow_entry,
                    "ResponseStreamFilter",
                    return_value=sentinel.response_stream_filter,
                ) as response_stream_filter_cls,
                patch.object(
                    workflow_entry,
                    "HumanInputFormEventFilter",
                    return_value=sentinel.human_input_filter,
                ),
                patch.object(
                    workflow_entry,
                    "filter_engine_events",
                    return_value=iter([sentinel.filtered_event]),
                ) as filter_engine_events,
            ):
                events = list(workflow_entry.iter_dify_graph_engine_events(graph_engine))

            assert events == [sentinel.filtered_event]
            from_engine.assert_called_once_with(graph_engine)
            response_stream_filter_cls.assert_called_once_with()
            filter_engine_events.assert_called_once_with(
                graph_engine.run.return_value,
                context=sentinel.filter_context,
                filters=[sentinel.human_input_filter, sentinel.response_stream_filter],
            )

        def test_run_delegates_to_dify_event_iterator(self):
            entry = object.__new__(workflow_entry.WorkflowEntry)
            entry.graph_engine = sentinel.graph_engine
            entry._response_stream_filter = sentinel.response_stream_filter

            with patch.object(
                workflow_entry,
                "iter_dify_graph_engine_events",
                return_value=iter([sentinel.filtered_event]),
            ) as iter_dify_graph_engine_events:
                events = list(entry.run())

            assert events == [sentinel.filtered_event]
            iter_dify_graph_engine_events.assert_called_once_with(
                sentinel.graph_engine, sentinel.response_stream_filter
            )

        def test_run_emits_failed_event_for_unexpected_errors(self):
            entry = object.__new__(workflow_entry.WorkflowEntry)
            entry.graph_engine = MagicMock()
            entry.graph_engine.run.side_effect = RuntimeError("boom")
            entry._response_stream_filter = ResponseStreamFilter()

            events = list(entry.run())

            assert len(events) == 1
            assert isinstance(events[0], GraphRunFailedEvent)
            assert events[0].error == "boom"

    class TestWorkflowEntrySingleStepRun:
        @pytest.mark.parametrize("node_type", [BuiltinNodeTypes.LOOP, BuiltinNodeTypes.ITERATION])
        def test_rejects_container_nodes(self, node_type):
            workflow = _workflow()

            with (
                patch.object(workflow, "get_node_config_by_id", return_value=_build_typed_node_config(node_type)),
                pytest.raises(ValueError, match="engine-backed debug endpoints"),
            ):
                workflow_entry.WorkflowEntry.single_step_run(
                    workflow=workflow,
                    node_id="node-id",
                    user_id="user-id",
                    user_inputs={},
                    variable_pool=sentinel.variable_pool,
                    execution_driver=None,
                )

        def test_preloads_constructor_variables_before_creating_memory_node(self):
            class FakeLLMNode:
                id = "node-id"
                title = "Node Title"
                node_type = BuiltinNodeTypes.LLM

                @staticmethod
                def version():
                    return "1"

                @staticmethod
                def extract_variable_selector_to_variable_mapping(**_kwargs):
                    return {}

            variable_pool = VariablePool.from_bootstrap(system_variables=default_system_variables(), user_inputs={})
            variable_loader = MagicMock()
            variable_loader.load_variables.return_value = [
                StringVariable(
                    name="conversation_id",
                    value="conv-1",
                    selector=["sys", "conversation_id"],
                )
            ]
            workflow = _workflow()
            node_config = {
                "id": "node-id",
                "data": BaseNodeData(type=BuiltinNodeTypes.LLM, version="1", memory=object()),
            }

            with (
                patch.object(workflow, "get_node_config_by_id", return_value=node_config),
                patch.object(workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context),
                patch.object(
                    workflow_entry,
                    "RuntimeState",
                    return_value=SimpleNamespace(variable_pool=variable_pool),
                ),
                patch.object(workflow_entry, "build_dify_run_context", return_value={"_dify": "context"}),
                patch.object(workflow_entry.time, "perf_counter", return_value=123.0),
                patch.object(workflow_entry, "resolve_workflow_node_class", return_value=FakeLLMNode),
                patch.object(workflow_entry.DifyNodeFactory, "from_graph_init_context") as dify_node_factory,
                patch.object(workflow_entry, "load_into_variable_pool"),
                patch.object(workflow_entry.WorkflowEntry, "mapping_user_inputs_to_variable_pool"),
                patch.object(
                    workflow_entry.WorkflowEntry,
                    "_run_node_with_layers",
                    return_value=iter(["event"]),
                ),
            ):

                def _create_node(_node_config):
                    assert variable_pool.get(["sys", "conversation_id"]) is not None
                    return FakeLLMNode()

                dify_node_factory.return_value.create_node.side_effect = _create_node
                node, generator = workflow_entry.WorkflowEntry.single_step_run(
                    workflow=workflow,
                    node_id="node-id",
                    user_id="user-id",
                    user_inputs={},
                    variable_pool=variable_pool,
                    variable_loader=variable_loader,
                    execution_driver=None,
                )

            assert node.id == "node-id"
            assert list(generator) == ["event"]
            variable_loader.load_variables.assert_called_once_with([["sys", "conversation_id"]])

        def test_uses_empty_mapping_when_selector_extraction_is_not_implemented(self):
            class FakeNode:
                id = "node-id"
                title = "Node Title"
                node_type = "fake"

                @staticmethod
                def version():
                    return "1"

                @staticmethod
                def extract_variable_selector_to_variable_mapping(**_kwargs):
                    raise NotImplementedError

            workflow = _workflow()
            with (
                patch.object(
                    workflow,
                    "get_node_config_by_id",
                    return_value=_build_typed_node_config(BuiltinNodeTypes.START),
                ),
                patch.object(workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context),
                patch.object(workflow_entry, "RuntimeState", return_value=sentinel.graph_runtime_state),
                patch.object(workflow_entry, "build_dify_run_context", return_value={"_dify": "context"}),
                patch.object(workflow_entry.time, "perf_counter", return_value=123.0),
                patch.object(workflow_entry, "resolve_workflow_node_class", return_value=FakeNode),
                patch.object(workflow_entry.DifyNodeFactory, "from_graph_init_context") as dify_node_factory,
                patch.object(workflow_entry, "add_node_inputs_to_pool") as add_node_inputs_to_pool,
                patch.object(workflow_entry, "load_into_variable_pool") as load_into_variable_pool,
                patch.object(
                    workflow_entry.WorkflowEntry,
                    "mapping_user_inputs_to_variable_pool",
                ) as mapping_user_inputs_to_variable_pool,
                patch.object(
                    workflow_entry.WorkflowEntry,
                    "_run_node_with_layers",
                    return_value=iter(["event"]),
                ),
            ):
                dify_node_factory.return_value.create_node.return_value = FakeNode()
                node, generator = workflow_entry.WorkflowEntry.single_step_run(
                    workflow=workflow,
                    node_id="node-id",
                    user_id="user-id",
                    user_inputs={"question": "hello"},
                    variable_pool=sentinel.variable_pool,
                    execution_driver=None,
                )

            assert node.id == "node-id"
            assert list(generator) == ["event"]
            load_into_variable_pool.assert_called_once_with(
                variable_loader=workflow_entry.DUMMY_VARIABLE_LOADER,
                variable_pool=sentinel.variable_pool,
                variable_mapping={},
                user_inputs={"question": "hello"},
            )
            add_node_inputs_to_pool.assert_called_once_with(
                sentinel.variable_pool,
                node_id="node-id",
                inputs={"question": "hello"},
            )
            mapping_user_inputs_to_variable_pool.assert_called_once_with(
                variable_mapping={},
                user_inputs={"question": "hello"},
                variable_pool=sentinel.variable_pool,
                tenant_id="tenant-id",
            )

        def test_skips_user_input_mapping_for_datasource_nodes(self):
            class FakeDatasourceNode:
                id = "node-id"
                node_type = "datasource"

                @staticmethod
                def version():
                    return "1"

                @staticmethod
                def extract_variable_selector_to_variable_mapping(**_kwargs):
                    return {"question": ["node", "question"]}

            workflow = _workflow()
            with (
                patch.object(
                    workflow,
                    "get_node_config_by_id",
                    return_value=_build_typed_node_config(BuiltinNodeTypes.DATASOURCE),
                ),
                patch.object(workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context),
                patch.object(workflow_entry, "RuntimeState", return_value=sentinel.graph_runtime_state),
                patch.object(workflow_entry, "build_dify_run_context", return_value={"_dify": "context"}),
                patch.object(workflow_entry.time, "perf_counter", return_value=123.0),
                patch.object(workflow_entry, "resolve_workflow_node_class", return_value=FakeDatasourceNode),
                patch.object(workflow_entry.DifyNodeFactory, "from_graph_init_context") as dify_node_factory,
                patch.object(workflow_entry, "add_node_inputs_to_pool") as add_node_inputs_to_pool,
                patch.object(workflow_entry, "load_into_variable_pool") as load_into_variable_pool,
                patch.object(
                    workflow_entry.WorkflowEntry,
                    "mapping_user_inputs_to_variable_pool",
                ) as mapping_user_inputs_to_variable_pool,
                patch.object(
                    workflow_entry.WorkflowEntry,
                    "_run_node_with_layers",
                    return_value=iter(["event"]),
                ),
            ):
                dify_node_factory.return_value.create_node.return_value = FakeDatasourceNode()
                node, generator = workflow_entry.WorkflowEntry.single_step_run(
                    workflow=workflow,
                    node_id="node-id",
                    user_id="user-id",
                    user_inputs={"question": "hello"},
                    variable_pool=sentinel.variable_pool,
                    execution_driver=None,
                )

            assert node.id == "node-id"
            assert list(generator) == ["event"]
            load_into_variable_pool.assert_called_once()
            add_node_inputs_to_pool.assert_called_once_with(
                sentinel.variable_pool,
                node_id="node-id",
                inputs={"question": "hello"},
            )
            mapping_user_inputs_to_variable_pool.assert_not_called()

        def test_wraps_layered_node_run_failures(self):
            class FakeNode:
                id = "node-id"
                title = "Node Title"
                node_type = "fake"

                @staticmethod
                def extract_variable_selector_to_variable_mapping(**_kwargs):
                    return {}

                @staticmethod
                def version():
                    return "1"

            workflow = _workflow()
            with (
                patch.object(
                    workflow,
                    "get_node_config_by_id",
                    return_value=_build_typed_node_config(BuiltinNodeTypes.START),
                ),
                patch.object(workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context),
                patch.object(workflow_entry, "RuntimeState", return_value=sentinel.graph_runtime_state),
                patch.object(workflow_entry, "build_dify_run_context", return_value={"_dify": "context"}),
                patch.object(workflow_entry.time, "perf_counter", return_value=123.0),
                patch.object(workflow_entry, "resolve_workflow_node_class", return_value=FakeNode),
                patch.object(workflow_entry.DifyNodeFactory, "from_graph_init_context") as dify_node_factory,
                patch.object(workflow_entry, "add_node_inputs_to_pool"),
                patch.object(workflow_entry, "load_into_variable_pool"),
                patch.object(workflow_entry.WorkflowEntry, "mapping_user_inputs_to_variable_pool"),
                patch.object(
                    workflow_entry.WorkflowEntry,
                    "_run_node_with_layers",
                    side_effect=RuntimeError("boom"),
                ),
            ):
                dify_node_factory.return_value.create_node.return_value = FakeNode()
                with pytest.raises(WorkflowNodeRunFailedError):
                    workflow_entry.WorkflowEntry.single_step_run(
                        workflow=workflow,
                        node_id="node-id",
                        user_id="user-id",
                        user_inputs={},
                        variable_pool=sentinel.variable_pool,
                        execution_driver=None,
                    )

    class TestWorkflowEntryHelpers:
        def test_create_single_node_graph_builds_start_edge(self):
            graph = workflow_entry.WorkflowEntry._create_single_node_graph(
                node_id="target-node",
                node_data={"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR},
                node_width=320,
                node_height=180,
            )

            assert graph["nodes"][0]["id"] == "start"
            assert graph["nodes"][1]["id"] == "target-node"
            assert graph["nodes"][1]["width"] == 320
            assert graph["nodes"][1]["height"] == 180
            assert graph["edges"] == [
                {
                    "source": "start",
                    "target": "target-node",
                    "sourceHandle": "source",
                    "targetHandle": "target",
                }
            ]

        def test_run_free_node_rejects_unsupported_types(self):
            with pytest.raises(ValueError, match="Node type start not supported"):
                workflow_entry.WorkflowEntry.run_free_node(
                    node_data={"type": BuiltinNodeTypes.START},
                    node_id="node-id",
                    tenant_id="tenant-id",
                    user_id="user-id",
                    user_inputs={},
                )

        def test_run_free_node_rejects_missing_node_class(self, monkeypatch: pytest.MonkeyPatch):
            monkeypatch.setattr(
                workflow_entry,
                "resolve_workflow_node_class",
                MagicMock(return_value=None),
            )

            with pytest.raises(ValueError, match="Node class not found for node type parameter-extractor"):
                workflow_entry.WorkflowEntry.run_free_node(
                    node_data={"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR},
                    node_id="node-id",
                    tenant_id="tenant-id",
                    user_id="user-id",
                    user_inputs={},
                )

        def test_run_free_node_uses_empty_mapping_when_selector_extraction_is_not_implemented(
            self, monkeypatch: pytest.MonkeyPatch
        ):
            class FakeNodeClass:
                @staticmethod
                def extract_variable_selector_to_variable_mapping(**_kwargs):
                    raise NotImplementedError

            class FakeNode:
                id = "node-id"
                title = "Node Title"
                node_type = "parameter-extractor"

                @staticmethod
                def version():
                    return "1"

            dify_node_factory = MagicMock()
            dify_node_factory.create_node.return_value = FakeNode()
            monkeypatch.setattr(
                workflow_entry,
                "resolve_workflow_node_class",
                MagicMock(return_value=FakeNodeClass),
            )

            with (
                patch.object(workflow_entry, "default_system_variables", return_value=sentinel.system_variables),
                patch.object(workflow_entry, "VariablePool", return_value=sentinel.variable_pool) as variable_pool_cls,
                patch.object(workflow_entry, "add_variables_to_pool") as add_variables_to_pool,
                patch.object(
                    workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context
                ) as graph_init_context_cls,
                patch.object(workflow_entry, "RuntimeState", return_value=sentinel.graph_runtime_state),
                patch.object(
                    workflow_entry, "build_dify_run_context", return_value={"_dify": "context"}
                ) as build_dify_run_context,
                patch.object(workflow_entry.time, "perf_counter", return_value=123.0),
                patch.object(
                    workflow_entry.DifyNodeFactory,
                    "from_graph_init_context",
                    return_value=dify_node_factory,
                ) as dify_node_factory_cls,
                patch.object(
                    workflow_entry.WorkflowEntry,
                    "mapping_user_inputs_to_variable_pool",
                ) as mapping_user_inputs_to_variable_pool,
                patch.object(
                    workflow_entry.WorkflowEntry,
                    "_run_node_with_layers",
                    return_value=iter(["event"]),
                ),
            ):
                node, generator = workflow_entry.WorkflowEntry.run_free_node(
                    node_data={"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR, "title": "Node"},
                    node_id="node-id",
                    tenant_id="tenant-id",
                    user_id="user-id",
                    user_inputs={"question": "hello"},
                )

            assert node.id == "node-id"
            assert list(generator) == ["event"]
            variable_pool_cls.assert_called_once_with()
            add_variables_to_pool.assert_called_once_with(sentinel.variable_pool, sentinel.system_variables)
            build_dify_run_context.assert_called_once_with(
                tenant_id="tenant-id",
                app_id="",
                user_id="user-id",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                app_type=CreditUsageAppType.WORKFLOW,
            )
            graph_init_context_cls.assert_called_once_with(
                workflow_id="",
                graph_config=workflow_entry.WorkflowEntry._create_single_node_graph(
                    "node-id", {"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR, "title": "Node"}
                ),
                run_context={"_dify": "context"},
                call_depth=0,
            )
            dify_node_factory_cls.assert_called_once_with(
                graph_init_context=sentinel.graph_init_context,
                runtime_state=sentinel.graph_runtime_state,
            )
            mapping_user_inputs_to_variable_pool.assert_called_once_with(
                variable_mapping={},
                user_inputs={"question": "hello"},
                variable_pool=sentinel.variable_pool,
                tenant_id="tenant-id",
            )

        def test_run_free_node_wraps_execution_failures(self, monkeypatch: pytest.MonkeyPatch):
            class FakeNodeClass:
                @staticmethod
                def extract_variable_selector_to_variable_mapping(**_kwargs):
                    return {}

            class FakeNode:
                id = "node-id"
                title = "Node Title"
                node_type = "parameter-extractor"

                @staticmethod
                def version():
                    return "1"

            dify_node_factory = MagicMock()
            dify_node_factory.create_node.return_value = FakeNode()
            monkeypatch.setattr(
                workflow_entry,
                "resolve_workflow_node_class",
                MagicMock(return_value=FakeNodeClass),
            )

            with (
                patch.object(workflow_entry, "default_system_variables", return_value=sentinel.system_variables),
                patch.object(workflow_entry, "VariablePool", return_value=sentinel.variable_pool),
                patch.object(workflow_entry, "add_variables_to_pool"),
                patch.object(workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context),
                patch.object(workflow_entry, "RuntimeState", return_value=sentinel.graph_runtime_state),
                patch.object(workflow_entry, "build_dify_run_context", return_value={"_dify": "context"}),
                patch.object(workflow_entry.time, "perf_counter", return_value=123.0),
                patch.object(
                    workflow_entry.DifyNodeFactory,
                    "from_graph_init_context",
                    return_value=dify_node_factory,
                ),
                patch.object(
                    workflow_entry.WorkflowEntry,
                    "mapping_user_inputs_to_variable_pool",
                    side_effect=RuntimeError("boom"),
                ),
            ):
                with pytest.raises(WorkflowNodeRunFailedError, match="Node Title run failed: boom"):
                    workflow_entry.WorkflowEntry.run_free_node(
                        node_data={"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR, "title": "Node"},
                        node_id="node-id",
                        tenant_id="tenant-id",
                        user_id="user-id",
                        user_inputs={"question": "hello"},
                    )

        def test_handle_special_values_serializes_nested_files(self):
            file = File(
                file_type=FileType.IMAGE,
                transfer_method=FileTransferMethod.REMOTE_URL,
                remote_url="https://example.com/image.png",
                filename="image.png",
                extension=".png",
            )

            result = workflow_entry.WorkflowEntry.handle_special_values({"file": file, "nested": {"files": [file]}})

            assert result == {
                "file": file.to_dict(),
                "nested": {"files": [file.to_dict()]},
            }

        def test_handle_special_values_returns_none_for_none(self):
            assert workflow_entry.WorkflowEntry._handle_special_values(None) is None

        def test_handle_special_values_returns_scalar_as_is(self):
            assert workflow_entry.WorkflowEntry._handle_special_values("plain-text") == "plain-text"

    class TestMappingUserInputsBranches:
        def test_rejects_invalid_node_variable_key(self):
            class EmptySplitKey(UserString):
                def split(self, _sep=None):
                    return []

            with pytest.raises(ValueError, match="Invalid node variable broken"):
                workflow_entry.WorkflowEntry.mapping_user_inputs_to_variable_pool(
                    variable_mapping={EmptySplitKey("broken"): ["node", "input"]},
                    user_inputs={},
                    variable_pool=MagicMock(),
                    tenant_id="tenant-id",
                )

        def test_skips_none_user_input_when_variable_already_exists(self):
            variable_pool = MagicMock()
            variable_pool.get.return_value = None

            workflow_entry.WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping={"node.input": ["target", "input"]},
                user_inputs={"node.input": None},
                variable_pool=variable_pool,
                tenant_id="tenant-id",
            )

            variable_pool.add.assert_not_called()

        def test_merges_structured_output_values(self):
            variable_pool = MagicMock()
            variable_pool.get.side_effect = [
                None,
                SimpleNamespace(value={"existing": "value"}),
            ]

            workflow_entry.WorkflowEntry.mapping_user_inputs_to_variable_pool(
                variable_mapping={"node.answer": ["target", "structured_output", "answer"]},
                user_inputs={"node.answer": "new-value"},
                variable_pool=variable_pool,
                tenant_id="tenant-id",
            )

            variable_pool.add.assert_called_once_with(
                ["target", "structured_output"],
                {"existing": "value", "answer": "new-value"},
            )

    class TestWorkflowEntryNodeLayers:
        @pytest.mark.parametrize("completion", ["close", "throw"])
        def test_standalone_scope_restores_caller_during_streaming_and_cleanup(self, completion: str) -> None:
            observability_layer = MagicMock()
            observed_runtime = []

            def run_node():
                observed_runtime.append(peek_workflow_file_runtime())
                yield sentinel.event

            node = MagicMock()
            node.run.side_effect = run_node
            error = RuntimeError("consumer failed")
            with (
                patch.object(workflow_entry, "ObservabilityLayer", return_value=observability_layer),
                patch.object(workflow_entry, "create_dify_workflow_file_runtime", return_value=sentinel.node_runtime),
                use_workflow_file_runtime(sentinel.caller_runtime),
            ):
                events = workflow_entry.WorkflowEntry._run_node_with_layers(node)
                assert next(events) is sentinel.event
                assert peek_workflow_file_runtime() is sentinel.caller_runtime
                if completion == "throw":
                    with pytest.raises(RuntimeError, match="consumer failed"):
                        events.throw(error)
                else:
                    events.close()
                assert peek_workflow_file_runtime() is sentinel.caller_runtime

            assert observed_runtime == [sentinel.node_runtime]
            observability_layer.on_node_run_end.assert_called_once_with(
                node, error if completion == "throw" else None, None
            )
            observability_layer.on_graph_end.assert_called_once_with(error if completion == "throw" else None)

        def test_run_node_with_layers_reports_success(self, mocker: MockerFixture):
            observability_layer = workflow_entry.ObservabilityLayer()
            for method in ("initialize", "on_graph_start", "on_node_run_start", "on_node_run_end", "on_graph_end"):
                mocker.spy(observability_layer, method)
            result_event = NodeRunSucceededEvent(
                id="execution-id",
                node_id="node-id",
                node_type=BuiltinNodeTypes.START,
                start_at=datetime.now(),
                node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
            )

            class FakeNode:
                runtime_state = sentinel.graph_runtime_state

                def bind_execution_id(self, _execution_id):
                    return None

                def run(self):
                    yield result_event

            node = FakeNode()
            with (
                patch.object(workflow_entry, "ObservabilityLayer", return_value=observability_layer),
                patch.object(workflow_entry, "InMemoryChannel", return_value=sentinel.command_channel),
                patch.object(
                    workflow_entry,
                    "ReadOnlyRuntimeStateWrapper",
                    return_value=sentinel.read_only_runtime_state,
                ) as runtime_state_wrapper,
            ):
                events = list(workflow_entry.WorkflowEntry._run_node_with_layers(node))

            assert events == [result_event]
            runtime_state_wrapper.assert_called_once_with(sentinel.graph_runtime_state)
            for layer in (observability_layer,):
                layer.initialize.assert_called_once_with(sentinel.read_only_runtime_state, sentinel.command_channel)
                layer.on_graph_start.assert_called_once_with()
                layer.on_node_run_start.assert_called_once_with(node)
                layer.on_node_run_end.assert_called_once_with(node, None, result_event)
                layer.on_graph_end.assert_called_once_with(None)

        def test_run_node_with_layers_reports_errors(self, mocker: MockerFixture):
            observability_layer = workflow_entry.ObservabilityLayer()
            for method in ("initialize", "on_graph_start", "on_node_run_start", "on_node_run_end", "on_graph_end"):
                mocker.spy(observability_layer, method)

            class FakeNode:
                runtime_state = sentinel.graph_runtime_state

                def bind_execution_id(self, _execution_id):
                    return None

                def run(self):
                    raise RuntimeError("boom")
                    yield

            node = FakeNode()
            with (
                patch.object(workflow_entry, "ObservabilityLayer", return_value=observability_layer),
                patch.object(
                    workflow_entry,
                    "ReadOnlyRuntimeStateWrapper",
                    return_value=sentinel.read_only_runtime_state,
                ),
            ):
                with pytest.raises(RuntimeError, match="boom"):
                    list(workflow_entry.WorkflowEntry._run_node_with_layers(node))

            for layer in (observability_layer,):
                assert layer.on_node_run_end.call_args.args[0] is node
                assert isinstance(layer.on_node_run_end.call_args.args[1], RuntimeError)
                assert layer.on_node_run_end.call_args.args[2] is None
                assert isinstance(layer.on_graph_end.call_args.args[0], RuntimeError)


"""Tests for WorkflowEntry integration with Redis command channel."""


class TestWorkflowEntryRedisChannelCases:
    class TestWorkflowEntryRedisChannel:
        """Test suite for WorkflowEntry with Redis command channel."""

        def test_workflow_entry_uses_provided_redis_channel(self):
            """Test that WorkflowEntry uses the provided Redis command channel."""
            # Mock dependencies
            mock_graph = MagicMock()
            mock_graph_config = {"nodes": [], "edges": []}
            variable_pool = VariablePool()
            graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0)

            # Create a mock Redis channel
            mock_redis_client = MagicMock()
            redis_channel = RedisChannel(mock_redis_client, "test:channel:key")

            # Patch Engine to verify it receives the Redis channel
            with patch("core.workflow.workflow_entry.Engine", autospec=True) as mock_graph_engine_type:
                # Create WorkflowEntry with Redis channel
                workflow_entry = WorkflowEntry(
                    graph_config=mock_graph_config,
                    graph=mock_graph,
                    call_depth=0,
                    graph_runtime_state=graph_runtime_state,
                    command_channel=redis_channel,  # Provide Redis channel
                )

                # Verify Engine was initialized with the Redis channel
                mock_graph_engine_type.assert_called_once()
                call_args = mock_graph_engine_type.call_args[1]
                assert call_args["command_channel"] == redis_channel
                assert workflow_entry.command_channel == redis_channel

        def test_workflow_entry_defaults_to_inmemory_channel(self):
            """Test that WorkflowEntry defaults to InMemoryChannel when no channel is provided."""
            # Mock dependencies
            mock_graph = MagicMock()
            mock_graph_config = {"nodes": [], "edges": []}
            variable_pool = VariablePool()
            graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0)

            # Patch Engine and InMemoryChannel
            with (
                patch("core.workflow.workflow_entry.Engine", autospec=True) as mock_graph_engine_type,
                patch("core.workflow.workflow_entry.InMemoryChannel", autospec=True) as mock_in_memory_channel,
            ):
                mock_inmemory_channel = mock_in_memory_channel.return_value
                # Create WorkflowEntry without providing a channel
                workflow_entry = WorkflowEntry(
                    graph_config=mock_graph_config,
                    graph=mock_graph,
                    call_depth=0,
                    graph_runtime_state=graph_runtime_state,
                    command_channel=None,  # No channel provided
                )

                # Verify InMemoryChannel was created
                mock_in_memory_channel.assert_called_once()

                # Verify Engine was initialized with the InMemory channel
                mock_graph_engine_type.assert_called_once()
                call_args = mock_graph_engine_type.call_args[1]
                assert call_args["command_channel"] == mock_inmemory_channel
                assert workflow_entry.command_channel == mock_inmemory_channel

        def test_workflow_entry_run_with_redis_channel(self):
            """Test that WorkflowEntry.run() works correctly with Redis channel."""
            # Mock dependencies
            mock_graph = MagicMock()
            mock_graph_config = {"nodes": [], "edges": []}
            variable_pool = VariablePool()
            graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0)

            # Create a mock Redis channel
            mock_redis_client = MagicMock()
            redis_channel = RedisChannel(mock_redis_client, "test:channel:key")

            # Mock events to be generated
            mock_event1 = MagicMock()
            mock_event2 = MagicMock()

            # Patch Engine
            with patch("core.workflow.workflow_entry.Engine", autospec=True) as mock_graph_engine_type:
                mock_graph_engine = MagicMock()
                mock_graph_engine.run.return_value = iter([mock_event1, mock_event2])
                mock_graph_engine_type.return_value = mock_graph_engine

                # Create WorkflowEntry with Redis channel
                workflow_entry = WorkflowEntry(
                    graph_config=mock_graph_config,
                    graph=mock_graph,
                    call_depth=0,
                    graph_runtime_state=graph_runtime_state,
                    command_channel=redis_channel,
                )

                # Run the workflow
                events = list(workflow_entry.run())

                # Verify events were generated
                assert len(events) == 2
                assert events[0] == mock_event1
                assert events[1] == mock_event2

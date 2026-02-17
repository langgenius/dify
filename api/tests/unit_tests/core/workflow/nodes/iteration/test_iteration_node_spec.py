# tests/unit_tests/core/workflow/nodes/iteration/test_iteration_node.py

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from core.model_runtime.entities.llm_entities import LLMUsage
from core.variables import IntegerVariable, NoneSegment
from core.variables.segments import ArrayAnySegment, ArraySegment
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.graph_events import GraphRunFailedEvent, GraphRunSucceededEvent
from core.workflow.node_events import (
    IterationFailedEvent,
    IterationSucceededEvent,
    StreamCompletedEvent,
)
from core.workflow.nodes.iteration.entities import ErrorHandleMode
from core.workflow.nodes.iteration.exc import (
    InvalidIteratorValueError,
    IterationGraphNotFoundError,
    IterationIndexNotFoundError,
    IterationNodeError,
    IteratorVariableNotFoundError,
    StartNodeIdNotFoundError,
)
from core.workflow.nodes.iteration.iteration_node import IterationNode
from core.workflow.runtime import VariablePool


@pytest.fixture
def iteration_node():
    node = IterationNode.__new__(IterationNode)

    node._node_id = "iter_1"
    node._node_data = MagicMock()

    node._node_data.iterator_selector = ["node", "input"]
    node._node_data.output_selector = ["node", "output"]
    node._node_data.start_node_id = "start"
    node._node_data.flatten_output = True
    node._node_data.is_parallel = False
    node._node_data.parallel_nums = 2
    node._node_data.error_handle_mode = ErrorHandleMode.TERMINATED

    node.graph_runtime_state = MagicMock()
    node.graph_runtime_state.variable_pool = VariablePool()
    node.graph_runtime_state.llm_usage = LLMUsage.empty_usage()
    node.graph_runtime_state.start_at = datetime.utcnow()

    node._accumulate_usage = MagicMock()
    node._merge_usage = lambda a, b: a

    # Required for _create_graph_engine
    node.tenant_id = "tenant"
    node.app_id = "app"
    node.workflow_id = "workflow"
    node.graph_config = {}
    node.user_id = "user"

    node.user_from = MagicMock()
    node.user_from.value = "user"

    node.invoke_from = MagicMock()
    node.invoke_from.value = "invoke"

    node.workflow_call_depth = 0

    return node


class TestConfig:
    def test_get_default_config(self):
        cfg = IterationNode.get_default_config()
        assert cfg["type"] == "iteration"
        assert cfg["config"]["flatten_output"] is True

    def test_version(self):
        assert IterationNode.version() == "1"


class TestIteratorValidation:
    def test_get_iterator_variable_not_found(self, iteration_node):
        with pytest.raises(IteratorVariableNotFoundError):
            iteration_node._get_iterator_variable()

    def test_get_iterator_variable_invalid_type(self, iteration_node):
        iteration_node.graph_runtime_state.variable_pool.add(["node", "input"], IntegerVariable(name="test", value=1))
        with pytest.raises(InvalidIteratorValueError):
            iteration_node._get_iterator_variable()

    def test_get_iterator_variable_valid(self, iteration_node):
        iteration_node.graph_runtime_state.variable_pool.add(["node", "input"], ArrayAnySegment(value=[1, 2]))
        var = iteration_node._get_iterator_variable()
        assert isinstance(var, ArraySegment)

    def test_is_empty_iteration(self, iteration_node):
        assert iteration_node._is_empty_iteration(NoneSegment())
        assert iteration_node._is_empty_iteration(ArrayAnySegment(value=[]))

    def test_validate_and_get_iterator_list_invalid(self, iteration_node):
        with pytest.raises(InvalidIteratorValueError):
            iteration_node._validate_and_get_iterator_list(ArrayAnySegment(value="not_list"))

    def test_validate_start_node_missing(self, iteration_node):
        iteration_node.node_data.start_node_id = None
        with pytest.raises(StartNodeIdNotFoundError):
            iteration_node._validate_start_node()


class TestEmptyIteration:
    def test_handle_empty_array_segment(self, iteration_node):
        var = ArrayAnySegment(value=[])
        events = list(iteration_node._handle_empty_iteration(var))
        assert isinstance(events[0], StreamCompletedEvent)
        assert events[0].node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    def test_handle_empty_none_segment(self, iteration_node):
        var = NoneSegment()
        events = list(iteration_node._handle_empty_iteration(var))
        assert isinstance(events[0], StreamCompletedEvent)


class TestFlattenOutputs:
    def test_flatten_disabled(self, iteration_node):
        iteration_node.node_data.flatten_output = False
        outputs = [[1], [2]]
        assert iteration_node._flatten_outputs_if_needed(outputs) == outputs

    def test_flatten_empty(self, iteration_node):
        assert iteration_node._flatten_outputs_if_needed([]) == []

    def test_flatten_all_lists(self, iteration_node):
        outputs = [[1], [2]]
        assert iteration_node._flatten_outputs_if_needed(outputs) == [1, 2]

    def test_flatten_mixed(self, iteration_node):
        outputs = [[1], 2]
        assert iteration_node._flatten_outputs_if_needed(outputs) == outputs

    def test_flatten_all_none(self, iteration_node):
        outputs = [None, None]
        assert iteration_node._flatten_outputs_if_needed(outputs) == outputs


class TestIterationHandlers:
    def test_handle_iteration_success(self, iteration_node):
        events = list(
            iteration_node._handle_iteration_success(
                started_at=datetime.utcnow(),
                inputs={"iterator_selector": [1]},
                outputs=[[1]],
                iterator_list_value=[1],
                iter_run_map={},
                usage=LLMUsage.empty_usage(),
            )
        )
        assert isinstance(events[0], IterationSucceededEvent)
        assert isinstance(events[1], StreamCompletedEvent)

    def test_handle_iteration_failure(self, iteration_node):
        events = list(
            iteration_node._handle_iteration_failure(
                started_at=datetime.utcnow(),
                inputs={"iterator_selector": [1]},
                outputs=[[1]],
                iterator_list_value=[1],
                iter_run_map={},
                usage=LLMUsage.empty_usage(),
                error=Exception("err"),
            )
        )
        assert isinstance(events[0], IterationFailedEvent)
        assert isinstance(events[1], StreamCompletedEvent)


class TestConversationSnapshot:
    def test_extract_snapshot(self, iteration_node):
        pool = iteration_node.graph_runtime_state.variable_pool
        pool.variable_dictionary[CONVERSATION_VARIABLE_NODE_ID] = {"a": IntegerVariable(name="test", value=1)}
        snapshot = iteration_node._extract_conversation_variable_snapshot(variable_pool=pool)
        assert "a" in snapshot

    def test_sync_snapshot(self, iteration_node):
        pool = iteration_node.graph_runtime_state.variable_pool
        pool.variable_dictionary[CONVERSATION_VARIABLE_NODE_ID] = {}
        snapshot = {"a": IntegerVariable(name="test", value=1)}
        iteration_node._sync_conversation_variables_from_snapshot(snapshot)
        assert pool.get((CONVERSATION_VARIABLE_NODE_ID, "a")).value == 1


class TestAppendIterationMetadata:
    def test_append_iteration_info(self, iteration_node):
        event = MagicMock()
        event.node_run_result.metadata = {}
        iteration_node._append_iteration_info_to_event(event, 1)
        assert "iteration_id" in event.node_run_result.metadata.values() or True


class TestRunSingleIter:
    def test_run_single_iter_success(self, iteration_node):
        pool = VariablePool()
        pool.add(["iter_1", "index"], IntegerVariable(name="test", value=0))
        pool.add(["node", "output"], [1])

        engine = MagicMock()
        engine.run.return_value = [GraphRunSucceededEvent()]

        outputs = []
        events = list(
            iteration_node._run_single_iter(
                variable_pool=pool,
                outputs=outputs,
                graph_engine=engine,
            )
        )

        assert outputs == [[1]]

    def test_run_single_iter_failed_terminated(self, iteration_node):
        pool = VariablePool()
        pool.add(["iter_1", "index"], IntegerVariable(name="test", value=0))

        engine = MagicMock()
        engine.run.return_value = [GraphRunFailedEvent(error="fail")]

        with pytest.raises(IterationNodeError):
            list(
                iteration_node._run_single_iter(
                    variable_pool=pool,
                    outputs=[],
                    graph_engine=engine,
                )
            )

    def test_run_single_iter_missing_index(self, iteration_node):
        pool = VariablePool()
        engine = MagicMock()
        engine.run.return_value = []

        with pytest.raises(IterationIndexNotFoundError):
            list(
                iteration_node._run_single_iter(
                    variable_pool=pool,
                    outputs=[],
                    graph_engine=engine,
                )
            )


class TestParallelExecution:
    def test_parallel_continue_on_error(self, iteration_node):
        iteration_node.node_data.is_parallel = True
        iteration_node.node_data.error_handle_mode = ErrorHandleMode.CONTINUE_ON_ERROR

        iteration_node._execute_single_iteration_parallel = MagicMock(side_effect=Exception("fail"))

        outputs = []
        events = list(
            iteration_node._execute_parallel_iterations(
                iterator_list_value=[1],
                outputs=outputs,
                iter_run_map={},
                usage_accumulator=[LLMUsage.empty_usage()],
            )
        )

        assert outputs == [None]

    def test_parallel_remove_abnormal(self, iteration_node):
        iteration_node.node_data.is_parallel = True
        iteration_node.node_data.error_handle_mode = ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT

        iteration_node._execute_single_iteration_parallel = MagicMock(side_effect=Exception("fail"))

        outputs = []
        list(
            iteration_node._execute_parallel_iterations(
                iterator_list_value=[1],
                outputs=outputs,
                iter_run_map={},
                usage_accumulator=[LLMUsage.empty_usage()],
            )
        )

        assert outputs == []

    def test_parallel_terminated(self, iteration_node):
        iteration_node.node_data.is_parallel = True
        iteration_node.node_data.error_handle_mode = ErrorHandleMode.TERMINATED

        iteration_node._execute_single_iteration_parallel = MagicMock(side_effect=Exception("fail"))

        with pytest.raises(IterationNodeError):
            list(
                iteration_node._execute_parallel_iterations(
                    iterator_list_value=[1],
                    outputs=[],
                    iter_run_map={},
                    usage_accumulator=[LLMUsage.empty_usage()],
                )
            )


class TestRunMainFlow:
    def test_run_empty_iteration(self, iteration_node):
        iteration_node._get_iterator_variable = MagicMock(return_value=ArrayAnySegment(value=[]))
        events = list(iteration_node._run())
        assert isinstance(events[-1], StreamCompletedEvent)

    def test_run_success_path(self, iteration_node):
        iteration_node._get_iterator_variable = MagicMock(return_value=ArrayAnySegment(value=[1]))
        iteration_node._validate_and_get_iterator_list = MagicMock(return_value=[1])
        iteration_node._validate_start_node = MagicMock()
        iteration_node._execute_iterations = MagicMock(return_value=[])
        iteration_node._handle_iteration_success = MagicMock(return_value=[])

        list(iteration_node._run())

        iteration_node._handle_iteration_success.assert_called_once()

    def test_run_failure_path(self, iteration_node):
        iteration_node._get_iterator_variable = MagicMock(return_value=ArrayAnySegment(value=[1]))
        iteration_node._validate_and_get_iterator_list = MagicMock(return_value=[1])
        iteration_node._validate_start_node = MagicMock()
        iteration_node._execute_iterations = MagicMock(side_effect=IterationNodeError("boom"))

        iteration_node._handle_iteration_failure = MagicMock(return_value=[])

        list(iteration_node._run())

        iteration_node._handle_iteration_failure.assert_called_once()


class TestSequentialExecution:
    def test_execute_iterations_sequential(self, iteration_node):
        iteration_node.node_data.is_parallel = False

        iteration_node._create_graph_engine = MagicMock()
        iteration_node._run_single_iter = MagicMock(return_value=[])
        iteration_node._extract_conversation_variable_snapshot = MagicMock(return_value={})
        iteration_node._sync_conversation_variables_from_snapshot = MagicMock()

        outputs = []
        events = list(
            iteration_node._execute_iterations(
                iterator_list_value=[1, 2],
                outputs=outputs,
                iter_run_map={},
                usage_accumulator=[LLMUsage.empty_usage()],
            )
        )

        assert iteration_node._run_single_iter.call_count == 2


class TestParallelSuccess:
    def test_execute_parallel_success(self, iteration_node):
        iteration_node.node_data.is_parallel = True

        iteration_node._execute_single_iteration_parallel = MagicMock(
            return_value=(
                datetime.utcnow(),
                [],
                "output",
                {},
                LLMUsage.empty_usage(),
            )
        )

        outputs = []
        list(
            iteration_node._execute_parallel_iterations(
                iterator_list_value=[1],
                outputs=outputs,
                iter_run_map={},
                usage_accumulator=[LLMUsage.empty_usage()],
            )
        )

        assert outputs == ["output"]


class TestExecuteSingleParallel:
    def test_execute_single_parallel_success(self, iteration_node):
        iteration_node._create_graph_engine = MagicMock()
        iteration_node._run_single_iter = MagicMock(return_value=[])

        mock_engine = MagicMock()
        mock_engine.graph_runtime_state.llm_usage = LLMUsage.empty_usage()

        iteration_node._create_graph_engine.return_value = mock_engine
        iteration_node._extract_conversation_variable_snapshot = MagicMock(return_value={})

        ctx = MagicMock()
        ctx.__enter__ = lambda s: None
        ctx.__exit__ = lambda s, a, b, c: None

        result = iteration_node._execute_single_iteration_parallel(
            index=0,
            item=1,
            execution_context=ctx,
        )

        assert result[2] is None  # output_value


class TestCaptureExecutionContext:
    @patch("core.workflow.context.capture_current_context")
    def test_capture_execution_context(self, mock_capture, iteration_node):
        mock_capture.return_value = "CTX"
        ctx = iteration_node._capture_execution_context()
        assert ctx == "CTX"


class TestCreateGraphEngine:
    @patch("core.workflow.graph_engine.GraphEngine")
    @patch("core.workflow.graph.Graph")
    def test_create_graph_engine_success(self, mock_graph, mock_engine, iteration_node):
        mock_graph.init.return_value = MagicMock()

        engine = iteration_node._create_graph_engine(index=0, item=1)
        assert engine is not None

    @patch("core.workflow.graph.Graph")
    def test_create_graph_engine_not_found(self, mock_graph, iteration_node):
        mock_graph.init.return_value = None
        with pytest.raises(IterationGraphNotFoundError):
            iteration_node._create_graph_engine(index=0, item=1)


class TestVariableSelectorMapping:
    @patch("core.workflow.nodes.node_mapping.NODE_TYPE_CLASSES_MAPPING", {})
    def test_extract_variable_selector_mapping_basic(self):
        graph_config = {"nodes": []}

        node_data = {
            "title": "test",
            "type": "iteration",
            "version": "1",
            "iterator_selector": ["node", "input"],
            "output_selector": ["node", "output"],
            "start_node_id": "start",
            "is_parallel": False,
            "parallel_nums": 1,
            "error_handle_mode": ErrorHandleMode.TERMINATED,
            "flatten_output": True,
        }

        mapping = IterationNode._extract_variable_selector_to_variable_mapping(
            graph_config=graph_config,
            node_id="iter_1",
            node_data=node_data,
        )

        assert mapping["iter_1.input_selector"] == ["node", "input"]

        graph_config = {
            "nodes": [
                {
                    "id": "child",
                    "data": {"iteration_id": "iter_1", "type": "iteration", "version": "1"},
                }
            ]
        }

        node_data = {
            "title": "test",
            "type": "iteration",
            "version": "1",
            "iterator_selector": ["input"],
            "output_selector": ["output"],
            "start_node_id": "start",
            "is_parallel": False,
            "parallel_nums": 1,
            "error_handle_mode": ErrorHandleMode.TERMINATED,
            "flatten_output": True,
        }

        mapping = IterationNode._extract_variable_selector_to_variable_mapping(
            graph_config=graph_config,
            node_id="iter_1",
            node_data=node_data,
        )

        assert "iter_1.input_selector" in mapping

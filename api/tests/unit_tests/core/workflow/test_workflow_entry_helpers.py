from collections import UserString
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, sentinel

import pytest

from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.model_manager import ModelInstance
from core.workflow import workflow_entry
from core.workflow.system_variables import default_system_variables
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import NodeType, WorkflowNodeExecutionStatus
from graphon.errors import WorkflowNodeRunFailedError
from graphon.file import File, FileTransferMethod, FileType
from graphon.graph import Graph
from graphon.graph_events import GraphRunFailedEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from graphon.nodes import BuiltinNodeTypes
from graphon.nodes.base.node import Node
from graphon.runtime import ChildGraphNotFoundError, VariablePool
from graphon.variables.variables import StringVariable
from tests.workflow_test_utils import build_test_graph_init_params, build_test_variable_pool


def _build_typed_node_config(node_type: NodeType):
    return {"id": "node-id", "data": BaseNodeData(type=node_type)}


def _build_wrapped_model_instance() -> tuple[SimpleNamespace, ModelInstance]:
    raw_model_instance = ModelInstance.__new__(ModelInstance)
    return SimpleNamespace(_model_instance=raw_model_instance), raw_model_instance


class _FakeModelNodeMixin:
    @classmethod
    def version(cls) -> str:
        return "1"

    def post_init(self) -> None:
        self.model_instance, self.raw_model_instance = _build_wrapped_model_instance()
        self.usage_snapshot = LLMUsage.empty_usage()
        self.usage_snapshot.total_tokens = 1

    def _run(self) -> NodeRunResult:
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            llm_usage=self.usage_snapshot,
        )


class _FakeLLMNode(_FakeModelNodeMixin, Node[BaseNodeData]):
    node_type = BuiltinNodeTypes.LLM


class _FakeQuestionClassifierNode(_FakeModelNodeMixin, Node[BaseNodeData]):
    node_type = BuiltinNodeTypes.QUESTION_CLASSIFIER


class TestWorkflowChildEngineBuilder:
    @pytest.mark.parametrize(
        ("graph_config", "node_id", "expected"),
        [
            ({"nodes": [{"id": "root"}]}, "root", True),
            ({"nodes": [{"id": "root"}]}, "other", False),
            ({"nodes": "invalid"}, "root", None),
            ({"nodes": ["invalid"]}, "root", None),
        ],
    )
    def test_has_node_id(self, graph_config, node_id, expected):
        result = workflow_entry._WorkflowChildEngineBuilder._has_node_id(graph_config, node_id)

        assert result is expected

    def test_build_child_engine_raises_when_root_node_is_missing(self):
        builder = workflow_entry._WorkflowChildEngineBuilder()
        graph_init_params = SimpleNamespace(graph_config={"nodes": []})
        parent_graph_runtime_state = SimpleNamespace(
            execution_context=sentinel.execution_context,
            variable_pool=sentinel.variable_pool,
        )

        with patch.object(workflow_entry, "DifyNodeFactory", return_value=sentinel.factory):
            with pytest.raises(ChildGraphNotFoundError, match="child graph root node 'missing' not found"):
                builder.build_child_engine(
                    workflow_id="workflow-id",
                    graph_init_params=graph_init_params,
                    parent_graph_runtime_state=parent_graph_runtime_state,
                    root_node_id="missing",
                )

    def test_build_child_engine_constructs_graph_engine_with_quota_layer_only(self):
        builder = workflow_entry._WorkflowChildEngineBuilder()
        graph_init_params = SimpleNamespace(graph_config={"nodes": [{"id": "root"}]})
        parent_graph_runtime_state = SimpleNamespace(
            execution_context=sentinel.execution_context,
            variable_pool=sentinel.parent_variable_pool,
        )
        child_graph = sentinel.child_graph
        child_graph_runtime_state = sentinel.child_graph_runtime_state
        child_engine = MagicMock()

        with (
            patch.object(workflow_entry.time, "perf_counter", return_value=123.0),
            patch.object(
                workflow_entry,
                "GraphRuntimeState",
                return_value=child_graph_runtime_state,
            ) as graph_runtime_state_cls,
            patch.object(workflow_entry, "DifyNodeFactory", return_value=sentinel.factory) as dify_node_factory,
            patch.object(workflow_entry.Graph, "init", return_value=child_graph) as graph_init,
            patch.object(workflow_entry, "GraphEngine", return_value=child_engine) as graph_engine_cls,
            patch.object(workflow_entry, "GraphEngineConfig", return_value=sentinel.graph_engine_config),
            patch.object(workflow_entry, "InMemoryChannel", return_value=sentinel.command_channel),
            patch.object(workflow_entry, "LLMQuotaLayer", return_value=sentinel.llm_quota_layer),
        ):
            result = builder.build_child_engine(
                workflow_id="workflow-id",
                graph_init_params=graph_init_params,
                parent_graph_runtime_state=parent_graph_runtime_state,
                root_node_id="root",
                variable_pool=sentinel.child_variable_pool,
            )

        assert result is child_engine
        graph_runtime_state_cls.assert_called_once_with(
            variable_pool=sentinel.child_variable_pool,
            start_at=123.0,
            execution_context=sentinel.execution_context,
        )
        dify_node_factory.assert_called_once_with(
            graph_init_params=graph_init_params,
            graph_runtime_state=child_graph_runtime_state,
        )
        graph_init.assert_called_once_with(
            graph_config={"nodes": [{"id": "root"}]},
            node_factory=sentinel.factory,
            root_node_id="root",
        )
        graph_engine_cls.assert_called_once_with(
            workflow_id="workflow-id",
            graph=child_graph,
            graph_runtime_state=child_graph_runtime_state,
            command_channel=sentinel.command_channel,
            config=sentinel.graph_engine_config,
            child_engine_builder=builder,
        )
        assert child_engine.layer.call_args_list == [((sentinel.llm_quota_layer,), {})]

    @pytest.mark.parametrize("node_cls", [_FakeLLMNode, _FakeQuestionClassifierNode])
    def test_build_child_engine_runs_llm_quota_layer_for_child_model_nodes(self, node_cls):
        builder = workflow_entry._WorkflowChildEngineBuilder()
        graph_init_params = build_test_graph_init_params(
            graph_config={"nodes": [{"id": "root"}], "edges": []},
        )
        parent_graph_runtime_state = SimpleNamespace(
            execution_context=nullcontext(None),
            variable_pool=build_test_variable_pool(),
        )
        created_node: dict[str, _FakeLLMNode | _FakeQuestionClassifierNode] = {}

        def build_graph(*, graph_config, node_factory, root_node_id):
            _ = graph_config
            node = node_cls(
                node_id=root_node_id,
                config=BaseNodeData(
                    type=node_cls.node_type,
                    title="Child Model",
                ),
                graph_init_params=node_factory.graph_init_params,
                graph_runtime_state=node_factory.graph_runtime_state,
            )
            created_node["node"] = node
            return Graph(
                nodes={root_node_id: node},
                edges={},
                in_edges={},
                out_edges={},
                root_node=node,
            )

        with (
            patch.object(
                workflow_entry,
                "DifyNodeFactory",
                side_effect=lambda graph_init_params, graph_runtime_state: SimpleNamespace(
                    graph_init_params=graph_init_params,
                    graph_runtime_state=graph_runtime_state,
                ),
            ),
            patch.object(workflow_entry.Graph, "init", side_effect=build_graph),
            patch("core.app.workflow.layers.llm_quota.ensure_llm_quota_available") as ensure_quota,
            patch("core.app.workflow.layers.llm_quota.deduct_llm_quota") as deduct_quota,
        ):
            child_engine = builder.build_child_engine(
                workflow_id="workflow-id",
                graph_init_params=graph_init_params,
                parent_graph_runtime_state=parent_graph_runtime_state,
                root_node_id="root",
            )
            list(child_engine.run())

        node = created_node["node"]
        ensure_quota.assert_called_once_with(model_instance=node.raw_model_instance)
        deduct_quota.assert_called_once_with(
            tenant_id="tenant",
            model_instance=node.raw_model_instance,
            usage=node.usage_snapshot,
        )


class TestWorkflowEntryInit:
    def test_rejects_call_depth_above_limit(self):
        call_depth = workflow_entry.dify_config.WORKFLOW_CALL_MAX_DEPTH + 1

        with pytest.raises(ValueError, match="Max workflow call depth"):
            workflow_entry.WorkflowEntry(
                tenant_id="tenant-id",
                app_id="app-id",
                workflow_id="workflow-id",
                graph_config={"nodes": [], "edges": []},
                graph=sentinel.graph,
                user_id="user-id",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=call_depth,
                variable_pool=sentinel.variable_pool,
                graph_runtime_state=sentinel.graph_runtime_state,
            )

    def test_applies_debug_and_observability_layers(self):
        graph_engine = MagicMock()
        graph_runtime_state = SimpleNamespace(execution_context=None)
        debug_layer = sentinel.debug_layer
        execution_limits_layer = sentinel.execution_limits_layer
        llm_quota_layer = sentinel.llm_quota_layer
        observability_layer = sentinel.observability_layer

        with (
            patch.object(workflow_entry.dify_config, "DEBUG", True),
            patch.object(workflow_entry.dify_config, "ENABLE_OTEL", False),
            patch.object(workflow_entry, "is_instrument_flag_enabled", return_value=True),
            patch.object(workflow_entry, "capture_current_context", return_value=sentinel.execution_context),
            patch.object(workflow_entry, "GraphEngine", return_value=graph_engine) as graph_engine_cls,
            patch.object(workflow_entry, "GraphEngineConfig", return_value=sentinel.graph_engine_config),
            patch.object(workflow_entry, "InMemoryChannel", return_value=sentinel.command_channel),
            patch.object(workflow_entry, "DebugLoggingLayer", return_value=debug_layer) as debug_logging_layer,
            patch.object(
                workflow_entry,
                "ExecutionLimitsLayer",
                return_value=execution_limits_layer,
            ) as execution_limits_layer_cls,
            patch.object(workflow_entry, "LLMQuotaLayer", return_value=llm_quota_layer),
            patch.object(workflow_entry, "ObservabilityLayer", return_value=observability_layer),
        ):
            entry = workflow_entry.WorkflowEntry(
                tenant_id="tenant-id",
                app_id="app-id",
                workflow_id="workflow-id-123456",
                graph_config={"nodes": [], "edges": []},
                graph=sentinel.graph,
                user_id="user-id",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
                variable_pool=sentinel.variable_pool,
                graph_runtime_state=graph_runtime_state,
                command_channel=None,
            )

        assert entry.command_channel is sentinel.command_channel
        graph_engine_cls.assert_called_once_with(
            workflow_id="workflow-id-123456",
            graph=sentinel.graph,
            graph_runtime_state=graph_runtime_state,
            command_channel=sentinel.command_channel,
            config=sentinel.graph_engine_config,
            child_engine_builder=entry._child_engine_builder,
        )
        assert graph_runtime_state.execution_context is sentinel.execution_context
        debug_logging_layer.assert_called_once_with(
            level="DEBUG",
            include_inputs=True,
            include_outputs=True,
            include_process_data=False,
            logger_name="GraphEngine.Debug.workflow",
        )
        execution_limits_layer_cls.assert_called_once_with(
            max_steps=workflow_entry.dify_config.WORKFLOW_MAX_EXECUTION_STEPS,
            max_time=workflow_entry.dify_config.WORKFLOW_MAX_EXECUTION_TIME,
        )
        assert graph_engine.layer.call_args_list == [
            ((debug_layer,), {}),
            ((execution_limits_layer,), {}),
            ((llm_quota_layer,), {}),
            ((observability_layer,), {}),
        ]


class TestWorkflowEntryRun:
    def test_run_swallows_generate_task_stopped_errors(self):
        entry = object.__new__(workflow_entry.WorkflowEntry)
        entry.graph_engine = MagicMock()
        entry.graph_engine.run.side_effect = GenerateTaskStoppedError()

        assert list(entry.run()) == []

    def test_run_emits_failed_event_for_unexpected_errors(self):
        entry = object.__new__(workflow_entry.WorkflowEntry)
        entry.graph_engine = MagicMock()
        entry.graph_engine.run.side_effect = RuntimeError("boom")

        events = list(entry.run())

        assert len(events) == 1
        assert isinstance(events[0], GraphRunFailedEvent)
        assert events[0].error == "boom"


class TestWorkflowEntrySingleStepRun:
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

        variable_pool = VariablePool(system_variables=default_system_variables(), user_inputs={})
        variable_loader = MagicMock()
        variable_loader.load_variables.return_value = [
            StringVariable(
                name="conversation_id",
                value="conv-1",
                selector=["sys", "conversation_id"],
            )
        ]

        with (
            patch.object(workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context),
            patch.object(
                workflow_entry,
                "GraphRuntimeState",
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
                "_traced_node_run",
                return_value=iter(["event"]),
            ),
        ):

            def _create_node(_node_config):
                assert variable_pool.get(["sys", "conversation_id"]) is not None
                return FakeLLMNode()

            dify_node_factory.return_value.create_node.side_effect = _create_node
            workflow = SimpleNamespace(
                tenant_id="tenant-id",
                app_id="app-id",
                id="workflow-id",
                graph_dict={"nodes": [], "edges": []},
                get_node_config_by_id=lambda _node_id: {
                    "id": "node-id",
                    "data": SimpleNamespace(type=BuiltinNodeTypes.LLM, version="1", memory=object()),
                },
            )

            node, generator = workflow_entry.WorkflowEntry.single_step_run(
                workflow=workflow,
                node_id="node-id",
                user_id="user-id",
                user_inputs={},
                variable_pool=variable_pool,
                variable_loader=variable_loader,
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

        with (
            patch.object(workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context),
            patch.object(workflow_entry, "GraphRuntimeState", return_value=sentinel.graph_runtime_state),
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
                "_traced_node_run",
                return_value=iter(["event"]),
            ),
        ):
            dify_node_factory.return_value.create_node.return_value = FakeNode()
            workflow = SimpleNamespace(
                tenant_id="tenant-id",
                app_id="app-id",
                id="workflow-id",
                graph_dict={"nodes": [], "edges": []},
                get_node_config_by_id=lambda _node_id: _build_typed_node_config(BuiltinNodeTypes.START),
            )

            node, generator = workflow_entry.WorkflowEntry.single_step_run(
                workflow=workflow,
                node_id="node-id",
                user_id="user-id",
                user_inputs={"question": "hello"},
                variable_pool=sentinel.variable_pool,
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

        with (
            patch.object(workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context),
            patch.object(workflow_entry, "GraphRuntimeState", return_value=sentinel.graph_runtime_state),
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
                "_traced_node_run",
                return_value=iter(["event"]),
            ),
        ):
            dify_node_factory.return_value.create_node.return_value = FakeDatasourceNode()
            workflow = SimpleNamespace(
                tenant_id="tenant-id",
                app_id="app-id",
                id="workflow-id",
                graph_dict={"nodes": [], "edges": []},
                get_node_config_by_id=lambda _node_id: _build_typed_node_config(BuiltinNodeTypes.DATASOURCE),
            )

            node, generator = workflow_entry.WorkflowEntry.single_step_run(
                workflow=workflow,
                node_id="node-id",
                user_id="user-id",
                user_inputs={"question": "hello"},
                variable_pool=sentinel.variable_pool,
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

    def test_wraps_traced_node_run_failures(self):
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

        with (
            patch.object(workflow_entry, "DifyGraphInitContext", return_value=sentinel.graph_init_context),
            patch.object(workflow_entry, "GraphRuntimeState", return_value=sentinel.graph_runtime_state),
            patch.object(workflow_entry, "build_dify_run_context", return_value={"_dify": "context"}),
            patch.object(workflow_entry.time, "perf_counter", return_value=123.0),
            patch.object(workflow_entry, "resolve_workflow_node_class", return_value=FakeNode),
            patch.object(workflow_entry.DifyNodeFactory, "from_graph_init_context") as dify_node_factory,
            patch.object(workflow_entry, "add_node_inputs_to_pool"),
            patch.object(workflow_entry, "load_into_variable_pool"),
            patch.object(workflow_entry.WorkflowEntry, "mapping_user_inputs_to_variable_pool"),
            patch.object(
                workflow_entry.WorkflowEntry,
                "_traced_node_run",
                side_effect=RuntimeError("boom"),
            ),
        ):
            dify_node_factory.return_value.create_node.return_value = FakeNode()
            workflow = SimpleNamespace(
                tenant_id="tenant-id",
                app_id="app-id",
                id="workflow-id",
                graph_dict={"nodes": [], "edges": []},
                get_node_config_by_id=lambda _node_id: _build_typed_node_config(BuiltinNodeTypes.START),
            )

            with pytest.raises(WorkflowNodeRunFailedError):
                workflow_entry.WorkflowEntry.single_step_run(
                    workflow=workflow,
                    node_id="node-id",
                    user_id="user-id",
                    user_inputs={},
                    variable_pool=sentinel.variable_pool,
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
            patch.object(workflow_entry, "GraphRuntimeState", return_value=sentinel.graph_runtime_state),
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
                "_traced_node_run",
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
            graph_runtime_state=sentinel.graph_runtime_state,
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
            patch.object(workflow_entry, "GraphRuntimeState", return_value=sentinel.graph_runtime_state),
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


class TestWorkflowEntryTracing:
    def test_traced_node_run_reports_success(self):
        layer = MagicMock()

        class FakeNode:
            def ensure_execution_id(self):
                return None

            def run(self):
                yield "event"

        with patch.object(workflow_entry, "ObservabilityLayer", return_value=layer):
            events = list(workflow_entry.WorkflowEntry._traced_node_run(FakeNode()))

        assert events == ["event"]
        layer.on_graph_start.assert_called_once_with()
        layer.on_node_run_start.assert_called_once()
        layer.on_node_run_end.assert_called_once_with(
            layer.on_node_run_start.call_args.args[0],
            None,
        )

    def test_traced_node_run_reports_errors(self):
        layer = MagicMock()

        class FakeNode:
            def ensure_execution_id(self):
                return None

            def run(self):
                raise RuntimeError("boom")
                yield

        with patch.object(workflow_entry, "ObservabilityLayer", return_value=layer):
            with pytest.raises(RuntimeError, match="boom"):
                list(workflow_entry.WorkflowEntry._traced_node_run(FakeNode()))

        assert isinstance(layer.on_node_run_end.call_args.args[1], RuntimeError)

import logging
import time
import uuid
from collections.abc import Generator, Mapping, Sequence
from typing import Any

from configs import dify_config
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.layers.observability import ObservabilityLayer
from core.app.workflow.node_factory import DifyNodeFactory
from core.file.models import File
from core.workflow.constants import ENVIRONMENT_VARIABLE_NODE_ID
from core.workflow.entities import GraphInitParams
from core.workflow.errors import WorkflowNodeRunFailedError
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_engine.layers import DebugLoggingLayer, ExecutionLimitsLayer
from core.workflow.graph_engine.protocols.command_channel import CommandChannel
from core.workflow.graph_events import GraphEngineEvent, GraphNodeEventBase, GraphRunFailedEvent
from core.workflow.nodes import NodeType
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.node_mapping import NODE_TYPE_CLASSES_MAPPING
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader, load_into_variable_pool
from extensions.otel.runtime import is_instrument_flag_enabled
from factories import file_factory
from models.enums import UserFrom
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class WorkflowEntry:
    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        graph_config: Mapping[str, Any],
        graph: Graph,
        user_id: str,
        user_from: UserFrom,
        invoke_from: InvokeFrom,
        call_depth: int,
        variable_pool: VariablePool,
        graph_runtime_state: GraphRuntimeState,
        command_channel: CommandChannel | None = None,
    ) -> None:
        """
        Init workflow entry
        :param tenant_id: tenant id
        :param app_id: app id
        :param workflow_id: workflow id
        :param workflow_type: workflow type
        :param graph_config: workflow graph config
        :param graph: workflow graph
        :param user_id: user id
        :param user_from: user from
        :param invoke_from: invoke from
        :param call_depth: call depth
        :param variable_pool: variable pool
        :param graph_runtime_state: pre-created graph runtime state
        :param command_channel: command channel for external control (optional, defaults to InMemoryChannel)
        :param thread_pool_id: thread pool id
        """
        # check call depth
        workflow_call_max_depth = dify_config.WORKFLOW_CALL_MAX_DEPTH
        if call_depth > workflow_call_max_depth:
            raise ValueError(f"Max workflow call depth {workflow_call_max_depth} reached.")

        # Use provided command channel or default to InMemoryChannel
        if command_channel is None:
            command_channel = InMemoryChannel()

        self.command_channel = command_channel
        self.graph_engine = GraphEngine(
            workflow_id=workflow_id,
            graph=graph,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
            config=GraphEngineConfig(
                min_workers=dify_config.GRAPH_ENGINE_MIN_WORKERS,
                max_workers=dify_config.GRAPH_ENGINE_MAX_WORKERS,
                scale_up_threshold=dify_config.GRAPH_ENGINE_SCALE_UP_THRESHOLD,
                scale_down_idle_time=dify_config.GRAPH_ENGINE_SCALE_DOWN_IDLE_TIME,
            ),
        )

        # Add debug logging layer when in debug mode
        if dify_config.DEBUG:
            logger.info("Debug mode enabled - adding DebugLoggingLayer to GraphEngine")
            debug_layer = DebugLoggingLayer(
                level="DEBUG",
                include_inputs=True,
                include_outputs=True,
                include_process_data=False,  # Process data can be very verbose
                logger_name=f"GraphEngine.Debug.{workflow_id[:8]}",  # Use workflow ID prefix for unique logger
            )
            self.graph_engine.layer(debug_layer)

        # Add execution limits layer
        limits_layer = ExecutionLimitsLayer(
            max_steps=dify_config.WORKFLOW_MAX_EXECUTION_STEPS, max_time=dify_config.WORKFLOW_MAX_EXECUTION_TIME
        )
        self.graph_engine.layer(limits_layer)

        # Add observability layer when OTel is enabled
        if dify_config.ENABLE_OTEL or is_instrument_flag_enabled():
            self.graph_engine.layer(ObservabilityLayer())

    def run(self) -> Generator[GraphEngineEvent, None, None]:
        graph_engine = self.graph_engine

        try:
            # run workflow
            generator = graph_engine.run()
            yield from generator
        except GenerateTaskStoppedError:
            pass
        except Exception as e:
            logger.exception("Unknown Error when workflow entry running")
            yield GraphRunFailedEvent(error=str(e))
            return

    @classmethod
    def single_step_run(
        cls,
        *,
        workflow: Workflow,
        node_id: str,
        user_id: str,
        user_inputs: Mapping[str, Any],
        variable_pool: VariablePool,
        variable_loader: VariableLoader = DUMMY_VARIABLE_LOADER,
    ) -> tuple[Node, Generator[GraphNodeEventBase, None, None]]:
        """
        Single step run workflow node
        :param workflow: Workflow instance
        :param node_id: node id
        :param user_id: user id
        :param user_inputs: user inputs
        :return:
        """
        node_config = dict(workflow.get_node_config_by_id(node_id))
        node_config_data = node_config.get("data", {})

        # Get node type
        node_type = NodeType(node_config_data.get("type"))

        # init graph init params and runtime state
        graph_init_params = GraphInitParams(
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
            graph_config=workflow.graph_dict,
            user_id=user_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        # init workflow run state
        node_factory = DifyNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        node = node_factory.create_node(node_config)
        node_cls = type(node)

        try:
            # variable selector to variable mapping
            variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                graph_config=workflow.graph_dict, config=node_config
            )
        except NotImplementedError:
            variable_mapping = {}

        # Loading missing variable from draft var here, and set it into
        # variable_pool.
        load_into_variable_pool(
            variable_loader=variable_loader,
            variable_pool=variable_pool,
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
        )
        if node_type != NodeType.DATASOURCE:
            cls.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id=workflow.tenant_id,
            )

        try:
            generator = cls._traced_node_run(node)
        except Exception as e:
            logger.exception(
                "error while running node, workflow_id=%s, node_id=%s, node_type=%s, node_version=%s",
                workflow.id,
                node.id,
                node.node_type,
                node.version(),
            )
            raise WorkflowNodeRunFailedError(node=node, err_msg=str(e))
        return node, generator

    @staticmethod
    def _create_single_node_graph(
        node_id: str,
        node_data: dict[str, Any],
        node_width: int = 114,
        node_height: int = 514,
    ) -> dict[str, Any]:
        """
        Create a minimal graph structure for testing a single node in isolation.

        :param node_id: ID of the target node
        :param node_data: configuration data for the target node
        :param node_width: width for UI layout (default: 200)
        :param node_height: height for UI layout (default: 100)
        :return: graph dictionary with start node and target node
        """
        node_config = {
            "id": node_id,
            "width": node_width,
            "height": node_height,
            "type": "custom",
            "data": node_data,
        }
        start_node_config = {
            "id": "start",
            "width": node_width,
            "height": node_height,
            "type": "custom",
            "data": {
                "type": NodeType.START,
                "title": "Start",
                "desc": "Start",
            },
        }
        return {
            "nodes": [start_node_config, node_config],
            "edges": [
                {
                    "source": "start",
                    "target": node_id,
                    "sourceHandle": "source",
                    "targetHandle": "target",
                }
            ],
        }

    @classmethod
    def run_free_node(
        cls, node_data: dict, node_id: str, tenant_id: str, user_id: str, user_inputs: dict[str, Any]
    ) -> tuple[Node, Generator[GraphNodeEventBase, None, None]]:
        """
        Run free node

        NOTE: only parameter_extractor/question_classifier are supported

        :param node_data: node data
        :param node_id: node id
        :param tenant_id: tenant id
        :param user_id: user id
        :param user_inputs: user inputs
        :return:
        """
        # Create a minimal graph for single node execution
        graph_dict = cls._create_single_node_graph(node_id, node_data)

        node_type = NodeType(node_data.get("type", ""))
        if node_type not in {NodeType.PARAMETER_EXTRACTOR, NodeType.QUESTION_CLASSIFIER}:
            raise ValueError(f"Node type {node_type} not supported")

        node_cls = NODE_TYPE_CLASSES_MAPPING[node_type]["1"]
        if not node_cls:
            raise ValueError(f"Node class not found for node type {node_type}")

        # init variable pool
        variable_pool = VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
            environment_variables=[],
        )

        # init graph init params and runtime state
        graph_init_params = GraphInitParams(
            tenant_id=tenant_id,
            app_id="",
            workflow_id="",
            graph_config=graph_dict,
            user_id=user_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        # init workflow run state
        node_config = {
            "id": node_id,
            "data": node_data,
        }
        node: Node = node_cls(
            id=str(uuid.uuid4()),
            config=node_config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        try:
            # variable selector to variable mapping
            try:
                variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                    graph_config=graph_dict, config=node_config
                )
            except NotImplementedError:
                variable_mapping = {}

            cls.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id=tenant_id,
            )

            generator = cls._traced_node_run(node)

            return node, generator
        except Exception as e:
            logger.exception(
                "error while running node, node_id=%s, node_type=%s, node_version=%s",
                node.id,
                node.node_type,
                node.version(),
            )
            raise WorkflowNodeRunFailedError(node=node, err_msg=str(e))

    @staticmethod
    def handle_special_values(value: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
        # NOTE(QuantumGhost): Avoid using this function in new code.
        # Keep values structured as long as possible and only convert to dict
        # immediately before serialization (e.g., JSON serialization) to maintain
        # data integrity and type information.
        result = WorkflowEntry._handle_special_values(value)
        return result if isinstance(result, Mapping) or result is None else dict(result)

    @staticmethod
    def _handle_special_values(value: Any):
        if value is None:
            return value
        if isinstance(value, dict):
            res = {}
            for k, v in value.items():
                res[k] = WorkflowEntry._handle_special_values(v)
            return res
        if isinstance(value, list):
            res_list = []
            for item in value:
                res_list.append(WorkflowEntry._handle_special_values(item))
            return res_list
        if isinstance(value, File):
            return value.to_dict()
        return value

    @classmethod
    def mapping_user_inputs_to_variable_pool(
        cls,
        *,
        variable_mapping: Mapping[str, Sequence[str]],
        user_inputs: Mapping[str, Any],
        variable_pool: VariablePool,
        tenant_id: str,
    ):
        # NOTE(QuantumGhost): This logic should remain synchronized with
        # the implementation of `load_into_variable_pool`, specifically the logic about
        # variable existence checking.

        # WARNING(QuantumGhost): The semantics of this method are not clearly defined,
        # and multiple parts of the codebase depend on its current behavior.
        # Modify with caution.
        for node_variable, variable_selector in variable_mapping.items():
            # fetch node id and variable key from node_variable
            node_variable_list = node_variable.split(".")
            if len(node_variable_list) < 1:
                raise ValueError(f"Invalid node variable {node_variable}")

            node_variable_key = ".".join(node_variable_list[1:])

            if (node_variable_key not in user_inputs and node_variable not in user_inputs) and not variable_pool.get(
                variable_selector
            ):
                raise ValueError(f"Variable key {node_variable} not found in user inputs.")

            # environment variable already exist in variable pool, not from user inputs
            if variable_pool.get(variable_selector) and variable_selector[0] == ENVIRONMENT_VARIABLE_NODE_ID:
                continue

            # fetch variable node id from variable selector
            variable_node_id = variable_selector[0]
            variable_key_list = variable_selector[1:]
            variable_key_list = list(variable_key_list)

            # get input value
            input_value = user_inputs.get(node_variable)
            if not input_value:
                input_value = user_inputs.get(node_variable_key)
            if input_value is None:
                continue

            if isinstance(input_value, dict) and "type" in input_value and "transfer_method" in input_value:
                input_value = file_factory.build_from_mapping(mapping=input_value, tenant_id=tenant_id)
            if (
                isinstance(input_value, list)
                and all(isinstance(item, dict) for item in input_value)
                and all("type" in item and "transfer_method" in item for item in input_value)
            ):
                input_value = file_factory.build_from_mappings(mappings=input_value, tenant_id=tenant_id)

            # append variable and value to variable pool
            if variable_node_id != ENVIRONMENT_VARIABLE_NODE_ID:
                # In single run, the input_value is set as the LLM's structured output value within the variable_pool.
                if len(variable_key_list) == 2 and variable_key_list[0] == "structured_output":
                    input_value = {variable_key_list[1]: input_value}
                    variable_key_list = variable_key_list[0:1]

                    # Support for a single node to reference multiple structured_output variables
                    current_variable = variable_pool.get([variable_node_id] + variable_key_list)
                    if current_variable and isinstance(current_variable.value, dict):
                        input_value = current_variable.value | input_value

                variable_pool.add([variable_node_id] + variable_key_list, input_value)

    @staticmethod
    def _traced_node_run(node: Node) -> Generator[GraphNodeEventBase, None, None]:
        """
        Wraps a node's run method with OpenTelemetry tracing and returns a generator.
        """
        # Wrap node.run() with ObservabilityLayer hooks to produce node-level spans
        layer = ObservabilityLayer()
        layer.on_graph_start()
        node.ensure_execution_id()

        def _gen():
            error: Exception | None = None
            layer.on_node_run_start(node)
            try:
                yield from node.run()
            except Exception as exc:
                error = exc
                raise
            finally:
                layer.on_node_run_end(node, error)

        return _gen()

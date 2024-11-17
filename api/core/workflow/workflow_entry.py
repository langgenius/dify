import logging
import time
import uuid
from collections.abc import Generator, Mapping, Sequence
from typing import Any, Optional, cast

from configs import dify_config
from core.app.app_config.entities import FileUploadConfig
from core.app.apps.base_app_queue_manager import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file.models import File, FileTransferMethod, ImageConfig
from core.workflow.callbacks import WorkflowCallback
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.errors import WorkflowNodeRunFailedError
from core.workflow.graph_engine.entities.event import GraphEngineEvent, GraphRunFailedEvent, InNodeEvent
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.nodes import NodeType
from core.workflow.nodes.base import BaseNode, BaseNodeData
from core.workflow.nodes.event import NodeEvent
from core.workflow.nodes.llm import LLMNodeData
from core.workflow.nodes.node_mapping import node_type_classes_mapping
from factories import file_factory
from models.enums import UserFrom
from models.workflow import (
    Workflow,
    WorkflowType,
)

logger = logging.getLogger(__name__)


class WorkflowEntry:
    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        workflow_type: WorkflowType,
        graph_config: Mapping[str, Any],
        graph: Graph,
        user_id: str,
        user_from: UserFrom,
        invoke_from: InvokeFrom,
        call_depth: int,
        variable_pool: VariablePool,
        thread_pool_id: Optional[str] = None,
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
        :param thread_pool_id: thread pool id
        """
        # check call depth
        workflow_call_max_depth = dify_config.WORKFLOW_CALL_MAX_DEPTH
        if call_depth > workflow_call_max_depth:
            raise ValueError("Max workflow call depth {} reached.".format(workflow_call_max_depth))

        # init workflow run state
        self.graph_engine = GraphEngine(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_type=workflow_type,
            workflow_id=workflow_id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=call_depth,
            graph=graph,
            graph_config=graph_config,
            variable_pool=variable_pool,
            max_execution_steps=dify_config.WORKFLOW_MAX_EXECUTION_STEPS,
            max_execution_time=dify_config.WORKFLOW_MAX_EXECUTION_TIME,
            thread_pool_id=thread_pool_id,
        )

    def run(
        self,
        *,
        callbacks: Sequence[WorkflowCallback],
    ) -> Generator[GraphEngineEvent, None, None]:
        """
        :param callbacks: workflow callbacks
        """
        graph_engine = self.graph_engine

        try:
            # run workflow
            generator = graph_engine.run()
            for event in generator:
                if callbacks:
                    for callback in callbacks:
                        callback.on_event(event=event)
                yield event
        except GenerateTaskStoppedError:
            pass
        except Exception as e:
            logger.exception("Unknown Error when workflow entry running")
            if callbacks:
                for callback in callbacks:
                    callback.on_event(event=GraphRunFailedEvent(error=str(e)))
            return

    @classmethod
    def single_step_run(
        cls, workflow: Workflow, node_id: str, user_id: str, user_inputs: dict
    ) -> tuple[BaseNode, Generator[NodeEvent | InNodeEvent, None, None]]:
        """
        Single step run workflow node
        :param workflow: Workflow instance
        :param node_id: node id
        :param user_id: user id
        :param user_inputs: user inputs
        :return:
        """
        # fetch node info from workflow graph
        graph = workflow.graph_dict
        if not graph:
            raise ValueError("workflow graph not found")

        nodes = graph.get("nodes")
        if not nodes:
            raise ValueError("nodes not found in workflow graph")

        # fetch node config from node id
        node_config = None
        for node in nodes:
            if node.get("id") == node_id:
                node_config = node
                break

        if not node_config:
            raise ValueError("node id not found in workflow graph")

        # Get node class
        node_type = NodeType(node_config.get("data", {}).get("type"))
        node_cls = node_type_classes_mapping.get(node_type)
        node_cls = cast(type[BaseNode], node_cls)

        if not node_cls:
            raise ValueError(f"Node class not found for node type {node_type}")

        # init variable pool
        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
            environment_variables=workflow.environment_variables,
        )

        # init graph
        graph = Graph.init(graph_config=workflow.graph_dict)

        # init workflow run state
        node_instance = node_cls(
            id=str(uuid.uuid4()),
            config=node_config,
            graph_init_params=GraphInitParams(
                tenant_id=workflow.tenant_id,
                app_id=workflow.app_id,
                workflow_type=WorkflowType.value_of(workflow.type),
                workflow_id=workflow.id,
                graph_config=workflow.graph_dict,
                user_id=user_id,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                call_depth=0,
            ),
            graph=graph,
            graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        )

        try:
            # variable selector to variable mapping
            try:
                variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                    graph_config=workflow.graph_dict, config=node_config
                )
            except NotImplementedError:
                variable_mapping = {}

            cls.mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id=workflow.tenant_id,
                node_type=node_type,
                node_data=node_instance.node_data,
            )

            # run node
            generator = node_instance.run()

            return node_instance, generator
        except Exception as e:
            raise WorkflowNodeRunFailedError(node_instance=node_instance, error=str(e))

    @staticmethod
    def handle_special_values(value: Optional[Mapping[str, Any]]) -> Mapping[str, Any] | None:
        return WorkflowEntry._handle_special_values(value)

    @staticmethod
    def _handle_special_values(value: Any) -> Any:
        if value is None:
            return value
        if isinstance(value, dict):
            res = {}
            for k, v in value.items():
                res[k] = WorkflowEntry._handle_special_values(v)
            return res
        if isinstance(value, list):
            res = []
            for item in value:
                res.append(WorkflowEntry._handle_special_values(item))
            return res
        if isinstance(value, File):
            return value.to_dict()
        return value

    @classmethod
    def mapping_user_inputs_to_variable_pool(
        cls,
        variable_mapping: Mapping[str, Sequence[str]],
        user_inputs: dict,
        variable_pool: VariablePool,
        tenant_id: str,
        node_type: NodeType,
        node_data: BaseNodeData,
    ) -> None:
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

            # fetch variable node id from variable selector
            variable_node_id = variable_selector[0]
            variable_key_list = variable_selector[1:]
            variable_key_list = cast(list[str], variable_key_list)

            # get input value
            input_value = user_inputs.get(node_variable)
            if not input_value:
                input_value = user_inputs.get(node_variable_key)

            # FIXME: temp fix for image type
            if node_type == NodeType.LLM:
                new_value = []
                if isinstance(input_value, list):
                    node_data = cast(LLMNodeData, node_data)

                    detail = node_data.vision.configs.detail if node_data.vision.configs else None

                    for item in input_value:
                        if isinstance(item, dict) and "type" in item and item["type"] == "image":
                            transfer_method = FileTransferMethod.value_of(item.get("transfer_method"))
                            mapping = {
                                "id": item.get("id"),
                                "transfer_method": transfer_method,
                                "upload_file_id": item.get("upload_file_id"),
                                "url": item.get("url"),
                            }
                            config = FileUploadConfig(image_config=ImageConfig(detail=detail) if detail else None)
                            file = file_factory.build_from_mapping(
                                mapping=mapping,
                                tenant_id=tenant_id,
                                config=config,
                            )
                            new_value.append(file)

                if new_value:
                    input_value = new_value

            # append variable and value to variable pool
            variable_pool.add([variable_node_id] + variable_key_list, input_value)

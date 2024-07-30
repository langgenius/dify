import logging
from collections.abc import Generator, Mapping, Sequence
from typing import Any, Optional, cast

from configs import dify_config
from core.app.app_config.entities import FileExtraConfig
from core.app.apps.base_app_queue_manager import GenerateTaskStoppedException
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file.file_obj import FileTransferMethod, FileType, FileVar
from core.workflow.callbacks.base_workflow_callback import WorkflowCallback
from core.workflow.entities.node_entities import NodeRunResult, NodeType, SystemVariable, UserFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.errors import WorkflowNodeRunFailedError
from core.workflow.graph_engine.entities.event import GraphEngineEvent, GraphRunFailedEvent
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.llm.entities import LLMNodeData
from core.workflow.nodes.node_mapping import node_classes
from models.workflow import (
    Workflow,
    WorkflowType,
)

logger = logging.getLogger(__name__)


class WorkflowEntry:
    def __init__(
            self,
            workflow: Workflow,
            user_id: str,
            user_from: UserFrom,
            invoke_from: InvokeFrom,
            user_inputs: Mapping[str, Any],
            system_inputs: Mapping[SystemVariable, Any],
            call_depth: int = 0
    ) -> None:
        """
        :param workflow: Workflow instance
        :param user_id: user id
        :param user_from: user from
        :param invoke_from: invoke from service-api, web-app, debugger, explore
        :param user_inputs: user variables inputs
        :param system_inputs: system inputs, like: query, files
        :param call_depth: call depth
        """
        # fetch workflow graph
        graph_config = workflow.graph_dict
        if not graph_config:
            raise ValueError('workflow graph not found')

        if 'nodes' not in graph_config or 'edges' not in graph_config:
            raise ValueError('nodes or edges not found in workflow graph')

        if not isinstance(graph_config.get('nodes'), list):
            raise ValueError('nodes in workflow graph must be a list')

        if not isinstance(graph_config.get('edges'), list):
            raise ValueError('edges in workflow graph must be a list')

        workflow_call_max_depth = dify_config.WORKFLOW_CALL_MAX_DEPTH
        if call_depth > workflow_call_max_depth:
            raise ValueError('Max workflow call depth {} reached.'.format(workflow_call_max_depth))

        # init graph
        graph = Graph.init(
            graph_config=graph_config
        )

        if not graph:
            raise ValueError('graph not found in workflow')

        # init variable pool
        variable_pool = VariablePool(
            system_variables=system_inputs,
            user_inputs=user_inputs,
            environment_variables=workflow.environment_variables,
        )

        # init workflow run state
        self.graph_engine = GraphEngine(
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            workflow_type=WorkflowType.value_of(workflow.type),
            workflow_id=workflow.id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=call_depth,
            graph=graph,
            graph_config=graph_config,
            variable_pool=variable_pool,
            max_execution_steps=dify_config.WORKFLOW_MAX_EXECUTION_STEPS,
            max_execution_time=dify_config.WORKFLOW_MAX_EXECUTION_TIME
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
                        callback.on_event(
                            graph=self.graph_engine.graph,
                            graph_init_params=graph_engine.init_params,
                            graph_runtime_state=graph_engine.graph_runtime_state,
                            event=event
                        )
                    yield event
        except GenerateTaskStoppedException:
            pass
        except Exception as e:
            if callbacks:
                for callback in callbacks:
                    callback.on_event(
                        graph=self.graph_engine.graph,
                        graph_init_params=graph_engine.init_params,
                        graph_runtime_state=graph_engine.graph_runtime_state,
                        event=GraphRunFailedEvent(
                            error=str(e)
                        )
                    )
            return

    def single_step_run(self, workflow: Workflow,
                        node_id: str,
                        user_id: str,
                        user_inputs: dict) -> tuple[BaseNode, NodeRunResult]:
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
            raise ValueError('workflow graph not found')

        nodes = graph.get('nodes')
        if not nodes:
            raise ValueError('nodes not found in workflow graph')

        # fetch node config from node id
        node_config = None
        for node in nodes:
            if node.get('id') == node_id:
                node_config = node
                break

        if not node_config:
            raise ValueError('node id not found in workflow graph')

        # Get node class
        node_type = NodeType.value_of(node_config.get('data', {}).get('type'))
        node_cls = node_classes.get(node_type)

        if not node_cls:
            raise ValueError(f'Node class not found for node type {node_type}')

        # init workflow run state
        node_instance = node_cls(
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
            user_id=user_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            config=node_config,
            workflow_call_depth=0
        )

        try:
            # init variable pool
            variable_pool = VariablePool(
                system_variables={},
                user_inputs={},
                environment_variables=workflow.environment_variables,
            )

            # variable selector to variable mapping
            try:
                variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(node_config)
            except NotImplementedError:
                variable_mapping = {}

            self._mapping_user_inputs_to_variable_pool(
                variable_mapping=variable_mapping,
                user_inputs=user_inputs,
                variable_pool=variable_pool,
                tenant_id=workflow.tenant_id,
                node_instance=node_instance
            )

            # run node TODO
            node_run_result = node_instance.run(
                variable_pool=variable_pool
            )

            # sign output files
            node_run_result.outputs = self.handle_special_values(node_run_result.outputs)
        except Exception as e:
            raise WorkflowNodeRunFailedError(
                node_id=node_instance.node_id,
                node_type=node_instance.node_type,
                node_title=node_instance.node_data.title,
                error=str(e)
            )

        return node_instance, node_run_result

    @classmethod
    def handle_special_values(cls, value: Optional[dict]) -> Optional[dict]:
        """
        Handle special values
        :param value: value
        :return:
        """
        if not value:
            return None

        new_value = value.copy()
        if isinstance(new_value, dict):
            for key, val in new_value.items():
                if isinstance(val, FileVar):
                    new_value[key] = val.to_dict()
                elif isinstance(val, list):
                    new_val = []
                    for v in val:
                        if isinstance(v, FileVar):
                            new_val.append(v.to_dict())
                        else:
                            new_val.append(v)

                    new_value[key] = new_val

        return new_value

    def _mapping_user_inputs_to_variable_pool(self,
                                              variable_mapping: dict,
                                              user_inputs: dict,
                                              variable_pool: VariablePool,
                                              tenant_id: str,
                                              node_instance: BaseNode):
        for variable_key, variable_selector in variable_mapping.items():
            if variable_key not in user_inputs and not variable_pool.get(variable_selector):
                raise ValueError(f'Variable key {variable_key} not found in user inputs.')

            # fetch variable node id from variable selector
            variable_node_id = variable_selector[0]
            variable_key_list = variable_selector[1:]

            # get value
            value = user_inputs.get(variable_key)

            # FIXME: temp fix for image type
            if node_instance.node_type == NodeType.LLM:
                new_value = []
                if isinstance(value, list):
                    node_data = node_instance.node_data
                    node_data = cast(LLMNodeData, node_data)

                    detail = node_data.vision.configs.detail if node_data.vision.configs else None

                    for item in value:
                        if isinstance(item, dict) and 'type' in item and item['type'] == 'image':
                            transfer_method = FileTransferMethod.value_of(item.get('transfer_method'))
                            file = FileVar(
                                tenant_id=tenant_id,
                                type=FileType.IMAGE,
                                transfer_method=transfer_method,
                                url=item.get('url') if transfer_method == FileTransferMethod.REMOTE_URL else None,
                                related_id=item.get(
                                    'upload_file_id') if transfer_method == FileTransferMethod.LOCAL_FILE else None,
                                extra_config=FileExtraConfig(image_config={'detail': detail} if detail else None),
                            )
                            new_value.append(file)

                if new_value:
                    value = new_value

            # append variable and value to variable pool
            variable_pool.add([variable_node_id] + variable_key_list, value)

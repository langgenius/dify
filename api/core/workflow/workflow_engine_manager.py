import json
import time
from datetime import datetime
from typing import Optional, Union

from core.workflow.callbacks.base_workflow_callback import BaseWorkflowCallback
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool, VariableValue
from core.workflow.entities.workflow_entities import WorkflowRunState
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.code.code_node import CodeNode
from core.workflow.nodes.direct_answer.direct_answer_node import DirectAnswerNode
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.http_request.http_request_node import HttpRequestNode
from core.workflow.nodes.if_else.if_else_node import IfElseNode
from core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node import KnowledgeRetrievalNode
from core.workflow.nodes.llm.llm_node import LLMNode
from core.workflow.nodes.question_classifier.question_classifier_node import QuestionClassifierNode
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode
from core.workflow.nodes.tool.tool_node import ToolNode
from core.workflow.nodes.variable_assigner.variable_assigner_node import VariableAssignerNode
from extensions.ext_database import db
from models.account import Account
from models.model import App, EndUser
from models.workflow import (
    CreatedByRole,
    Workflow,
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowRunStatus,
    WorkflowRunTriggeredFrom,
)

node_classes = {
    NodeType.START: StartNode,
    NodeType.END: EndNode,
    NodeType.DIRECT_ANSWER: DirectAnswerNode,
    NodeType.LLM: LLMNode,
    NodeType.KNOWLEDGE_RETRIEVAL: KnowledgeRetrievalNode,
    NodeType.IF_ELSE: IfElseNode,
    NodeType.CODE: CodeNode,
    NodeType.TEMPLATE_TRANSFORM: TemplateTransformNode,
    NodeType.QUESTION_CLASSIFIER: QuestionClassifierNode,
    NodeType.HTTP_REQUEST: HttpRequestNode,
    NodeType.TOOL: ToolNode,
    NodeType.VARIABLE_ASSIGNER: VariableAssignerNode,
}


class WorkflowEngineManager:
    def get_draft_workflow(self, app_model: App) -> Optional[Workflow]:
        """
        Get draft workflow
        """
        # fetch draft workflow by app_model
        workflow = db.session.query(Workflow).filter(
            Workflow.tenant_id == app_model.tenant_id,
            Workflow.app_id == app_model.id,
            Workflow.version == 'draft'
        ).first()

        # return draft workflow
        return workflow

    def get_published_workflow(self, app_model: App) -> Optional[Workflow]:
        """
        Get published workflow
        """
        if not app_model.workflow_id:
            return None

        # fetch published workflow by workflow_id
        return self.get_workflow(app_model, app_model.workflow_id)

    def get_workflow(self, app_model: App, workflow_id: str) -> Optional[Workflow]:
        """
        Get workflow
        """
        # fetch workflow by workflow_id
        workflow = db.session.query(Workflow).filter(
            Workflow.tenant_id == app_model.tenant_id,
            Workflow.app_id == app_model.id,
            Workflow.id == workflow_id
        ).first()

        # return workflow
        return workflow

    def get_default_configs(self) -> list[dict]:
        """
        Get default block configs
        """
        default_block_configs = []
        for node_type, node_class in node_classes.items():
            default_config = node_class.get_default_config()
            if default_config:
                default_block_configs.append({
                    'type': node_type.value,
                    'config': default_config
                })

        return default_block_configs

    def get_default_config(self, node_type: NodeType, filters: Optional[dict] = None) -> Optional[dict]:
        """
        Get default config of node.
        :param node_type: node type
        :param filters: filter by node config parameters.
        :return:
        """
        node_class = node_classes.get(node_type)
        if not node_class:
            return None

        default_config = node_class.get_default_config(filters=filters)
        if not default_config:
            return None

        return default_config

    def run_workflow(self, workflow: Workflow,
                     triggered_from: WorkflowRunTriggeredFrom,
                     user: Union[Account, EndUser],
                     user_inputs: dict,
                     system_inputs: Optional[dict] = None,
                     callbacks: list[BaseWorkflowCallback] = None) -> None:
        """
        Run workflow
        :param workflow: Workflow instance
        :param triggered_from: triggered from
        :param user: account or end user
        :param user_inputs: user variables inputs
        :param system_inputs: system inputs, like: query, files
        :param callbacks: workflow callbacks
        :return:
        """
        # fetch workflow graph
        graph = workflow.graph_dict
        if not graph:
            raise ValueError('workflow graph not found')

        if 'nodes' not in graph or 'edges' not in graph:
            raise ValueError('nodes or edges not found in workflow graph')

        if isinstance(graph.get('nodes'), list):
            raise ValueError('nodes in workflow graph must be a list')

        if isinstance(graph.get('edges'), list):
            raise ValueError('edges in workflow graph must be a list')

        # init workflow run
        workflow_run = self._init_workflow_run(
            workflow=workflow,
            triggered_from=triggered_from,
            user=user,
            user_inputs=user_inputs,
            system_inputs=system_inputs,
            callbacks=callbacks
        )

        # init workflow run state
        workflow_run_state = WorkflowRunState(
            workflow_run=workflow_run,
            start_at=time.perf_counter(),
            variable_pool=VariablePool(
                system_variables=system_inputs,
            )
        )

        try:
            predecessor_node = None
            while True:
                # get next node, multiple target nodes in the future
                next_node = self._get_next_node(
                    graph=graph,
                    predecessor_node=predecessor_node,
                    callbacks=callbacks
                )

                if not next_node:
                    break

                # max steps 30 reached
                if len(workflow_run_state.workflow_node_executions) > 30:
                    raise ValueError('Max steps 30 reached.')

                # or max execution time 10min reached
                if self._is_timed_out(start_at=workflow_run_state.start_at, max_execution_time=600):
                    raise ValueError('Max execution time 10min reached.')

                # run workflow, run multiple target nodes in the future
                self._run_workflow_node(
                    workflow_run_state=workflow_run_state,
                    node=next_node,
                    predecessor_node=predecessor_node,
                    callbacks=callbacks
                )

                if next_node.node_type == NodeType.END:
                    break

                predecessor_node = next_node

            if not predecessor_node and not next_node:
                self._workflow_run_failed(
                    workflow_run_state=workflow_run_state,
                    error='Start node not found in workflow graph.',
                    callbacks=callbacks
                )
                return
        except Exception as e:
            self._workflow_run_failed(
                workflow_run_state=workflow_run_state,
                error=str(e),
                callbacks=callbacks
            )
            return

        # workflow run success
        self._workflow_run_success(
            workflow_run_state=workflow_run_state,
            callbacks=callbacks
        )

    def _init_workflow_run(self, workflow: Workflow,
                           triggered_from: WorkflowRunTriggeredFrom,
                           user: Union[Account, EndUser],
                           user_inputs: dict,
                           system_inputs: Optional[dict] = None,
                           callbacks: list[BaseWorkflowCallback] = None) -> WorkflowRun:
        """
        Init workflow run
        :param workflow: Workflow instance
        :param triggered_from: triggered from
        :param user: account or end user
        :param user_inputs: user variables inputs
        :param system_inputs: system inputs, like: query, files
        :param callbacks: workflow callbacks
        :return:
        """
        try:
            db.session.begin()

            max_sequence = db.session.query(db.func.max(WorkflowRun.sequence_number)) \
                               .filter(WorkflowRun.tenant_id == workflow.tenant_id) \
                               .filter(WorkflowRun.app_id == workflow.app_id) \
                               .for_update() \
                               .scalar() or 0
            new_sequence_number = max_sequence + 1

            # init workflow run
            workflow_run = WorkflowRun(
                tenant_id=workflow.tenant_id,
                app_id=workflow.app_id,
                sequence_number=new_sequence_number,
                workflow_id=workflow.id,
                type=workflow.type,
                triggered_from=triggered_from.value,
                version=workflow.version,
                graph=workflow.graph,
                inputs=json.dumps({**user_inputs, **system_inputs}),
                status=WorkflowRunStatus.RUNNING.value,
                created_by_role=(CreatedByRole.ACCOUNT.value
                                 if isinstance(user, Account) else CreatedByRole.END_USER.value),
                created_by=user.id
            )

            db.session.add(workflow_run)
            db.session.commit()
        except:
            db.session.rollback()
            raise

        if callbacks:
            for callback in callbacks:
                callback.on_workflow_run_started(workflow_run)

        return workflow_run

    def _workflow_run_success(self, workflow_run_state: WorkflowRunState,
                              callbacks: list[BaseWorkflowCallback] = None) -> WorkflowRun:
        """
        Workflow run success
        :param workflow_run_state: workflow run state
        :param callbacks: workflow callbacks
        :return:
        """
        workflow_run = workflow_run_state.workflow_run
        workflow_run.status = WorkflowRunStatus.SUCCEEDED.value

        # fetch last workflow_node_executions
        last_workflow_node_execution = workflow_run_state.workflow_node_executions[-1]
        if last_workflow_node_execution:
            workflow_run.outputs = json.dumps(last_workflow_node_execution.node_run_result.outputs)

        workflow_run.elapsed_time = time.perf_counter() - workflow_run_state.start_at
        workflow_run.total_tokens = workflow_run_state.total_tokens
        workflow_run.total_steps = len(workflow_run_state.workflow_node_executions)
        workflow_run.finished_at = datetime.utcnow()

        db.session.commit()

        if callbacks:
            for callback in callbacks:
                callback.on_workflow_run_finished(workflow_run)

        return workflow_run

    def _workflow_run_failed(self, workflow_run_state: WorkflowRunState,
                             error: str,
                             callbacks: list[BaseWorkflowCallback] = None) -> WorkflowRun:
        """
        Workflow run failed
        :param workflow_run_state: workflow run state
        :param error: error message
        :param callbacks: workflow callbacks
        :return:
        """
        workflow_run = workflow_run_state.workflow_run
        workflow_run.status = WorkflowRunStatus.FAILED.value
        workflow_run.error = error
        workflow_run.elapsed_time = time.perf_counter() - workflow_run_state.start_at
        workflow_run.total_tokens = workflow_run_state.total_tokens
        workflow_run.total_steps = len(workflow_run_state.workflow_node_executions)
        workflow_run.finished_at = datetime.utcnow()

        db.session.commit()

        if callbacks:
            for callback in callbacks:
                callback.on_workflow_run_finished(workflow_run)

        return workflow_run

    def _get_next_node(self, graph: dict,
                       predecessor_node: Optional[BaseNode] = None,
                       callbacks: list[BaseWorkflowCallback] = None) -> Optional[BaseNode]:
        """
        Get next node
        multiple target nodes in the future.
        :param graph: workflow graph
        :param predecessor_node: predecessor node
        :param callbacks: workflow callbacks
        :return:
        """
        nodes = graph.get('nodes')
        if not nodes:
            return None

        if not predecessor_node:
            for node_config in nodes:
                if node_config.get('type') == NodeType.START.value:
                    return StartNode(config=node_config)
        else:
            edges = graph.get('edges')
            source_node_id = predecessor_node.node_id

            # fetch all outgoing edges from source node
            outgoing_edges = [edge for edge in edges if edge.get('source') == source_node_id]
            if not outgoing_edges:
                return None

            # fetch target node id from outgoing edges
            outgoing_edge = None
            source_handle = predecessor_node.node_run_result.edge_source_handle
            if source_handle:
                for edge in outgoing_edges:
                    if edge.get('source_handle') and edge.get('source_handle') == source_handle:
                        outgoing_edge = edge
                        break
            else:
                outgoing_edge = outgoing_edges[0]

            if not outgoing_edge:
                return None

            target_node_id = outgoing_edge.get('target')

            # fetch target node from target node id
            target_node_config = None
            for node in nodes:
                if node.get('id') == target_node_id:
                    target_node_config = node
                    break

            if not target_node_config:
                return None

            # get next node
            target_node = node_classes.get(NodeType.value_of(target_node_config.get('type')))

            return target_node(
                config=target_node_config,
                callbacks=callbacks
            )

    def _is_timed_out(self, start_at: float, max_execution_time: int) -> bool:
        """
        Check timeout
        :param start_at: start time
        :param max_execution_time: max execution time
        :return:
        """
        # TODO check queue is stopped
        return time.perf_counter() - start_at > max_execution_time

    def _run_workflow_node(self, workflow_run_state: WorkflowRunState,
                           node: BaseNode,
                           predecessor_node: Optional[BaseNode] = None,
                           callbacks: list[BaseWorkflowCallback] = None) -> WorkflowNodeExecution:
        # init workflow node execution
        start_at = time.perf_counter()
        workflow_node_execution = self._init_node_execution_from_workflow_run(
            workflow_run_state=workflow_run_state,
            node=node,
            predecessor_node=predecessor_node,
        )

        # add to workflow node executions
        workflow_run_state.workflow_node_executions.append(workflow_node_execution)

        # run node, result must have inputs, process_data, outputs, execution_metadata
        node_run_result = node.run(
            variable_pool=workflow_run_state.variable_pool
        )

        if node_run_result.status == WorkflowNodeExecutionStatus.FAILED:
            # node run failed
            self._workflow_node_execution_failed(
                workflow_node_execution=workflow_node_execution,
                start_at=start_at,
                error=node_run_result.error,
                callbacks=callbacks
            )
            raise ValueError(f"Node {node.node_data.title} run failed: {node_run_result.error}")

        # node run success
        self._workflow_node_execution_success(
            workflow_node_execution=workflow_node_execution,
            start_at=start_at,
            result=node_run_result,
            callbacks=callbacks
        )

        for variable_key, variable_value in node_run_result.outputs.items():
            # append variables to variable pool recursively
            self._append_variables_recursively(
                variable_pool=workflow_run_state.variable_pool,
                node_id=node.node_id,
                variable_key_list=[variable_key],
                variable_value=variable_value
            )

        if node_run_result.metadata.get('total_tokens'):
            workflow_run_state.total_tokens += int(node_run_result.metadata.get('total_tokens'))

        return workflow_node_execution

    def _init_node_execution_from_workflow_run(self, workflow_run_state: WorkflowRunState,
                                               node: BaseNode,
                                               predecessor_node: Optional[BaseNode] = None,
                                               callbacks: list[BaseWorkflowCallback] = None) -> WorkflowNodeExecution:
        """
        Init workflow node execution from workflow run
        :param workflow_run_state: workflow run state
        :param node: current node
        :param predecessor_node: predecessor node if exists
        :param callbacks: workflow callbacks
        :return:
        """
        workflow_run = workflow_run_state.workflow_run

        # init workflow node execution
        workflow_node_execution = WorkflowNodeExecution(
            tenant_id=workflow_run.tenant_id,
            app_id=workflow_run.app_id,
            workflow_id=workflow_run.workflow_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=workflow_run.id,
            predecessor_node_id=predecessor_node.node_id if predecessor_node else None,
            index=len(workflow_run_state.workflow_node_executions) + 1,
            node_id=node.node_id,
            node_type=node.node_type.value,
            title=node.node_data.title,
            type=node.node_type.value,
            status=WorkflowNodeExecutionStatus.RUNNING.value,
            created_by_role=workflow_run.created_by_role,
            created_by=workflow_run.created_by
        )

        db.session.add(workflow_node_execution)
        db.session.commit()

        if callbacks:
            for callback in callbacks:
                callback.on_workflow_node_execute_started(workflow_node_execution)

        return workflow_node_execution

    def _workflow_node_execution_success(self, workflow_node_execution: WorkflowNodeExecution,
                                         start_at: float,
                                         result: NodeRunResult,
                                         callbacks: list[BaseWorkflowCallback] = None) -> WorkflowNodeExecution:
        """
        Workflow node execution success
        :param workflow_node_execution: workflow node execution
        :param start_at: start time
        :param result: node run result
        :param callbacks: workflow callbacks
        :return:
        """
        workflow_node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED.value
        workflow_node_execution.elapsed_time = time.perf_counter() - start_at
        workflow_node_execution.inputs = json.dumps(result.inputs)
        workflow_node_execution.process_data = json.dumps(result.process_data)
        workflow_node_execution.outputs = json.dumps(result.outputs)
        workflow_node_execution.execution_metadata = json.dumps(result.metadata)
        workflow_node_execution.finished_at = datetime.utcnow()

        db.session.commit()

        if callbacks:
            for callback in callbacks:
                callback.on_workflow_node_execute_finished(workflow_node_execution)

        return workflow_node_execution

    def _workflow_node_execution_failed(self, workflow_node_execution: WorkflowNodeExecution,
                                        start_at: float,
                                        error: str,
                                        callbacks: list[BaseWorkflowCallback] = None) -> WorkflowNodeExecution:
        """
        Workflow node execution failed
        :param workflow_node_execution: workflow node execution
        :param start_at: start time
        :param error: error message
        :param callbacks: workflow callbacks
        :return:
        """
        workflow_node_execution.status = WorkflowNodeExecutionStatus.FAILED.value
        workflow_node_execution.error = error
        workflow_node_execution.elapsed_time = time.perf_counter() - start_at
        workflow_node_execution.finished_at = datetime.utcnow()

        db.session.commit()

        if callbacks:
            for callback in callbacks:
                callback.on_workflow_node_execute_finished(workflow_node_execution)

        return workflow_node_execution

    def _append_variables_recursively(self, variable_pool: VariablePool,
                                      node_id: str,
                                      variable_key_list: list[str],
                                      variable_value: VariableValue):
        """
        Append variables recursively
        :param variable_pool: variable pool
        :param node_id: node id
        :param variable_key_list: variable key list
        :param variable_value: variable value
        :return:
        """
        variable_pool.append_variable(
            node_id=node_id,
            variable_key_list=variable_key_list,
            value=variable_value
        )

        # if variable_value is a dict, then recursively append variables
        if isinstance(variable_value, dict):
            for key, value in variable_value.items():
                # construct new key list
                new_key_list = variable_key_list + [key]
                self._append_variables_recursively(
                    variable_pool=variable_pool,
                    node_id=node_id,
                    variable_key_list=new_key_list,
                    variable_value=value
                )

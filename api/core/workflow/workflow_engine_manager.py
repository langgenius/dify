import json
from collections.abc import Generator
from typing import Optional, Union

from core.workflow.callbacks.base_callback import BaseWorkflowCallback
from core.workflow.entities.node_entities import NodeType
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
from models.workflow import CreatedByRole, Workflow, WorkflowRun, WorkflowRunStatus, WorkflowRunTriggeredFrom

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

    def run_workflow(self, app_model: App,
                     workflow: Workflow,
                     triggered_from: WorkflowRunTriggeredFrom,
                     user: Union[Account, EndUser],
                     user_inputs: dict,
                     system_inputs: Optional[dict] = None,
                     callbacks: list[BaseWorkflowCallback] = None) -> Generator:
        """
        Run workflow
        :param app_model: App instance
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

        # init workflow run
        workflow_run = self._init_workflow_run(
            workflow=workflow,
            triggered_from=triggered_from,
            user=user,
            user_inputs=user_inputs,
            system_inputs=system_inputs
        )

        if callbacks:
            for callback in callbacks:
                callback.on_workflow_run_started(workflow_run)

        pass

    def _init_workflow_run(self, workflow: Workflow,
                           triggered_from: WorkflowRunTriggeredFrom,
                           user: Union[Account, EndUser],
                           user_inputs: dict,
                           system_inputs: Optional[dict] = None) -> WorkflowRun:
        """
        Init workflow run
        :param workflow: Workflow instance
        :param triggered_from: triggered from
        :param user: account or end user
        :param user_inputs: user variables inputs
        :param system_inputs: system inputs, like: query, files
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
                created_by_id=user.id
            )

            db.session.add(workflow_run)
            db.session.commit()
        except:
            db.session.rollback()
            raise

        return workflow_run

    def _get_entry_node(self, graph: dict) -> Optional[StartNode]:
        """
        Get entry node
        :param graph: workflow graph
        :return:
        """
        nodes = graph.get('nodes')
        if not nodes:
            return None

        for node_config in nodes.items():
            if node_config.get('type') == NodeType.START.value:
                return StartNode(config=node_config)

        return None

import json
from typing import Optional

from core.application_manager import ApplicationManager
from core.entities.application_entities import ModelConfigEntity, PromptTemplateEntity, FileUploadEntity, \
    ExternalDataVariableEntity, DatasetEntity, VariableEntity
from core.model_runtime.utils import helper
from core.workflow.entities.NodeEntities import NodeType
from core.workflow.nodes.end.entities import EndNodeOutputType
from extensions.ext_database import db
from models.account import Account
from models.model import App, AppMode, ChatbotAppEngine
from models.workflow import Workflow, WorkflowType


class WorkflowConverter:
    """
    App Convert to Workflow Mode
    """

    def convert_to_workflow(self, app_model: App, account: Account) -> Workflow:
        """
        Convert to workflow mode

        - basic mode of chatbot app

        - advanced mode of assistant app (for migration)

        - completion app (for migration)

        :param app_model: App instance
        :param account: Account instance
        :return: workflow instance
        """
        # get original app config
        app_model_config = app_model.app_model_config

        # convert app model config
        application_manager = ApplicationManager()
        application_manager.convert_from_app_model_config_dict(
            tenant_id=app_model.tenant_id,
            app_model_config_dict=app_model_config.to_dict()
        )

        # init workflow graph
        graph = {
            "nodes": [],
            "edges": []
        }

        # Convert list:
        # - variables -> start
        # - model_config -> llm
        # - prompt_template -> llm
        # - file_upload -> llm
        # - external_data_variables -> http-request
        # - dataset -> knowledge-retrieval
        # - show_retrieve_source -> knowledge-retrieval

        # convert to start node
        start_node = self._convert_to_start_node(
            variables=app_model_config.variables
        )

        graph['nodes'].append(start_node)

        # convert to http request node
        if app_model_config.external_data_variables:
            http_request_node = self._convert_to_http_request_node(
                external_data_variables=app_model_config.external_data_variables
            )

            graph = self._append_node(graph, http_request_node)

        # convert to knowledge retrieval node
        if app_model_config.dataset:
            knowledge_retrieval_node = self._convert_to_knowledge_retrieval_node(
                dataset=app_model_config.dataset,
                show_retrieve_source=app_model_config.show_retrieve_source
            )

            graph = self._append_node(graph, knowledge_retrieval_node)

        # convert to llm node
        llm_node = self._convert_to_llm_node(
            model_config=app_model_config.model_config,
            prompt_template=app_model_config.prompt_template,
            file_upload=app_model_config.file_upload
        )

        graph = self._append_node(graph, llm_node)

        # convert to end node by app mode
        end_node = self._convert_to_end_node(app_model=app_model)

        graph = self._append_node(graph, end_node)

        # get new app mode
        app_mode = self._get_new_app_mode(app_model)

        # create workflow record
        workflow = Workflow(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=WorkflowType.from_app_mode(app_mode).value,
            version='draft',
            graph=json.dumps(graph),
            created_by=account.id
        )

        db.session.add(workflow)
        db.session.flush()

        # create new app model config record
        new_app_model_config = app_model_config.copy()
        new_app_model_config.external_data_tools = ''
        new_app_model_config.model = ''
        new_app_model_config.user_input_form = ''
        new_app_model_config.dataset_query_variable = None
        new_app_model_config.pre_prompt = None
        new_app_model_config.agent_mode = ''
        new_app_model_config.prompt_type = 'simple'
        new_app_model_config.chat_prompt_config = ''
        new_app_model_config.completion_prompt_config = ''
        new_app_model_config.dataset_configs = ''
        new_app_model_config.chatbot_app_engine = ChatbotAppEngine.WORKFLOW.value \
            if app_mode == AppMode.CHAT else ChatbotAppEngine.NORMAL.value
        new_app_model_config.workflow_id = workflow.id

        db.session.add(new_app_model_config)
        db.session.commit()

        return workflow

    def _convert_to_start_node(self, variables: list[VariableEntity]) -> dict:
        """
        Convert to Start Node
        :param variables: list of variables
        :return:
        """
        return {
            "id": "start",
            "position": None,
            "data": {
                "title": "START",
                "type": NodeType.START.value,
                "variables": [helper.dump_model(v) for v in variables]
            }
        }

    def _convert_to_http_request_node(self, external_data_variables: list[ExternalDataVariableEntity]) -> dict:
        """
        Convert API Based Extension to HTTP Request Node
        :param external_data_variables: list of external data variables
        :return:
        """
        # TODO: implement
        pass

    def _convert_to_knowledge_retrieval_node(self, new_app_mode: AppMode, dataset: DatasetEntity) -> dict:
        """
        Convert datasets to Knowledge Retrieval Node
        :param new_app_mode: new app mode
        :param dataset: dataset
        :return:
        """
        # TODO: implement
        if new_app_mode == AppMode.CHAT:
            query_variable_selector = ["start", "sys.query"]
        else:
            pass

        return {
            "id": "knowledge-retrieval",
            "position": None,
            "data": {
                "title": "KNOWLEDGE RETRIEVAL",
                "type": NodeType.KNOWLEDGE_RETRIEVAL.value,
            }
        }

    def _convert_to_llm_node(self, model_config: ModelConfigEntity,
                             prompt_template: PromptTemplateEntity,
                             file_upload: Optional[FileUploadEntity] = None) -> dict:
        """
        Convert to LLM Node
        :param model_config: model config
        :param prompt_template: prompt template
        :param file_upload: file upload config (optional)
        """
        # TODO: implement
        pass

    def _convert_to_end_node(self, app_model: App) -> dict:
        """
        Convert to End Node
        :param app_model: App instance
        :return:
        """
        if app_model.mode == AppMode.CHAT.value:
            return {
                "id": "end",
                "position": None,
                "data": {
                    "title": "END",
                    "type": NodeType.END.value,
                }
            }
        elif app_model.mode == "completion":
            # for original completion app
            return {
                "id": "end",
                "position": None,
                "data": {
                    "title": "END",
                    "type": NodeType.END.value,
                    "outputs": {
                        "type": EndNodeOutputType.PLAIN_TEXT.value,
                        "plain_text_selector": ["llm", "text"]
                    }
                }
            }

    def _create_edge(self, source: str, target: str) -> dict:
        """
        Create Edge
        :param source: source node id
        :param target: target node id
        :return:
        """
        return {
            "id": f"{source}-{target}",
            "source": source,
            "target": target
        }

    def _append_node(self, graph: dict, node: dict) -> dict:
        """
        Append Node to Graph

        :param graph: Graph, include: nodes, edges
        :param node: Node to append
        :return:
        """
        previous_node = graph['nodes'][-1]
        graph['nodes'].append(node)
        graph['edges'].append(self._create_edge(previous_node['id'], node['id']))
        return graph

    def _get_new_app_mode(self, app_model: App) -> AppMode:
        """
        Get new app mode
        :param app_model: App instance
        :return: AppMode
        """
        if app_model.mode == "completion":
            return AppMode.WORKFLOW
        else:
            return AppMode.value_of(app_model.mode)

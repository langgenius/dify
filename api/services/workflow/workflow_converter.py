import json
from typing import Optional

from core.application_manager import ApplicationManager
from core.entities.application_entities import (
    DatasetEntity,
    ExternalDataVariableEntity,
    FileUploadEntity,
    ModelConfigEntity,
    PromptTemplateEntity,
    VariableEntity, DatasetRetrieveConfigEntity,
)
from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.utils import helper
from core.prompt.simple_prompt_transform import SimplePromptTransform
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
        # get new app mode
        new_app_mode = self._get_new_app_mode(app_model)

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
                new_app_mode=new_app_mode,
                dataset_config=app_model_config.dataset
            )

            if knowledge_retrieval_node:
                graph = self._append_node(graph, knowledge_retrieval_node)

        # convert to llm node
        llm_node = self._convert_to_llm_node(
            new_app_mode=new_app_mode,
            graph=graph,
            model_config=app_model_config.model_config,
            prompt_template=app_model_config.prompt_template,
            file_upload=app_model_config.file_upload
        )

        graph = self._append_node(graph, llm_node)

        # convert to end node by app mode
        end_node = self._convert_to_end_node(app_model=app_model)

        graph = self._append_node(graph, end_node)

        # create workflow record
        workflow = Workflow(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=WorkflowType.from_app_mode(new_app_mode).value,
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
            if new_app_mode == AppMode.CHAT else ChatbotAppEngine.NORMAL.value
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

    def _convert_to_knowledge_retrieval_node(self, new_app_mode: AppMode, dataset_config: DatasetEntity) \
            -> Optional[dict]:
        """
        Convert datasets to Knowledge Retrieval Node
        :param new_app_mode: new app mode
        :param dataset_config: dataset
        :return:
        """
        retrieve_config = dataset_config.retrieve_config
        if new_app_mode == AppMode.CHAT:
            query_variable_selector = ["start", "sys.query"]
        elif retrieve_config.query_variable:
            # fetch query variable
            query_variable_selector = ["start", retrieve_config.query_variable]
        else:
            return None

        return {
            "id": "knowledge-retrieval",
            "position": None,
            "data": {
                "title": "KNOWLEDGE RETRIEVAL",
                "type": NodeType.KNOWLEDGE_RETRIEVAL.value,
                "query_variable_selector": query_variable_selector,
                "dataset_ids": dataset_config.dataset_ids,
                "retrieval_mode": retrieve_config.retrieve_strategy.value,
                "multiple_retrieval_config": {
                    "top_k": retrieve_config.top_k,
                    "score_threshold": retrieve_config.score_threshold,
                    "reranking_model": retrieve_config.reranking_model
                }
                if retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE
                else None,
            }
        }

    def _convert_to_llm_node(self, new_app_mode: AppMode,
                             graph: dict,
                             model_config: ModelConfigEntity,
                             prompt_template: PromptTemplateEntity,
                             file_upload: Optional[FileUploadEntity] = None) -> dict:
        """
        Convert to LLM Node
        :param new_app_mode: new app mode
        :param graph: graph
        :param model_config: model config
        :param prompt_template: prompt template
        :param file_upload: file upload config (optional)
        """
        # fetch start and knowledge retrieval node
        start_node = next(filter(lambda n: n['data']['type'] == NodeType.START.value, graph['nodes']))
        knowledge_retrieval_node = next(filter(
            lambda n: n['data']['type'] == NodeType.KNOWLEDGE_RETRIEVAL.value,
            graph['nodes']
        ), None)

        role_prefix = None

        # Chat Model
        if model_config.mode == LLMMode.CHAT.value:
            if prompt_template.prompt_type == PromptTemplateEntity.PromptType.SIMPLE:
                # get prompt template
                prompt_transform = SimplePromptTransform()
                prompt_template_config = prompt_transform.get_prompt_template(
                    app_mode=AppMode.WORKFLOW,
                    provider=model_config.provider,
                    model=model_config.model,
                    pre_prompt=prompt_template.simple_prompt_template,
                    has_context=knowledge_retrieval_node is not None,
                    query_in_prompt=False
                )
                prompts = [
                    {
                        "role": 'user',
                        "text": prompt_template_config['prompt_template'].template
                    }
                ]
            else:
                advanced_chat_prompt_template = prompt_template.advanced_chat_prompt_template
                prompts = [helper.dump_model(m) for m in advanced_chat_prompt_template.messages] \
                    if advanced_chat_prompt_template else []
        # Completion Model
        else:
            if prompt_template.prompt_type == PromptTemplateEntity.PromptType.SIMPLE:
                # get prompt template
                prompt_transform = SimplePromptTransform()
                prompt_template_config = prompt_transform.get_prompt_template(
                    app_mode=AppMode.WORKFLOW,
                    provider=model_config.provider,
                    model=model_config.model,
                    pre_prompt=prompt_template.simple_prompt_template,
                    has_context=knowledge_retrieval_node is not None,
                    query_in_prompt=False
                )
                prompts = {
                    "text": prompt_template_config['prompt_template'].template
                }

                prompt_rules = prompt_template_config['prompt_rules']
                role_prefix = {
                    "user": prompt_rules['human_prefix'] if 'human_prefix' in prompt_rules else 'Human',
                    "assistant": prompt_rules['assistant_prefix'] if 'assistant_prefix' in prompt_rules else 'Assistant'
                }
            else:
                advanced_completion_prompt_template = prompt_template.advanced_completion_prompt_template
                prompts = {
                    "text": advanced_completion_prompt_template.prompt,
                } if advanced_completion_prompt_template else {"text": ""}

                if advanced_completion_prompt_template.role_prefix:
                    role_prefix = {
                        "user": advanced_completion_prompt_template.role_prefix.user,
                        "assistant": advanced_completion_prompt_template.role_prefix.assistant
                    }

        memory = None
        if new_app_mode == AppMode.CHAT:
            memory = {
                "role_prefix": role_prefix,
                "window": {
                    "enabled": False
                }
            }

        return {
            "id": "llm",
            "position": None,
            "data": {
                "title": "LLM",
                "type": NodeType.LLM.value,
                "model": {
                    "provider": model_config.provider,
                    "name": model_config.model,
                    "mode": model_config.mode,
                    "completion_params": model_config.parameters.update({"stop": model_config.stop})
                },
                "variables": [{
                    "variable": v['variable'],
                    "value_selector": ["start", v['variable']]
                } for v in start_node['data']['variables']],
                "prompts": prompts,
                "memory": memory,
                "context": {
                    "enabled": knowledge_retrieval_node is not None,
                    "variable_selector": ["knowledge-retrieval", "result"]
                    if knowledge_retrieval_node is not None else None
                },
                "vision": {
                    "enabled": file_upload is not None,
                    "variable_selector": ["start", "sys.files"] if file_upload is not None else None,
                    "configs": {
                        "detail": file_upload.image_config['detail']
                    } if file_upload is not None else None
                }
            }
        }

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

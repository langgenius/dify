import json
from typing import Optional

from core.application_manager import ApplicationManager
from core.entities.application_entities import (
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    ExternalDataVariableEntity,
    FileUploadEntity,
    ModelConfigEntity,
    PromptTemplateEntity,
    VariableEntity,
)
from core.helper import encrypter
from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.simple_prompt_transform import SimplePromptTransform
from core.workflow.entities.NodeEntities import NodeType
from core.workflow.nodes.end.entities import EndNodeOutputType
from events.app_event import app_was_created
from extensions.ext_database import db
from models.account import Account
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint
from models.model import App, AppMode, AppModelConfig, Site
from models.workflow import Workflow, WorkflowType


class WorkflowConverter:
    """
    App Convert to Workflow Mode
    """

    def convert_to_workflow(self, app_model: App, account: Account) -> App:
        """
        Convert app to workflow

        - basic mode of chatbot app

        - advanced mode of assistant app

        - completion app

        :param app_model: App instance
        :param account: Account
        :return: new App instance
        """
        # get original app config
        app_model_config = app_model.app_model_config

        # convert app model config
        workflow = self.convert_app_model_config_to_workflow(
            app_model=app_model,
            app_model_config=app_model_config,
            account_id=account.id
        )

        # create new app
        new_app = App()
        new_app.tenant_id = app_model.tenant_id
        new_app.name = app_model.name + '(workflow)'
        new_app.mode = AppMode.CHAT.value \
            if app_model.mode == AppMode.CHAT.value else AppMode.WORKFLOW.value
        new_app.icon = app_model.icon
        new_app.icon_background = app_model.icon_background
        new_app.enable_site = app_model.enable_site
        new_app.enable_api = app_model.enable_api
        new_app.api_rpm = app_model.api_rpm
        new_app.api_rph = app_model.api_rph
        new_app.is_demo = False
        new_app.is_public = app_model.is_public
        db.session.add(new_app)
        db.session.flush()

        # create new app model config record
        new_app_model_config = app_model_config.copy()
        new_app_model_config.id = None
        new_app_model_config.app_id = new_app.id
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
        new_app_model_config.workflow_id = workflow.id

        db.session.add(new_app_model_config)
        db.session.flush()

        new_app.app_model_config_id = new_app_model_config.id
        db.session.commit()

        app_was_created.send(new_app, account=account)

        return new_app

    def convert_app_model_config_to_workflow(self, app_model: App,
                                             app_model_config: AppModelConfig,
                                             account_id: str) -> Workflow:
        """
        Convert app model config to workflow mode
        :param app_model: App instance
        :param app_model_config: AppModelConfig instance
        :param account_id: Account ID
        :return:
        """
        # get new app mode
        new_app_mode = self._get_new_app_mode(app_model)

        # convert app model config
        application_manager = ApplicationManager()
        app_orchestration_config_entity = application_manager.convert_from_app_model_config_dict(
            tenant_id=app_model.tenant_id,
            app_model_config_dict=app_model_config.to_dict(),
            skip_check=True
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
            variables=app_orchestration_config_entity.variables
        )

        graph['nodes'].append(start_node)

        # convert to http request node
        if app_orchestration_config_entity.external_data_variables:
            http_request_nodes = self._convert_to_http_request_node(
                app_model=app_model,
                variables=app_orchestration_config_entity.variables,
                external_data_variables=app_orchestration_config_entity.external_data_variables
            )

            for http_request_node in http_request_nodes:
                graph = self._append_node(graph, http_request_node)

        # convert to knowledge retrieval node
        if app_orchestration_config_entity.dataset:
            knowledge_retrieval_node = self._convert_to_knowledge_retrieval_node(
                new_app_mode=new_app_mode,
                dataset_config=app_orchestration_config_entity.dataset
            )

            if knowledge_retrieval_node:
                graph = self._append_node(graph, knowledge_retrieval_node)

        # convert to llm node
        llm_node = self._convert_to_llm_node(
            new_app_mode=new_app_mode,
            graph=graph,
            model_config=app_orchestration_config_entity.model_config,
            prompt_template=app_orchestration_config_entity.prompt_template,
            file_upload=app_orchestration_config_entity.file_upload
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
            created_by=account_id,
            created_at=app_model_config.created_at
        )

        db.session.add(workflow)
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
                "variables": [jsonable_encoder(v) for v in variables]
            }
        }

    def _convert_to_http_request_node(self, app_model: App,
                                      variables: list[VariableEntity],
                                      external_data_variables: list[ExternalDataVariableEntity]) -> list[dict]:
        """
        Convert API Based Extension to HTTP Request Node
        :param app_model: App instance
        :param variables: list of variables
        :param external_data_variables: list of external data variables
        :return:
        """
        index = 1
        nodes = []
        tenant_id = app_model.tenant_id
        for external_data_variable in external_data_variables:
            tool_type = external_data_variable.type
            if tool_type != "api":
                continue

            tool_variable = external_data_variable.variable
            tool_config = external_data_variable.config

            # get params from config
            api_based_extension_id = tool_config.get("api_based_extension_id")

            # get api_based_extension
            api_based_extension = self._get_api_based_extension(
                tenant_id=tenant_id,
                api_based_extension_id=api_based_extension_id
            )

            if not api_based_extension:
                raise ValueError("[External data tool] API query failed, variable: {}, "
                                 "error: api_based_extension_id is invalid"
                                 .format(tool_variable))

            # decrypt api_key
            api_key = encrypter.decrypt_token(
                tenant_id=tenant_id,
                token=api_based_extension.api_key
            )

            http_request_variables = []
            inputs = {}
            for v in variables:
                http_request_variables.append({
                    "variable": v.variable,
                    "value_selector": ["start", v.variable]
                })

                inputs[v.variable] = '{{' + v.variable + '}}'

            if app_model.mode == AppMode.CHAT.value:
                http_request_variables.append({
                    "variable": "_query",
                    "value_selector": ["start", "sys.query"]
                })

            request_body = {
                'point': APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY.value,
                'params': {
                    'app_id': app_model.id,
                    'tool_variable': tool_variable,
                    'inputs': inputs,
                    'query': '{{_query}}' if app_model.mode == AppMode.CHAT.value else ''
                }
            }

            request_body_json = json.dumps(request_body)
            request_body_json = request_body_json.replace('\{\{', '{{').replace('\}\}', '}}')

            http_request_node = {
                "id": f"http-request-{index}",
                "position": None,
                "data": {
                    "title": f"HTTP REQUEST {api_based_extension.name}",
                    "type": NodeType.HTTP_REQUEST.value,
                    "variables": http_request_variables,
                    "method": "post",
                    "url": api_based_extension.api_endpoint,
                    "authorization": {
                        "type": "api-key",
                        "config": {
                            "type": "bearer",
                            "api_key": api_key
                        }
                    },
                    "headers": "",
                    "params": "",
                    "body": {
                        "type": "json",
                        "data": request_body_json
                    }
                }
            }

            nodes.append(http_request_node)

            # append code node for response body parsing
            code_node = {
                "id": f"code-{index}",
                "position": None,
                "data": {
                    "title": f"Parse {api_based_extension.name} Response",
                    "type": NodeType.CODE.value,
                    "variables": [{
                        "variable": "response_json",
                        "value_selector": [http_request_node['id'], "body"]
                    }],
                    "code_language": "python3",
                    "code": "import json\n\ndef main(response_json: str) -> str:\n    response_body = json.loads("
                            "response_json)\n    return {\n        \"result\": response_body[\"result\"]\n    }",
                    "outputs": [
                        {
                            "variable": "result",
                            "variable_type": "string"
                        }
                    ]
                }
            }

            nodes.append(code_node)
            index += 1

        return nodes

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
                prompts = [{
                    "role": m.role.value,
                    "text": m.text
                } for m in advanced_chat_prompt_template.messages] \
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
        elif app_model.mode == AppMode.COMPLETION.value:
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
        if app_model.mode == AppMode.COMPLETION.value:
            return AppMode.WORKFLOW
        else:
            return AppMode.value_of(app_model.mode)

    def _get_api_based_extension(self, tenant_id: str, api_based_extension_id: str) -> APIBasedExtension:
        """
        Get API Based Extension
        :param tenant_id: tenant id
        :param api_based_extension_id: api based extension id
        :return:
        """
        return db.session.query(APIBasedExtension).filter(
                APIBasedExtension.tenant_id == tenant_id,
                APIBasedExtension.id == api_based_extension_id
            ).first()

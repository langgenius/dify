import json
from typing import Optional

from core.app.app_config.entities import (
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    EasyUIBasedAppConfig,
    ExternalDataVariableEntity,
    ModelConfigEntity,
    PromptTemplateEntity,
    VariableEntity,
)
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfigManager
from core.app.apps.chat.app_config_manager import ChatAppConfigManager
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from core.file.file_obj import FileExtraConfig
from core.helper import encrypter
from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.simple_prompt_transform import SimplePromptTransform
from core.workflow.entities.node_entities import NodeType
from events.app_event import app_was_created
from extensions.ext_database import db
from models.account import Account
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint
from models.model import App, AppMode, AppModelConfig
from models.workflow import Workflow, WorkflowType


class WorkflowConverter:
    """
    App Convert to Workflow Mode
    """

    def convert_to_workflow(
        self, app_model: App, account: Account, name: str, icon_type: str, icon: str, icon_background: str
    ):
        """
        Convert app to workflow

        - basic mode of chatbot app

        - expert mode of chatbot app

        - completion app

        :param app_model: App instance
        :param account: Account
        :param name: new app name
        :param icon: new app icon
        :param icon_type: new app icon type
        :param icon_background: new app icon background
        :return: new App instance
        """
        # convert app model config
        if not app_model.app_model_config:
            raise ValueError("App model config is required")

        workflow = self.convert_app_model_config_to_workflow(
            app_model=app_model, app_model_config=app_model.app_model_config, account_id=account.id
        )

        # create new app
        new_app = App()
        new_app.tenant_id = app_model.tenant_id
        new_app.name = name or app_model.name + "(workflow)"
        new_app.mode = AppMode.ADVANCED_CHAT.value if app_model.mode == AppMode.CHAT.value else AppMode.WORKFLOW.value
        new_app.icon_type = icon_type or app_model.icon_type
        new_app.icon = icon or app_model.icon
        new_app.icon_background = icon_background or app_model.icon_background
        new_app.enable_site = app_model.enable_site
        new_app.enable_api = app_model.enable_api
        new_app.api_rpm = app_model.api_rpm
        new_app.api_rph = app_model.api_rph
        new_app.is_demo = False
        new_app.is_public = app_model.is_public
        new_app.created_by = account.id
        new_app.updated_by = account.id
        db.session.add(new_app)
        db.session.flush()
        db.session.commit()

        workflow.app_id = new_app.id
        db.session.commit()

        app_was_created.send(new_app, account=account)

        return new_app

    def convert_app_model_config_to_workflow(self, app_model: App, app_model_config: AppModelConfig, account_id: str):
        """
        Convert app model config to workflow mode
        :param app_model: App instance
        :param app_model_config: AppModelConfig instance
        :param account_id: Account ID
        """
        # get new app mode
        new_app_mode = self._get_new_app_mode(app_model)

        # convert app model config
        app_config = self._convert_to_app_config(app_model=app_model, app_model_config=app_model_config)

        # init workflow graph
        graph = {"nodes": [], "edges": []}

        # Convert list:
        # - variables -> start
        # - model_config -> llm
        # - prompt_template -> llm
        # - file_upload -> llm
        # - external_data_variables -> http-request
        # - dataset -> knowledge-retrieval
        # - show_retrieve_source -> knowledge-retrieval

        # convert to start node
        start_node = self._convert_to_start_node(variables=app_config.variables)

        graph["nodes"].append(start_node)

        # convert to http request node
        external_data_variable_node_mapping = {}
        if app_config.external_data_variables:
            http_request_nodes, external_data_variable_node_mapping = self._convert_to_http_request_node(
                app_model=app_model,
                variables=app_config.variables,
                external_data_variables=app_config.external_data_variables,
            )

            for http_request_node in http_request_nodes:
                graph = self._append_node(graph, http_request_node)

        # convert to knowledge retrieval node
        if app_config.dataset:
            knowledge_retrieval_node = self._convert_to_knowledge_retrieval_node(
                new_app_mode=new_app_mode, dataset_config=app_config.dataset, model_config=app_config.model
            )

            if knowledge_retrieval_node:
                graph = self._append_node(graph, knowledge_retrieval_node)

        # convert to llm node
        llm_node = self._convert_to_llm_node(
            original_app_mode=AppMode.value_of(app_model.mode),
            new_app_mode=new_app_mode,
            graph=graph,
            model_config=app_config.model,
            prompt_template=app_config.prompt_template,
            file_upload=app_config.additional_features.file_upload,
            external_data_variable_node_mapping=external_data_variable_node_mapping,
        )

        graph = self._append_node(graph, llm_node)

        if new_app_mode == AppMode.WORKFLOW:
            # convert to end node by app mode
            end_node = self._convert_to_end_node()
            graph = self._append_node(graph, end_node)
        else:
            answer_node = self._convert_to_answer_node()
            graph = self._append_node(graph, answer_node)

        app_model_config_dict = app_config.app_model_config_dict

        # features
        if new_app_mode == AppMode.ADVANCED_CHAT:
            features = {
                "opening_statement": app_model_config_dict.get("opening_statement"),
                "suggested_questions": app_model_config_dict.get("suggested_questions"),
                "suggested_questions_after_answer": app_model_config_dict.get("suggested_questions_after_answer"),
                "speech_to_text": app_model_config_dict.get("speech_to_text"),
                "text_to_speech": app_model_config_dict.get("text_to_speech"),
                "file_upload": app_model_config_dict.get("file_upload"),
                "sensitive_word_avoidance": app_model_config_dict.get("sensitive_word_avoidance"),
                "retriever_resource": app_model_config_dict.get("retriever_resource"),
            }
        else:
            features = {
                "text_to_speech": app_model_config_dict.get("text_to_speech"),
                "file_upload": app_model_config_dict.get("file_upload"),
                "sensitive_word_avoidance": app_model_config_dict.get("sensitive_word_avoidance"),
            }

        # create workflow record
        workflow = Workflow(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=WorkflowType.from_app_mode(new_app_mode).value,
            version="draft",
            graph=json.dumps(graph),
            features=json.dumps(features),
            created_by=account_id,
            environment_variables=[],
            conversation_variables=[],
        )

        db.session.add(workflow)
        db.session.commit()

        return workflow

    def _convert_to_app_config(self, app_model: App, app_model_config: AppModelConfig) -> EasyUIBasedAppConfig:
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode == AppMode.AGENT_CHAT or app_model.is_agent:
            app_model.mode = AppMode.AGENT_CHAT.value
            app_config = AgentChatAppConfigManager.get_app_config(
                app_model=app_model, app_model_config=app_model_config
            )
        elif app_mode == AppMode.CHAT:
            app_config = ChatAppConfigManager.get_app_config(app_model=app_model, app_model_config=app_model_config)
        elif app_mode == AppMode.COMPLETION:
            app_config = CompletionAppConfigManager.get_app_config(
                app_model=app_model, app_model_config=app_model_config
            )
        else:
            raise ValueError("Invalid app mode")

        return app_config

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
                "variables": [jsonable_encoder(v) for v in variables],
            },
        }

    def _convert_to_http_request_node(
        self, app_model: App, variables: list[VariableEntity], external_data_variables: list[ExternalDataVariableEntity]
    ) -> tuple[list[dict], dict[str, str]]:
        """
        Convert API Based Extension to HTTP Request Node
        :param app_model: App instance
        :param variables: list of variables
        :param external_data_variables: list of external data variables
        :return:
        """
        index = 1
        nodes = []
        external_data_variable_node_mapping = {}
        tenant_id = app_model.tenant_id
        for external_data_variable in external_data_variables:
            tool_type = external_data_variable.type
            if tool_type != "api":
                continue

            tool_variable = external_data_variable.variable
            tool_config = external_data_variable.config

            # get params from config
            api_based_extension_id = tool_config.get("api_based_extension_id")
            if not api_based_extension_id:
                continue

            # get api_based_extension
            api_based_extension = self._get_api_based_extension(
                tenant_id=tenant_id, api_based_extension_id=api_based_extension_id
            )

            # decrypt api_key
            api_key = encrypter.decrypt_token(tenant_id=tenant_id, token=api_based_extension.api_key)

            inputs = {}
            for v in variables:
                inputs[v.variable] = "{{#start." + v.variable + "#}}"

            request_body = {
                "point": APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY.value,
                "params": {
                    "app_id": app_model.id,
                    "tool_variable": tool_variable,
                    "inputs": inputs,
                    "query": "{{#sys.query#}}" if app_model.mode == AppMode.CHAT.value else "",
                },
            }

            request_body_json = json.dumps(request_body)
            request_body_json = request_body_json.replace(r"\{\{", "{{").replace(r"\}\}", "}}")

            http_request_node = {
                "id": f"http_request_{index}",
                "position": None,
                "data": {
                    "title": f"HTTP REQUEST {api_based_extension.name}",
                    "type": NodeType.HTTP_REQUEST.value,
                    "method": "post",
                    "url": api_based_extension.api_endpoint,
                    "authorization": {"type": "api-key", "config": {"type": "bearer", "api_key": api_key}},
                    "headers": "",
                    "params": "",
                    "body": {"type": "json", "data": request_body_json},
                },
            }

            nodes.append(http_request_node)

            # append code node for response body parsing
            code_node = {
                "id": f"code_{index}",
                "position": None,
                "data": {
                    "title": f"Parse {api_based_extension.name} Response",
                    "type": NodeType.CODE.value,
                    "variables": [{"variable": "response_json", "value_selector": [http_request_node["id"], "body"]}],
                    "code_language": "python3",
                    "code": "import json\n\ndef main(response_json: str) -> str:\n    response_body = json.loads("
                    'response_json)\n    return {\n        "result": response_body["result"]\n    }',
                    "outputs": {"result": {"type": "string"}},
                },
            }

            nodes.append(code_node)

            external_data_variable_node_mapping[external_data_variable.variable] = code_node["id"]
            index += 1

        return nodes, external_data_variable_node_mapping

    def _convert_to_knowledge_retrieval_node(
        self, new_app_mode: AppMode, dataset_config: DatasetEntity, model_config: ModelConfigEntity
    ) -> Optional[dict]:
        """
        Convert datasets to Knowledge Retrieval Node
        :param new_app_mode: new app mode
        :param dataset_config: dataset
        :param model_config: model config
        :return:
        """
        retrieve_config = dataset_config.retrieve_config
        if new_app_mode == AppMode.ADVANCED_CHAT:
            query_variable_selector = ["sys", "query"]
        elif retrieve_config.query_variable:
            # fetch query variable
            query_variable_selector = ["start", retrieve_config.query_variable]
        else:
            return None

        return {
            "id": "knowledge_retrieval",
            "position": None,
            "data": {
                "title": "KNOWLEDGE RETRIEVAL",
                "type": NodeType.KNOWLEDGE_RETRIEVAL.value,
                "query_variable_selector": query_variable_selector,
                "dataset_ids": dataset_config.dataset_ids,
                "retrieval_mode": retrieve_config.retrieve_strategy.value,
                "single_retrieval_config": {
                    "model": {
                        "provider": model_config.provider,
                        "name": model_config.model,
                        "mode": model_config.mode,
                        "completion_params": {
                            **model_config.parameters,
                            "stop": model_config.stop,
                        },
                    }
                }
                if retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE
                else None,
                "multiple_retrieval_config": {
                    "top_k": retrieve_config.top_k,
                    "score_threshold": retrieve_config.score_threshold,
                    "reranking_model": retrieve_config.reranking_model,
                }
                if retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE
                else None,
            },
        }

    def _convert_to_llm_node(
        self,
        original_app_mode: AppMode,
        new_app_mode: AppMode,
        graph: dict,
        model_config: ModelConfigEntity,
        prompt_template: PromptTemplateEntity,
        file_upload: Optional[FileExtraConfig] = None,
        external_data_variable_node_mapping: dict[str, str] | None = None,
    ) -> dict:
        """
        Convert to LLM Node
        :param original_app_mode: original app mode
        :param new_app_mode: new app mode
        :param graph: graph
        :param model_config: model config
        :param prompt_template: prompt template
        :param file_upload: file upload config (optional)
        :param external_data_variable_node_mapping: external data variable node mapping
        """
        # fetch start and knowledge retrieval node
        start_node = next(filter(lambda n: n["data"]["type"] == NodeType.START.value, graph["nodes"]))
        knowledge_retrieval_node = next(
            filter(lambda n: n["data"]["type"] == NodeType.KNOWLEDGE_RETRIEVAL.value, graph["nodes"]), None
        )

        role_prefix = None

        # Chat Model
        if model_config.mode == LLMMode.CHAT.value:
            if prompt_template.prompt_type == PromptTemplateEntity.PromptType.SIMPLE:
                if not prompt_template.simple_prompt_template:
                    raise ValueError("Simple prompt template is required")
                # get prompt template
                prompt_transform = SimplePromptTransform()
                prompt_template_config = prompt_transform.get_prompt_template(
                    app_mode=original_app_mode,
                    provider=model_config.provider,
                    model=model_config.model,
                    pre_prompt=prompt_template.simple_prompt_template,
                    has_context=knowledge_retrieval_node is not None,
                    query_in_prompt=False,
                )

                template = prompt_template_config["prompt_template"].template
                if not template:
                    prompts = []
                else:
                    template = self._replace_template_variables(
                        template, start_node["data"]["variables"], external_data_variable_node_mapping
                    )

                    prompts = [{"role": "user", "text": template}]
            else:
                advanced_chat_prompt_template = prompt_template.advanced_chat_prompt_template

                prompts = []
                if advanced_chat_prompt_template:
                    for m in advanced_chat_prompt_template.messages:
                        text = m.text
                        text = self._replace_template_variables(
                            text, start_node["data"]["variables"], external_data_variable_node_mapping
                        )

                        prompts.append({"role": m.role.value, "text": text})
        # Completion Model
        else:
            if prompt_template.prompt_type == PromptTemplateEntity.PromptType.SIMPLE:
                if not prompt_template.simple_prompt_template:
                    raise ValueError("Simple prompt template is required")
                # get prompt template
                prompt_transform = SimplePromptTransform()
                prompt_template_config = prompt_transform.get_prompt_template(
                    app_mode=original_app_mode,
                    provider=model_config.provider,
                    model=model_config.model,
                    pre_prompt=prompt_template.simple_prompt_template,
                    has_context=knowledge_retrieval_node is not None,
                    query_in_prompt=False,
                )

                template = prompt_template_config["prompt_template"].template
                template = self._replace_template_variables(
                    template=template,
                    variables=start_node["data"]["variables"],
                    external_data_variable_node_mapping=external_data_variable_node_mapping,
                )

                prompts = {"text": template}

                prompt_rules = prompt_template_config["prompt_rules"]
                role_prefix = {
                    "user": prompt_rules.get("human_prefix", "Human"),
                    "assistant": prompt_rules.get("assistant_prefix", "Assistant"),
                }
            else:
                advanced_completion_prompt_template = prompt_template.advanced_completion_prompt_template
                if advanced_completion_prompt_template:
                    text = advanced_completion_prompt_template.prompt
                    text = self._replace_template_variables(
                        template=text,
                        variables=start_node["data"]["variables"],
                        external_data_variable_node_mapping=external_data_variable_node_mapping,
                    )
                else:
                    text = ""

                text = text.replace("{{#query#}}", "{{#sys.query#}}")

                prompts = {
                    "text": text,
                }

                if advanced_completion_prompt_template and advanced_completion_prompt_template.role_prefix:
                    role_prefix = {
                        "user": advanced_completion_prompt_template.role_prefix.user,
                        "assistant": advanced_completion_prompt_template.role_prefix.assistant,
                    }

        memory = None
        if new_app_mode == AppMode.ADVANCED_CHAT:
            memory = {"role_prefix": role_prefix, "window": {"enabled": False}}

        completion_params = model_config.parameters
        completion_params.update({"stop": model_config.stop})
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
                    "completion_params": completion_params,
                },
                "prompt_template": prompts,
                "memory": memory,
                "context": {
                    "enabled": knowledge_retrieval_node is not None,
                    "variable_selector": ["knowledge_retrieval", "result"]
                    if knowledge_retrieval_node is not None
                    else None,
                },
                "vision": {
                    "enabled": file_upload is not None,
                    "variable_selector": ["sys", "files"] if file_upload is not None else None,
                    "configs": {"detail": file_upload.image_config["detail"]}
                    if file_upload is not None and file_upload.image_config is not None
                    else None,
                },
            },
        }

    def _replace_template_variables(
        self, template: str, variables: list[dict], external_data_variable_node_mapping: dict[str, str] | None = None
    ) -> str:
        """
        Replace Template Variables
        :param template: template
        :param variables: list of variables
        :param external_data_variable_node_mapping: external data variable node mapping
        :return:
        """
        for v in variables:
            template = template.replace("{{" + v["variable"] + "}}", "{{#start." + v["variable"] + "#}}")

        if external_data_variable_node_mapping:
            for variable, code_node_id in external_data_variable_node_mapping.items():
                template = template.replace("{{" + variable + "}}", "{{#" + code_node_id + ".result#}}")

        return template

    def _convert_to_end_node(self) -> dict:
        """
        Convert to End Node
        :return:
        """
        # for original completion app
        return {
            "id": "end",
            "position": None,
            "data": {
                "title": "END",
                "type": NodeType.END.value,
                "outputs": [{"variable": "result", "value_selector": ["llm", "text"]}],
            },
        }

    def _convert_to_answer_node(self) -> dict:
        """
        Convert to Answer Node
        :return:
        """
        # for original chat app
        return {
            "id": "answer",
            "position": None,
            "data": {"title": "ANSWER", "type": NodeType.ANSWER.value, "answer": "{{#llm.text#}}"},
        }

    def _create_edge(self, source: str, target: str) -> dict:
        """
        Create Edge
        :param source: source node id
        :param target: target node id
        :return:
        """
        return {"id": f"{source}-{target}", "source": source, "target": target}

    def _append_node(self, graph: dict, node: dict) -> dict:
        """
        Append Node to Graph

        :param graph: Graph, include: nodes, edges
        :param node: Node to append
        :return:
        """
        previous_node = graph["nodes"][-1]
        graph["nodes"].append(node)
        graph["edges"].append(self._create_edge(previous_node["id"], node["id"]))
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
            return AppMode.ADVANCED_CHAT

    def _get_api_based_extension(self, tenant_id: str, api_based_extension_id: str):
        """
        Get API Based Extension
        :param tenant_id: tenant id
        :param api_based_extension_id: api based extension id
        :return:
        """
        api_based_extension = (
            db.session.query(APIBasedExtension)
            .filter(APIBasedExtension.tenant_id == tenant_id, APIBasedExtension.id == api_based_extension_id)
            .first()
        )

        if not api_based_extension:
            raise ValueError(f"API Based Extension not found, id: {api_based_extension_id}")

        return api_based_extension

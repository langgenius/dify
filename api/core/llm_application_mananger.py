from typing import cast, Optional, Any

from core.app_runner.agent_app_runner import AgentApplicationRunner
from core.app_runner.basic_app_runner import BasicApplicationRunner
from core.entities.llm_application_entities import LLMApplicationGenerateEntity, AppOrchestrationConfigEntity, \
    ModelConfigEntity, PromptTemplateEntity, AdvancedChatMessageEntity, AdvancedChatPromptTemplateEntity, \
    AdvancedCompletionPromptTemplateEntity, ExternalDataVariableEntity, DatasetEntity, DatasetRetrieveConfigEntity, \
    AgentEntity, AgentToolEntity, FileUploadEntity, SensitiveWordAvoidanceEntity, AnnotationReplyEntity, \
    AnnotationReplyEmbeddingModelEntity, InvokeFrom
from core.file.file_obj import FileObj
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.provider_manager import ProviderManager


class LLMApplicationManager:
    """
    This class is responsible for managing LLM application
    """

    def generate(self, task_id: str,
                 tenant_id: str,
                 app_id: str,
                 app_model_config_id: str,
                 app_model_config_dict: dict,
                 user_id: str,
                 invoke_from: InvokeFrom,
                 inputs: dict[str, str],
                 query: Optional[str] = None,
                 files: Optional[list[FileObj]] = None,
                 conversation_id: Optional[str] = None,
                 stream: bool = False,
                 extras: Optional[dict[str, Any]] = None) -> None:
        """
        Generate App response.

        :param task_id: task id
        :param tenant_id: workspace ID
        :param app_id: app ID
        :param app_model_config_id: app model config id
        :param app_model_config_dict: app model config dict
        :param user_id: user id
        :param invoke_from: invoke from source
        :param inputs: inputs
        :param query: query
        :param files: file obj list
        :param conversation_id: conversation id
        :param stream: is stream
        :param extras: extras
        """
        llm_application_generate_entity = LLMApplicationGenerateEntity(
            task_id=task_id,
            tenant_id=tenant_id,
            app_id=app_id,
            app_model_config_id=app_model_config_id,
            app_model_config_dict=app_model_config_dict,
            app_orchestration_config_entity=self._convert_from_app_model_config_dict(
                tenant_id=tenant_id,
                app_model_config_dict=app_model_config_dict
            ),
            conversation_id=conversation_id,
            inputs=inputs,
            query=query,
            files=files if files else [],
            user_id=user_id,
            stream=stream,
            invoke_from=invoke_from,
            extras=extras
        )

        if llm_application_generate_entity.app_orchestration_config_entity.agent:
            # agent app
            runner = AgentApplicationRunner()
            runner.run(llm_application_generate_entity)
        else:
            # basic app
            runner = BasicApplicationRunner()
            runner.run(llm_application_generate_entity)

    def _convert_from_app_model_config_dict(self, tenant_id: str, app_model_config_dict: dict) \
            -> AppOrchestrationConfigEntity:
        """
        Convert app model config dict to entity.
        """
        properties = {}

        copy_app_model_config_dict = app_model_config_dict.copy()

        provider_manager = ProviderManager()
        provider_model_bundle = provider_manager.get_provider_model_bundle(
            tenant_id=tenant_id,
            provider=copy_app_model_config_dict['model']['provider'],
            model_type=ModelType.LLM
        )

        model_instance = provider_model_bundle.model_instance
        model_instance = cast(LargeLanguageModel, model_instance)

        model_credentials = provider_model_bundle.configuration.get_current_credentials(
            model_type=ModelType.LLM,
            model=copy_app_model_config_dict['model']['name']
        )

        # model config
        completion_params = copy_app_model_config_dict['model'].get('completion_params')
        stop = []
        if 'stop' in completion_params:
            stop = completion_params['stop']
            del completion_params['stop']

        # get model mode
        model_mode = copy_app_model_config_dict['model'].get('mode')
        if not model_mode:
            mode_enum = model_instance.get_model_mode(
                model=copy_app_model_config_dict['model']['name'],
                credentials=model_credentials
            )

            model_mode = mode_enum.value

        properties['model_config'] = ModelConfigEntity(
            provider=copy_app_model_config_dict['model']['provider'],
            model=copy_app_model_config_dict['model']['name'],
            mode=model_mode,
            provider_model_bundle=provider_model_bundle,
            credentials=model_credentials,
            parameters=completion_params,
            stop=stop,
        )

        # prompt template
        prompt_type = PromptTemplateEntity.PromptType.value_of(copy_app_model_config_dict['prompt_type'])
        if prompt_type == PromptTemplateEntity.PromptType.SIMPLE:
            simple_prompt_template = copy_app_model_config_dict.get("pre_prompt", "")
            properties['prompt_template'] = PromptTemplateEntity(
                prompt_type=prompt_type,
                simple_prompt_template=simple_prompt_template
            )
        else:
            advanced_chat_prompt_template = None
            chat_prompt_config = copy_app_model_config_dict.get("chat_prompt_config", {})
            if chat_prompt_config:
                chat_prompt_messages = []
                for message in chat_prompt_config.get("messages", []):
                    chat_prompt_messages.append({
                        "text": message["text"],
                        "role": AdvancedChatMessageEntity.MessageType.value_of(message["role"])
                    })

                advanced_chat_prompt_template = AdvancedChatPromptTemplateEntity(
                    messages=chat_prompt_messages
                )

            advanced_completion_prompt_template = None
            completion_prompt_config = copy_app_model_config_dict.get("completion_prompt_config", {})
            if completion_prompt_config:
                advanced_completion_prompt_template = AdvancedCompletionPromptTemplateEntity(
                    prompt=completion_prompt_config['prompt']['text'],
                    role_prefix=AdvancedCompletionPromptTemplateEntity.RolePrefixEntity(
                        user=completion_prompt_config['conversation_histories_role']['user_prefix'],
                        assistant=completion_prompt_config['conversation_histories_role']['assistant_prefix']
                    )
                )

            properties['prompt_template'] = PromptTemplateEntity(
                prompt_type=prompt_type,
                advanced_chat_prompt_template=advanced_chat_prompt_template,
                advanced_completion_prompt_template=advanced_completion_prompt_template
            )

        # external data variables
        external_data_tools = copy_app_model_config_dict.get('external_data_tools', [])
        for external_data_tool in external_data_tools:
            if 'enabled' not in external_data_tool or not external_data_tool['enabled']:
                continue

            properties['external_data_variables'].append(
                ExternalDataVariableEntity(
                    variable=external_data_tool['variable'],
                    type=external_data_tool['type'],
                    config=external_data_tool['config']
                )
            )

        if 'agent_mode' in copy_app_model_config_dict and copy_app_model_config_dict['agent_mode'] \
                and 'enabled' in copy_app_model_config_dict['agent_mode'] and copy_app_model_config_dict['agent_mode'][
            'enabled']:
            agent_dict = copy_app_model_config_dict.get('agent_mode')
            if agent_dict['strategy'] in ['router', 'react_router']:
                query_variable = None
                if model_mode == 'completion':
                    query_variable = copy_app_model_config_dict.get('dataset_query_variable')

                dataset_ids = []
                for tool in agent_dict.get('tools', []):
                    key = list(tool.keys())[0]

                    if key != 'dataset':
                        continue

                    tool_item = tool[key]

                    if "enabled" not in tool_item or not tool_item["enabled"]:
                        continue

                    del tool_item["enabled"]
                    dataset_id = tool_item['id']
                    dataset_ids.append(dataset_id)

                dataset_configs = copy_app_model_config_dict.get('dataset_configs', {'retrieval_model': 'single'})
                if dataset_configs['retrieval_model'] == 'single':
                    properties['dataset'] = DatasetEntity(
                        dataset_ids=dataset_ids,
                        retrieve_config=DatasetRetrieveConfigEntity(
                            query_variable=query_variable,
                            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.value_of(
                                dataset_configs['retrieve_strategy']
                            ),
                            single_strategy=agent_dict['strategy']
                        )
                    )
                else:
                    properties['dataset'] = DatasetEntity(
                        dataset_ids=dataset_ids,
                        retrieve_config=DatasetRetrieveConfigEntity(
                            query_variable=query_variable,
                            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.value_of(
                                dataset_configs['retrieve_strategy']
                            ),
                            top_k=dataset_configs.get('top_k'),
                            score_threshold=dataset_configs.get('score_threshold'),
                            reranking_model=dataset_configs.get('reranking_model')
                        )
                    )
            else:
                if agent_dict['strategy'] == 'react':
                    strategy = AgentEntity.Strategy.CHAIN_OF_THOUGHT
                else:
                    strategy = AgentEntity.Strategy.FUNCTION_CALLING

                agent_tools = []
                for tool in agent_dict.get('tools', []):
                    key = list(tool.keys())[0]
                    tool_item = tool[key]

                    agent_tool_properties = {
                        "tool_id": key
                    }

                    if "enabled" not in tool_item or not tool_item["enabled"]:
                        continue

                    del tool_item["enabled"]

                    agent_tool_properties["config"] = tool_item
                    agent_tools.append(AgentToolEntity(**agent_tool_properties))

                properties['agent'] = AgentEntity(
                    provider=properties['model_config'].provider,
                    model=properties['model_config'].model,
                    strategy=strategy,
                    tools=agent_tools
                )

        # file upload
        file_upload_dict = copy_app_model_config_dict.get('file_upload')
        if file_upload_dict:
            if 'image' in file_upload_dict and file_upload_dict['image']:
                if 'enabled' in file_upload_dict['image'] and file_upload_dict['image']['enabled']:
                    properties['file_upload'] = FileUploadEntity(
                        image_config={
                            'number_limits': file_upload_dict['image']['number_limits'],
                            'detail': file_upload_dict['image']['detail'],
                            'transfer_methods': file_upload_dict['image']['transfer_methods']
                        }
                    )

        # opening statement
        properties['opening_statement'] = copy_app_model_config_dict.get('opening_statement')

        # suggested questions after answer
        suggested_questions_after_answer_dict = copy_app_model_config_dict.get('suggested_questions_after_answer')
        if suggested_questions_after_answer_dict:
            if 'enabled' in suggested_questions_after_answer_dict and suggested_questions_after_answer_dict['enabled']:
                properties['suggested_questions_after_answer'] = True

        # more like this
        more_like_this_dict = copy_app_model_config_dict.get('more_like_this')
        if more_like_this_dict:
            if 'enabled' in more_like_this_dict and more_like_this_dict['enabled']:
                properties['more_like_this'] = copy_app_model_config_dict.get('opening_statement')

        # speech to text
        speech_to_text_dict = copy_app_model_config_dict.get('speech_to_text')
        if speech_to_text_dict:
            if 'enabled' in speech_to_text_dict and speech_to_text_dict['enabled']:
                properties['speech_to_text'] = True

        # show retrieve source
        retriever_resource_dict = copy_app_model_config_dict.get('retriever_resource')
        if retriever_resource_dict:
            if 'enabled' in retriever_resource_dict and retriever_resource_dict['enabled']:
                properties['show_retrieve_source'] = True

        # sensitive word avoidance
        sensitive_word_avoidance_dict = copy_app_model_config_dict.get('sensitive_word_avoidance')
        if sensitive_word_avoidance_dict:
            if 'enabled' in sensitive_word_avoidance_dict and sensitive_word_avoidance_dict['enabled']:
                properties['sensitive_word_avoidance'] = SensitiveWordAvoidanceEntity(
                    type=sensitive_word_avoidance_dict.get('type'),
                    config=sensitive_word_avoidance_dict.get('config'),
                )

        annotation_reply_dict = copy_app_model_config_dict.get('annotation_reply')
        if annotation_reply_dict:
            if 'enabled' in annotation_reply_dict and annotation_reply_dict['enabled']:
                properties['annotation_reply'] = AnnotationReplyEntity(
                    score_threshold=annotation_reply_dict.get('score_threshold'),
                    embedding_model=AnnotationReplyEmbeddingModelEntity(
                        provider=annotation_reply_dict['embedding_model']['embedding_provider_name'],
                        model=annotation_reply_dict['embedding_model']['embedding_model_name'],
                    )
                )

        return AppOrchestrationConfigEntity(**properties)

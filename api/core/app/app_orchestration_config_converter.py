from typing import cast

from core.entities.application_entities import AppOrchestrationConfigEntity, SensitiveWordAvoidanceEntity, \
    TextToSpeechEntity, DatasetRetrieveConfigEntity, DatasetEntity, AgentPromptEntity, AgentEntity, AgentToolEntity, \
    ExternalDataVariableEntity, VariableEntity, AdvancedCompletionPromptTemplateEntity, PromptTemplateEntity, \
    AdvancedChatPromptTemplateEntity, ModelConfigEntity, FileUploadEntity
from core.entities.model_entities import ModelStatus
from core.errors.error import ProviderTokenNotInitError, ModelCurrentlyNotSupportError, QuotaExceededError
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.provider_manager import ProviderManager
from core.tools.prompt.template import REACT_PROMPT_TEMPLATES


class AppOrchestrationConfigConverter:
    @classmethod
    def convert_from_app_model_config_dict(cls, tenant_id: str,
                                           app_model_config_dict: dict,
                                           skip_check: bool = False) \
            -> AppOrchestrationConfigEntity:
        """
        Convert app model config dict to entity.
        :param tenant_id: tenant ID
        :param app_model_config_dict: app model config dict
        :param skip_check: skip check
        :raises ProviderTokenNotInitError: provider token not init error
        :return: app orchestration config entity
        """
        properties = {}

        copy_app_model_config_dict = app_model_config_dict.copy()

        provider_manager = ProviderManager()
        provider_model_bundle = provider_manager.get_provider_model_bundle(
            tenant_id=tenant_id,
            provider=copy_app_model_config_dict['model']['provider'],
            model_type=ModelType.LLM
        )

        provider_name = provider_model_bundle.configuration.provider.provider
        model_name = copy_app_model_config_dict['model']['name']

        model_type_instance = provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        # check model credentials
        model_credentials = provider_model_bundle.configuration.get_current_credentials(
            model_type=ModelType.LLM,
            model=copy_app_model_config_dict['model']['name']
        )

        if model_credentials is None:
            if not skip_check:
                raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")
            else:
                model_credentials = {}

        if not skip_check:
            # check model
            provider_model = provider_model_bundle.configuration.get_provider_model(
                model=copy_app_model_config_dict['model']['name'],
                model_type=ModelType.LLM
            )

            if provider_model is None:
                model_name = copy_app_model_config_dict['model']['name']
                raise ValueError(f"Model {model_name} not exist.")

            if provider_model.status == ModelStatus.NO_CONFIGURE:
                raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")
            elif provider_model.status == ModelStatus.NO_PERMISSION:
                raise ModelCurrentlyNotSupportError(f"Dify Hosted OpenAI {model_name} currently not support.")
            elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
                raise QuotaExceededError(f"Model provider {provider_name} quota exceeded.")

        # model config
        completion_params = copy_app_model_config_dict['model'].get('completion_params')
        stop = []
        if 'stop' in completion_params:
            stop = completion_params['stop']
            del completion_params['stop']

        # get model mode
        model_mode = copy_app_model_config_dict['model'].get('mode')
        if not model_mode:
            mode_enum = model_type_instance.get_model_mode(
                model=copy_app_model_config_dict['model']['name'],
                credentials=model_credentials
            )

            model_mode = mode_enum.value

        model_schema = model_type_instance.get_model_schema(
            copy_app_model_config_dict['model']['name'],
            model_credentials
        )

        if not skip_check and not model_schema:
            raise ValueError(f"Model {model_name} not exist.")

        properties['model_config'] = ModelConfigEntity(
            provider=copy_app_model_config_dict['model']['provider'],
            model=copy_app_model_config_dict['model']['name'],
            model_schema=model_schema,
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
                for message in chat_prompt_config.get("prompt", []):
                    chat_prompt_messages.append({
                        "text": message["text"],
                        "role": PromptMessageRole.value_of(message["role"])
                    })

                advanced_chat_prompt_template = AdvancedChatPromptTemplateEntity(
                    messages=chat_prompt_messages
                )

            advanced_completion_prompt_template = None
            completion_prompt_config = copy_app_model_config_dict.get("completion_prompt_config", {})
            if completion_prompt_config:
                completion_prompt_template_params = {
                    'prompt': completion_prompt_config['prompt']['text'],
                }

                if 'conversation_histories_role' in completion_prompt_config:
                    completion_prompt_template_params['role_prefix'] = {
                        'user': completion_prompt_config['conversation_histories_role']['user_prefix'],
                        'assistant': completion_prompt_config['conversation_histories_role']['assistant_prefix']
                    }

                advanced_completion_prompt_template = AdvancedCompletionPromptTemplateEntity(
                    **completion_prompt_template_params
                )

            properties['prompt_template'] = PromptTemplateEntity(
                prompt_type=prompt_type,
                advanced_chat_prompt_template=advanced_chat_prompt_template,
                advanced_completion_prompt_template=advanced_completion_prompt_template
            )

        # external data variables
        properties['external_data_variables'] = []

        # old external_data_tools
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

        properties['variables'] = []

        # variables and external_data_tools
        for variable in copy_app_model_config_dict.get('user_input_form', []):
            typ = list(variable.keys())[0]
            if typ == 'external_data_tool':
                val = variable[typ]
                properties['external_data_variables'].append(
                    ExternalDataVariableEntity(
                        variable=val['variable'],
                        type=val['type'],
                        config=val['config']
                    )
                )
            elif typ in [
                VariableEntity.Type.TEXT_INPUT.value,
                VariableEntity.Type.PARAGRAPH.value,
                VariableEntity.Type.NUMBER.value,
            ]:
                properties['variables'].append(
                    VariableEntity(
                        type=VariableEntity.Type.value_of(typ),
                        variable=variable[typ].get('variable'),
                        description=variable[typ].get('description'),
                        label=variable[typ].get('label'),
                        required=variable[typ].get('required', False),
                        max_length=variable[typ].get('max_length'),
                        default=variable[typ].get('default'),
                    )
                )
            elif typ == VariableEntity.Type.SELECT.value:
                properties['variables'].append(
                    VariableEntity(
                        type=VariableEntity.Type.SELECT,
                        variable=variable[typ].get('variable'),
                        description=variable[typ].get('description'),
                        label=variable[typ].get('label'),
                        required=variable[typ].get('required', False),
                        options=variable[typ].get('options'),
                        default=variable[typ].get('default'),
                    )
                )

        # show retrieve source
        show_retrieve_source = False
        retriever_resource_dict = copy_app_model_config_dict.get('retriever_resource')
        if retriever_resource_dict:
            if 'enabled' in retriever_resource_dict and retriever_resource_dict['enabled']:
                show_retrieve_source = True

        properties['show_retrieve_source'] = show_retrieve_source

        dataset_ids = []
        if 'datasets' in copy_app_model_config_dict.get('dataset_configs', {}):
            datasets = copy_app_model_config_dict.get('dataset_configs', {}).get('datasets', {
                'strategy': 'router',
                'datasets': []
            })

            for dataset in datasets.get('datasets', []):
                keys = list(dataset.keys())
                if len(keys) == 0 or keys[0] != 'dataset':
                    continue
                dataset = dataset['dataset']

                if 'enabled' not in dataset or not dataset['enabled']:
                    continue

                dataset_id = dataset.get('id', None)
                if dataset_id:
                    dataset_ids.append(dataset_id)

        if 'agent_mode' in copy_app_model_config_dict and copy_app_model_config_dict['agent_mode'] \
                and 'enabled' in copy_app_model_config_dict['agent_mode'] \
                and copy_app_model_config_dict['agent_mode']['enabled']:

            agent_dict = copy_app_model_config_dict.get('agent_mode', {})
            agent_strategy = agent_dict.get('strategy', 'cot')

            if agent_strategy == 'function_call':
                strategy = AgentEntity.Strategy.FUNCTION_CALLING
            elif agent_strategy == 'cot' or agent_strategy == 'react':
                strategy = AgentEntity.Strategy.CHAIN_OF_THOUGHT
            else:
                # old configs, try to detect default strategy
                if copy_app_model_config_dict['model']['provider'] == 'openai':
                    strategy = AgentEntity.Strategy.FUNCTION_CALLING
                else:
                    strategy = AgentEntity.Strategy.CHAIN_OF_THOUGHT

            agent_tools = []
            for tool in agent_dict.get('tools', []):
                keys = tool.keys()
                if len(keys) >= 4:
                    if "enabled" not in tool or not tool["enabled"]:
                        continue

                    agent_tool_properties = {
                        'provider_type': tool['provider_type'],
                        'provider_id': tool['provider_id'],
                        'tool_name': tool['tool_name'],
                        'tool_parameters': tool['tool_parameters'] if 'tool_parameters' in tool else {}
                    }

                    agent_tools.append(AgentToolEntity(**agent_tool_properties))
                elif len(keys) == 1:
                    # old standard
                    key = list(tool.keys())[0]

                    if key != 'dataset':
                        continue

                    tool_item = tool[key]

                    if "enabled" not in tool_item or not tool_item["enabled"]:
                        continue

                    dataset_id = tool_item['id']
                    dataset_ids.append(dataset_id)

            if 'strategy' in copy_app_model_config_dict['agent_mode'] and \
                    copy_app_model_config_dict['agent_mode']['strategy'] not in ['react_router', 'router']:
                agent_prompt = agent_dict.get('prompt', None) or {}
                # check model mode
                model_mode = copy_app_model_config_dict.get('model', {}).get('mode', 'completion')
                if model_mode == 'completion':
                    agent_prompt_entity = AgentPromptEntity(
                        first_prompt=agent_prompt.get('first_prompt',
                                                      REACT_PROMPT_TEMPLATES['english']['completion']['prompt']),
                        next_iteration=agent_prompt.get('next_iteration',
                                                        REACT_PROMPT_TEMPLATES['english']['completion'][
                                                            'agent_scratchpad']),
                    )
                else:
                    agent_prompt_entity = AgentPromptEntity(
                        first_prompt=agent_prompt.get('first_prompt',
                                                      REACT_PROMPT_TEMPLATES['english']['chat']['prompt']),
                        next_iteration=agent_prompt.get('next_iteration',
                                                        REACT_PROMPT_TEMPLATES['english']['chat']['agent_scratchpad']),
                    )

                properties['agent'] = AgentEntity(
                    provider=properties['model_config'].provider,
                    model=properties['model_config'].model,
                    strategy=strategy,
                    prompt=agent_prompt_entity,
                    tools=agent_tools,
                    max_iteration=agent_dict.get('max_iteration', 5)
                )

        if len(dataset_ids) > 0:
            # dataset configs
            dataset_configs = copy_app_model_config_dict.get('dataset_configs', {'retrieval_model': 'single'})
            query_variable = copy_app_model_config_dict.get('dataset_query_variable')

            if dataset_configs['retrieval_model'] == 'single':
                properties['dataset'] = DatasetEntity(
                    dataset_ids=dataset_ids,
                    retrieve_config=DatasetRetrieveConfigEntity(
                        query_variable=query_variable,
                        retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.value_of(
                            dataset_configs['retrieval_model']
                        )
                    )
                )
            else:
                properties['dataset'] = DatasetEntity(
                    dataset_ids=dataset_ids,
                    retrieve_config=DatasetRetrieveConfigEntity(
                        query_variable=query_variable,
                        retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.value_of(
                            dataset_configs['retrieval_model']
                        ),
                        top_k=dataset_configs.get('top_k'),
                        score_threshold=dataset_configs.get('score_threshold'),
                        reranking_model=dataset_configs.get('reranking_model')
                    )
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
                properties['more_like_this'] = True

        # speech to text
        speech_to_text_dict = copy_app_model_config_dict.get('speech_to_text')
        if speech_to_text_dict:
            if 'enabled' in speech_to_text_dict and speech_to_text_dict['enabled']:
                properties['speech_to_text'] = True

        # text to speech
        text_to_speech_dict = copy_app_model_config_dict.get('text_to_speech')
        if text_to_speech_dict:
            if 'enabled' in text_to_speech_dict and text_to_speech_dict['enabled']:
                properties['text_to_speech'] = TextToSpeechEntity(
                    enabled=text_to_speech_dict.get('enabled'),
                    voice=text_to_speech_dict.get('voice'),
                    language=text_to_speech_dict.get('language'),
                )

        # sensitive word avoidance
        sensitive_word_avoidance_dict = copy_app_model_config_dict.get('sensitive_word_avoidance')
        if sensitive_word_avoidance_dict:
            if 'enabled' in sensitive_word_avoidance_dict and sensitive_word_avoidance_dict['enabled']:
                properties['sensitive_word_avoidance'] = SensitiveWordAvoidanceEntity(
                    type=sensitive_word_avoidance_dict.get('type'),
                    config=sensitive_word_avoidance_dict.get('config'),
                )

        return AppOrchestrationConfigEntity(**properties)

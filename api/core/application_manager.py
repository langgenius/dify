import json
import logging
import threading
import uuid
from typing import Any, Generator, Optional, Tuple, Union, cast

from core.app_runner.assistant_app_runner import AssistantApplicationRunner
from core.app_runner.basic_app_runner import BasicApplicationRunner
from core.app_runner.generate_task_pipeline import GenerateTaskPipeline
from core.application_queue_manager import ApplicationQueueManager, ConversationTaskStoppedException, PublishFrom
from core.entities.application_entities import (AdvancedChatPromptTemplateEntity,
                                                AdvancedCompletionPromptTemplateEntity, AgentEntity, AgentPromptEntity,
                                                AgentToolEntity, ApplicationGenerateEntity,
                                                AppOrchestrationConfigEntity, DatasetEntity,
                                                DatasetRetrieveConfigEntity, ExternalDataVariableEntity,
                                                FileUploadEntity, InvokeFrom, ModelConfigEntity, PromptTemplateEntity,
                                                SensitiveWordAvoidanceEntity)
from core.entities.model_entities import ModelStatus
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.file.file_obj import FileObj
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.prompt_template import PromptTemplateParser
from core.provider_manager import ProviderManager
from core.tools.prompt.template import REACT_PROMPT_TEMPLATES
from extensions.ext_database import db
from flask import Flask, current_app
from models.account import Account
from models.model import App, Conversation, EndUser, Message, MessageFile
from pydantic import ValidationError

logger = logging.getLogger(__name__)


class ApplicationManager:
    """
    This class is responsible for managing application
    """

    def generate(self, tenant_id: str,
                 app_id: str,
                 app_model_config_id: str,
                 app_model_config_dict: dict,
                 app_model_config_override: bool,
                 user: Union[Account, EndUser],
                 invoke_from: InvokeFrom,
                 inputs: dict[str, str],
                 query: Optional[str] = None,
                 files: Optional[list[FileObj]] = None,
                 conversation: Optional[Conversation] = None,
                 stream: bool = False,
                 extras: Optional[dict[str, Any]] = None) \
            -> Union[dict, Generator]:
        """
        Generate App response.

        :param tenant_id: workspace ID
        :param app_id: app ID
        :param app_model_config_id: app model config id
        :param app_model_config_dict: app model config dict
        :param app_model_config_override: app model config override
        :param user: account or end user
        :param invoke_from: invoke from source
        :param inputs: inputs
        :param query: query
        :param files: file obj list
        :param conversation: conversation
        :param stream: is stream
        :param extras: extras
        """
        # init task id
        task_id = str(uuid.uuid4())

        # init application generate entity
        application_generate_entity = ApplicationGenerateEntity(
            task_id=task_id,
            tenant_id=tenant_id,
            app_id=app_id,
            app_model_config_id=app_model_config_id,
            app_model_config_dict=app_model_config_dict,
            app_orchestration_config_entity=self._convert_from_app_model_config_dict(
                tenant_id=tenant_id,
                app_model_config_dict=app_model_config_dict
            ),
            app_model_config_override=app_model_config_override,
            conversation_id=conversation.id if conversation else None,
            inputs=conversation.inputs if conversation else inputs,
            query=query.replace('\x00', '') if query else None,
            files=files if files else [],
            user_id=user.id,
            stream=stream,
            invoke_from=invoke_from,
            extras=extras
        )

        if not stream and application_generate_entity.app_orchestration_config_entity.agent:
            raise ValueError("Agent app is not supported in blocking mode.")

        # init generate records
        (
            conversation,
            message
        ) = self._init_generate_records(application_generate_entity)

        # init queue manager
        queue_manager = ApplicationQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id
        )

        # new thread
        worker_thread = threading.Thread(target=self._generate_worker, kwargs={
            'flask_app': current_app._get_current_object(),
            'application_generate_entity': application_generate_entity,
            'queue_manager': queue_manager,
            'conversation_id': conversation.id,
            'message_id': message.id,
        })

        worker_thread.start()

        # return response or stream generator
        return self._handle_response(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            stream=stream
        )

    def _generate_worker(self, flask_app: Flask,
                         application_generate_entity: ApplicationGenerateEntity,
                         queue_manager: ApplicationQueueManager,
                         conversation_id: str,
                         message_id: str) -> None:
        """
        Generate worker in a new thread.
        :param flask_app: Flask app
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param conversation_id: conversation ID
        :param message_id: message ID
        :return:
        """
        with flask_app.app_context():
            try:
                # get conversation and message
                conversation = self._get_conversation(conversation_id)
                message = self._get_message(message_id)

                if application_generate_entity.app_orchestration_config_entity.agent:
                    # agent app
                    runner = AssistantApplicationRunner()
                    runner.run(
                        application_generate_entity=application_generate_entity,
                        queue_manager=queue_manager,
                        conversation=conversation,
                        message=message
                    )
                else:
                    # basic app
                    runner = BasicApplicationRunner()
                    runner.run(
                        application_generate_entity=application_generate_entity,
                        queue_manager=queue_manager,
                        conversation=conversation,
                        message=message
                    )
            except ConversationTaskStoppedException:
                pass
            except InvokeAuthorizationError:
                queue_manager.publish_error(
                    InvokeAuthorizationError('Incorrect API key provided'),
                    PublishFrom.APPLICATION_MANAGER
                )
            except ValidationError as e:
                logger.exception("Validation Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except (ValueError, InvokeError) as e:
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except Exception as e:
                logger.exception("Unknown Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            finally:
                db.session.remove()

    def _handle_response(self, application_generate_entity: ApplicationGenerateEntity,
                         queue_manager: ApplicationQueueManager,
                         conversation: Conversation,
                         message: Message,
                         stream: bool = False) -> Union[dict, Generator]:
        """
        Handle response.
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param conversation: conversation
        :param message: message
        :param stream: is stream
        :return:
        """
        # init generate task pipeline
        generate_task_pipeline = GenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message
        )

        try:
            return generate_task_pipeline.process(stream=stream)
        except ValueError as e:
            if e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise ConversationTaskStoppedException()
            else:
                logger.exception(e)
                raise e
        finally:
            db.session.remove()

    def _convert_from_app_model_config_dict(self, tenant_id: str, app_model_config_dict: dict) \
            -> AppOrchestrationConfigEntity:
        """
        Convert app model config dict to entity.
        :param tenant_id: tenant ID
        :param app_model_config_dict: app model config dict
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
            raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")

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

        if not model_schema:
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
        
        # current external_data_tools
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
        else:
            datasets = {'strategy': 'router', 'datasets': []}

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
                        first_prompt=agent_prompt.get('first_prompt', REACT_PROMPT_TEMPLATES['english']['completion']['prompt']),
                        next_iteration=agent_prompt.get('next_iteration', REACT_PROMPT_TEMPLATES['english']['completion']['agent_scratchpad']),
                    )
                else:
                    agent_prompt_entity = AgentPromptEntity(
                        first_prompt=agent_prompt.get('first_prompt', REACT_PROMPT_TEMPLATES['english']['chat']['prompt']),
                        next_iteration=agent_prompt.get('next_iteration', REACT_PROMPT_TEMPLATES['english']['chat']['agent_scratchpad']),
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
                        ),
                        single_strategy=datasets.get('strategy', 'router')
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
                properties['text_to_speech'] = True

        # sensitive word avoidance
        sensitive_word_avoidance_dict = copy_app_model_config_dict.get('sensitive_word_avoidance')
        if sensitive_word_avoidance_dict:
            if 'enabled' in sensitive_word_avoidance_dict and sensitive_word_avoidance_dict['enabled']:
                properties['sensitive_word_avoidance'] = SensitiveWordAvoidanceEntity(
                    type=sensitive_word_avoidance_dict.get('type'),
                    config=sensitive_word_avoidance_dict.get('config'),
                )

        return AppOrchestrationConfigEntity(**properties)

    def _init_generate_records(self, application_generate_entity: ApplicationGenerateEntity) \
            -> Tuple[Conversation, Message]:
        """
        Initialize generate records
        :param application_generate_entity: application generate entity
        :return:
        """
        app_orchestration_config_entity = application_generate_entity.app_orchestration_config_entity

        model_type_instance = app_orchestration_config_entity.model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)
        model_schema = model_type_instance.get_model_schema(
            model=app_orchestration_config_entity.model_config.model,
            credentials=app_orchestration_config_entity.model_config.credentials
        )

        app_record = (db.session.query(App)
                      .filter(App.id == application_generate_entity.app_id).first())

        app_mode = app_record.mode

        # get from source
        end_user_id = None
        account_id = None
        if application_generate_entity.invoke_from in [InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API]:
            from_source = 'api'
            end_user_id = application_generate_entity.user_id
        else:
            from_source = 'console'
            account_id = application_generate_entity.user_id

        override_model_configs = None
        if application_generate_entity.app_model_config_override:
            override_model_configs = application_generate_entity.app_model_config_dict

        introduction = ''
        if app_mode == 'chat':
            # get conversation introduction
            introduction = self._get_conversation_introduction(application_generate_entity)

        if not application_generate_entity.conversation_id:
            conversation = Conversation(
                app_id=app_record.id,
                app_model_config_id=application_generate_entity.app_model_config_id,
                model_provider=app_orchestration_config_entity.model_config.provider,
                model_id=app_orchestration_config_entity.model_config.model,
                override_model_configs=json.dumps(override_model_configs) if override_model_configs else None,
                mode=app_mode,
                name='New conversation',
                inputs=application_generate_entity.inputs,
                introduction=introduction,
                system_instruction="",
                system_instruction_tokens=0,
                status='normal',
                from_source=from_source,
                from_end_user_id=end_user_id,
                from_account_id=account_id,
            )

            db.session.add(conversation)
            db.session.commit()
        else:
            conversation = (
                db.session.query(Conversation)
                .filter(
                    Conversation.id == application_generate_entity.conversation_id,
                    Conversation.app_id == app_record.id
                ).first()
            )

        currency = model_schema.pricing.currency if model_schema.pricing else 'USD'

        message = Message(
            app_id=app_record.id,
            model_provider=app_orchestration_config_entity.model_config.provider,
            model_id=app_orchestration_config_entity.model_config.model,
            override_model_configs=json.dumps(override_model_configs) if override_model_configs else None,
            conversation_id=conversation.id,
            inputs=application_generate_entity.inputs,
            query=application_generate_entity.query or "",
            message="",
            message_tokens=0,
            message_unit_price=0,
            message_price_unit=0,
            answer="",
            answer_tokens=0,
            answer_unit_price=0,
            answer_price_unit=0,
            provider_response_latency=0,
            total_price=0,
            currency=currency,
            from_source=from_source,
            from_end_user_id=end_user_id,
            from_account_id=account_id,
            agent_based=app_orchestration_config_entity.agent is not None
        )

        db.session.add(message)
        db.session.commit()

        for file in application_generate_entity.files:
            message_file = MessageFile(
                message_id=message.id,
                type=file.type.value,
                transfer_method=file.transfer_method.value,
                belongs_to='user',
                url=file.url,
                upload_file_id=file.upload_file_id,
                created_by_role=('account' if account_id else 'end_user'),
                created_by=account_id or end_user_id,
            )
            db.session.add(message_file)
            db.session.commit()

        return conversation, message

    def _get_conversation_introduction(self, application_generate_entity: ApplicationGenerateEntity) -> str:
        """
        Get conversation introduction
        :param application_generate_entity: application generate entity
        :return: conversation introduction
        """
        app_orchestration_config_entity = application_generate_entity.app_orchestration_config_entity
        introduction = app_orchestration_config_entity.opening_statement

        if introduction:
            try:
                inputs = application_generate_entity.inputs
                prompt_template = PromptTemplateParser(template=introduction)
                prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}
                introduction = prompt_template.format(prompt_inputs)
            except KeyError:
                pass

        return introduction

    def _get_conversation(self, conversation_id: str) -> Conversation:
        """
        Get conversation by conversation id
        :param conversation_id: conversation id
        :return: conversation
        """
        conversation = (
            db.session.query(Conversation)
            .filter(Conversation.id == conversation_id)
            .first()
        )

        return conversation

    def _get_message(self, message_id: str) -> Message:
        """
        Get message by message id
        :param message_id: message id
        :return: message
        """
        message = (
            db.session.query(Message)
            .filter(Message.id == message_id)
            .first()
        )

        return message

import json
import logging
import threading
import time
import uuid
from typing import cast, Optional, Any, Union, Generator, Tuple

from flask import Flask, current_app

from core.app_runner.agent_app_runner import AgentApplicationRunner
from core.app_runner.basic_app_runner import BasicApplicationRunner
from core.app_runner.generate_task_pipeline import GenerateTaskPipeline
from core.entities.llm_application_entities import LLMApplicationGenerateEntity, AppOrchestrationConfigEntity, \
    ModelConfigEntity, PromptTemplateEntity, AdvancedChatMessageEntity, AdvancedChatPromptTemplateEntity, \
    AdvancedCompletionPromptTemplateEntity, ExternalDataVariableEntity, DatasetEntity, DatasetRetrieveConfigEntity, \
    AgentEntity, AgentToolEntity, FileUploadEntity, SensitiveWordAvoidanceEntity, AnnotationReplyEntity, \
    AnnotationReplyEmbeddingModelEntity, InvokeFrom, LLMApplicationGenerateResponse
from core.file.file_obj import FileObj
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.prompt_template import PromptTemplateParser
from core.provider_manager import ProviderManager
from core.pub_sub_manager import PubSubManager, ConversationTaskStoppedException
from extensions.ext_database import db
from models.account import Account
from models.model import EndUser, Conversation, Message, MessageFile, App

logger = logging.getLogger(__name__)


class LLMApplicationManager:
    """
    This class is responsible for managing LLM application
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
            -> Union[LLMApplicationGenerateResponse, Generator]:
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
        # init pubsub manager
        task_id = str(uuid.uuid4())

        # init llm application generate entity
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
            app_model_config_override=app_model_config_override,
            conversation_id=conversation.id if conversation else None,
            inputs=inputs,
            query=query.replace('\x00', '') if query else None,
            files=files if files else [],
            user_id=user.id,
            stream=stream,
            invoke_from=invoke_from,
            extras=extras
        )

        # init generate records
        (
            conversation,
            message
        ) = self._init_generate_records(llm_application_generate_entity)

        # init pubsub manager
        pubsub_manager = PubSubManager(
            task_id=llm_application_generate_entity.task_id,
            user_id=llm_application_generate_entity.user_id,
            invoke_from=llm_application_generate_entity.invoke_from
        )

        # subscribe channel, and listening in _handle_response method
        pubsub_manager.subscribe()

        # new thread
        worker_thread = threading.Thread(target=self._generate_worker, kwargs={
            'flask_app': current_app._get_current_object(),
            'llm_application_generate_entity': llm_application_generate_entity,
            'conversation_id': conversation.id,
            'message_id': message.id,
        })

        worker_thread.start()

        # wait for a limited time to close the worker thread
        self._countdown_and_stop_thread(
            flask_app=current_app._get_current_object(),
            worker_thread=worker_thread,
            pubsub_manager=pubsub_manager,
            llm_application_generate_entity=llm_application_generate_entity
        )

        # return response or stream generator
        return self._handle_response(pubsub_manager, stream)

    def _generate_worker(self, flask_app: Flask,
                         llm_application_generate_entity: LLMApplicationGenerateEntity,
                         conversation_id: str,
                         message_id: str) -> None:
        """
        Generate worker in a new thread.
        :param flask_app: Flask app
        :param llm_application_generate_entity: LLM application generate entity
        :param conversation_id: conversation ID
        :param message_id: message ID
        :return:
        """
        with flask_app.app_context():
            # init pubsub manager
            pubsub_manager = PubSubManager(
                task_id=llm_application_generate_entity.task_id,
                user_id=llm_application_generate_entity.user_id,
                invoke_from=llm_application_generate_entity.invoke_from
            )

            # init generate task pipeline
            generate_task_pipeline = GenerateTaskPipeline(
                llm_application_generate_entity=llm_application_generate_entity,
                pubsub_manager=pubsub_manager,
                conversation_id=conversation_id,
                message_id=message_id
            )

            try:
                if llm_application_generate_entity.app_orchestration_config_entity.agent:
                    # agent app
                    runner = AgentApplicationRunner()
                    runner.run(generate_task_pipeline)
                else:
                    # basic app
                    runner = BasicApplicationRunner()
                    runner.run(generate_task_pipeline)
            except (ConversationTaskInterruptException, ConversationTaskStoppedException):
                pass
            except InvokeAuthorizationError:
                pubsub_manager.pub_error(InvokeAuthorizationError('Incorrect API key provided'))
            except (ValueError, InvokeError, ProviderTokenNotInitError, QuotaExceededError,
                    ModelCurrentlyNotSupportError) as e:
                pubsub_manager.pub_error(e)
            except Exception as e:
                logger.exception("Unknown Error in completion")
                pubsub_manager.pub_error(e)
            finally:
                db.session.remove()

    def _countdown_and_stop_thread(self, flask_app: Flask,
                                   worker_thread: threading.Thread,
                                   pubsub_manager: PubSubManager,
                                   llm_application_generate_entity: LLMApplicationGenerateEntity) -> threading.Thread:
        # wait for 10 minutes to close the thread
        timeout = 600

        def close_pubsub():
            with flask_app.app_context():
                try:
                    task_id = llm_application_generate_entity.task_id
                    if llm_application_generate_entity.invoke_from in [InvokeFrom.SERVICE_API, InvokeFrom.WEB_APP]:
                        user = db.session.query(EndUser).filter(
                            EndUser.tenant_id == llm_application_generate_entity.tenant_id,
                            EndUser.id == llm_application_generate_entity.user_id
                        ).first()
                    else:
                        user = db.session.query(Account).filter(
                            Account.id == llm_application_generate_entity.user_id
                        ).first()

                    sleep_iterations = 0
                    while sleep_iterations < timeout and worker_thread.is_alive():
                        if sleep_iterations > 0 and sleep_iterations % 10 == 0:
                            pubsub_manager.ping(user, task_id)

                        time.sleep(1)
                        sleep_iterations += 1

                    if worker_thread.is_alive():
                        # todo
                        pubsub_manager.stop(user, task_id)
                        try:
                            pubsub_manager.unsubscribe()
                        except Exception:
                            pass
                finally:
                    db.session.remove()

        countdown_thread = threading.Thread(target=close_pubsub)
        countdown_thread.start()

        return countdown_thread

    def _handle_response(self, pubsub_manager: PubSubManager, stream: bool = False) -> Union[dict, Generator]:
        if not stream:
            try:
                message_result = {}
                for message in pubsub_manager.subscriber_listen():
                    if message["type"] == "message":
                        result = message["data"].decode('utf-8')
                        result = json.loads(result)
                        if result.get('error'):
                            cls.handle_error(result)
                        if result['event'] == 'message' and 'data' in result:
                            message_result['message'] = result.get('data')
                        if result['event'] == 'message_end' and 'data' in result:
                            message_result['message_end'] = result.get('data')
                            return cls.get_blocking_message_response_data(message_result)
            except ValueError as e:
                if e.args[0] != "I/O operation on closed file.":  # ignore this error
                    raise CompletionStoppedError()
                else:
                    logging.exception(e)
                    raise
            finally:
                db.session.remove()

                try:
                    pubsub_manager.unsubscribe()
                except ConnectionError:
                    pass
        else:
            def generate() -> Generator:
                try:
                    for message in pubsub_manager.subscriber_listen():
                        if message["type"] == "message":
                            result = message["data"].decode('utf-8')
                            result = json.loads(result)
                            if result.get('error'):
                                cls.handle_error(result)

                            event = result.get('event')
                            if event == "end":
                                logging.debug("{} finished".format(generate_channel))
                                break
                            if event == 'message':
                                yield "data: " + json.dumps(cls.get_message_response_data(result.get('data'))) + "\n\n"
                            elif event == 'message_replace':
                                yield "data: " + json.dumps(
                                    cls.get_message_replace_response_data(result.get('data'))) + "\n\n"
                            elif event == 'chain':
                                yield "data: " + json.dumps(cls.get_chain_response_data(result.get('data'))) + "\n\n"
                            elif event == 'agent_thought':
                                yield "data: " + json.dumps(
                                    cls.get_agent_thought_response_data(result.get('data'))) + "\n\n"
                            elif event == 'message_end':
                                yield "data: " + json.dumps(
                                    cls.get_message_end_data(result.get('data'))) + "\n\n"
                            elif event == 'ping':
                                yield "event: ping\n\n"
                            else:
                                yield "data: " + json.dumps(result) + "\n\n"
                except ValueError as e:
                    if e.args[0] != "I/O operation on closed file.":  # ignore this error
                        logging.exception(e)
                        raise
                finally:
                    db.session.remove()

                    try:
                        pubsub_manager.unsubscribe()
                    except ConnectionError:
                        pass

            return generate()

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

    def _init_generate_records(self, llm_application_generate_entity: LLMApplicationGenerateEntity) \
            -> Tuple[Conversation, Message]:
        """
        Initialize generate records
        :param llm_application_generate_entity: LLM application generate entity
        :return:
        """
        app_orchestration_config_entity = llm_application_generate_entity.app_orchestration_config_entity

        model_instance = app_orchestration_config_entity.model_config.provider_model_bundle.model_instance
        model_instance = cast(LargeLanguageModel, model_instance)
        model_schema = model_instance.get_model_schema(
            model=app_orchestration_config_entity.model_config.model,
            credentials=app_orchestration_config_entity.model_config.credentials
        )

        app_record = (db.session.query(App)
                      .filter(App.id == llm_application_generate_entity.app_id).first())

        app_mode = app_record.mode

        # get from source
        end_user_id = None
        account_id = None
        if llm_application_generate_entity.invoke_from in [InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API]:
            from_source = 'api'
            end_user_id = llm_application_generate_entity.user_id
        else:
            from_source = 'console'
            account_id = llm_application_generate_entity.user_id

        override_model_configs = None
        if llm_application_generate_entity.app_model_config_override:
            override_model_configs = llm_application_generate_entity.app_model_config_dict

        introduction = ''
        if app_mode == 'chat':
            # get conversation introduction
            introduction = self._get_conversation_introduction(llm_application_generate_entity)

        if not llm_application_generate_entity.conversation_id:
            conversation = Conversation(
                app_id=app_record.id,
                app_model_config_id=llm_application_generate_entity.app_model_config_id,
                model_provider=app_orchestration_config_entity.model_config.provider,
                model_id=app_orchestration_config_entity.model_config.model,
                override_model_configs=json.dumps(override_model_configs) if override_model_configs else None,
                mode=app_mode,
                name='New conversation',
                inputs=llm_application_generate_entity.inputs,
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
                    Conversation.id == llm_application_generate_entity.conversation_id,
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
            inputs=llm_application_generate_entity.inputs,
            query=llm_application_generate_entity.query,
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

        for file in llm_application_generate_entity.files:
            message_file = MessageFile(
                message_id=message.id,
                type=file.type.value,
                transfer_method=file.transfer_method.value,
                url=file.url,
                upload_file_id=file.upload_file_id,
                created_by_role=('account' if account_id else 'end_user'),
                created_by=account_id or end_user_id,
            )
            db.session.add(message_file)
            db.session.commit()

        return conversation, message

    def _get_conversation_introduction(self, llm_application_generate_entity: LLMApplicationGenerateEntity) -> str:
        """
        Get conversation introduction
        :param llm_application_generate_entity: LLM application generate entity
        :return: conversation introduction
        """
        app_orchestration_config_entity = llm_application_generate_entity.app_orchestration_config_entity
        introduction = app_orchestration_config_entity.opening_statement

        if introduction:
            try:
                inputs = llm_application_generate_entity.inputs
                prompt_template = PromptTemplateParser(template=introduction)
                prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}
                introduction = prompt_template.format(prompt_inputs)
            except KeyError:
                pass

        return introduction

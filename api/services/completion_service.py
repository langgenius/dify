import json
import logging
import threading
import time
import uuid
from typing import Generator, Union, Any

from flask import current_app, Flask
from redis.client import PubSub
from sqlalchemy import and_

from core.completion import Completion
from core.conversation_message_task import PubHandler, ConversationTaskStoppedException
from core.llm.error import LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, LLMRateLimitError, \
    LLMAuthorizationError, ProviderTokenNotInitError, QuotaExceededError, ModelCurrentlyNotSupportError
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.model import Conversation, AppModelConfig, App, Account, EndUser, Message
from services.app_model_config_service import AppModelConfigService
from services.errors.app import MoreLikeThisDisabledError
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.completion import CompletionStoppedError
from services.errors.conversation import ConversationNotExistsError, ConversationCompletedError
from services.errors.message import MessageNotExistsError


class CompletionService:

    @classmethod
    def completion(cls, app_model: App, user: Union[Account | EndUser], args: Any,
                   from_source: str, streaming: bool = True,
                   is_model_config_override: bool = False) -> Union[dict | Generator]:
        # is streaming mode
        inputs = args['inputs']
        query = args['query']

        if not query:
            raise ValueError('query is required')

        conversation_id = args['conversation_id'] if 'conversation_id' in args else None

        conversation = None
        if conversation_id:
            conversation_filter = [
                Conversation.id == args['conversation_id'],
                Conversation.app_id == app_model.id,
                Conversation.status == 'normal'
            ]

            if from_source == 'console':
                conversation_filter.append(Conversation.from_account_id == user.id)
            else:
                conversation_filter.append(Conversation.from_end_user_id == user.id if user else None)

            conversation = db.session.query(Conversation).filter(and_(*conversation_filter)).first()

            if not conversation:
                raise ConversationNotExistsError()

            if conversation.status != 'normal':
                raise ConversationCompletedError()

            if not conversation.override_model_configs:
                app_model_config = db.session.query(AppModelConfig).get(conversation.app_model_config_id)

                if not app_model_config:
                    raise AppModelConfigBrokenError()
            else:
                conversation_override_model_configs = json.loads(conversation.override_model_configs)
                app_model_config = AppModelConfig(
                    id=conversation.app_model_config_id,
                    app_id=app_model.id,
                    provider="",
                    model_id="",
                    configs="",
                    opening_statement=conversation_override_model_configs['opening_statement'],
                    suggested_questions=json.dumps(conversation_override_model_configs['suggested_questions']),
                    model=json.dumps(conversation_override_model_configs['model']),
                    user_input_form=json.dumps(conversation_override_model_configs['user_input_form']),
                    pre_prompt=conversation_override_model_configs['pre_prompt'],
                    agent_mode=json.dumps(conversation_override_model_configs['agent_mode']),
                )

            if is_model_config_override:
                # build new app model config
                if 'model' not in args['model_config']:
                    raise ValueError('model_config.model is required')

                if 'completion_params' not in args['model_config']['model']:
                    raise ValueError('model_config.model.completion_params is required')

                completion_params = AppModelConfigService.validate_model_completion_params(
                    cp=args['model_config']['model']['completion_params'],
                    model_name=app_model_config.model_dict["name"]
                )

                app_model_config_model = app_model_config.model_dict
                app_model_config_model['completion_params'] = completion_params

                app_model_config = AppModelConfig(
                    id=app_model_config.id,
                    app_id=app_model.id,
                    provider="",
                    model_id="",
                    configs="",
                    opening_statement=app_model_config.opening_statement,
                    suggested_questions=app_model_config.suggested_questions,
                    model=json.dumps(app_model_config_model),
                    user_input_form=app_model_config.user_input_form,
                    pre_prompt=app_model_config.pre_prompt,
                    agent_mode=app_model_config.agent_mode,
                )
        else:
            if app_model.app_model_config_id is None:
                raise AppModelConfigBrokenError()

            app_model_config = app_model.app_model_config

            if not app_model_config:
                raise AppModelConfigBrokenError()

            if is_model_config_override:
                if not isinstance(user, Account):
                    raise Exception("Only account can override model config")

                # validate config
                model_config = AppModelConfigService.validate_configuration(
                    account=user,
                    config=args['model_config'],
                    mode=app_model.mode
                )

                app_model_config = AppModelConfig(
                    id=app_model_config.id,
                    app_id=app_model.id,
                    provider="",
                    model_id="",
                    configs="",
                    opening_statement=model_config['opening_statement'],
                    suggested_questions=json.dumps(model_config['suggested_questions']),
                    suggested_questions_after_answer=json.dumps(model_config['suggested_questions_after_answer']),
                    more_like_this=json.dumps(model_config['more_like_this']),
                    model=json.dumps(model_config['model']),
                    user_input_form=json.dumps(model_config['user_input_form']),
                    pre_prompt=model_config['pre_prompt'],
                    agent_mode=json.dumps(model_config['agent_mode']),
                )

        # clean input by app_model_config form rules
        inputs = cls.get_cleaned_inputs(inputs, app_model_config)

        generate_task_id = str(uuid.uuid4())

        pubsub = redis_client.pubsub()
        pubsub.subscribe(PubHandler.generate_channel_name(user, generate_task_id))

        user = cls.get_real_user_instead_of_proxy_obj(user)

        generate_worker_thread = threading.Thread(target=cls.generate_worker, kwargs={
            'flask_app': current_app._get_current_object(),
            'generate_task_id': generate_task_id,
            'app_model': app_model,
            'app_model_config': app_model_config,
            'query': query,
            'inputs': inputs,
            'user': user,
            'conversation': conversation,
            'streaming': streaming,
            'is_model_config_override': is_model_config_override
        })

        generate_worker_thread.start()

        # wait for 5 minutes to close the thread
        cls.countdown_and_close(generate_worker_thread, pubsub, user, generate_task_id)

        return cls.compact_response(pubsub, streaming)

    @classmethod
    def get_real_user_instead_of_proxy_obj(cls, user: Union[Account, EndUser]):
        if isinstance(user, Account):
            user = db.session.query(Account).get(user.id)
        elif isinstance(user, EndUser):
            user = db.session.query(EndUser).get(user.id)
        else:
            raise Exception("Unknown user type")

        return user

    @classmethod
    def generate_worker(cls, flask_app: Flask, generate_task_id: str, app_model: App, app_model_config: AppModelConfig,
                        query: str, inputs: dict, user: Union[Account, EndUser],
                        conversation: Conversation, streaming: bool, is_model_config_override: bool):
        with flask_app.app_context():
            try:
                if conversation:
                    # fixed the state of the conversation object when it detached from the original session
                    conversation = db.session.query(Conversation).filter_by(id=conversation.id).first()

                # run
                Completion.generate(
                    task_id=generate_task_id,
                    app=app_model,
                    app_model_config=app_model_config,
                    query=query,
                    inputs=inputs,
                    user=user,
                    conversation=conversation,
                    streaming=streaming,
                    is_override=is_model_config_override,
                )
            except ConversationTaskStoppedException:
                pass
            except (LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError,
                    LLMRateLimitError, ProviderTokenNotInitError, QuotaExceededError,
                    ModelCurrentlyNotSupportError) as e:
                db.session.rollback()
                PubHandler.pub_error(user, generate_task_id, e)
            except LLMAuthorizationError:
                db.session.rollback()
                PubHandler.pub_error(user, generate_task_id, LLMAuthorizationError('Incorrect API key provided'))
            except Exception as e:
                db.session.rollback()
                logging.exception("Unknown Error in completion")
                PubHandler.pub_error(user, generate_task_id, e)

    @classmethod
    def countdown_and_close(cls, worker_thread, pubsub, user, generate_task_id) -> threading.Thread:
        # wait for 5 minutes to close the thread
        timeout = 300

        def close_pubsub():
            sleep_iterations = 0
            while sleep_iterations < timeout and worker_thread.is_alive():
                time.sleep(1)
                sleep_iterations += 1

            if worker_thread.is_alive():
                PubHandler.stop(user, generate_task_id)
                try:
                    pubsub.close()
                except:
                    pass

        countdown_thread = threading.Thread(target=close_pubsub)
        countdown_thread.start()

        return countdown_thread

    @classmethod
    def generate_more_like_this(cls, app_model: App, user: Union[Account | EndUser],
                                message_id: str, streaming: bool = True) -> Union[dict | Generator]:
        if not user:
            raise ValueError('user cannot be None')

        message = db.session.query(Message).filter(
            Message.id == message_id,
            Message.app_id == app_model.id,
            Message.from_source == ('api' if isinstance(user, EndUser) else 'console'),
            Message.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
            Message.from_account_id == (user.id if isinstance(user, Account) else None),
        ).first()

        if not message:
            raise MessageNotExistsError()

        current_app_model_config = app_model.app_model_config
        more_like_this = current_app_model_config.more_like_this_dict

        if not current_app_model_config.more_like_this or more_like_this.get("enabled", False) is False:
            raise MoreLikeThisDisabledError()

        app_model_config = message.app_model_config

        if message.override_model_configs:
            override_model_configs = json.loads(message.override_model_configs)
            pre_prompt = override_model_configs.get("pre_prompt", '')
        elif app_model_config:
            pre_prompt = app_model_config.pre_prompt
        else:
            raise AppModelConfigBrokenError()

        generate_task_id = str(uuid.uuid4())

        pubsub = redis_client.pubsub()
        pubsub.subscribe(PubHandler.generate_channel_name(user, generate_task_id))

        user = cls.get_real_user_instead_of_proxy_obj(user)

        generate_worker_thread = threading.Thread(target=cls.generate_more_like_this_worker, kwargs={
            'flask_app': current_app._get_current_object(),
            'generate_task_id': generate_task_id,
            'app_model': app_model,
            'app_model_config': app_model_config,
            'message': message,
            'pre_prompt': pre_prompt,
            'user': user,
            'streaming': streaming
        })

        generate_worker_thread.start()

        cls.countdown_and_close(generate_worker_thread, pubsub, user, generate_task_id)

        return cls.compact_response(pubsub, streaming)

    @classmethod
    def generate_more_like_this_worker(cls, flask_app: Flask, generate_task_id: str, app_model: App,
                                       app_model_config: AppModelConfig, message: Message, pre_prompt: str,
                                       user: Union[Account, EndUser], streaming: bool):
        with flask_app.app_context():
            try:
                # run
                Completion.generate_more_like_this(
                    task_id=generate_task_id,
                    app=app_model,
                    user=user,
                    message=message,
                    pre_prompt=pre_prompt,
                    app_model_config=app_model_config,
                    streaming=streaming
                )
            except ConversationTaskStoppedException:
                pass
            except (LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError,
                    LLMRateLimitError, ProviderTokenNotInitError, QuotaExceededError,
                    ModelCurrentlyNotSupportError) as e:
                db.session.rollback()
                PubHandler.pub_error(user, generate_task_id, e)
            except LLMAuthorizationError:
                db.session.rollback()
                PubHandler.pub_error(user, generate_task_id, LLMAuthorizationError('Incorrect API key provided'))
            except Exception as e:
                db.session.rollback()
                logging.exception("Unknown Error in completion")
                PubHandler.pub_error(user, generate_task_id, e)

    @classmethod
    def get_cleaned_inputs(cls, user_inputs: dict, app_model_config: AppModelConfig):
        if user_inputs is None:
            user_inputs = {}

        filtered_inputs = {}

        # Filter input variables from form configuration, handle required fields, default values, and option values
        input_form_config = app_model_config.user_input_form_list
        for config in input_form_config:
            input_config = list(config.values())[0]
            variable = input_config["variable"]

            input_type = list(config.keys())[0]

            if variable not in user_inputs or not user_inputs[variable]:
                if "required" in input_config and input_config["required"]:
                    raise ValueError(f"{variable} is required in input form")
                else:
                    filtered_inputs[variable] = input_config["default"] if "default" in input_config else ""
                    continue

            value = user_inputs[variable]

            if input_type == "select":
                options = input_config["options"] if "options" in input_config else []
                if value not in options:
                    raise ValueError(f"{variable} in input form must be one of the following: {options}")
            else:
                if 'max_length' in variable:
                    max_length = variable['max_length']
                    if len(value) > max_length:
                        raise ValueError(f'{variable} in input form must be less than {max_length} characters')

            filtered_inputs[variable] = value

        return filtered_inputs

    @classmethod
    def compact_response(cls, pubsub: PubSub, streaming: bool = False) -> Union[dict | Generator]:
        generate_channel = list(pubsub.channels.keys())[0].decode('utf-8')
        if not streaming:
            try:
                for message in pubsub.listen():
                    if message["type"] == "message":
                        result = message["data"].decode('utf-8')
                        result = json.loads(result)
                        if result.get('error'):
                            cls.handle_error(result)

                        return cls.get_message_response_data(result.get('data'))
            except ValueError as e:
                if e.args[0] != "I/O operation on closed file.":  # ignore this error
                    raise CompletionStoppedError()
                else:
                    logging.exception(e)
                    raise
            finally:
                try:
                    pubsub.unsubscribe(generate_channel)
                except ConnectionError:
                    pass
        else:
            def generate() -> Generator:
                try:
                    for message in pubsub.listen():
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
                            elif event == 'chain':
                                yield "data: " + json.dumps(cls.get_chain_response_data(result.get('data'))) + "\n\n"
                            elif event == 'agent_thought':
                                yield "data: " + json.dumps(cls.get_agent_thought_response_data(result.get('data'))) + "\n\n"
                except ValueError as e:
                    if e.args[0] != "I/O operation on closed file.":  # ignore this error
                        logging.exception(e)
                        raise
                finally:
                    try:
                        pubsub.unsubscribe(generate_channel)
                    except ConnectionError:
                        pass

            return generate()

    @classmethod
    def get_message_response_data(cls, data: dict):
        response_data = {
            'event': 'message',
            'task_id': data.get('task_id'),
            'id': data.get('message_id'),
            'answer': data.get('text'),
            'created_at': int(time.time())
        }

        if data.get('mode') == 'chat':
            response_data['conversation_id'] = data.get('conversation_id')

        return response_data

    @classmethod
    def get_chain_response_data(cls, data: dict):
        response_data = {
            'event': 'chain',
            'id': data.get('chain_id'),
            'task_id': data.get('task_id'),
            'message_id': data.get('message_id'),
            'type': data.get('type'),
            'input': data.get('input'),
            'output': data.get('output'),
            'created_at': int(time.time())
        }

        if data.get('mode') == 'chat':
            response_data['conversation_id'] = data.get('conversation_id')

        return response_data

    @classmethod
    def get_agent_thought_response_data(cls, data: dict):
        response_data = {
            'event': 'agent_thought',
            'id': data.get('agent_thought_id'),
            'chain_id': data.get('chain_id'),
            'task_id': data.get('task_id'),
            'message_id': data.get('message_id'),
            'position': data.get('position'),
            'thought': data.get('thought'),
            'tool': data.get('tool'),  # todo use real dataset obj replace it
            'tool_input': data.get('tool_input'),
            'observation': data.get('observation'),
            'answer': data.get('answer') if not data.get('thought') else '',
            'created_at': int(time.time())
        }

        if data.get('mode') == 'chat':
            response_data['conversation_id'] = data.get('conversation_id')

        return response_data

    @classmethod
    def handle_error(cls, result: dict):
        logging.debug("error: %s", result)
        error = result.get('error')
        description = result.get('description')

        # handle errors
        llm_errors = {
            'LLMBadRequestError': LLMBadRequestError,
            'LLMAPIConnectionError': LLMAPIConnectionError,
            'LLMAPIUnavailableError': LLMAPIUnavailableError,
            'LLMRateLimitError': LLMRateLimitError,
            'ProviderTokenNotInitError': ProviderTokenNotInitError,
            'QuotaExceededError': QuotaExceededError,
            'ModelCurrentlyNotSupportError': ModelCurrentlyNotSupportError
        }

        if error in llm_errors:
            raise llm_errors[error](description)
        elif error == 'LLMAuthorizationError':
            raise LLMAuthorizationError('Incorrect API key provided')
        else:
            raise Exception(description)

import json
import logging
import threading
import uuid
from collections.abc import Generator
from typing import Any, Optional, Union, cast

from flask import Flask, current_app
from pydantic import ValidationError

from core.app.app_orchestration_config_converter import AppOrchestrationConfigConverter
from core.app.agent_chat.app_runner import AgentChatAppRunner
from core.app.chat.app_runner import ChatAppRunner
from core.app.generate_task_pipeline import GenerateTaskPipeline
from core.app.app_queue_manager import AppQueueManager, ConversationTaskStoppedException, PublishFrom
from core.entities.application_entities import (
    ApplicationGenerateEntity,
    InvokeFrom,
)
from core.file.file_obj import FileObj
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from extensions.ext_database import db
from models.account import Account
from models.model import App, Conversation, EndUser, Message, MessageFile

logger = logging.getLogger(__name__)


class AppManager:
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
            app_orchestration_config_entity=AppOrchestrationConfigConverter.convert_from_app_model_config_dict(
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
        queue_manager = AppQueueManager(
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
                         queue_manager: AppQueueManager,
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
                    runner = AgentChatAppRunner()
                    runner.run(
                        application_generate_entity=application_generate_entity,
                        queue_manager=queue_manager,
                        conversation=conversation,
                        message=message
                    )
                else:
                    # basic app
                    runner = ChatAppRunner()
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
                         queue_manager: AppQueueManager,
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

    def _init_generate_records(self, application_generate_entity: ApplicationGenerateEntity) \
            -> tuple[Conversation, Message]:
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

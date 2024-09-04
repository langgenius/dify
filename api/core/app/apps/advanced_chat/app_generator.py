import contextvars
import logging
import os
import threading
import uuid
from collections.abc import Generator
from typing import Literal, Union, overload

from flask import Flask, current_app
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

import contexts
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from core.app.apps.advanced_chat.app_runner import AdvancedChatAppRunner
from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.apps.advanced_chat.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline
from core.app.apps.base_app_queue_manager import AppQueueManager, GenerateTaskStoppedException, PublishFrom
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.task_entities import ChatbotAppBlockingResponse, ChatbotAppStreamResponse
from core.file.message_file_parser import MessageFileParser
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from extensions.ext_database import db
from models.account import Account
from models.model import App, Conversation, EndUser, Message
from models.workflow import ConversationVariable, Workflow

logger = logging.getLogger(__name__)


class AdvancedChatAppGenerator(MessageBasedAppGenerator):
    @overload
    def generate(
        self, app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: dict,
        invoke_from: InvokeFrom,
        stream: Literal[True] = True,
    ) -> Generator[str, None, None]: ...

    @overload
    def generate(
        self, app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: dict,
        invoke_from: InvokeFrom,
        stream: Literal[False] = False,
    ) -> dict: ...

    def generate(
        self, app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: dict,
        invoke_from: InvokeFrom,
        stream: bool = True,
    ):
        """
        Generate App response.

        :param app_model: App
        :param workflow: Workflow
        :param user: account or end user
        :param args: request args
        :param invoke_from: invoke from source
        :param stream: is stream
        """
        if not args.get('query'):
            raise ValueError('query is required')

        query = args['query']
        if not isinstance(query, str):
            raise ValueError('query must be a string')

        query = query.replace('\x00', '')
        inputs = args['inputs']

        extras = {
            "auto_generate_conversation_name": args.get('auto_generate_name', False)
        }

        # get conversation
        conversation = None
        conversation_id = args.get('conversation_id')
        if conversation_id:
            conversation = self._get_conversation_by_user(app_model=app_model, conversation_id=conversation_id, user=user)

        # parse files
        files = args['files'] if args.get('files') else []
        message_file_parser = MessageFileParser(tenant_id=app_model.tenant_id, app_id=app_model.id)
        file_extra_config = FileUploadConfigManager.convert(workflow.features_dict, is_vision=False)
        if file_extra_config:
            file_objs = message_file_parser.validate_and_transform_files_arg(
                files,
                file_extra_config,
                user
            )
        else:
            file_objs = []

        # convert to app config
        app_config = AdvancedChatAppConfigManager.get_app_config(
            app_model=app_model,
            workflow=workflow
        )

        # get tracing instance
        user_id = user.id if isinstance(user, Account) else user.session_id
        trace_manager = TraceQueueManager(app_model.id, user_id)

        if invoke_from == InvokeFrom.DEBUGGER:
            # always enable retriever resource in debugger mode
            app_config.additional_features.show_retrieve_source = True

        # init application generate entity
        application_generate_entity = AdvancedChatAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            conversation_id=conversation.id if conversation else None,
            inputs=conversation.inputs if conversation else self._get_cleaned_inputs(inputs, app_config),
            query=query,
            files=file_objs,
            user_id=user.id,
            stream=stream,
            invoke_from=invoke_from,
            extras=extras,
            trace_manager=trace_manager
        )
        contexts.tenant_id.set(application_generate_entity.app_config.tenant_id)

        return self._generate(
            workflow=workflow,
            user=user,
            invoke_from=invoke_from,
            application_generate_entity=application_generate_entity,
            conversation=conversation,
            stream=stream
        )

    def single_iteration_generate(self, app_model: App,
                                  workflow: Workflow,
                                  node_id: str,
                                  user: Account,
                                  args: dict,
                                  stream: bool = True):
        """
        Generate App response.

        :param app_model: App
        :param workflow: Workflow
        :param user: account or end user
        :param args: request args
        :param invoke_from: invoke from source
        :param stream: is stream
        """
        if not node_id:
            raise ValueError('node_id is required')

        if args.get('inputs') is None:
            raise ValueError('inputs is required')

        extras = {
            "auto_generate_conversation_name": False
        }

        # get conversation
        conversation = None
        conversation_id = args.get('conversation_id')
        if conversation_id:
            conversation = self._get_conversation_by_user(app_model=app_model, conversation_id=conversation_id, user=user)

        # convert to app config
        app_config = AdvancedChatAppConfigManager.get_app_config(
            app_model=app_model,
            workflow=workflow
        )

        # init application generate entity
        application_generate_entity = AdvancedChatAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            conversation_id=conversation.id if conversation else None,
            inputs={},
            query='',
            files=[],
            user_id=user.id,
            stream=stream,
            invoke_from=InvokeFrom.DEBUGGER,
            extras=extras,
            single_iteration_run=AdvancedChatAppGenerateEntity.SingleIterationRunEntity(
                node_id=node_id,
                inputs=args['inputs']
            )
        )
        contexts.tenant_id.set(application_generate_entity.app_config.tenant_id)

        return self._generate(
            workflow=workflow,
            user=user,
            invoke_from=InvokeFrom.DEBUGGER,
            application_generate_entity=application_generate_entity,
            conversation=conversation,
            stream=stream
        )

    def _generate(self, *,
                 workflow: Workflow,
                 user: Union[Account, EndUser],
                 invoke_from: InvokeFrom,
                 application_generate_entity: AdvancedChatAppGenerateEntity,
                 conversation: Conversation | None = None,
                 stream: bool = True):
        is_first_conversation = False
        if not conversation:
            is_first_conversation = True

        # init generate records
        (
            conversation,
            message
        ) = self._init_generate_records(application_generate_entity, conversation)

        if is_first_conversation:
            # update conversation features
            conversation.override_model_configs = workflow.features
            db.session.commit()
            # db.session.refresh(conversation)

        # init queue manager
        queue_manager = MessageBasedAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id
        )

        # Init conversation variables
        stmt = select(ConversationVariable).where(
            ConversationVariable.app_id == conversation.app_id, ConversationVariable.conversation_id == conversation.id
        )
        with Session(db.engine) as session:
            conversation_variables = session.scalars(stmt).all()
            if not conversation_variables:
                # Create conversation variables if they don't exist.
                conversation_variables = [
                    ConversationVariable.from_variable(
                        app_id=conversation.app_id, conversation_id=conversation.id, variable=variable
                    )
                    for variable in workflow.conversation_variables
                ]
                session.add_all(conversation_variables)
            # Convert database entities to variables.
            conversation_variables = [item.to_variable() for item in conversation_variables]

            session.commit()

            # Increment dialogue count.
            conversation.dialogue_count += 1

            conversation_id = conversation.id
            conversation_dialogue_count = conversation.dialogue_count
            db.session.commit()
            db.session.refresh(conversation)

        inputs = application_generate_entity.inputs
        query = application_generate_entity.query
        files = application_generate_entity.files

        user_id = None
        if application_generate_entity.invoke_from in [InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API]:
            end_user = db.session.query(EndUser).filter(EndUser.id == application_generate_entity.user_id).first()
            if end_user:
                user_id = end_user.session_id
        else:
            user_id = application_generate_entity.user_id

        # Create a variable pool.
        system_inputs = {
            SystemVariableKey.QUERY: query,
            SystemVariableKey.FILES: files,
            SystemVariableKey.CONVERSATION_ID: conversation_id,
            SystemVariableKey.USER_ID: user_id,
            SystemVariableKey.DIALOGUE_COUNT: conversation_dialogue_count,
        }
        variable_pool = VariablePool(
            system_variables=system_inputs,
            user_inputs=inputs,
            environment_variables=workflow.environment_variables,
            conversation_variables=conversation_variables,
        )
        contexts.workflow_variable_pool.set(variable_pool)

        # new thread
        worker_thread = threading.Thread(target=self._generate_worker, kwargs={
            'flask_app': current_app._get_current_object(),
            'application_generate_entity': application_generate_entity,
            'queue_manager': queue_manager,
            'message_id': message.id,
            'context': contextvars.copy_context(),
        })

        worker_thread.start()

        # return response or stream generator
        response = self._handle_advanced_chat_response(
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            user=user,
            stream=stream,
        )

        return AdvancedChatAppGenerateResponseConverter.convert(
            response=response,
            invoke_from=invoke_from
        )

    def _generate_worker(self, flask_app: Flask,
                         application_generate_entity: AdvancedChatAppGenerateEntity,
                         queue_manager: AppQueueManager,
                         message_id: str,
                         context: contextvars.Context) -> None:
        """
        Generate worker in a new thread.
        :param flask_app: Flask app
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param conversation_id: conversation ID
        :param message_id: message ID
        :return:
        """
        for var, val in context.items():
            var.set(val)
        with flask_app.app_context():
            try:
                runner = AdvancedChatAppRunner()
                if application_generate_entity.single_iteration_run:
                    single_iteration_run = application_generate_entity.single_iteration_run
                    runner.single_iteration_run(
                        app_id=application_generate_entity.app_config.app_id,
                        workflow_id=application_generate_entity.app_config.workflow_id,
                        queue_manager=queue_manager,
                        inputs=single_iteration_run.inputs,
                        node_id=single_iteration_run.node_id,
                        user_id=application_generate_entity.user_id
                    )
                else:
                    # get message
                    message = self._get_message(message_id)

                    # chatbot app
                    runner = AdvancedChatAppRunner()
                    runner.run(
                        application_generate_entity=application_generate_entity,
                        queue_manager=queue_manager,
                        message=message
                    )
            except GenerateTaskStoppedException:
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
                if os.environ.get("DEBUG", "false").lower() == 'true':
                    logger.exception("Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except Exception as e:
                logger.exception("Unknown Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            finally:
                db.session.close()

    def _handle_advanced_chat_response(
        self,
        *,
        application_generate_entity: AdvancedChatAppGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        user: Union[Account, EndUser],
        stream: bool = False,
    ) -> Union[ChatbotAppBlockingResponse, Generator[ChatbotAppStreamResponse, None, None]]:
        """
        Handle response.
        :param application_generate_entity: application generate entity
        :param workflow: workflow
        :param queue_manager: queue manager
        :param conversation: conversation
        :param message: message
        :param user: account or end user
        :param stream: is stream
        :return:
        """
        # init generate task pipeline
        generate_task_pipeline = AdvancedChatAppGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            user=user,
            stream=stream,
        )

        try:
            return generate_task_pipeline.process()
        except ValueError as e:
            if e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise GenerateTaskStoppedException()
            else:
                logger.exception(e)
                raise e

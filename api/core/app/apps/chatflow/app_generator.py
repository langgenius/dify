import logging
import os
import uuid
from collections.abc import Generator
from typing import Union

from pydantic import ValidationError

import contexts
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.apps.base_app_queue_manager import GenerateTaskStoppedException
from core.app.apps.chatflow.app_runner import AdvancedChatAppRunner
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.file.message_file_parser import MessageFileParser
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.ops.ops_trace_manager import TraceQueueManager
from extensions.ext_database import db
from models.account import Account
from models.model import App, Conversation, EndUser
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class AdvancedChatAppGenerator(MessageBasedAppGenerator):
    def generate(
            self, app_model: App,
            workflow: Workflow,
            user: Union[Account, EndUser],
            args: dict,
            invoke_from: InvokeFrom,
            stream: bool = True,
    ) -> Union[dict, Generator[dict, None, None]]:
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
        if args.get('conversation_id'):
            conversation = self._get_conversation_by_user(app_model, args.get('conversation_id'), user)

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
        trace_manager = TraceQueueManager(app_id=app_model.id)

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
            app_model=app_model,
            workflow=workflow,
            user=user,
            invoke_from=invoke_from,
            application_generate_entity=application_generate_entity,
            conversation=conversation,
            stream=stream
        )

    def _generate(self, app_model: App,
                  workflow: Workflow,
                  user: Union[Account, EndUser],
                  invoke_from: InvokeFrom,
                  application_generate_entity: AdvancedChatAppGenerateEntity,
                  conversation: Conversation = None,
                  stream: bool = True) \
            -> Union[dict, Generator[dict, None, None]]:
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
            db.session.refresh(conversation)

        # init queue manager
        queue_manager = MessageBasedAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id
        )

        try:
            # chatbot app
            runner = AdvancedChatAppRunner()
            response = runner.run(
                application_generate_entity=application_generate_entity,
                queue_manager=queue_manager,
                conversation=conversation,
                message=message
            )
        except GenerateTaskStoppedException:
            pass
        except InvokeAuthorizationError:
            raise
        except ValidationError as e:
            logger.exception("Validation Error when generating")
            raise e
        except ValueError as e:
            if e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise GenerateTaskStoppedException()
            else:
                if os.environ.get("DEBUG") and os.environ.get("DEBUG").lower() == 'true':
                    logger.exception(e)
                raise e
        except InvokeError as e:
            if os.environ.get("DEBUG") and os.environ.get("DEBUG").lower() == 'true':
                logger.exception("Error when generating")
            raise e
        except Exception as e:
            logger.exception("Unknown Error when generating")
            raise e
        finally:
            db.session.close()

        return AdvancedChatAppGenerateResponseConverter.convert(
            response=response,
            invoke_from=invoke_from
        )

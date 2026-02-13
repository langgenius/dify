import contextvars
import logging
import threading
import uuid
from collections.abc import Generator, Mapping
from typing import Any, Literal, Union, overload

from flask import Flask, current_app
from pydantic import ValidationError

from configs import dify_config
from constants import UUID_NIL
from core.app.app_config.easy_ui_based_app.model_config.converter import ModelConfigConverter
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfigManager
from core.app.apps.agent_chat.app_runner import AgentChatAppRunner
from core.app.apps.agent_chat.generate_response_converter import AgentChatAppGenerateResponseConverter
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.agent_media import AgentMedia
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, InvokeFrom
from core.model_runtime.errors.invoke import InvokeAuthorizationError
from core.ops.ops_trace_manager import TraceQueueManager
from extensions.ext_database import db
from factories import file_factory
from libs.flask_utils import preserve_flask_contexts
from models import Account, App, EndUser
from services.conversation_service import ConversationService

logger = logging.getLogger(__name__)


class AgentChatAppGenerator(MessageBasedAppGenerator):
    @overload
    def generate(
        self,
        *,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[False],
    ) -> Mapping[str, Any]: ...

    @overload
    def generate(
        self,
        *,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[True],
    ) -> Generator[Mapping | str, None, None]: ...

    @overload
    def generate(
        self,
        *,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool,
    ) -> Union[Mapping, Generator[Mapping | str, None, None]]: ...

    def generate(
        self,
        *,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
    ) -> Union[Mapping, Generator[Mapping | str, None, None]]:
        """
        Generate App response.
        """
        if not streaming:
            raise ValueError("Agent Chat App does not support blocking mode")

        if not args.get("query"):
            raise ValueError("query is required")

        query = args["query"]
        if not isinstance(query, str):
            raise ValueError("query must be a string")

        query = query.replace("\x00", "")
        inputs = args["inputs"]

        extras = {"auto_generate_conversation_name": args.get("auto_generate_name", True)}

        conversation = None
        conversation_id = args.get("conversation_id")
        if conversation_id:
            conversation = ConversationService.get_conversation(
                app_model=app_model, conversation_id=conversation_id, user=user
            )

        app_model_config = self._get_app_model_config(app_model=app_model, conversation=conversation)

        override_model_config_dict = None
        if args.get("model_config"):
            if invoke_from != InvokeFrom.DEBUGGER:
                raise ValueError("Only in App debug mode can override model config")

            override_model_config_dict = AgentChatAppConfigManager.config_validate(
                tenant_id=app_model.tenant_id,
                config=args["model_config"],
            )
            override_model_config_dict["retriever_resource"] = {"enabled": True}

        # -------------------------
        # File parsing (existing)
        # -------------------------
        files = args.get("files") or []
        file_extra_config = FileUploadConfigManager.convert(override_model_config_dict or app_model_config.to_dict())

        if file_extra_config:
            file_objs = file_factory.build_from_mappings(
                mappings=files,
                tenant_id=app_model.tenant_id,
                config=file_extra_config,
            )
        else:
            file_objs = []

        # -------------------------
        # Media extraction (NEW)
        # -------------------------
        media: list[AgentMedia] = []

        for f in file_objs:
            if f.content_type and (f.content_type.startswith("audio/") or f.content_type.startswith("video/")):
                media.append(
                    AgentMedia(
                        file_id=f.id,
                        media_type=f.content_type,
                        filename=f.filename,
                        content_type=f.content_type,
                        size=f.size,
                        duration=getattr(f, "duration", None),
                    )
                )

        # -------------------------
        # App config & tracing
        # -------------------------
        app_config = AgentChatAppConfigManager.get_app_config(
            app_model=app_model,
            app_model_config=app_model_config,
            conversation=conversation,
            override_config_dict=override_model_config_dict,
        )

        trace_manager = TraceQueueManager(
            app_model.id,
            user.id if isinstance(user, Account) else user.session_id,
        )

        application_generate_entity = AgentChatAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            model_conf=ModelConfigConverter.convert(app_config),
            file_upload_config=file_extra_config,
            conversation_id=conversation.id if conversation else None,
            inputs=self._prepare_user_inputs(
                user_inputs=inputs,
                variables=app_config.variables,
                tenant_id=app_model.tenant_id,
            ),
            query=query,
            files=list(file_objs),
            media=media or None,
            parent_message_id=args.get("parent_message_id") if invoke_from != InvokeFrom.SERVICE_API else UUID_NIL,
            user_id=user.id,
            stream=streaming,
            invoke_from=invoke_from,
            extras=extras,
            call_depth=0,
            trace_manager=trace_manager,
        )

        (conversation, message) = self._init_generate_records(application_generate_entity, conversation)

        queue_manager = MessageBasedAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id,
        )

        context = contextvars.copy_context()

        worker_thread = threading.Thread(
            target=self._generate_worker,
            kwargs={
                "flask_app": current_app._get_current_object(),  # type: ignore
                "context": context,
                "application_generate_entity": application_generate_entity,
                "queue_manager": queue_manager,
                "conversation_id": conversation.id,
                "message_id": message.id,
            },
        )

        worker_thread.start()

        response = self._handle_response(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            user=user,
            stream=streaming,
        )

        return AgentChatAppGenerateResponseConverter.convert(response=response, invoke_from=invoke_from)

    def _generate_worker(
        self,
        flask_app: Flask,
        context: contextvars.Context,
        application_generate_entity: AgentChatAppGenerateEntity,
        queue_manager: AppQueueManager,
        conversation_id: str,
        message_id: str,
    ):
        with preserve_flask_contexts(flask_app, context_vars=context):
            try:
                conversation = self._get_conversation(conversation_id)
                message = self._get_message(message_id)

                runner = AgentChatAppRunner()
                runner.run(
                    application_generate_entity=application_generate_entity,
                    queue_manager=queue_manager,
                    conversation=conversation,
                    message=message,
                )
            except GenerateTaskStoppedError:
                pass
            except InvokeAuthorizationError:
                queue_manager.publish_error(
                    InvokeAuthorizationError("Incorrect API key provided"),
                    PublishFrom.APPLICATION_MANAGER,
                )
            except ValidationError as e:
                logger.exception("Validation Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except ValueError as e:
                if dify_config.DEBUG:
                    logger.exception("Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except Exception as e:
                logger.exception("Unknown Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            finally:
                db.session.close()

import contextvars
import logging
import threading
import uuid
from collections.abc import Generator, Mapping
from typing import Any, Literal, overload

from flask import Flask, copy_current_request_context, current_app
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.app_config.easy_ui_based_app.model_config.converter import ModelConfigConverter
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from core.app.apps.completion.app_runner import CompletionAppRunner
from core.app.apps.completion.generate_response_converter import CompletionAppGenerateResponseConverter
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity, InvokeFrom
from core.app.entities.task_entities import AppBlockingResponse, AppStreamResponse
from core.db.session_factory import session_factory
from core.helper.trace_id_helper import extract_trace_session_id_from_args
from core.ops.ops_trace_manager import TraceQueueManager
from extensions.ext_database import db
from factories import file_factory
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from models import Account, App, Conversation, EndUser, Message
from models.model import load_annotation_reply_config

logger = logging.getLogger(__name__)


class CompletionAppGenerator(MessageBasedAppGenerator):
    @overload
    def generate(
        self,
        app_model: App,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[True],
        *,
        session: Session,
    ) -> Generator[str | Mapping[str, Any]]: ...

    @overload
    def generate(
        self,
        app_model: App,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[False],
        *,
        session: Session,
    ) -> Mapping[str, Any]: ...

    @overload
    def generate(
        self,
        app_model: App,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = False,
        *,
        session: Session,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any]]: ...

    def generate(
        self,
        app_model: App,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
        *,
        session: Session,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any]]:
        """
        Generate App response.

        :param app_model: App
        :param user: account or end user
        :param args: request args
        :param invoke_from: invoke from source
        :param streaming: is stream
        """
        query = args["query"]
        if not isinstance(query, str):
            raise ValueError("query must be a string")

        query = query.replace("\x00", "")
        inputs = args["inputs"]

        # get conversation
        conversation = None

        # get app model config
        app_model_config = self._get_app_model_config(
            app_model=app_model,
            conversation=conversation,
            session=session,
        )

        # validate override model config
        override_model_config_dict = None
        if args.get("model_config"):
            if invoke_from != InvokeFrom.DEBUGGER:
                raise ValueError("Only in App debug mode can override model config")

            # validate config
            override_model_config_dict = CompletionAppConfigManager.config_validate(
                tenant_id=app_model.tenant_id, config=args.get("model_config", {}), session=session
            )

        if override_model_config_dict:
            annotation_reply = None
            effective_model_config_dict = override_model_config_dict
        else:
            annotation_reply = load_annotation_reply_config(session, app_model_config.app_id)
            effective_model_config_dict = app_model_config.to_dict(annotation_reply=annotation_reply)

        # parse files
        # TODO(QuantumGhost): Move file parsing logic to the API controller layer
        # for better separation of concerns.
        #
        # For implementation reference, see the `_parse_file` function and
        # `DraftWorkflowNodeRunApi` class which handle this properly.
        with self._bind_file_access_scope(tenant_id=app_model.tenant_id, user=user, invoke_from=invoke_from):
            files = args["files"] if args.get("files") else []
            file_extra_config = FileUploadConfigManager.convert(effective_model_config_dict)
            if file_extra_config:
                file_objs = file_factory.build_from_mappings(
                    mappings=files,
                    tenant_id=app_model.tenant_id,
                    config=file_extra_config,
                    access_controller=self._file_access_controller,
                )
            else:
                file_objs = []

            # convert to app config
            app_config = CompletionAppConfigManager.get_app_config(
                app_model=app_model,
                app_model_config=app_model_config,
                override_config_dict=override_model_config_dict,
                annotation_reply=annotation_reply,
            )

            # get tracing instance
            trace_manager = TraceQueueManager(
                app_id=app_model.id, user_id=user.id if isinstance(user, Account) else user.session_id
            )

            # init application generate entity
            application_generate_entity = CompletionAppGenerateEntity(
                task_id=str(uuid.uuid4()),
                app_config=app_config,
                model_conf=ModelConfigConverter.convert(app_config),
                file_upload_config=file_extra_config,
                inputs=self._prepare_user_inputs(
                    user_inputs=inputs, variables=app_config.variables, tenant_id=app_model.tenant_id
                ),
                query=query,
                files=list(file_objs),
                user_id=user.id,
                stream=streaming,
                invoke_from=invoke_from,
                extras={
                    **extract_trace_session_id_from_args(args),
                },
                trace_manager=trace_manager,
            )

            # init generate records
            (conversation, message) = self._init_generate_records(
                application_generate_entity,
                session=session,
            )

            response = self._start_generation(application_generate_entity, conversation, message)
            return CompletionAppGenerateResponseConverter.convert(response=response, invoke_from=invoke_from)

    def generate_from_entity(
        self,
        application_generate_entity: CompletionAppGenerateEntity,
        *,
        session_factory: sessionmaker[Session],
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any]]:
        """Persist prepared completion records before starting provider work.

        Preparation owns configuration, inputs and files. This path preserves
        those values and closes its write session before starting the worker or
        waiting for a blocking response.
        """
        with session_factory(expire_on_commit=False) as session:
            conversation, message = self._init_generate_records(application_generate_entity, session=session)
        response = self._start_generation(application_generate_entity, conversation, message)
        return CompletionAppGenerateResponseConverter.convert(
            response=response, invoke_from=application_generate_entity.invoke_from
        )

    def _start_generation(
        self,
        application_generate_entity: CompletionAppGenerateEntity,
        conversation: Conversation,
        message: Message,
    ) -> AppBlockingResponse | Generator[AppStreamResponse]:
        queue_manager = MessageBasedAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id,
        )
        context = contextvars.copy_context()

        @copy_current_request_context
        def worker_with_context() -> None:
            context.run(
                self._generate_worker,
                flask_app=current_app._get_current_object(),  # type: ignore
                application_generate_entity=application_generate_entity,
                queue_manager=queue_manager,
                message_id=message.id,
            )

        worker_thread = threading.Thread(target=worker_with_context)
        worker_thread.start()

        return self._handle_response(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            stream=application_generate_entity.stream,
        )

    def _generate_worker(
        self,
        flask_app: Flask,
        application_generate_entity: CompletionAppGenerateEntity,
        queue_manager: AppQueueManager,
        message_id: str,
    ) -> None:
        """
        Generate worker in a new thread.
        :param flask_app: Flask app
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param message_id: message ID
        :return:
        """
        with flask_app.app_context():
            try:
                # get message
                message = self._get_message(message_id)

                # chatbot app
                runner = CompletionAppRunner()
                with session_factory.create_session() as session:
                    runner.run(
                        application_generate_entity=application_generate_entity,
                        queue_manager=queue_manager,
                        message=message,
                        session=session,
                    )
            except GenerateTaskStoppedError:
                pass
            except InvokeAuthorizationError:
                queue_manager.publish_error(
                    InvokeAuthorizationError("Incorrect API key provided"), PublishFrom.APPLICATION_MANAGER
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

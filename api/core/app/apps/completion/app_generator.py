import logging
import threading
import uuid
from collections.abc import Generator, Mapping
from typing import Any, Literal, Union, overload

from flask import Flask, current_app
from pydantic import ValidationError

from configs import dify_config
from core.app.app_config.easy_ui_based_app.model_config.converter import ModelConfigConverter
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_queue_manager import AppQueueManager, GenerateTaskStoppedError, PublishFrom
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from core.app.apps.completion.app_runner import CompletionAppRunner
from core.app.apps.completion.generate_response_converter import CompletionAppGenerateResponseConverter
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity, InvokeFrom
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.ops.ops_trace_manager import TraceQueueManager
from extensions.ext_database import db
from factories import file_factory
from models import Account, App, EndUser, Message
from services.errors.app import MoreLikeThisDisabledError
from services.errors.message import MessageNotExistsError

logger = logging.getLogger(__name__)


class CompletionAppGenerator(MessageBasedAppGenerator):
    @overload
    def generate(
        self,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[True],
    ) -> Generator[str, None, None]: ...

    @overload
    def generate(
        self,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[False],
    ) -> Mapping[str, Any]: ...

    @overload
    def generate(
        self,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool,
    ) -> Mapping[str, Any] | Generator[str, None, None]: ...

    def generate(
        self,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
    ):
        """
        Generate App response.

        :param app_model: App
        :param user: account or end user
        :param args: request args
        :param invoke_from: invoke from source
        :param stream: is stream
        """
        query = args["query"]
        if not isinstance(query, str):
            raise ValueError("query must be a string")

        query = query.replace("\x00", "")
        inputs = args["inputs"]

        # get conversation
        conversation = None

        # get app model config
        app_model_config = self._get_app_model_config(app_model=app_model, conversation=conversation)

        # validate override model config
        override_model_config_dict = None
        if args.get("model_config"):
            if invoke_from != InvokeFrom.DEBUGGER:
                raise ValueError("Only in App debug mode can override model config")

            # validate config
            override_model_config_dict = CompletionAppConfigManager.config_validate(
                tenant_id=app_model.tenant_id, config=args.get("model_config", {})
            )

        # parse files
        files = args["files"] if args.get("files") else []
        file_extra_config = FileUploadConfigManager.convert(override_model_config_dict or app_model_config.to_dict())
        if file_extra_config:
            file_objs = file_factory.build_from_mappings(
                mappings=files,
                tenant_id=app_model.tenant_id,
                config=file_extra_config,
            )
        else:
            file_objs = []

        # convert to app config
        app_config = CompletionAppConfigManager.get_app_config(
            app_model=app_model, app_model_config=app_model_config, override_config_dict=override_model_config_dict
        )

        # get tracing instance
        trace_manager = TraceQueueManager(app_model.id)

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
            extras={},
            trace_manager=trace_manager,
        )

        # init generate records
        (conversation, message) = self._init_generate_records(application_generate_entity)

        # init queue manager
        queue_manager = MessageBasedAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id,
        )

        # new thread
        worker_thread = threading.Thread(
            target=self._generate_worker,
            kwargs={
                "flask_app": current_app._get_current_object(),  # type: ignore
                "application_generate_entity": application_generate_entity,
                "queue_manager": queue_manager,
                "message_id": message.id,
            },
        )

        worker_thread.start()

        # return response or stream generator
        response = self._handle_response(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            user=user,
            stream=streaming,
        )

        return CompletionAppGenerateResponseConverter.convert(response=response, invoke_from=invoke_from)

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
                if message is None:
                    raise MessageNotExistsError()

                # chatbot app
                runner = CompletionAppRunner()
                runner.run(
                    application_generate_entity=application_generate_entity,
                    queue_manager=queue_manager,
                    message=message,
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
            except (ValueError, InvokeError) as e:
                if dify_config.DEBUG:
                    logger.exception("Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            except Exception as e:
                logger.exception("Unknown Error when generating")
                queue_manager.publish_error(e, PublishFrom.APPLICATION_MANAGER)
            finally:
                db.session.close()

    def generate_more_like_this(
        self,
        app_model: App,
        message_id: str,
        user: Union[Account, EndUser],
        invoke_from: InvokeFrom,
        stream: bool = True,
    ) -> Union[Mapping[str, Any], Generator[str, None, None]]:
        """
        Generate App response.

        :param app_model: App
        :param message_id: message ID
        :param user: account or end user
        :param invoke_from: invoke from source
        :param stream: is stream
        """
        message = (
            db.session.query(Message)
            .filter(
                Message.id == message_id,
                Message.app_id == app_model.id,
                Message.from_source == ("api" if isinstance(user, EndUser) else "console"),
                Message.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
                Message.from_account_id == (user.id if isinstance(user, Account) else None),
            )
            .first()
        )

        if not message:
            raise MessageNotExistsError()

        current_app_model_config = app_model.app_model_config
        more_like_this = current_app_model_config.more_like_this_dict

        if not current_app_model_config.more_like_this or more_like_this.get("enabled", False) is False:
            raise MoreLikeThisDisabledError()

        app_model_config = message.app_model_config
        override_model_config_dict = app_model_config.to_dict()
        model_dict = override_model_config_dict["model"]
        completion_params = model_dict.get("completion_params")
        completion_params["temperature"] = 0.9
        model_dict["completion_params"] = completion_params
        override_model_config_dict["model"] = model_dict

        # parse files
        file_extra_config = FileUploadConfigManager.convert(override_model_config_dict)
        if file_extra_config:
            file_objs = file_factory.build_from_mappings(
                mappings=message.message_files,
                tenant_id=app_model.tenant_id,
                config=file_extra_config,
            )
        else:
            file_objs = []

        # convert to app config
        app_config = CompletionAppConfigManager.get_app_config(
            app_model=app_model, app_model_config=app_model_config, override_config_dict=override_model_config_dict
        )

        # init application generate entity
        application_generate_entity = CompletionAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            model_conf=ModelConfigConverter.convert(app_config),
            inputs=message.inputs,
            query=message.query,
            files=list(file_objs),
            user_id=user.id,
            stream=stream,
            invoke_from=invoke_from,
            extras={},
        )

        # init generate records
        (conversation, message) = self._init_generate_records(application_generate_entity)

        # init queue manager
        queue_manager = MessageBasedAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id,
        )

        # new thread
        worker_thread = threading.Thread(
            target=self._generate_worker,
            kwargs={
                "flask_app": current_app._get_current_object(),  # type: ignore
                "application_generate_entity": application_generate_entity,
                "queue_manager": queue_manager,
                "message_id": message.id,
            },
        )

        worker_thread.start()

        # return response or stream generator
        response = self._handle_response(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            user=user,
            stream=stream,
        )

        return CompletionAppGenerateResponseConverter.convert(response=response, invoke_from=invoke_from)

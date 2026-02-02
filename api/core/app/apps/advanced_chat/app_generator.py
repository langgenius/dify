from __future__ import annotations

import contextvars
import logging
import threading
import uuid
from collections.abc import Generator, Mapping
from typing import TYPE_CHECKING, Any, Literal, Union, overload

from flask import Flask, current_app
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import contexts
from configs import dify_config
from constants import UUID_NIL

if TYPE_CHECKING:
    from controllers.console.app.workflow import LoopNodeRunPayload
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from core.app.apps.advanced_chat.app_runner import AdvancedChatAppRunner
from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.apps.advanced_chat.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.task_entities import ChatbotAppBlockingResponse, ChatbotAppStreamResponse
from core.helper.trace_id_helper import extract_external_trace_id_from_args
from core.model_runtime.errors.invoke import InvokeAuthorizationError
from core.ops.ops_trace_manager import TraceQueueManager
from core.prompt.utils.get_thread_messages_length import get_thread_messages_length
from core.repositories import DifyCoreRepositoryFactory
from core.workflow.repositories.draft_variable_repository import (
    DraftVariableSaverFactory,
)
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader
from extensions.ext_database import db
from factories import file_factory
from libs.flask_utils import preserve_flask_contexts
from models import Account, App, Conversation, EndUser, Message, Workflow, WorkflowNodeExecutionTriggeredFrom
from models.enums import WorkflowRunTriggeredFrom
from services.conversation_service import ConversationService
from services.workflow_draft_variable_service import (
    DraftVarLoader,
    WorkflowDraftVariableService,
)

logger = logging.getLogger(__name__)


class AdvancedChatAppGenerator(MessageBasedAppGenerator):
    _dialogue_count: int

    @overload
    def generate(
        self,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[False],
    ) -> Mapping[str, Any]: ...

    @overload
    def generate(
        self,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping,
        invoke_from: InvokeFrom,
        streaming: Literal[True],
    ) -> Generator[Mapping | str, None, None]: ...

    @overload
    def generate(
        self,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping,
        invoke_from: InvokeFrom,
        streaming: bool,
    ) -> Mapping[str, Any] | Generator[str | Mapping, None, None]: ...

    def generate(
        self,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping,
        invoke_from: InvokeFrom,
        streaming: bool = True,
    ) -> Mapping[str, Any] | Generator[str | Mapping, None, None]:
        """
        Generate App response.

        :param app_model: App
        :param workflow: Workflow
        :param user: account or end user
        :param args: request args
        :param invoke_from: invoke from source
        :param streaming: is stream
        """
        if not args.get("query"):
            raise ValueError("query is required")

        query = args["query"]
        if not isinstance(query, str):
            raise ValueError("query must be a string")

        query = query.replace("\x00", "")
        inputs = args["inputs"]

        extras = {
            "auto_generate_conversation_name": args.get("auto_generate_name", False),
            **extract_external_trace_id_from_args(args),
        }

        # get conversation
        conversation = None
        conversation_id = args.get("conversation_id")
        if conversation_id:
            conversation = ConversationService.get_conversation(
                app_model=app_model, conversation_id=conversation_id, user=user
            )

        # parse files
        # TODO(QuantumGhost): Move file parsing logic to the API controller layer
        # for better separation of concerns.
        #
        # For implementation reference, see the `_parse_file` function and
        # `DraftWorkflowNodeRunApi` class which handle this properly.
        files = args["files"] if args.get("files") else []
        file_extra_config = FileUploadConfigManager.convert(workflow.features_dict, is_vision=False)
        if file_extra_config:
            file_objs = file_factory.build_from_mappings(
                mappings=files,
                tenant_id=app_model.tenant_id,
                config=file_extra_config,
            )
        else:
            file_objs = []

        # convert to app config
        app_config = AdvancedChatAppConfigManager.get_app_config(app_model=app_model, workflow=workflow)

        # get tracing instance
        trace_manager = TraceQueueManager(
            app_id=app_model.id, user_id=user.id if isinstance(user, Account) else user.session_id
        )

        if invoke_from == InvokeFrom.DEBUGGER:
            # always enable retriever resource in debugger mode
            app_config.additional_features.show_retrieve_source = True  # type: ignore

        workflow_run_id = str(uuid.uuid4())
        # init application generate entity
        application_generate_entity = AdvancedChatAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            file_upload_config=file_extra_config,
            conversation_id=conversation.id if conversation else None,
            inputs=self._prepare_user_inputs(
                user_inputs=inputs, variables=app_config.variables, tenant_id=app_model.tenant_id
            ),
            query=query,
            files=list(file_objs),
            parent_message_id=args.get("parent_message_id") if invoke_from != InvokeFrom.SERVICE_API else UUID_NIL,
            user_id=user.id,
            stream=streaming,
            invoke_from=invoke_from,
            extras=extras,
            trace_manager=trace_manager,
            workflow_run_id=workflow_run_id,
        )
        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        # Create repositories
        #
        # Create session factory
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        # Create workflow execution(aka workflow run) repository
        if invoke_from == InvokeFrom.DEBUGGER:
            workflow_triggered_from = WorkflowRunTriggeredFrom.DEBUGGING
        else:
            workflow_triggered_from = WorkflowRunTriggeredFrom.APP_RUN
        workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=workflow_triggered_from,
        )
        # Create workflow node execution repository
        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        return self._generate(
            workflow=workflow,
            user=user,
            invoke_from=invoke_from,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            conversation=conversation,
            stream=streaming,
        )

    def single_iteration_generate(
        self,
        app_model: App,
        workflow: Workflow,
        node_id: str,
        user: Account | EndUser,
        args: Mapping,
        streaming: bool = True,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], Any, None]:
        """
        Generate App response.

        :param app_model: App
        :param workflow: Workflow
        :param node_id: the node id
        :param user: account or end user
        :param args: request args
        :param streaming: is streamed
        """
        if not node_id:
            raise ValueError("node_id is required")

        if args.get("inputs") is None:
            raise ValueError("inputs is required")

        # convert to app config
        app_config = AdvancedChatAppConfigManager.get_app_config(app_model=app_model, workflow=workflow)

        # init application generate entity
        application_generate_entity = AdvancedChatAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            conversation_id=None,
            inputs={},
            query="",
            files=[],
            user_id=user.id,
            stream=streaming,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={"auto_generate_conversation_name": False},
            single_iteration_run=AdvancedChatAppGenerateEntity.SingleIterationRunEntity(
                node_id=node_id, inputs=args["inputs"]
            ),
        )
        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        # Create repositories
        #
        # Create session factory
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        # Create workflow execution(aka workflow run) repository
        workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        )
        # Create workflow node execution repository
        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        var_loader = DraftVarLoader(
            engine=db.engine,
            app_id=application_generate_entity.app_config.app_id,
            tenant_id=application_generate_entity.app_config.tenant_id,
        )
        draft_var_srv = WorkflowDraftVariableService(db.session())
        draft_var_srv.prefill_conversation_variable_default_values(workflow)

        return self._generate(
            workflow=workflow,
            user=user,
            invoke_from=InvokeFrom.DEBUGGER,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            conversation=None,
            stream=streaming,
            variable_loader=var_loader,
        )

    def single_loop_generate(
        self,
        app_model: App,
        workflow: Workflow,
        node_id: str,
        user: Account | EndUser,
        args: LoopNodeRunPayload,
        streaming: bool = True,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], Any, None]:
        """
        Generate App response.

        :param app_model: App
        :param workflow: Workflow
        :param node_id: the node id
        :param user: account or end user
        :param args: request args
        :param streaming: is stream
        """
        if not node_id:
            raise ValueError("node_id is required")

        if args.inputs is None:
            raise ValueError("inputs is required")

        # convert to app config
        app_config = AdvancedChatAppConfigManager.get_app_config(app_model=app_model, workflow=workflow)

        # init application generate entity
        application_generate_entity = AdvancedChatAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            conversation_id=None,
            inputs={},
            query="",
            files=[],
            user_id=user.id,
            stream=streaming,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={"auto_generate_conversation_name": False},
            single_loop_run=AdvancedChatAppGenerateEntity.SingleLoopRunEntity(node_id=node_id, inputs=args.inputs),
        )
        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        # Create repositories
        #
        # Create session factory
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        # Create workflow execution(aka workflow run) repository
        workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        )
        # Create workflow node execution repository
        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            user=user,
            app_id=application_generate_entity.app_config.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        )
        var_loader = DraftVarLoader(
            engine=db.engine,
            app_id=application_generate_entity.app_config.app_id,
            tenant_id=application_generate_entity.app_config.tenant_id,
        )
        draft_var_srv = WorkflowDraftVariableService(db.session())
        draft_var_srv.prefill_conversation_variable_default_values(workflow)

        return self._generate(
            workflow=workflow,
            user=user,
            invoke_from=InvokeFrom.DEBUGGER,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            conversation=None,
            stream=streaming,
            variable_loader=var_loader,
        )

    def _generate(
        self,
        *,
        workflow: Workflow,
        user: Union[Account, EndUser],
        invoke_from: InvokeFrom,
        application_generate_entity: AdvancedChatAppGenerateEntity,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        conversation: Conversation | None = None,
        stream: bool = True,
        variable_loader: VariableLoader = DUMMY_VARIABLE_LOADER,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], Any, None]:
        """
        Generate App response.

        :param workflow: Workflow
        :param user: account or end user
        :param invoke_from: invoke from source
        :param application_generate_entity: application generate entity
        :param workflow_execution_repository: repository for workflow execution
        :param workflow_node_execution_repository: repository for workflow node execution
        :param conversation: conversation
        :param stream: is stream
        """
        is_first_conversation = False
        if not conversation:
            is_first_conversation = True

        # init generate records
        (conversation, message) = self._init_generate_records(application_generate_entity, conversation)

        if is_first_conversation:
            # update conversation features
            conversation.override_model_configs = workflow.features
            db.session.commit()
            db.session.refresh(conversation)

        # get conversation dialogue count
        # NOTE: dialogue_count should not start from 0,
        # because during the first conversation, dialogue_count should be 1.
        self._dialogue_count = get_thread_messages_length(conversation.id) + 1

        # init queue manager
        queue_manager = MessageBasedAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            conversation_id=conversation.id,
            app_mode=conversation.mode,
            message_id=message.id,
        )

        # new thread with request context and contextvars
        context = contextvars.copy_context()

        worker_thread = threading.Thread(
            target=self._generate_worker,
            kwargs={
                "flask_app": current_app._get_current_object(),  # type: ignore
                "application_generate_entity": application_generate_entity,
                "queue_manager": queue_manager,
                "conversation_id": conversation.id,
                "message_id": message.id,
                "context": context,
                "variable_loader": variable_loader,
                "workflow_execution_repository": workflow_execution_repository,
                "workflow_node_execution_repository": workflow_node_execution_repository,
            },
        )

        worker_thread.start()

        # release database connection, because the following new thread operations may take a long time
        db.session.refresh(workflow)
        db.session.refresh(message)
        # db.session.refresh(user)
        db.session.close()

        # return response or stream generator
        response = self._handle_advanced_chat_response(
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            user=user,
            stream=stream,
            draft_var_saver_factory=self._get_draft_var_saver_factory(invoke_from, account=user),
        )

        return AdvancedChatAppGenerateResponseConverter.convert(response=response, invoke_from=invoke_from)

    def _generate_worker(
        self,
        flask_app: Flask,
        application_generate_entity: AdvancedChatAppGenerateEntity,
        queue_manager: AppQueueManager,
        conversation_id: str,
        message_id: str,
        context: contextvars.Context,
        variable_loader: VariableLoader,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ):
        """
        Generate worker in a new thread.
        :param flask_app: Flask app
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param conversation_id: conversation ID
        :param message_id: message ID
        :return:
        """

        with preserve_flask_contexts(flask_app, context_vars=context):
            # get conversation and message
            conversation = self._get_conversation(conversation_id)
            message = self._get_message(message_id)

            with Session(db.engine, expire_on_commit=False) as session:
                workflow = session.scalar(
                    select(Workflow).where(
                        Workflow.tenant_id == application_generate_entity.app_config.tenant_id,
                        Workflow.app_id == application_generate_entity.app_config.app_id,
                        Workflow.id == application_generate_entity.app_config.workflow_id,
                    )
                )
                if workflow is None:
                    raise ValueError("Workflow not found")

                # Determine system_user_id based on invocation source
                is_external_api_call = application_generate_entity.invoke_from in {
                    InvokeFrom.WEB_APP,
                    InvokeFrom.SERVICE_API,
                }

                if is_external_api_call:
                    # For external API calls, use end user's session ID
                    end_user = session.scalar(select(EndUser).where(EndUser.id == application_generate_entity.user_id))
                    system_user_id = end_user.session_id if end_user else ""
                else:
                    # For internal calls, use the original user ID
                    system_user_id = application_generate_entity.user_id

                app = session.scalar(select(App).where(App.id == application_generate_entity.app_config.app_id))
                if app is None:
                    raise ValueError("App not found")

            runner = AdvancedChatAppRunner(
                application_generate_entity=application_generate_entity,
                queue_manager=queue_manager,
                conversation=conversation,
                message=message,
                dialogue_count=self._dialogue_count,
                variable_loader=variable_loader,
                workflow=workflow,
                system_user_id=system_user_id,
                app=app,
                workflow_execution_repository=workflow_execution_repository,
                workflow_node_execution_repository=workflow_node_execution_repository,
            )

            try:
                runner.run()
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

    def _handle_advanced_chat_response(
        self,
        *,
        application_generate_entity: AdvancedChatAppGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        user: Union[Account, EndUser],
        draft_var_saver_factory: DraftVariableSaverFactory,
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
            dialogue_count=self._dialogue_count,
            stream=stream,
            draft_var_saver_factory=draft_var_saver_factory,
        )

        try:
            return generate_task_pipeline.process()
        except ValueError as e:
            if len(e.args) > 0 and e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise GenerateTaskStoppedError()
            else:
                logger.exception("Failed to process generate task pipeline, conversation_id: %s", conversation.id)
                raise e

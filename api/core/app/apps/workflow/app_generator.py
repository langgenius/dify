import contextvars
import logging
import threading
import uuid
from collections.abc import Generator, Mapping, Sequence
from typing import Any, Literal, Optional, Union, overload

from flask import Flask, current_app
from pydantic import ValidationError
from sqlalchemy.orm import sessionmaker

import contexts
from configs import dify_config
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.base_app_queue_manager import AppQueueManager, GenerateTaskStoppedError, PublishFrom
from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.task_entities import WorkflowAppBlockingResponse, WorkflowAppStreamResponse
from core.model_runtime.errors.invoke import InvokeAuthorizationError
from core.ops.ops_trace_manager import TraceQueueManager
from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.repository.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.workflow_app_generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from extensions.ext_database import db
from factories import file_factory
from models import Account, App, EndUser, Workflow

logger = logging.getLogger(__name__)


class WorkflowAppGenerator(BaseAppGenerator):
    @overload
    def generate(
        self,
        *,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[True],
        call_depth: int,
        workflow_thread_pool_id: Optional[str],
    ) -> Generator[Mapping | str, None, None]: ...

    @overload
    def generate(
        self,
        *,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: Literal[False],
        call_depth: int,
        workflow_thread_pool_id: Optional[str],
    ) -> Mapping[str, Any]: ...

    @overload
    def generate(
        self,
        *,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool,
        call_depth: int,
        workflow_thread_pool_id: Optional[str],
    ) -> Union[Mapping[str, Any], Generator[Mapping | str, None, None]]: ...

    def generate(
        self,
        *,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
        call_depth: int = 0,
        workflow_thread_pool_id: Optional[str] = None,
    ) -> Union[Mapping[str, Any], Generator[Mapping | str, None, None]]:
        files: Sequence[Mapping[str, Any]] = args.get("files") or []

        # parse files
        file_extra_config = FileUploadConfigManager.convert(workflow.features_dict, is_vision=False)
        system_files = file_factory.build_from_mappings(
            mappings=files,
            tenant_id=app_model.tenant_id,
            config=file_extra_config,
            strict_type_validation=True if invoke_from == InvokeFrom.SERVICE_API else False,
        )

        # convert to app config
        app_config = WorkflowAppConfigManager.get_app_config(
            app_model=app_model,
            workflow=workflow,
        )

        # get tracing instance
        trace_manager = TraceQueueManager(
            app_id=app_model.id,
            user_id=user.id if isinstance(user, Account) else user.session_id,
        )

        inputs: Mapping[str, Any] = args["inputs"]
        workflow_run_id = str(uuid.uuid4())
        # init application generate entity
        application_generate_entity = WorkflowAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            file_upload_config=file_extra_config,
            inputs=self._prepare_user_inputs(
                user_inputs=inputs,
                variables=app_config.variables,
                tenant_id=app_model.tenant_id,
                strict_type_validation=True if invoke_from == InvokeFrom.SERVICE_API else False,
            ),
            files=list(system_files),
            user_id=user.id,
            stream=streaming,
            invoke_from=invoke_from,
            call_depth=call_depth,
            trace_manager=trace_manager,
            workflow_run_id=workflow_run_id,
        )

        contexts.tenant_id.set(application_generate_entity.app_config.tenant_id)
        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        # Create workflow node execution repository
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        workflow_node_execution_repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            tenant_id=application_generate_entity.app_config.tenant_id,
            app_id=application_generate_entity.app_config.app_id,
        )

        return self._generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            application_generate_entity=application_generate_entity,
            invoke_from=invoke_from,
            workflow_node_execution_repository=workflow_node_execution_repository,
            streaming=streaming,
            workflow_thread_pool_id=workflow_thread_pool_id,
        )

    def _generate(
        self,
        *,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        application_generate_entity: WorkflowAppGenerateEntity,
        invoke_from: InvokeFrom,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        streaming: bool = True,
        workflow_thread_pool_id: Optional[str] = None,
    ) -> Union[Mapping[str, Any], Generator[str | Mapping[str, Any], None, None]]:
        """
        Generate App response.

        :param app_model: App
        :param workflow: Workflow
        :param user: account or end user
        :param application_generate_entity: application generate entity
        :param invoke_from: invoke from source
        :param workflow_node_execution_repository: repository for workflow node execution
        :param streaming: is stream
        :param workflow_thread_pool_id: workflow thread pool id
        """
        # init queue manager
        queue_manager = WorkflowAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            app_mode=app_model.mode,
        )

        # new thread
        worker_thread = threading.Thread(
            target=self._generate_worker,
            kwargs={
                "flask_app": current_app._get_current_object(),  # type: ignore
                "application_generate_entity": application_generate_entity,
                "queue_manager": queue_manager,
                "context": contextvars.copy_context(),
                "workflow_thread_pool_id": workflow_thread_pool_id,
            },
        )

        worker_thread.start()

        # return response or stream generator
        response = self._handle_response(
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            user=user,
            workflow_node_execution_repository=workflow_node_execution_repository,
            stream=streaming,
        )

        return WorkflowAppGenerateResponseConverter.convert(response=response, invoke_from=invoke_from)

    def single_iteration_generate(
        self,
        app_model: App,
        workflow: Workflow,
        node_id: str,
        user: Account | EndUser,
        args: Mapping[str, Any],
        streaming: bool = True,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], None, None]:
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
        app_config = WorkflowAppConfigManager.get_app_config(app_model=app_model, workflow=workflow)

        # init application generate entity
        application_generate_entity = WorkflowAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            inputs={},
            files=[],
            user_id=user.id,
            stream=streaming,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={"auto_generate_conversation_name": False},
            single_iteration_run=WorkflowAppGenerateEntity.SingleIterationRunEntity(
                node_id=node_id, inputs=args["inputs"]
            ),
            workflow_run_id=str(uuid.uuid4()),
        )
        contexts.tenant_id.set(application_generate_entity.app_config.tenant_id)
        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        # Create workflow node execution repository
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        workflow_node_execution_repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            tenant_id=application_generate_entity.app_config.tenant_id,
            app_id=application_generate_entity.app_config.app_id,
        )

        return self._generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            invoke_from=InvokeFrom.DEBUGGER,
            application_generate_entity=application_generate_entity,
            workflow_node_execution_repository=workflow_node_execution_repository,
            streaming=streaming,
        )

    def single_loop_generate(
        self,
        app_model: App,
        workflow: Workflow,
        node_id: str,
        user: Account | EndUser,
        args: Mapping[str, Any],
        streaming: bool = True,
    ) -> Mapping[str, Any] | Generator[str | Mapping[str, Any], None, None]:
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
        app_config = WorkflowAppConfigManager.get_app_config(app_model=app_model, workflow=workflow)

        # init application generate entity
        application_generate_entity = WorkflowAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            inputs={},
            files=[],
            user_id=user.id,
            stream=streaming,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={"auto_generate_conversation_name": False},
            single_loop_run=WorkflowAppGenerateEntity.SingleLoopRunEntity(node_id=node_id, inputs=args["inputs"]),
            workflow_run_id=str(uuid.uuid4()),
        )
        contexts.tenant_id.set(application_generate_entity.app_config.tenant_id)
        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        # Create workflow node execution repository
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        workflow_node_execution_repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            tenant_id=application_generate_entity.app_config.tenant_id,
            app_id=application_generate_entity.app_config.app_id,
        )

        return self._generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            invoke_from=InvokeFrom.DEBUGGER,
            application_generate_entity=application_generate_entity,
            workflow_node_execution_repository=workflow_node_execution_repository,
            streaming=streaming,
        )

    def _generate_worker(
        self,
        flask_app: Flask,
        application_generate_entity: WorkflowAppGenerateEntity,
        queue_manager: AppQueueManager,
        context: contextvars.Context,
        workflow_thread_pool_id: Optional[str] = None,
    ) -> None:
        """
        Generate worker in a new thread.
        :param flask_app: Flask app
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param workflow_thread_pool_id: workflow thread pool id
        :return:
        """
        for var, val in context.items():
            var.set(val)
        with flask_app.app_context():
            try:
                # workflow app
                runner = WorkflowAppRunner(
                    application_generate_entity=application_generate_entity,
                    queue_manager=queue_manager,
                    workflow_thread_pool_id=workflow_thread_pool_id,
                )

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

    def _handle_response(
        self,
        application_generate_entity: WorkflowAppGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        user: Union[Account, EndUser],
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        stream: bool = False,
    ) -> Union[WorkflowAppBlockingResponse, Generator[WorkflowAppStreamResponse, None, None]]:
        """
        Handle response.
        :param application_generate_entity: application generate entity
        :param workflow: workflow
        :param queue_manager: queue manager
        :param user: account or end user
        :param stream: is stream
        :param workflow_node_execution_repository: optional repository for workflow node execution
        :return:
        """
        # init generate task pipeline
        generate_task_pipeline = WorkflowAppGenerateTaskPipeline(
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            user=user,
            stream=stream,
            workflow_node_execution_repository=workflow_node_execution_repository,
        )

        try:
            return generate_task_pipeline.process()
        except ValueError as e:
            if len(e.args) > 0 and e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise GenerateTaskStoppedError()
            else:
                logger.exception(
                    f"Fails to process generate task pipeline, task_id: {application_generate_entity.task_id}"
                )
                raise e

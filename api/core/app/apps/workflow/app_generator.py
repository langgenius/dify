from __future__ import annotations

import contextvars
import logging
import threading
import uuid
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal, Union, overload

from flask import Flask, current_app
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

import contexts
from configs import dify_config
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.task_entities import WorkflowAppBlockingResponse, WorkflowAppStreamResponse
from core.db.session_factory import session_factory
from core.helper.trace_id_helper import extract_external_trace_id_from_args
from core.model_runtime.errors.invoke import InvokeAuthorizationError
from core.ops.ops_trace_manager import TraceQueueManager
from core.repositories import DifyCoreRepositoryFactory
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.repositories.draft_variable_repository import DraftVariableSaverFactory
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader
from extensions.ext_database import db
from factories import file_factory
from libs.flask_utils import preserve_flask_contexts
from models import Account, App, EndUser, Workflow, WorkflowNodeExecutionTriggeredFrom
from models.enums import WorkflowRunTriggeredFrom
from services.workflow_draft_variable_service import DraftVarLoader, WorkflowDraftVariableService

if TYPE_CHECKING:
    from controllers.console.app.workflow import LoopNodeRunPayload

SKIP_PREPARE_USER_INPUTS_KEY = "_skip_prepare_user_inputs"

logger = logging.getLogger(__name__)


class WorkflowAppGenerator(BaseAppGenerator):
    @staticmethod
    def _should_prepare_user_inputs(args: Mapping[str, Any]) -> bool:
        return not bool(args.get(SKIP_PREPARE_USER_INPUTS_KEY))

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
        triggered_from: WorkflowRunTriggeredFrom | None = None,
        root_node_id: str | None = None,
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
    ) -> Generator[Mapping[str, Any] | str, None, None]: ...

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
        triggered_from: WorkflowRunTriggeredFrom | None = None,
        root_node_id: str | None = None,
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
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
        triggered_from: WorkflowRunTriggeredFrom | None = None,
        root_node_id: str | None = None,
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
    ) -> Union[Mapping[str, Any], Generator[Mapping[str, Any] | str, None, None]]: ...

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
        triggered_from: WorkflowRunTriggeredFrom | None = None,
        root_node_id: str | None = None,
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
    ) -> Union[Mapping[str, Any], Generator[Mapping[str, Any] | str, None, None]]:
        files: Sequence[Mapping[str, Any]] = args.get("files") or []

        # parse files
        # TODO(QuantumGhost): Move file parsing logic to the API controller layer
        # for better separation of concerns.
        #
        # For implementation reference, see the `_parse_file` function and
        # `DraftWorkflowNodeRunApi` class which handle this properly.
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

        extras = {
            **extract_external_trace_id_from_args(args),
        }
        workflow_run_id = str(uuid.uuid4())
        # FIXME (Yeuoly): we need to remove the SKIP_PREPARE_USER_INPUTS_KEY from the args
        # trigger shouldn't prepare user inputs
        if self._should_prepare_user_inputs(args):
            inputs = self._prepare_user_inputs(
                user_inputs=inputs,
                variables=app_config.variables,
                tenant_id=app_model.tenant_id,
                strict_type_validation=True if invoke_from == InvokeFrom.SERVICE_API else False,
            )
        # init application generate entity
        application_generate_entity = WorkflowAppGenerateEntity(
            task_id=str(uuid.uuid4()),
            app_config=app_config,
            file_upload_config=file_extra_config,
            inputs=inputs,
            files=list(system_files),
            user_id=user.id,
            stream=streaming,
            invoke_from=invoke_from,
            call_depth=call_depth,
            trace_manager=trace_manager,
            workflow_execution_id=workflow_run_id,
            extras=extras,
        )

        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        # Create repositories
        #
        # Create session factory
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        # Create workflow execution(aka workflow run) repository
        if triggered_from is not None:
            # Use explicitly provided triggered_from (for async triggers)
            workflow_triggered_from = triggered_from
        elif invoke_from == InvokeFrom.DEBUGGER:
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
            app_model=app_model,
            workflow=workflow,
            user=user,
            application_generate_entity=application_generate_entity,
            invoke_from=invoke_from,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            streaming=streaming,
            root_node_id=root_node_id,
            graph_engine_layers=graph_engine_layers,
        )

    def resume(self, *, workflow_run_id: str) -> None:
        """
        @TBD
        """
        pass

    def _generate(
        self,
        *,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        application_generate_entity: WorkflowAppGenerateEntity,
        invoke_from: InvokeFrom,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        streaming: bool = True,
        variable_loader: VariableLoader = DUMMY_VARIABLE_LOADER,
        root_node_id: str | None = None,
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
    ) -> Union[Mapping[str, Any], Generator[str | Mapping[str, Any], None, None]]:
        """
        Generate App response.

        :param app_model: App
        :param workflow: Workflow
        :param user: account or end user
        :param application_generate_entity: application generate entity
        :param invoke_from: invoke from source
        :param workflow_execution_repository: repository for workflow execution
        :param workflow_node_execution_repository: repository for workflow node execution
        :param streaming: is stream
        """
        # init queue manager
        queue_manager = WorkflowAppQueueManager(
            task_id=application_generate_entity.task_id,
            user_id=application_generate_entity.user_id,
            invoke_from=application_generate_entity.invoke_from,
            app_mode=app_model.mode,
        )

        # new thread with request context and contextvars
        context = contextvars.copy_context()

        # release database connection, because the following new thread operations may take a long time
        db.session.close()

        worker_thread = threading.Thread(
            target=self._generate_worker,
            kwargs={
                "flask_app": current_app._get_current_object(),  # type: ignore
                "application_generate_entity": application_generate_entity,
                "queue_manager": queue_manager,
                "context": context,
                "variable_loader": variable_loader,
                "root_node_id": root_node_id,
                "workflow_execution_repository": workflow_execution_repository,
                "workflow_node_execution_repository": workflow_node_execution_repository,
                "graph_engine_layers": graph_engine_layers,
            },
        )

        worker_thread.start()

        draft_var_saver_factory = self._get_draft_var_saver_factory(invoke_from, user)

        # return response or stream generator
        response = self._handle_response(
            application_generate_entity=application_generate_entity,
            workflow=workflow,
            queue_manager=queue_manager,
            user=user,
            draft_var_saver_factory=draft_var_saver_factory,
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
            workflow_execution_id=str(uuid.uuid4()),
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
        draft_var_srv = WorkflowDraftVariableService(db.session())
        draft_var_srv.prefill_conversation_variable_default_values(workflow)
        var_loader = DraftVarLoader(
            engine=db.engine,
            app_id=application_generate_entity.app_config.app_id,
            tenant_id=application_generate_entity.app_config.tenant_id,
        )

        return self._generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            invoke_from=InvokeFrom.DEBUGGER,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            streaming=streaming,
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

        if args.inputs is None:
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
            single_loop_run=WorkflowAppGenerateEntity.SingleLoopRunEntity(node_id=node_id, inputs=args.inputs or {}),
            workflow_execution_id=str(uuid.uuid4()),
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
        draft_var_srv = WorkflowDraftVariableService(db.session())
        draft_var_srv.prefill_conversation_variable_default_values(workflow)
        var_loader = DraftVarLoader(
            engine=db.engine,
            app_id=application_generate_entity.app_config.app_id,
            tenant_id=application_generate_entity.app_config.tenant_id,
        )
        return self._generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            invoke_from=InvokeFrom.DEBUGGER,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            streaming=streaming,
            variable_loader=var_loader,
        )

    def _generate_worker(
        self,
        flask_app: Flask,
        application_generate_entity: WorkflowAppGenerateEntity,
        queue_manager: AppQueueManager,
        context: contextvars.Context,
        variable_loader: VariableLoader,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        root_node_id: str | None = None,
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
    ) -> None:
        """
        Generate worker in a new thread.
        :param flask_app: Flask app
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param workflow_thread_pool_id: workflow thread pool id
        :return:
        """
        with preserve_flask_contexts(flask_app, context_vars=context):
            with session_factory.create_session() as session:
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

            runner = WorkflowAppRunner(
                application_generate_entity=application_generate_entity,
                queue_manager=queue_manager,
                variable_loader=variable_loader,
                workflow=workflow,
                system_user_id=system_user_id,
                workflow_execution_repository=workflow_execution_repository,
                workflow_node_execution_repository=workflow_node_execution_repository,
                root_node_id=root_node_id,
                graph_engine_layers=graph_engine_layers,
            )

            try:
                runner.run()
            except GenerateTaskStoppedError as e:
                logger.warning("Task stopped: %s", str(e))
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

    def _handle_response(
        self,
        application_generate_entity: WorkflowAppGenerateEntity,
        workflow: Workflow,
        queue_manager: AppQueueManager,
        user: Union[Account, EndUser],
        draft_var_saver_factory: DraftVariableSaverFactory,
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
            draft_var_saver_factory=draft_var_saver_factory,
            stream=stream,
        )

        try:
            return generate_task_pipeline.process()
        except ValueError as e:
            if len(e.args) > 0 and e.args[0] == "I/O operation on closed file.":  # ignore this error
                raise GenerateTaskStoppedError()
            else:
                logger.exception(
                    "Fails to process generate task pipeline, task_id: %s", application_generate_entity.task_id
                )
                raise e

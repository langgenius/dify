import contextlib
import logging
import uuid
from collections.abc import Generator, Mapping
from enum import StrEnum
from typing import Annotated, Any, TypeAlias, Union

from celery import shared_task
from flask import current_app, json
from pydantic import BaseModel, Discriminator, Field, Tag
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig, WorkflowResumptionContext
from core.repositories import DifyCoreRepositoryFactory
from core.workflow.runtime import GraphRuntimeState
from extensions.ext_database import db
from libs.flask_utils import set_login_user
from models.account import Account
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Conversation, EndUser, Message
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory

logger = logging.getLogger(__name__)

WORKFLOW_BASED_APP_EXECUTION_QUEUE = "workflow_based_app_execution"


class _UserType(StrEnum):
    ACCOUNT = "account"
    END_USER = "end_user"


class _Account(BaseModel):
    TYPE: _UserType = _UserType.ACCOUNT

    user_id: str


class _EndUser(BaseModel):
    TYPE: _UserType = _UserType.END_USER
    end_user_id: str


def _get_user_type_descriminator(value: Any):
    if isinstance(value, (_Account, _EndUser)):
        return value.TYPE
    elif isinstance(value, dict):
        user_type_str = value.get("TYPE")
        if user_type_str is None:
            return None
        try:
            user_type = _UserType(user_type_str)
        except ValueError:
            return None
        return user_type
    else:
        # return None if the discriminator value isn't found
        return None


User: TypeAlias = Annotated[
    (Annotated[_Account, Tag(_UserType.ACCOUNT)] | Annotated[_EndUser, Tag(_UserType.END_USER)]),
    Discriminator(_get_user_type_descriminator),
]


class AppExecutionParams(BaseModel):
    app_id: str
    workflow_id: str
    tenant_id: str
    app_mode: AppMode = AppMode.ADVANCED_CHAT
    user: User
    args: Mapping[str, Any]

    invoke_from: InvokeFrom
    streaming: bool = True
    call_depth: int = 0
    root_node_id: str | None = None
    workflow_run_id: str = Field(default_factory=lambda: str(uuid.uuid4()))

    @classmethod
    def new(
        cls,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
        call_depth: int = 0,
        root_node_id: str | None = None,
        workflow_run_id: str | None = None,
    ):
        user_params: _Account | _EndUser
        if isinstance(user, Account):
            user_params = _Account(user_id=user.id)
        elif isinstance(user, EndUser):
            user_params = _EndUser(end_user_id=user.id)
        else:
            raise AssertionError("this statement should be unreachable.")
        return cls(
            app_id=app_model.id,
            workflow_id=workflow.id,
            tenant_id=app_model.tenant_id,
            app_mode=AppMode.value_of(app_model.mode),
            user=user_params,
            args=args,
            invoke_from=invoke_from,
            streaming=streaming,
            call_depth=call_depth,
            root_node_id=root_node_id,
            workflow_run_id=workflow_run_id or str(uuid.uuid4()),
        )


class _AppRunner:
    def __init__(self, session_factory: sessionmaker | Engine, exec_params: AppExecutionParams):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory
        self._exec_params = exec_params

    @contextlib.contextmanager
    def _session(self):
        with self._session_factory(expire_on_commit=False) as session, session.begin():
            yield session

    @contextlib.contextmanager
    def _setup_flask_context(self, user: Account | EndUser):
        flask_app = current_app._get_current_object()  # type: ignore
        with flask_app.app_context():
            set_login_user(user)
            yield

    def run(self):
        exec_params = self._exec_params
        with self._session() as session:
            workflow = session.get(Workflow, exec_params.workflow_id)
            if workflow is None:
                logger.warning("Workflow %s not found for execution", exec_params.workflow_id)
                return None
            app = session.get(App, workflow.app_id)
            if app is None:
                logger.warning("App %s not found for workflow %s", workflow.app_id, exec_params.workflow_id)
                return None

        pause_config = PauseStateLayerConfig(
            session_factory=self._session_factory,
            state_owner_user_id=workflow.created_by,
        )

        user = self._resolve_user()

        with self._setup_flask_context(user):
            response = self._run_app(
                app=app,
                workflow=workflow,
                user=user,
                pause_state_config=pause_config,
            )
            if not exec_params.streaming:
                return response

            assert isinstance(response, Generator)
            _publish_streaming_response(response, exec_params.workflow_run_id, exec_params.app_mode)

    def _run_app(
        self,
        *,
        app: App,
        workflow: Workflow,
        user: Account | EndUser,
        pause_state_config: PauseStateLayerConfig,
    ):
        exec_params = self._exec_params
        if exec_params.app_mode == AppMode.ADVANCED_CHAT:
            return AdvancedChatAppGenerator().generate(
                app_model=app,
                workflow=workflow,
                user=user,
                args=exec_params.args,
                invoke_from=exec_params.invoke_from,
                streaming=exec_params.streaming,
                workflow_run_id=exec_params.workflow_run_id,
                pause_state_config=pause_state_config,
            )
        if exec_params.app_mode == AppMode.WORKFLOW:
            return WorkflowAppGenerator().generate(
                app_model=app,
                workflow=workflow,
                user=user,
                args=exec_params.args,
                invoke_from=exec_params.invoke_from,
                streaming=exec_params.streaming,
                call_depth=exec_params.call_depth,
                root_node_id=exec_params.root_node_id,
                workflow_run_id=exec_params.workflow_run_id,
                pause_state_config=pause_state_config,
            )

        logger.error("Unsupported app mode for execution: %s", exec_params.app_mode)
        return None

    def _resolve_user(self) -> Account | EndUser:
        user_params = self._exec_params.user

        if isinstance(user_params, _EndUser):
            with self._session() as session:
                return session.get(EndUser, user_params.end_user_id)
        elif not isinstance(user_params, _Account):
            raise AssertionError(f"user should only be _Account or _EndUser, got {type(user_params)}")

        with self._session() as session:
            user: Account = session.get(Account, user_params.user_id)
            user.set_tenant_id(self._exec_params.tenant_id)

        return user


def _resolve_user_for_run(session: Session, workflow_run: WorkflowRun) -> Account | EndUser | None:
    role = CreatorUserRole(workflow_run.created_by_role)
    if role == CreatorUserRole.ACCOUNT:
        user = session.get(Account, workflow_run.created_by)
        if user:
            user.set_tenant_id(workflow_run.tenant_id)
        return user

    return session.get(EndUser, workflow_run.created_by)


def _publish_streaming_response(
    response_stream: Generator[str | Mapping[str, Any], None, None], workflow_run_id: str, app_mode: AppMode
) -> None:
    topic = MessageBasedAppGenerator.get_response_topic(app_mode, workflow_run_id)
    for event in response_stream:
        try:
            payload = json.dumps(event)
        except TypeError:
            logger.exception("error while encoding event")
            continue

        topic.publish(payload.encode())


@shared_task(queue=WORKFLOW_BASED_APP_EXECUTION_QUEUE)
def workflow_based_app_execution_task(
    payload: str,
) -> Generator[Mapping[str, Any] | str, None, None] | Mapping[str, Any] | None:
    exec_params = AppExecutionParams.model_validate_json(payload)

    logger.info("workflow_based_app_execution_task run with params: %s", exec_params)

    runner = _AppRunner(db.engine, exec_params=exec_params)
    return runner.run()


def _resume_app_execution(payload: dict[str, Any]) -> None:
    workflow_run_id = payload["workflow_run_id"]

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker=session_factory)

    pause_entity = workflow_run_repo.get_workflow_pause(workflow_run_id)
    if pause_entity is None:
        logger.warning("No pause entity found for workflow run %s", workflow_run_id)
        return

    try:
        resumption_context = WorkflowResumptionContext.loads(pause_entity.get_state().decode())
    except Exception:
        logger.exception("Failed to load resumption context for workflow run %s", workflow_run_id)
        return

    generate_entity = resumption_context.get_generate_entity()

    graph_runtime_state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)

    conversation = None
    message = None
    with Session(db.engine, expire_on_commit=False) as session:
        workflow_run = session.get(WorkflowRun, workflow_run_id)
        if workflow_run is None:
            logger.warning("Workflow run %s not found during resume", workflow_run_id)
            return

        workflow = session.get(Workflow, workflow_run.workflow_id)
        if workflow is None:
            logger.warning("Workflow %s not found during resume", workflow_run.workflow_id)
            return

        app_model = session.get(App, workflow_run.app_id)
        if app_model is None:
            logger.warning("App %s not found during resume", workflow_run.app_id)
            return

        user = _resolve_user_for_run(session, workflow_run)
        if user is None:
            logger.warning("User %s not found for workflow run %s", workflow_run.created_by, workflow_run_id)
            return

        if isinstance(generate_entity, AdvancedChatAppGenerateEntity):
            if generate_entity.conversation_id is None:
                logger.warning("Conversation id missing in resumption context for workflow run %s", workflow_run_id)
                return

            conversation = session.get(Conversation, generate_entity.conversation_id)
            if conversation is None:
                logger.warning(
                    "Conversation %s not found for workflow run %s", generate_entity.conversation_id, workflow_run_id
                )
                return

            message = session.scalar(
                select(Message).where(Message.workflow_run_id == workflow_run_id).order_by(Message.created_at.desc())
            )
            if message is None:
                logger.warning("Message not found for workflow run %s", workflow_run_id)
                return

    if not isinstance(generate_entity, (AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity)):
        logger.error(
            "Unsupported resumption entity for workflow run %s (found %s)",
            workflow_run_id,
            type(generate_entity),
        )
        return

    workflow_run_repo.resume_workflow_pause(workflow_run_id, pause_entity)

    pause_config = PauseStateLayerConfig(
        session_factory=session_factory,
        state_owner_user_id=workflow.created_by,
    )

    if isinstance(generate_entity, AdvancedChatAppGenerateEntity):
        assert conversation is not None
        assert message is not None
        _resume_advanced_chat(
            app_model=app_model,
            workflow=workflow,
            user=user,
            conversation=conversation,
            message=message,
            generate_entity=generate_entity,
            graph_runtime_state=graph_runtime_state,
            session_factory=session_factory,
            pause_state_config=pause_config,
            workflow_run_id=workflow_run_id,
            workflow_run=workflow_run,
        )
    elif isinstance(generate_entity, WorkflowAppGenerateEntity):
        _resume_workflow(
            app_model=app_model,
            workflow=workflow,
            user=user,
            generate_entity=generate_entity,
            graph_runtime_state=graph_runtime_state,
            session_factory=session_factory,
            pause_state_config=pause_config,
            workflow_run_id=workflow_run_id,
            workflow_run=workflow_run,
            workflow_run_repo=workflow_run_repo,
            pause_entity=pause_entity,
        )


def _resume_advanced_chat(
    *,
    app_model: App,
    workflow: Workflow,
    user: Account | EndUser,
    conversation: Conversation,
    message: Message,
    generate_entity: AdvancedChatAppGenerateEntity,
    graph_runtime_state: GraphRuntimeState,
    session_factory: sessionmaker,
    pause_state_config: PauseStateLayerConfig,
    workflow_run_id: str,
    workflow_run: WorkflowRun,
) -> None:
    try:
        triggered_from = WorkflowRunTriggeredFrom(workflow_run.triggered_from)
    except ValueError:
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

    workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
        session_factory=session_factory,
        user=user,
        app_id=app_model.id,
        triggered_from=triggered_from,
    )
    workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
        session_factory=session_factory,
        user=user,
        app_id=app_model.id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    generator = AdvancedChatAppGenerator()

    try:
        response = generator.resume(
            app_model=app_model,
            workflow=workflow,
            user=user,
            conversation=conversation,
            message=message,
            application_generate_entity=generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            graph_runtime_state=graph_runtime_state,
            pause_state_config=pause_state_config,
        )
    except Exception:
        logger.exception("Failed to resume chatflow execution for workflow run %s", workflow_run_id)
        raise

    if generate_entity.stream:
        assert isinstance(response, Generator)
        _publish_streaming_response(response, workflow_run_id, AppMode.ADVANCED_CHAT)


def _resume_workflow(
    *,
    app_model: App,
    workflow: Workflow,
    user: Account | EndUser,
    generate_entity: WorkflowAppGenerateEntity,
    graph_runtime_state: GraphRuntimeState,
    session_factory: sessionmaker,
    pause_state_config: PauseStateLayerConfig,
    workflow_run_id: str,
    workflow_run: WorkflowRun,
    workflow_run_repo,
    pause_entity,
) -> None:
    try:
        triggered_from = WorkflowRunTriggeredFrom(workflow_run.triggered_from)
    except ValueError:
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

    workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
        session_factory=session_factory,
        user=user,
        app_id=app_model.id,
        triggered_from=triggered_from,
    )
    workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
        session_factory=session_factory,
        user=user,
        app_id=app_model.id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    generator = WorkflowAppGenerator()

    try:
        response = generator.resume(
            app_model=app_model,
            workflow=workflow,
            user=user,
            application_generate_entity=generate_entity,
            graph_runtime_state=graph_runtime_state,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            pause_state_config=pause_state_config,
        )
    except Exception:
        logger.exception("Failed to resume workflow execution for workflow run %s", workflow_run_id)
        raise

    if generate_entity.stream:
        assert isinstance(response, Generator)
        _publish_streaming_response(response, workflow_run_id, AppMode.WORKFLOW)

    workflow_run_repo.delete_workflow_pause(pause_entity)


@shared_task(queue=WORKFLOW_BASED_APP_EXECUTION_QUEUE, name="resume_app_execution")
def resume_app_execution(payload: dict[str, Any]) -> None:
    _resume_app_execution(payload)

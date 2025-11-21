import contextlib
import logging
import uuid
from collections.abc import Mapping
from enum import StrEnum
from typing import Annotated, Any, TypeAlias, Union

from celery import shared_task
from flask import current_app, json
from pydantic import BaseModel, Discriminator, Field, Tag
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
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


class ChatflowExecutionParams(BaseModel):
    app_id: str
    workflow_id: str
    tenant_id: str
    user: User
    args: Mapping[str, Any]

    invoke_from: InvokeFrom
    streaming: bool = True
    call_depth: int = 0
    workflow_run_id: uuid.UUID = Field(default_factory=uuid.uuid4)

    @classmethod
    def new(
        cls,
        app_model: App,
        workflow: Workflow,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
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
            user=user_params,
            args=args,
            invoke_from=invoke_from,
            streaming=streaming,
            workflow_run_id=uuid.uuid4(),
        )


class _ChatflowRunner:
    def __init__(self, session_factory: sessionmaker | Engine, exec_params: ChatflowExecutionParams):
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
            app = session.get(App, workflow.app_id)

        pause_config = PauseStateLayerConfig(
            session_factory=self._session_factory,
            state_owner_user_id=workflow.created_by,
        )

        user = self._resolve_user()

        chat_generator = AdvancedChatAppGenerator()

        workflow_run_id = exec_params.workflow_run_id

        with self._setup_flask_context(user):
            response = chat_generator.generate(
                app_model=app,
                workflow=workflow,
                user=user,
                args=exec_params.args,
                invoke_from=exec_params.invoke_from,
                streaming=exec_params.streaming,
                workflow_run_id=workflow_run_id,
                pause_state_config=pause_config,
            )
            if not exec_params.streaming:
                return response

            topic = chat_generator.get_response_topic(AppMode.ADVANCED_CHAT, workflow_run_id)
            for event in response:
                try:
                    payload = json.dumps(event)
                except TypeError:
                    logging.exception("error while encoding event")
                    continue

                topic.publish(payload.encode())

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


@shared_task(queue="chatflow_execute")
def chatflow_execute_task(payload: str) -> Mapping[str, Any] | None:
    exec_params = ChatflowExecutionParams.model_validate_json(payload)

    logger.info("chatflow_execute_task run with params: %s", exec_params)

    runner = _ChatflowRunner(db.engine, exec_params=exec_params)
    return runner.run()


@shared_task(queue="chatflow_execute", name="resume_chatflow_execution")
def resume_chatflow_execution(payload: dict[str, Any]) -> None:
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
    if not isinstance(generate_entity, AdvancedChatAppGenerateEntity):
        logger.error(
            "Resumption entity is not AdvancedChatAppGenerateEntity for workflow run %s (found %s)",
            workflow_run_id,
            type(generate_entity),
        )
        return

    graph_runtime_state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)

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

        user = _resolve_user_for_run(session, workflow_run)
        if user is None:
            logger.warning("User %s not found for workflow run %s", workflow_run.created_by, workflow_run_id)
            return

    workflow_run_repo.resume_workflow_pause(workflow_run_id, pause_entity)

    pause_config = PauseStateLayerConfig(
        session_factory=session_factory,
        state_owner_user_id=workflow.created_by,
    )

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
        generator.resume(
            app_model=app_model,
            workflow=workflow,
            user=user,
            conversation=conversation,
            message=message,
            application_generate_entity=generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            graph_runtime_state=graph_runtime_state,
            pause_state_config=pause_config,
        )
    except Exception:
        logger.exception("Failed to resume chatflow execution for workflow run %s", workflow_run_id)
        raise

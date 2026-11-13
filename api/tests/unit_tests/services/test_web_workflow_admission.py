"""Real resource validation and durable admission around the worker handoff."""

from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants.end_user_connections import ConnectionCredentialStatus, ConnectionCredentialType
from context.connection_execution import ConnectionExecutionContext, ExecutionConnectionSelection
from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    UserFrom,
    WorkflowAppGenerateEntity,
)
from core.app.file_access import get_current_file_access_scope
from core.workflow.file_reference import build_file_reference
from graphon.enums import WorkflowExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models.account import Account, AccountStatus
from models.end_user_connection import EndUserConnection
from models.enums import CreatorUserRole, CustomizeTokenStrategy, EndUserType
from models.model import App, AppMode, EndUser, Site, UploadFile
from models.workflow import Workflow, WorkflowRun, WorkflowType
from repositories.entities.web_execution import WebExecutionResourcesChangedError
from repositories.web_migration_repository import WebMigrationRepository
from services.app.file_input_defaults import grant_file_default_access
from services.web_migration_service import GuestMigrationNotReadyError
from services.web_workflow_admission import WebWorkflowEntity, web_workflow_launch, web_workflow_worker
from tests.helpers.unit.model_factories import make_upload_file


@dataclass
class Admission:
    sessions: sessionmaker[Session]
    workflow: Workflow
    guest: EndUser
    target: EndUser
    file_id: str
    connection_id: str
    entity: WorkflowAppGenerateEntity
    migration: WebMigrationRepository

    def claim(self) -> None:
        source = self.migration.get_claim_source(
            app_code="admission", app_id=self.guest.app_id or "", end_user_id=self.guest.id
        )
        assert source is not None
        self.migration.claim_guest(source, account_end_user_id=self.target.id)


@pytest.fixture
def admission(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> Admission:
    monkeypatch.setattr(dify_config, "WEBAPP_ACCOUNT_PASSPORT_ENABLED", True)
    with sqlite_session_factory(expire_on_commit=False) as session, session.begin():
        app = App(tenant_id=str(uuid4()), name="Admission", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
        account = Account(name="Target", email=f"{uuid4()}@example.com", status=AccountStatus.ACTIVE)
        session.add_all([app, account])
        session.flush()
        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW,
            version="published",
            graph='{"nodes": [], "edges": []}',
            _features="{}",
            created_by=account.id,
        )
        guest = EndUser(tenant_id=app.tenant_id, app_id=app.id, type=EndUserType.BROWSER, session_id=str(uuid4()))
        target = EndUser(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
            account_id=account.id,
        )
        session.add_all([workflow, guest, target])
        session.flush()
        app.workflow_id = workflow.id
        session.add(
            Site(
                app_id=app.id,
                code="admission",
                title="Admission",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            )
        )
        upload = make_upload_file(
            tenant_id=app.tenant_id, created_by=guest.id, created_by_role=CreatorUserRole.END_USER
        )
        connection = EndUserConnection(
            tenant_id=app.tenant_id,
            end_user_id=guest.id,
            account_id=None,
            provider="provider",
            name="Key",
            credential_type=ConnectionCredentialType.API_KEY,
            encrypted_credentials="ciphertext",
            status=ConnectionCredentialStatus.CONNECTED,
            oauth_client_source=None,
            oauth_client_configuration_id=None,
            oauth_client_id=None,
            expires_at=None,
        )
        session.add_all([upload, connection])
        session.flush()
        file_id, connection_id = upload.id, connection.id
    entity = WorkflowAppGenerateEntity(
        task_id=str(uuid4()),
        workflow_execution_id=str(uuid4()),
        app_config=WorkflowUIBasedAppConfig(
            tenant_id=app.tenant_id,
            app_id=app.id,
            app_mode=AppMode.WORKFLOW,
            workflow_id=workflow.id,
        ),
        user_id=guest.id,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        stream=False,
        inputs={},
        files=[],
    )
    return Admission(
        sqlite_session_factory,
        workflow,
        guest,
        target,
        file_id,
        connection_id,
        entity,
        WebMigrationRepository(session_factory=sqlite_session_factory),
    )


@pytest.fixture(params=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT], ids=["workflow", "chatflow"])
def file_entity(admission: Admission, request: pytest.FixtureRequest) -> WebWorkflowEntity:
    """Provide each Web execution type over a published workflow and real caller."""
    if request.param == AppMode.WORKFLOW:
        return admission.entity

    admission.workflow.type = WorkflowType.CHAT
    with admission.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == admission.workflow.app_id).values(mode=AppMode.ADVANCED_CHAT))
        session.execute(sa.update(Workflow).where(Workflow.id == admission.workflow.id).values(type=WorkflowType.CHAT))
    entity = AdvancedChatAppGenerateEntity(
        task_id=str(uuid4()),
        workflow_run_id=str(uuid4()),
        app_config=admission.entity.app_config.model_copy(
            update={"app_mode": AppMode.ADVANCED_CHAT, "additional_features": AppAdditionalFeatures()}
        ),
        inputs={},
        query="hello",
        files=[],
        user_id=admission.guest.id,
        invoke_from=InvokeFrom.WEB_APP,
        stream=False,
    )
    with admission.sessions() as session:
        MessageBasedAppGenerator()._init_generate_records(entity, session=session)
    return entity


@pytest.fixture
def default_file(admission: Admission, file_entity: WebWorkflowEntity) -> UploadFile:
    """Parse an Account-owned author default through the existing file access rules."""
    upload = make_upload_file(tenant_id=admission.guest.tenant_id, created_by=admission.workflow.created_by)
    with admission.sessions.begin() as session:
        session.add(upload)
        session.flush()
    file_entity.app_config.variables = [
        VariableEntity(
            variable="document",
            label="Document",
            type=VariableEntityType.FILE,
            required=True,
            default={
                "transferMethod": FileTransferMethod.LOCAL_FILE,
                "uploadedId": upload.id,
                "supportFileType": FileType.DOCUMENT,
            },
            allowed_file_types=[FileType.DOCUMENT],
            allowed_file_upload_methods=[FileTransferMethod.LOCAL_FILE],
        )
    ]
    generator = BaseAppGenerator()
    with generator._bind_file_access_scope(
        tenant_id=admission.guest.tenant_id, user=admission.guest, invoke_from=InvokeFrom.WEB_APP
    ):
        file_entity.inputs = generator._prepare_user_inputs(
            user_inputs={}, variables=file_entity.app_config.variables, tenant_id=admission.guest.tenant_id
        )
    assert isinstance(file_entity.inputs["document"], File)
    return upload


@pytest.mark.parametrize("variable_type", [VariableEntityType.FILE, VariableEntityType.FILE_LIST])
@pytest.mark.parametrize("resume", [False, True])
def test_author_file_defaults_are_admitted_with_trusted_execution_grants(
    admission: Admission,
    file_entity: WebWorkflowEntity,
    default_file: UploadFile,
    variable_type: VariableEntityType,
    resume: bool,
) -> None:
    conversation_id = file_entity.conversation_id if isinstance(file_entity, AdvancedChatAppGenerateEntity) else None
    if resume:
        original_inputs = file_entity.inputs
        file_entity.inputs = {}
        with web_workflow_launch(
            file_entity,
            workflow=admission.workflow,
            user=admission.guest,
            conversation_id=conversation_id,
            resume=False,
        ):
            pass
        file_entity.inputs = original_inputs
        with admission.sessions.begin() as session:
            session.execute(sa.update(WorkflowRun).values(status=WorkflowExecutionStatus.PAUSED))

    variable = file_entity.app_config.variables[0]
    if variable_type == VariableEntityType.FILE_LIST:
        variable.type = variable_type
        variable.default = [variable.default]
    generator = BaseAppGenerator()
    with generator._bind_file_access_scope(
        tenant_id=admission.guest.tenant_id, user=admission.guest, invoke_from=InvokeFrom.WEB_APP
    ):
        file_entity.inputs = generator._prepare_user_inputs(
            user_inputs={}, variables=file_entity.app_config.variables, tenant_id=admission.guest.tenant_id
        )
        # _generate binds a fresh scope and restores the same author-selected defaults.
        with generator._bind_file_access_scope(
            tenant_id=admission.guest.tenant_id, user=admission.guest, invoke_from=InvokeFrom.WEB_APP
        ):
            grant_file_default_access(file_entity.app_config.variables)
            assert file_entity.connection_context is None
            with web_workflow_launch(
                file_entity,
                workflow=admission.workflow,
                user=admission.guest,
                conversation_id=conversation_id,
                resume=resume,
            ):
                with admission.sessions() as session:
                    run = session.scalar(sa.select(WorkflowRun).where(WorkflowRun.task_id == file_entity.task_id))
                    assert run is not None
                    assert run.status == WorkflowExecutionStatus.RUNNING
                    assert run.type == admission.workflow.type
                    assert session.scalar(sa.select(sa.func.count()).select_from(WorkflowRun)) == 1
                    upload = session.get(UploadFile, default_file.id)
                    assert upload is not None
                    assert (upload.created_by_role, upload.created_by) == (
                        CreatorUserRole.ACCOUNT,
                        admission.workflow.created_by,
                    )


@pytest.mark.parametrize("file_change", ["other-tenant", "deleted"])
def test_granted_default_files_still_require_current_tenant_scoped_records(
    admission: Admission, file_entity: WebWorkflowEntity, default_file: UploadFile, file_change: str
) -> None:
    with admission.sessions.begin() as session:
        if file_change == "deleted":
            session.execute(sa.delete(UploadFile).where(UploadFile.id == default_file.id))
        else:
            session.execute(
                sa.update(UploadFile).where(UploadFile.id == default_file.id).values(tenant_id=str(uuid4()))
            )
    with BaseAppGenerator._bind_file_access_scope(
        tenant_id=admission.guest.tenant_id, user=admission.guest, invoke_from=InvokeFrom.WEB_APP
    ):
        grant_file_default_access(file_entity.app_config.variables)
        with (
            pytest.raises(WebExecutionResourcesChangedError),
            web_workflow_launch(
                file_entity,
                workflow=admission.workflow,
                user=admission.guest,
                conversation_id=file_entity.conversation_id
                if isinstance(file_entity, AdvancedChatAppGenerateEntity)
                else None,
                resume=False,
            ),
        ):
            pytest.fail("A grant must not bypass persistent Tenant scope or file existence")
    with admission.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(WorkflowRun)) == 0


@pytest.mark.parametrize("owner_role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def test_request_file_ids_cannot_extend_trusted_default_grants(
    admission: Admission, file_entity: WebWorkflowEntity, default_file: UploadFile, owner_role: CreatorUserRole
) -> None:
    upload = make_upload_file(
        tenant_id=admission.guest.tenant_id,
        created_by_role=owner_role,
        created_by=admission.workflow.created_by if owner_role == CreatorUserRole.ACCOUNT else admission.target.id,
    )
    with admission.sessions.begin() as session:
        session.add(upload)
        session.flush()
    default_input = file_entity.inputs["document"]
    assert isinstance(default_input, File)
    file_entity.files = [default_input.model_copy(update={"reference": build_file_reference(record_id=upload.id)})]
    file_entity.inputs = {**file_entity.inputs, "granted_upload_file_ids": [upload.id]}
    file_entity.extras["granted_upload_file_ids"] = [upload.id]
    with BaseAppGenerator._bind_file_access_scope(
        tenant_id=admission.guest.tenant_id, user=admission.guest, invoke_from=InvokeFrom.WEB_APP
    ):
        grant_file_default_access(file_entity.app_config.variables)
        scope = get_current_file_access_scope()
        assert scope is not None
        assert scope.granted_upload_file_ids == {default_file.id}
        with (
            pytest.raises(WebExecutionResourcesChangedError),
            web_workflow_launch(
                file_entity,
                workflow=admission.workflow,
                user=admission.guest,
                conversation_id=file_entity.conversation_id
                if isinstance(file_entity, AdvancedChatAppGenerateEntity)
                else None,
                resume=False,
            ),
        ):
            pytest.fail("Request-owned file IDs must never become trusted grants")
    with admission.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(WorkflowRun)) == 0
        persisted = session.get(UploadFile, upload.id)
        assert persisted is not None
        assert (persisted.created_by_role, persisted.created_by) == (owner_role, upload.created_by)


def test_end_user_owned_files_are_admitted_without_execution_grants(
    admission: Admission, file_entity: WebWorkflowEntity
) -> None:
    file_entity.app_config.variables = [
        VariableEntity(
            variable="document",
            label="Document",
            type=VariableEntityType.FILE,
            allowed_file_types=[FileType.DOCUMENT],
            allowed_file_upload_methods=[FileTransferMethod.LOCAL_FILE],
        )
    ]
    generator = BaseAppGenerator()
    with generator._bind_file_access_scope(
        tenant_id=admission.guest.tenant_id, user=admission.guest, invoke_from=InvokeFrom.WEB_APP
    ):
        file_entity.inputs = generator._prepare_user_inputs(
            user_inputs={
                "document": {
                    "transfer_method": FileTransferMethod.LOCAL_FILE,
                    "upload_file_id": admission.file_id,
                    "type": FileType.DOCUMENT,
                }
            },
            variables=file_entity.app_config.variables,
            tenant_id=admission.guest.tenant_id,
        )
        scope = get_current_file_access_scope()
        assert scope is not None
        assert not scope.granted_upload_file_ids
        with web_workflow_launch(
            file_entity,
            workflow=admission.workflow,
            user=admission.guest,
            conversation_id=file_entity.conversation_id
            if isinstance(file_entity, AdvancedChatAppGenerateEntity)
            else None,
            resume=False,
        ):
            with admission.sessions() as session:
                run = session.scalar(sa.select(WorkflowRun).where(WorkflowRun.task_id == file_entity.task_id))
                assert run is not None
                assert run.status == WorkflowExecutionStatus.RUNNING


@pytest.mark.parametrize("resource", ["upload", "connection"])
def test_prepared_guest_resources_are_rechecked_after_migration(admission: Admission, resource: str) -> None:
    if resource == "upload":
        admission.entity.files = [
            File(
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference=build_file_reference(record_id=admission.file_id),
                filename="input.txt",
                extension=".txt",
                mime_type="text/plain",
                size=1,
                storage_key="original-key",
            )
        ]
    else:
        admission.entity.connection_context = ConnectionExecutionContext(
            tenant_id=admission.guest.tenant_id,
            app_id=admission.workflow.app_id,
            end_user_id=admission.guest.id,
            account_id=None,
            workflow_id=admission.workflow.id,
            connection_revision="revision",
            selections=(
                ExecutionConnectionSelection(
                    node_id="tool", provider="provider", connection_id=admission.connection_id
                ),
            ),
        )
    admission.claim()
    with (
        pytest.raises(WebExecutionResourcesChangedError),
        web_workflow_launch(
            admission.entity,
            workflow=admission.workflow,
            user=admission.guest,
            conversation_id=None,
            resume=False,
        ),
    ):
        pytest.fail("A stale request must not launch its worker")
    with admission.sessions() as session:
        assert session.get(WorkflowRun, admission.entity.workflow_execution_id) is None
        assert (
            session.scalar(sa.select(UploadFile.created_by).where(UploadFile.id == admission.file_id))
            == admission.target.id
        )


def test_committed_admission_blocks_migration_before_worker_start(
    admission: Admission, monkeypatch: pytest.MonkeyPatch
) -> None:
    started_at = datetime(2026, 11, 9, 8, 30, 0, 123456)
    monkeypatch.setattr("services.web_workflow_admission.naive_utc_now", lambda: started_at)
    with web_workflow_launch(
        admission.entity,
        workflow=admission.workflow,
        user=admission.guest,
        conversation_id=None,
        resume=False,
    ):
        with admission.sessions() as session:
            run = session.get(WorkflowRun, admission.entity.workflow_execution_id)
            assert run is not None
            assert run.status == WorkflowExecutionStatus.RUNNING
            assert run.task_id == admission.entity.task_id
            assert run.created_at == started_at
        with pytest.raises(GuestMigrationNotReadyError):
            admission.claim()
    with web_workflow_worker(admission.entity):
        with admission.sessions.begin() as session:
            session.execute(
                sa.update(WorkflowRun)
                .where(WorkflowRun.id == admission.entity.workflow_execution_id)
                .values(status=WorkflowExecutionStatus.SUCCEEDED)
            )
    admission.claim()


@pytest.mark.parametrize("failure_stage", ["launch", "worker"])
def test_failed_start_releases_activity_for_migration(admission: Admission, failure_stage: str) -> None:
    def fail_start() -> None:
        with web_workflow_launch(
            admission.entity,
            workflow=admission.workflow,
            user=admission.guest,
            conversation_id=None,
            resume=False,
        ):
            if failure_stage == "launch":
                raise RuntimeError("startup failed")
        with web_workflow_worker(admission.entity):
            raise RuntimeError("startup failed")

    with pytest.raises(RuntimeError, match="startup failed"):
        fail_start()
    with admission.sessions() as session:
        run = session.get(WorkflowRun, admission.entity.workflow_execution_id)
        assert run is not None
        assert run.status == WorkflowExecutionStatus.FAILED
    admission.claim()


def test_paused_run_can_resume_without_recreating_history(admission: Admission) -> None:
    with web_workflow_launch(
        admission.entity,
        workflow=admission.workflow,
        user=admission.guest,
        conversation_id=None,
        resume=False,
    ):
        pass
    with web_workflow_worker(admission.entity):
        with admission.sessions.begin() as session:
            session.execute(
                sa.update(WorkflowRun)
                .where(WorkflowRun.id == admission.entity.workflow_execution_id)
                .values(status=WorkflowExecutionStatus.PAUSED)
            )
    with web_workflow_launch(
        admission.entity,
        workflow=admission.workflow,
        user=admission.guest,
        conversation_id=None,
        resume=True,
    ):
        with admission.sessions() as session:
            assert session.scalar(sa.select(sa.func.count()).select_from(WorkflowRun)) == 1
            assert session.scalar(sa.select(WorkflowRun.status)) == WorkflowExecutionStatus.RUNNING


def test_disabled_migration_capability_keeps_the_existing_launch_path(
    admission: Admission, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services import web_workflow_admission

    monkeypatch.setattr(dify_config, "WEBAPP_ACCOUNT_PASSPORT_ENABLED", False)

    def unexpected_database_access() -> None:
        pytest.fail("Disabled Account Passport must bypass admission persistence and locks")

    monkeypatch.setattr(web_workflow_admission.session_factory, "get_session_maker", unexpected_database_access)
    with (
        web_workflow_launch(
            admission.entity,
            workflow=admission.workflow,
            user=admission.guest,
            conversation_id=None,
            resume=False,
        ),
        web_workflow_worker(admission.entity),
    ):
        with admission.sessions() as session:
            assert session.get(WorkflowRun, admission.entity.workflow_execution_id) is None


def test_failed_admission_marks_unstarted_message_as_error(admission: Admission) -> None:
    from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity
    from models.enums import ConversationFromSource, MessageStatus
    from models.model import Conversation, Message

    entity = AdvancedChatAppGenerateEntity(
        task_id=str(uuid4()),
        workflow_run_id=str(uuid4()),
        app_config=admission.entity.app_config,
        inputs={},
        query="hello",
        files=[],
        user_id=admission.guest.id,
        invoke_from=InvokeFrom.WEB_APP,
        stream=False,
    )
    with admission.sessions.begin() as session:
        conversation = Conversation(
            app_id=admission.workflow.app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Pending",
            from_source=ConversationFromSource.API,
            from_end_user_id=admission.guest.id,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=admission.workflow.app_id,
            conversation_id=conversation.id,
            query="hello",
            message="",
            answer="",
            workflow_run_id=entity.workflow_run_id,
            from_source=ConversationFromSource.API,
            from_end_user_id=admission.guest.id,
        )
        session.add(message)
        session.flush()
        conversation_id, message_id = conversation.id, message.id
    with (
        pytest.raises(WebExecutionResourcesChangedError),
        web_workflow_launch(
            entity,
            workflow=admission.workflow,
            user=admission.guest,
            conversation_id=str(uuid4()),
            resume=False,
        ),
    ):
        pytest.fail("Invalid ownership must not launch a worker")
    with admission.sessions() as session:
        assert session.scalar(sa.select(Message.status).where(Message.id == message_id)) == MessageStatus.ERROR
        assert session.scalar(sa.select(Conversation.id).where(Conversation.id == conversation_id)) is not None
    admission.claim()


def test_engine_persistence_completes_the_admitted_run_without_losing_task_identity(admission: Admission) -> None:
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from graphon.enums import WorkflowType as RuntimeWorkflowType
    from libs.datetime_utils import naive_utc_now
    from models.enums import WorkflowRunTriggeredFrom
    from repositories.entities.workflow_execution import WorkflowExecution

    with web_workflow_launch(
        admission.entity,
        workflow=admission.workflow,
        user=admission.guest,
        conversation_id=None,
        resume=False,
    ):
        pass
    repository = SQLAlchemyWorkflowExecutionRepository(
        session_factory=admission.sessions,
        tenant_id=admission.guest.tenant_id,
        user=admission.guest,
        app_id=admission.workflow.app_id,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )
    execution = WorkflowExecution(
        id_=admission.entity.workflow_execution_id,
        workflow_id=admission.workflow.id,
        workflow_type=RuntimeWorkflowType.WORKFLOW,
        workflow_version=admission.workflow.version,
        graph=admission.workflow.graph_dict,
        inputs={"value": "prepared"},
        started_at=naive_utc_now(),
    )
    with web_workflow_worker(admission.entity):
        repository.save_synchronously(execution)
        execution.status = WorkflowExecutionStatus.SUCCEEDED
        execution.finished_at = naive_utc_now()
        execution.outputs = {"result": "done"}
        repository.save_synchronously(execution)
    with admission.sessions() as session:
        run = session.get(WorkflowRun, admission.entity.workflow_execution_id)
        assert run is not None
        assert run.task_id == admission.entity.task_id
        assert run.status == WorkflowExecutionStatus.SUCCEEDED
        assert run.inputs_dict == {"value": "prepared"}
        assert run.outputs_dict == {"result": "done"}


def test_rejected_resume_does_not_settle_another_active_attempt(admission: Admission) -> None:
    with web_workflow_launch(
        admission.entity,
        workflow=admission.workflow,
        user=admission.guest,
        conversation_id=None,
        resume=False,
    ):
        pass
    with (
        pytest.raises(WebExecutionResourcesChangedError),
        web_workflow_launch(
            admission.entity,
            workflow=admission.workflow,
            user=admission.guest,
            conversation_id=str(uuid4()),
            resume=True,
        ),
    ):
        pytest.fail("A rejected resume must not launch a worker")
    with admission.sessions() as session:
        assert session.scalar(sa.select(WorkflowRun.status)) == WorkflowExecutionStatus.RUNNING
    with pytest.raises(GuestMigrationNotReadyError):
        admission.claim()


def test_cancelled_unstarted_admission_becomes_terminal_after_worker_exit(admission: Admission) -> None:
    from libs.datetime_utils import naive_utc_now

    with web_workflow_launch(
        admission.entity,
        workflow=admission.workflow,
        user=admission.guest,
        conversation_id=None,
        resume=False,
    ):
        pass
    with admission.sessions.begin() as session:
        session.execute(
            sa.update(WorkflowRun)
            .where(WorkflowRun.id == admission.entity.workflow_execution_id)
            .values(stop_requested_at=naive_utc_now())
        )
    with pytest.raises(GuestMigrationNotReadyError):
        admission.claim()
    with web_workflow_worker(admission.entity):
        pass
    with admission.sessions() as session:
        assert session.scalar(sa.select(WorkflowRun.status)) == WorkflowExecutionStatus.STOPPED
    admission.claim()

"""PostgreSQL whole-Passport migration races; CI only."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from models.account import Account, AccountStatus
from models.end_user_connection import AppConnection, EndUserConnection
from models.enums import ConversationFromSource, CreatorUserRole, CustomizeTokenStrategy, EndUserType, InvokeFrom
from models.model import App, AppMode, Conversation, EndUser, Site, UploadFile
from models.tools import ToolFile
from repositories.end_user_execution_lock import lock_end_user
from repositories.entities.web_execution import EndUserBusyError
from repositories.web_migration_repository import WebMigrationRepository
from services.web_migration_service import MigrationCounts
from tests.helpers.end_user_api_key import PROVIDER, make_harness
from tests.helpers.unit.model_factories import make_upload_file


@pytest.mark.parametrize("same_account", [False, True])
def test_concurrent_passport_claims_transfer_all_resources_once(
    db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch, same_account: bool
) -> None:
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    target_id = harness.context.end_user_id
    with sessions.begin() as session:
        guest = EndUser(
            tenant_id=harness.context.tenant_id,
            app_id=harness.context.app_id,
            type=EndUserType.BROWSER,
            account_id=None,
            session_id=str(uuid4()),
        )
        session.add(guest)
        session.flush()
        guest_id = guest.id
        upload = make_upload_file(
            tenant_id=harness.context.tenant_id, created_by_role=CreatorUserRole.END_USER, created_by=guest_id
        )
        tool = ToolFile(
            tenant_id=harness.context.tenant_id,
            user_id=guest_id,
            conversation_id=None,
            file_key="tools/race.txt",
            mimetype="text/plain",
        )
        session.add_all([upload, tool])
        session.flush()
        upload_id, tool_id = upload.id, tool.id
        session.execute(sa.update(App).where(App.id == harness.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
        session.add(
            Site(
                app_id=harness.context.app_id,
                code="migration-race",
                title="Migration",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            )
        )
        conversation = Conversation(
            app_id=harness.context.app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Guest",
            _inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=guest_id,
            invoke_from=InvokeFrom.WEB_APP,
        )
        session.add(conversation)
        session.flush()
        conversation_id = conversation.id
        if same_account:
            other_target_id = target_id
        else:
            account = Account(name="Claimant", email=f"{uuid4()}@example.com", status=AccountStatus.ACTIVE)
            session.add(account)
            session.flush()
            other_target = EndUser(
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                type=EndUserType.BROWSER,
                account_id=account.id,
                session_id=str(uuid4()),
            )
            session.add(other_target)
            session.flush()
            other_target_id = other_target.id
    guest_context = replace(harness.context, account_id=None, end_user_id=guest_id)
    monkeypatch.setattr(dify_config, "END_USER_AUTH_ALLOW_ANONYMOUS", True)
    selected = harness.service.create_api_key(guest_context, harness.command())
    repository = WebMigrationRepository(session_factory=sessions)
    source = repository.get_claim_source(
        app_code="migration-race", app_id=guest_context.app_id, end_user_id=guest_context.end_user_id
    )
    assert source is not None
    barrier = Barrier(2)

    def claim(account_end_user_id: str) -> MigrationCounts | None:
        barrier.wait(timeout=10)
        try:
            return repository.claim_guest(source, account_end_user_id=account_end_user_id)
        except EndUserBusyError:
            return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        targets = (target_id, other_target_id)
        futures = [executor.submit(claim, target) for target in targets]
        results = [future.result(timeout=20) for future in futures]
    counts = sorted((result.connections, result.conversations) for result in results if result is not None)
    assert counts in ([(1, 1)], [(0, 0), (1, 1)])
    with sessions() as session:
        winner = session.get(
            EndUser,
            targets[
                next(index for index, result in enumerate(results) if result is not None and result.connections == 1)
            ],
        )
        assert winner is not None
        connection = session.get(EndUserConnection, selected.id)
        assert connection is not None
        assert connection.account_id == winner.account_id
        assert connection.end_user_id is None
        assert connection.revision == 2
        stored = session.get(Conversation, conversation_id)
        assert stored is not None
        assert stored.from_end_user_id == winner.id
        assert session.scalar(sa.select(UploadFile.created_by).where(UploadFile.id == upload_id)) == winner.id
        assert session.scalar(sa.select(ToolFile.user_id).where(ToolFile.id == tool_id)) == winner.id


def test_message_acceptance_is_serialized_with_passport_migration(db_session_with_containers: Session) -> None:
    from models.model import Message
    from repositories.conversation_access import ConversationAccessDeniedError, lock_web_message_acceptance

    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    with sessions.begin() as session:
        guest = EndUser(
            tenant_id=harness.context.tenant_id,
            app_id=harness.context.app_id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        session.add(guest)
        session.flush()
        guest_id = guest.id
        session.execute(sa.update(App).where(App.id == harness.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
        session.add(
            Site(
                app_id=harness.context.app_id,
                code="acceptance-race",
                title="Migration",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            )
        )
        conversation = Conversation(
            app_id=harness.context.app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Guest",
            _inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=guest_id,
            invoke_from=InvokeFrom.WEB_APP,
        )
        session.add(conversation)
        session.flush()
        conversation_id = conversation.id
    repository = WebMigrationRepository(session_factory=sessions)
    source = repository.get_claim_source(
        app_code="acceptance-race", app_id=harness.context.app_id, end_user_id=guest_id
    )
    assert source is not None
    barrier = Barrier(2)
    message_id = str(uuid4())

    def accept() -> bool:
        barrier.wait(timeout=10)
        try:
            with sessions.begin() as session:
                lock_web_message_acceptance(
                    session,
                    tenant_id=harness.context.tenant_id,
                    app_id=harness.context.app_id,
                    end_user_id=guest_id,
                    conversation_id=conversation_id,
                )
                session.add(
                    Message(
                        id=message_id,
                        app_id=harness.context.app_id,
                        conversation_id=conversation_id,
                        query="hello",
                        message="",
                        answer="",
                        from_source=ConversationFromSource.API,
                        from_end_user_id=guest_id,
                        invoke_from=InvokeFrom.WEB_APP,
                    )
                )
        except (ConversationAccessDeniedError, EndUserBusyError):
            return False
        return True

    def migrate() -> MigrationCounts | None:
        barrier.wait(timeout=10)
        try:
            return repository.claim_guest(source, account_end_user_id=harness.context.end_user_id)
        except EndUserBusyError:
            return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        accepted = executor.submit(accept)
        migrated = executor.submit(migrate)
        migration_result = migrated.result(timeout=20)
        was_accepted = accepted.result(timeout=20)
    if migration_result is None:
        assert was_accepted
        migration_result = repository.claim_guest(source, account_end_user_id=harness.context.end_user_id)
    assert migration_result.conversations == 1
    with sessions() as session:
        stored = session.get(Conversation, conversation_id)
        assert stored is not None
        assert stored.from_end_user_id == harness.context.end_user_id
        message = session.get(Message, message_id)
        assert (message is not None) == was_accepted
        if message is not None:
            assert message.from_end_user_id == guest_id


@pytest.mark.timeout(15)
def test_shared_admissions_coexist_and_migration_conflicts_only_for_the_same_identity(
    db_session_with_containers: Session,
) -> None:
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    with sessions.begin() as session:
        other = EndUser(
            tenant_id=harness.context.tenant_id,
            app_id=harness.context.app_id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        session.add(other)
        session.flush()
        other_id = other.id
    with sessions.begin() as first, sessions.begin() as second:
        assert (
            lock_end_user(
                first,
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                end_user_id=harness.context.end_user_id,
                exclusive=False,
            )
            is not None
        )
        assert (
            lock_end_user(
                second,
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                end_user_id=harness.context.end_user_id,
                exclusive=False,
            )
            is not None
        )
        with pytest.raises(EndUserBusyError), sessions.begin() as migration:
            lock_end_user(
                migration,
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                end_user_id=harness.context.end_user_id,
                exclusive=True,
            )
        with sessions.begin() as independent:
            assert (
                lock_end_user(
                    independent,
                    tenant_id=harness.context.tenant_id,
                    app_id=harness.context.app_id,
                    end_user_id=other_id,
                    exclusive=True,
                )
                is not None
            )
    with sessions.begin() as migration:
        assert (
            lock_end_user(
                migration,
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                end_user_id=harness.context.end_user_id,
                exclusive=True,
            )
            is not None
        )
        with pytest.raises(EndUserBusyError), sessions.begin() as starting:
            lock_end_user(
                starting,
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                end_user_id=harness.context.end_user_id,
                exclusive=False,
            )


@pytest.mark.timeout(30)
def test_two_guests_migrating_to_one_account_preserve_a_whole_default_set(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    code = f"default-race-{uuid4()}"
    with sessions.begin() as session:
        session.add(
            Site(
                app_id=harness.context.app_id,
                code=code,
                title="Defaults",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            )
        )
        guests = [
            EndUser(
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                type=EndUserType.BROWSER,
                session_id=str(uuid4()),
            )
            for _ in range(2)
        ]
        session.add_all(guests)
        session.flush()
        guest_ids = [guest.id for guest in guests]
    monkeypatch.setattr(dify_config, "END_USER_AUTH_ALLOW_ANONYMOUS", True)
    for index, guest_id in enumerate(guest_ids):
        identity = replace(harness.context, end_user_id=guest_id, account_id=None)
        connection = harness.service.create_api_key(identity, harness.command())
        with sessions.begin() as session:
            session.add(
                AppConnection(
                    tenant_id=identity.tenant_id,
                    app_id=identity.app_id,
                    end_user_id=identity.end_user_id,
                    workflow_id=harness.workflow_id,
                    node_id=f"guest-{index}",
                    provider=PROVIDER,
                    connection_id=connection.id,
                )
            )
    repository = WebMigrationRepository(session_factory=sessions)
    sources = [
        repository.get_claim_source(
            app_code=code,
            app_id=harness.context.app_id,
            end_user_id=guest_id,
        )
        for guest_id in guest_ids
    ]
    barrier = Barrier(2)

    def claim(index: int) -> MigrationCounts | None:
        source = sources[index]
        assert source is not None
        barrier.wait(timeout=10)
        try:
            return repository.claim_guest(source, account_end_user_id=harness.context.end_user_id)
        except EndUserBusyError:
            return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(claim, index) for index in range(2)]
        results = [future.result(timeout=20) for future in futures]
    assert any(result is not None and result.connections == 1 for result in results)
    with sessions() as session:
        initial_defaults = session.scalars(
            sa.select(AppConnection.node_id).where(
                AppConnection.app_id == harness.context.app_id,
                AppConnection.end_user_id == harness.context.end_user_id,
            )
        ).all()
        assert len(initial_defaults) == 1
        assert initial_defaults[0] in {"guest-0", "guest-1"}
    for index, result in enumerate(results):
        if result is None:
            source = sources[index]
            assert source is not None
            repository.claim_guest(source, account_end_user_id=harness.context.end_user_id)
    with sessions() as session:
        assert (
            session.scalars(
                sa.select(AppConnection.node_id).where(
                    AppConnection.app_id == harness.context.app_id,
                    AppConnection.end_user_id == harness.context.end_user_id,
                )
            ).all()
            == initial_defaults
        )


@pytest.mark.timeout(30)
def test_active_conversation_is_not_locked_by_best_effort_claim(db_session_with_containers: Session) -> None:
    from threading import Event

    from sqlalchemy import event

    from graphon.enums import WorkflowExecutionStatus
    from models.enums import WorkflowRunTriggeredFrom
    from models.model import Message
    from models.workflow import Workflow, WorkflowRun, WorkflowType

    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    code = f"active-race-{uuid4()}"
    with sessions.begin() as session:
        guest = EndUser(
            tenant_id=harness.context.tenant_id,
            app_id=harness.context.app_id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        session.add(guest)
        session.flush()
        guest_id = guest.id
        session.execute(sa.update(App).where(App.id == harness.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
        session.execute(sa.update(Workflow).where(Workflow.id == harness.workflow_id).values(type=WorkflowType.CHAT))
        session.add(
            Site(
                app_id=harness.context.app_id,
                code=code,
                title="Active",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            )
        )
        active = Conversation(
            app_id=harness.context.app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Active",
            _inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=guest_id,
            invoke_from=InvokeFrom.WEB_APP,
        )
        idle = Conversation(
            app_id=harness.context.app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Idle",
            _inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=guest_id,
            invoke_from=InvokeFrom.WEB_APP,
        )
        run = WorkflowRun(
            id=str(uuid4()),
            tenant_id=harness.context.tenant_id,
            app_id=harness.context.app_id,
            workflow_id=harness.workflow_id,
            type=WorkflowType.CHAT,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="published",
            graph="{}",
            inputs="{}",
            outputs="{}",
            status=WorkflowExecutionStatus.RUNNING,
            created_by_role=CreatorUserRole.END_USER,
            created_by=guest_id,
        )
        session.add_all([active, idle, run])
        session.flush()
        active_id, idle_id, run_id = active.id, idle.id, run.id
        session.add(
            Message(
                app_id=harness.context.app_id,
                conversation_id=active_id,
                workflow_run_id=run_id,
                query="hello",
                message="",
                answer="",
                from_source=ConversationFromSource.API,
                from_end_user_id=guest_id,
                invoke_from=InvokeFrom.WEB_APP,
            )
        )
        upload = make_upload_file(
            tenant_id=harness.context.tenant_id,
            created_by_role=CreatorUserRole.END_USER,
            created_by=guest_id,
        )
        session.add(upload)
    repository = WebMigrationRepository(session_factory=sessions)
    source = repository.get_claim_source(app_code=code, app_id=harness.context.app_id, end_user_id=guest_id)
    assert source is not None
    transferring, writer_done = Event(), Event()

    def pause_transfer(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.startswith("UPDATE upload_files SET"):
            transferring.set()
            if not writer_done.wait(timeout=10):
                raise TimeoutError("Active conversation writer was blocked by migration")

    def update_active() -> None:
        with sessions.begin() as session:
            session.execute(sa.update(Conversation).where(Conversation.id == active_id).values(name="Still active"))
        writer_done.set()

    engine = db_session_with_containers.get_bind()
    event.listen(engine, "after_cursor_execute", pause_transfer)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            claim = executor.submit(repository.claim_guest, source, account_end_user_id=harness.context.end_user_id)
            assert transferring.wait(timeout=10)
            writer = executor.submit(update_active)
            result = claim.result(timeout=20)
            writer.result(timeout=20)
    finally:
        event.remove(engine, "after_cursor_execute", pause_transfer)
    assert result.skipped_conversations == (active_id,)
    assert result.conversations == 1
    assert result.active_runs == 1
    with sessions() as session:
        assert session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == active_id)) == guest_id
        assert session.scalar(sa.select(Conversation.name).where(Conversation.id == active_id)) == "Still active"
        assert (
            session.scalar(sa.select(Conversation.from_end_user_id).where(Conversation.id == idle_id))
            == harness.context.end_user_id
        )

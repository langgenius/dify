"""PostgreSQL whole-Passport migration races; CI only."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta
from threading import Barrier, Event
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from models.account import Account, AccountStatus
from models.end_user_connection import AppConnection, EndUserConnection
from models.enums import ConversationFromSource, CreatorUserRole, CustomizeTokenStrategy, EndUserType, InvokeFrom
from models.model import App, AppMode, AppModelConfig, Conversation, EndUser, Site, UploadFile
from models.tools import ToolFile
from repositories.conversation_access import ConversationAccessDeniedError, require_web_message_access
from repositories.end_user_execution_lock import lock_end_user
from repositories.entities.web_execution import EndUserBusyError
from repositories.web_migration_repository import WebMigrationRepository
from services.end_user_connections.management import StoredConnection
from services.web_migration_service import MigrationCounts
from tests.helpers.end_user_api_key import PROVIDER, make_harness
from tests.helpers.unit.model_factories import make_upload_file


@pytest.mark.parametrize("same_account", [False, True])
@pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.CHAT])
def test_concurrent_passport_claims_transfer_all_resources_once(
    db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch, same_account: bool, mode: AppMode
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
        config = AppModelConfig(app_id=harness.context.app_id)
        session.add(config)
        session.flush()
        session.execute(
            sa.update(App).where(App.id == harness.context.app_id).values(mode=mode, app_model_config_id=config.id)
        )
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
            mode=mode,
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
    # Chat history can be claimed, but only a Chatflow has personal tool credentials.
    selected = (
        harness.service.create_api_key(guest_context, harness.command()) if mode == AppMode.ADVANCED_CHAT else None
    )
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
    transferred = (int(selected is not None), 1)
    assert counts in ([transferred], [(0, 0), transferred])
    with sessions() as session:
        winner_index = next(
            index for index, result in enumerate(results) if result is not None and result.conversations == 1
        )
        winner = session.get(EndUser, targets[winner_index])
        assert winner is not None
        if selected is not None:
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


@pytest.mark.parametrize("winner", ["claim", "cleanup"])
@pytest.mark.timeout(40)
def test_inactive_connection_cleanup_and_claim_use_the_same_identity_fence(
    db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch, winner: str
) -> None:
    """Pause the winner before commit and prove the competing operation cannot take the grant."""
    engine = db_session_with_containers.get_bind()
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    harness = make_harness(sessions)
    account = harness.context
    code = f"cleanup-race-{uuid4()}"
    with sessions.begin() as session:
        guest = EndUser(
            tenant_id=account.tenant_id, app_id=account.app_id, type=EndUserType.BROWSER, session_id=str(uuid4())
        )
        session.add_all(
            [
                guest,
                Site(
                    app_id=account.app_id,
                    code=code,
                    title="Guest retention",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                ),
            ]
        )
    context = replace(account, end_user_id=guest.id, account_id=None)
    monkeypatch.setattr(dify_config, "END_USER_AUTH_ALLOW_ANONYMOUS", True)
    connection = harness.service.create_api_key(context, harness.command())
    cutoff = datetime(2026, 1, 1)
    with sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection.id)
            .values(last_active_at=cutoff - timedelta(days=1))
        )
    migration = WebMigrationRepository(session_factory=sessions)
    source = migration.get_claim_source(app_code=code, app_id=context.app_id, end_user_id=context.end_user_id)
    assert source is not None
    (candidate,) = harness.repository.inactive_guests(before=cutoff, after=None, limit=1)
    assert candidate.connection_id == connection.id

    reached_write = Event()
    release = Event()
    write = "UPDATE end_user_connections" if winner == "claim" else "DELETE FROM end_user_connections"

    def pause_write(_conn: object, _cursor: object, statement: str, _params: object, _ctx: object, _many: bool) -> None:
        if statement.startswith(write):
            reached_write.set()
            assert release.wait(timeout=10)

    def claim() -> MigrationCounts:
        return migration.claim_guest(source, account_end_user_id=account.end_user_id)

    def cleanup() -> StoredConnection | None:
        return harness.repository.expire_guest(candidate, before=cutoff)

    event.listen(engine, "after_cursor_execute", pause_write)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(claim if winner == "claim" else cleanup)
            try:
                assert reached_write.wait(timeout=10)
                if winner == "claim":
                    assert cleanup() is None
                else:
                    with pytest.raises(EndUserBusyError):
                        claim()
            finally:
                release.set()
            outcome = first.result(timeout=10)
            if winner == "claim":
                assert outcome == MigrationCounts(1, 0)
            else:
                assert isinstance(outcome, StoredConnection)
    finally:
        event.remove(engine, "after_cursor_execute", pause_write)

    if winner == "claim":
        assert cleanup() is None
        claimed = harness.repository.find(account, connection.id)
        assert claimed is not None
        assert claimed.access.owner.account_id == account.account_id
    else:
        assert claim() == MigrationCounts(0, 0)
        assert harness.repository.find(context, connection.id) is None


@pytest.mark.timeout(30)
def test_chatbot_writes_are_fenced_before_and_after_claim(db_session_with_containers: Session) -> None:
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    with sessions.begin() as session:
        guest = EndUser(
            tenant_id=harness.context.tenant_id,
            app_id=harness.context.app_id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        config = AppModelConfig(app_id=harness.context.app_id)
        session.add_all([guest, config])
        session.flush()
        guest_id = guest.id
        session.execute(
            sa.update(App)
            .where(App.id == harness.context.app_id)
            .values(mode=AppMode.CHAT, app_model_config_id=config.id)
        )
        code = f"chatbot-write-race-{uuid4()}"
        session.add(
            Site(
                app_id=harness.context.app_id,
                code=code,
                title="Chatbot",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            )
        )
        conversation = Conversation(
            app_id=harness.context.app_id,
            mode=AppMode.CHAT,
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
    source = repository.get_claim_source(app_code=code, app_id=harness.context.app_id, end_user_id=guest_id)
    assert source is not None
    with sessions.begin() as writer:
        require_web_message_access(
            writer,
            tenant_id=harness.context.tenant_id,
            app_id=harness.context.app_id,
            end_user_id=guest_id,
            conversation_id=conversation_id,
        )
        writer.execute(sa.update(Conversation).where(Conversation.id == conversation_id).values(name="Committed first"))
        with pytest.raises(EndUserBusyError):
            repository.claim_guest(source, account_end_user_id=harness.context.end_user_id)
    assert repository.claim_guest(source, account_end_user_id=harness.context.end_user_id) == MigrationCounts(0, 1)
    with sessions.begin() as late_writer, pytest.raises(ConversationAccessDeniedError):
        require_web_message_access(
            late_writer,
            tenant_id=harness.context.tenant_id,
            app_id=harness.context.app_id,
            end_user_id=guest_id,
            conversation_id=conversation_id,
        )
    with sessions() as session:
        stored = session.get(Conversation, conversation_id)
        assert stored is not None
        assert stored.name == "Committed first"
        assert stored.from_end_user_id == harness.context.end_user_id


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

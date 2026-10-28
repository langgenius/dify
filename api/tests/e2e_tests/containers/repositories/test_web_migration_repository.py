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
from models.end_user_connection import EndUserConnection
from models.enums import ConversationFromSource, CustomizeTokenStrategy, EndUserType, InvokeFrom
from models.model import App, AppMode, Conversation, EndUser, Site
from repositories.web_migration_repository import WebMigrationRepository
from services.web_migration_service import MigrationCounts
from tests.helpers.end_user_api_key import make_harness


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

    def claim(account_end_user_id: str) -> MigrationCounts:
        barrier.wait(timeout=10)
        return repository.claim_guest(source, account_end_user_id=account_end_user_id)

    with ThreadPoolExecutor(max_workers=2) as executor:
        targets = (target_id, other_target_id)
        futures = [executor.submit(claim, target) for target in targets]
        results = [future.result(timeout=20) for future in futures]
    assert sorted((result.connections, result.conversations) for result in results) == [(0, 0), (1, 1)]
    with sessions() as session:
        winner = session.get(
            EndUser, targets[next(index for index, result in enumerate(results) if result.connections == 1)]
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
        except ConversationAccessDeniedError:
            return False
        return True

    def migrate() -> MigrationCounts:
        barrier.wait(timeout=10)
        return repository.claim_guest(source, account_end_user_id=harness.context.end_user_id)

    with ThreadPoolExecutor(max_workers=2) as executor:
        accepted = executor.submit(accept)
        migrated = executor.submit(migrate)
        assert migrated.result(timeout=20).conversations == 1
        was_accepted = accepted.result(timeout=20)
    with sessions() as session:
        stored = session.get(Conversation, conversation_id)
        assert stored is not None
        assert stored.from_end_user_id == harness.context.end_user_id
        message = session.get(Message, message_id)
        assert (message is not None) == was_accepted
        if message is not None:
            assert message.from_end_user_id == guest_id

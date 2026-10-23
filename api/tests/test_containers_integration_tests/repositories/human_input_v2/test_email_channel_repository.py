"""PostgreSQL concurrency contracts for Human Input Email configuration."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)
from libs.datetime_utils import naive_utc_now
from models.account import Tenant
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.email_channel import (
    CreateEmailConfigurationResult,
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationResult,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
    UpdateEmailConfigurationResult,
    UpdateEmailConfigurationStatus,
)
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository


def _configuration(tenant_id: TenantId, *, configuration_id: str | None = None) -> EmailChannelConfiguration:
    now = naive_utc_now()
    return EmailChannelConfiguration(
        EmailProviderId(configuration_id or str(uuid4())),
        tenant_id,
        NormalizedEmail("sender@example.com"),
        "Sender",
        ChannelEncryptedCredentials(ciphertext="ciphertext"),
        AccountId(str(uuid4())),
        now,
        now,
    )


def _sessions(db_session: Session) -> tuple[sessionmaker[Session], TenantId]:
    tenant = Tenant(name="Email channel concurrency")
    db_session.add(tenant)
    db_session.commit()
    tenant_id = TenantId(tenant.id)
    maker = sessionmaker(bind=db_session.get_bind(), expire_on_commit=False)
    return maker, tenant_id


def test_concurrent_first_creation_has_one_winner(db_session_with_containers: Session) -> None:
    sessions, tenant_id = _sessions(db_session_with_containers)
    barrier = Barrier(2)

    def create(configuration: EmailChannelConfiguration) -> CreateEmailConfigurationResult:
        barrier.wait()
        with sessions.begin() as session:
            return SQLAlchemyEmailChannelRepository(session).create(configuration)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = tuple(
            executor.map(
                create,
                (_configuration(tenant_id), _configuration(tenant_id)),
            )
        )

    assert sorted(result.status for result in results) == [
        CreateEmailConfigurationStatus.CONFLICT,
        CreateEmailConfigurationStatus.CREATED,
    ]


def test_concurrent_conditional_updates_have_one_winner(db_session_with_containers: Session) -> None:
    sessions, tenant_id = _sessions(db_session_with_containers)
    with sessions.begin() as session:
        current = SQLAlchemyEmailChannelRepository(session).create(_configuration(tenant_id)).configuration
    assert current is not None
    barrier = Barrier(2)

    def update(sender_name: str) -> UpdateEmailConfigurationResult:
        barrier.wait()
        with sessions.begin() as session:
            return SQLAlchemyEmailChannelRepository(session).update(
                replace(current, encrypted_credentials=ChannelEncryptedCredentials(ciphertext=sender_name)),
                expected=current.snapshot,
                now=naive_utc_now(),
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = tuple(executor.map(update, ("First", "Second")))

    assert sorted(result.status for result in results) == [
        UpdateEmailConfigurationStatus.STALE,
        UpdateEmailConfigurationStatus.UPDATED,
    ]


def test_update_delete_race_cannot_restore_deleted_row(db_session_with_containers: Session) -> None:
    sessions, tenant_id = _sessions(db_session_with_containers)
    with sessions.begin() as session:
        current = SQLAlchemyEmailChannelRepository(session).create(_configuration(tenant_id)).configuration
    assert current is not None
    barrier = Barrier(2)

    def update() -> UpdateEmailConfigurationResult:
        barrier.wait()
        with sessions.begin() as session:
            return SQLAlchemyEmailChannelRepository(session).update(
                replace(current, encrypted_credentials=ChannelEncryptedCredentials(ciphertext="replacement")),
                expected=current.snapshot,
                now=naive_utc_now(),
            )

    def delete() -> DeleteEmailConfigurationResult:
        barrier.wait()
        with sessions.begin() as session:
            return SQLAlchemyEmailChannelRepository(session).delete(tenant_id, expected=current.snapshot)

    with ThreadPoolExecutor(max_workers=2) as executor:
        update_future = executor.submit(update)
        delete_future = executor.submit(delete)
        update_result = update_future.result()
        delete_result = delete_future.result()

    with sessions() as session:
        persisted = SQLAlchemyEmailChannelRepository(session).load(tenant_id)
    if update_result.status is UpdateEmailConfigurationStatus.UPDATED:
        assert delete_result.status is DeleteEmailConfigurationStatus.STALE
        assert update_result.configuration is not None
        assert persisted == update_result.configuration
    else:
        assert update_result.status is UpdateEmailConfigurationStatus.STALE
        assert delete_result.status is DeleteEmailConfigurationStatus.DELETED
        assert persisted is None


def test_delete_recreate_rejects_previous_identity(db_session_with_containers: Session) -> None:
    sessions, tenant_id = _sessions(db_session_with_containers)
    with sessions.begin() as session:
        deleted = SQLAlchemyEmailChannelRepository(session).create(_configuration(tenant_id)).configuration
        assert deleted is not None
    with sessions.begin() as session:
        SQLAlchemyEmailChannelRepository(session).delete(tenant_id, expected=deleted.snapshot)
    with sessions.begin() as session:
        recreated = SQLAlchemyEmailChannelRepository(session).create(_configuration(tenant_id)).configuration
        assert recreated is not None

    with sessions.begin() as session:
        repository = SQLAlchemyEmailChannelRepository(session)
        stale = repository.update(
            replace(deleted, encrypted_credentials=ChannelEncryptedCredentials(ciphertext="stale")),
            expected=deleted.snapshot,
            now=naive_utc_now(),
        )
        assert stale.status is UpdateEmailConfigurationStatus.STALE
        assert repository.load(tenant_id) == recreated

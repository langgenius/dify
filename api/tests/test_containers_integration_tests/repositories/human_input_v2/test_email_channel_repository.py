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
from repositories.human_input_v2.email_channel import (
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
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
        "ciphertext",
        AccountId(str(uuid4())),
        now,
        now,
    )


def _repository(db_session: Session) -> tuple[SQLAlchemyEmailChannelRepository, TenantId]:
    tenant = Tenant(name="Email channel concurrency")
    db_session.add(tenant)
    db_session.commit()
    tenant_id = TenantId(tenant.id)
    maker = sessionmaker(bind=db_session.get_bind(), expire_on_commit=False)
    return SQLAlchemyEmailChannelRepository(maker), tenant_id


def test_concurrent_first_creation_has_one_winner(db_session_with_containers: Session) -> None:
    repository, tenant_id = _repository(db_session_with_containers)
    barrier = Barrier(2)

    def create(configuration: EmailChannelConfiguration):
        barrier.wait()
        return repository.create(configuration)

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
    repository, tenant_id = _repository(db_session_with_containers)
    current = repository.create(_configuration(tenant_id)).configuration
    assert current is not None
    barrier = Barrier(2)

    def update(sender_name: str):
        barrier.wait()
        return repository.update(
            replace(current, sender_name=sender_name),
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
    repository, tenant_id = _repository(db_session_with_containers)
    current = repository.create(_configuration(tenant_id)).configuration
    assert current is not None
    barrier = Barrier(2)

    def update():
        barrier.wait()
        return repository.update(
            replace(current, sender_name="Racing update"),
            expected=current.snapshot,
            now=naive_utc_now(),
        )

    def delete():
        barrier.wait()
        return repository.delete(tenant_id, expected=current.snapshot)

    with ThreadPoolExecutor(max_workers=2) as executor:
        update_future = executor.submit(update)
        delete_future = executor.submit(delete)
        update_result = update_future.result()
        delete_result = delete_future.result()

    persisted = repository.load(tenant_id)
    if update_result.status is UpdateEmailConfigurationStatus.UPDATED:
        assert delete_result.status is DeleteEmailConfigurationStatus.STALE
        assert update_result.configuration is not None
        assert persisted == update_result.configuration
    else:
        assert update_result.status is UpdateEmailConfigurationStatus.STALE
        assert delete_result.status is DeleteEmailConfigurationStatus.DELETED
        assert persisted is None


def test_delete_recreate_rejects_previous_identity(db_session_with_containers: Session) -> None:
    repository, tenant_id = _repository(db_session_with_containers)
    deleted = repository.create(_configuration(tenant_id)).configuration
    assert deleted is not None
    repository.delete(tenant_id, expected=deleted.snapshot)
    recreated = repository.create(_configuration(tenant_id)).configuration
    assert recreated is not None

    stale = repository.update(
        replace(deleted, sender_name="Stale write"),
        expected=deleted.snapshot,
        now=naive_utc_now(),
    )

    assert stale.status is UpdateEmailConfigurationStatus.STALE
    assert repository.load(tenant_id) == recreated

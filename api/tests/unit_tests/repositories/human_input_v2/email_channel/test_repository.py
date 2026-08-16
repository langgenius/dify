"""SQLite contract tests for Email channel persistence."""

from dataclasses import replace
from datetime import datetime

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.email_channel import (
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
    ProtectedAPIKey,
    UpdateEmailConfigurationStatus,
)
from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)
from models.account import Tenant
from models.human_input_v2 import HumanInputEmailProvider
from repositories.human_input_v2.email_channel.mappers import (
    email_configuration_from_record,
    email_configuration_to_record,
)
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository

_NOW = datetime(2026, 7, 28, 8)
_EARLIER = datetime(2026, 7, 28, 7)
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000001")


def _configuration(
    configuration_id: str = "00000000-0000-0000-0000-000000000010",
    tenant_id: TenantId = _TENANT_ID,
) -> EmailChannelConfiguration:
    return EmailChannelConfiguration(
        EmailProviderId(configuration_id),
        tenant_id,
        NormalizedEmail("sender@example.com"),
        "Sender",
        ProtectedAPIKey("ciphertext"),
        AccountId("00000000-0000-0000-0000-000000000020"),
        _NOW,
        _NOW,
    )


def _context(sqlite_engine: Engine) -> tuple[SQLAlchemyEmailChannelRepository, sessionmaker[Session]]:
    tables = [Tenant.__table__, HumanInputEmailProvider.__table__]
    HumanInputEmailProvider.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(sqlite_engine, expire_on_commit=False)
    with session_maker.begin() as session:
        session.add(Tenant(name="Workspace"))
        session.flush()
        tenant = session.scalar(sa.select(Tenant))
        assert tenant is not None
        tenant.id = str(_TENANT_ID)
    return SQLAlchemyEmailChannelRepository(session_maker), session_maker


def test_create_load_conflict_and_cross_tenant_isolation(sqlite_engine: Engine) -> None:
    repository, _ = _context(sqlite_engine)

    created = repository.create(_configuration())
    conflict = repository.create(_configuration("00000000-0000-0000-0000-000000000011"))

    assert created.status is CreateEmailConfigurationStatus.CREATED
    assert conflict.status is CreateEmailConfigurationStatus.CONFLICT
    assert repository.load(_TENANT_ID) == created.configuration
    assert repository.load(TenantId("00000000-0000-0000-0000-000000000099")) is None


def test_email_configuration_mapper_round_trip_is_detached() -> None:
    configuration = _configuration()

    restored = email_configuration_from_record(email_configuration_to_record(configuration))

    assert restored == configuration
    assert restored is not configuration


def test_update_uses_identity_and_timestamp_and_advances_equal_clock(sqlite_engine: Engine) -> None:
    repository, _ = _context(sqlite_engine)
    current = repository.create(_configuration()).configuration
    assert current is not None

    result = repository.update(
        replace(current, sender_name="Updated"),
        expected=current.snapshot,
        now=_EARLIER,
    )
    stale = repository.update(
        replace(current, sender_name="Stale"),
        expected=current.snapshot,
        now=_NOW,
    )

    assert result.status is UpdateEmailConfigurationStatus.UPDATED
    assert result.configuration is not None
    assert result.configuration.updated_at > current.updated_at
    assert stale.status is UpdateEmailConfigurationStatus.STALE
    assert repository.load(_TENANT_ID) == result.configuration


def test_delete_recreate_rejects_deleted_identity_snapshot(sqlite_engine: Engine) -> None:
    repository, _ = _context(sqlite_engine)
    deleted = repository.create(_configuration()).configuration
    assert deleted is not None
    assert repository.delete(_TENANT_ID).status is DeleteEmailConfigurationStatus.DELETED
    recreated = repository.create(_configuration("00000000-0000-0000-0000-000000000011")).configuration
    assert recreated is not None

    stale = repository.update(
        replace(deleted, sender_name="Stale"),
        expected=deleted.snapshot,
        now=_NOW,
    )

    assert stale.status is UpdateEmailConfigurationStatus.STALE
    assert repository.load(_TENANT_ID) == recreated


def test_operation_scoped_loads_have_bounded_query_counts(sqlite_engine: Engine) -> None:
    repository, _ = _context(sqlite_engine)
    current = repository.create(_configuration()).configuration
    assert current is not None
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        repository.load(_TENANT_ID)
        assert len(statements) == 1
        statements.clear()

        repository.update(
            replace(current, sender_name="Updated"),
            expected=current.snapshot,
            now=_NOW,
        )
        assert len(statements) == 2
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)


def test_failed_update_rolls_back_all_changes(sqlite_engine: Engine) -> None:
    repository, _ = _context(sqlite_engine)
    current = repository.create(_configuration()).configuration
    assert current is not None

    def fail_update(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("UPDATE"):
            raise RuntimeError("forced write failure")

    event.listen(sqlite_engine, "before_cursor_execute", fail_update)
    try:
        with pytest.raises(RuntimeError, match="forced write failure"):
            repository.update(
                replace(current, sender_name="Must roll back"),
                expected=current.snapshot,
                now=_NOW,
            )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", fail_update)

    assert repository.load(_TENANT_ID) == current

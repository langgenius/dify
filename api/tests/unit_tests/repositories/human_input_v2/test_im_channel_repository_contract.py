"""Behavioral contracts for owner-bound IM Channel persistence."""

from __future__ import annotations

import inspect
from collections.abc import Generator
from dataclasses import FrozenInstanceError, fields, replace
from datetime import datetime
from pathlib import Path
from typing import Literal

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.human_input_v2.entities import EmailProviderType, IMProvider
from core.human_input_v2.shared import AccountId, TenantId
from models.human_input_v2 import (
    HumanInputEmailProvider,
    HumanInputIMChannel,
    IMEncryptedCredentials,
    ResendEmailProviderEncryptedCredentials,
)
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelAlreadyConfiguredError,
    IMChannelId,
    IMChannelReader,
    IMChannelStatus,
    IMChannelWriter,
    StaleIMChannelWriteError,
    WebhookId,
)
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    DeploymentIMChannelWriter,
    WorkspaceIMChannelReader,
    WorkspaceIMChannelWriter,
)

_NOW = datetime(2026, 8, 31, 8)
_LATER = datetime(2026, 8, 31, 9)
_WORKSPACE_ONE = TenantId("00000000-0000-0000-0000-000000000101")
_WORKSPACE_TWO = TenantId("00000000-0000-0000-0000-000000000102")
_ACCOUNT_ONE = AccountId("00000000-0000-0000-0000-000000000201")
_ACCOUNT_TWO = AccountId("00000000-0000-0000-0000-000000000202")
_OwnerKind = Literal["workspace", "deployment"]


@pytest.fixture
def channel_engine(tmp_path: Path) -> Generator[Engine, None, None]:
    database_path = tmp_path / "im-channel.sqlite3"
    engine = sa.create_engine(f"sqlite:///{database_path}")
    channel_table = HumanInputIMChannel.metadata.tables[HumanInputIMChannel.__tablename__]
    email_table = HumanInputEmailProvider.metadata.tables[HumanInputEmailProvider.__tablename__]
    HumanInputIMChannel.metadata.create_all(
        engine,
        tables=[channel_table, email_table],
    )
    try:
        yield engine
    finally:
        engine.dispose()


def _channel(
    index: int,
    *,
    version: int = 1,
    webhook_index: int | None = None,
    provider: IMProvider = IMProvider.FEISHU,
    app_identifier: str | None = None,
    status: IMChannelStatus = IMChannelStatus.CONNECTED,
    status_reason: str | None = None,
    created_at: datetime = _NOW,
    updated_at: datetime = _NOW,
) -> IMChannel:
    return IMChannel(
        id=IMChannelId(f"00000000-0000-0000-0000-{index:012d}"),
        created_at=created_at,
        updated_at=updated_at,
        provider=provider,
        provider_tenant_id=f"provider-tenant-{index}",
        encrypted_credentials=IMEncryptedCredentials(ciphertext=f"opaque-ciphertext-{index}"),
        app_identifier=app_identifier or f"app-{index}",
        webhook_id=WebhookId(f"{webhook_index if webhook_index is not None else index:032x}"),
        config_version=version,
        status=status,
        status_reason=status_reason,
    )


def _reader(
    session: Session,
    owner_kind: _OwnerKind,
    tenant_id: TenantId = _WORKSPACE_ONE,
) -> IMChannelReader:
    if owner_kind == "workspace":
        return WorkspaceIMChannelReader(session, tenant_id)
    return DeploymentIMChannelReader(session)


def _writer(
    session: Session,
    owner_kind: _OwnerKind,
    tenant_id: TenantId = _WORKSPACE_ONE,
    account_id: AccountId = _ACCOUNT_ONE,
) -> IMChannelWriter:
    if owner_kind == "workspace":
        return WorkspaceIMChannelWriter(session, tenant_id, account_id)
    return DeploymentIMChannelWriter(session)


def _commit_channel(
    engine: Engine,
    owner_kind: _OwnerKind,
    channel: IMChannel,
    *,
    tenant_id: TenantId = _WORKSPACE_ONE,
    account_id: AccountId = _ACCOUNT_ONE,
) -> None:
    with Session(engine, expire_on_commit=False) as session, session.begin():
        _writer(session, owner_kind, tenant_id, account_id).create(channel)


def _pending_email_configuration() -> HumanInputEmailProvider:
    return HumanInputEmailProvider(
        provider=EmailProviderType.RESEND,
        sender_email="pending@example.com",
        encrypted_credentials=ResendEmailProviderEncryptedCredentials(encrypted_api_key="opaque-email-key"),
        tenant_id="00000000-0000-0000-0000-000000000999",
        sender_name="Pending",
    )


def _public_methods(protocol: type[object]) -> set[str]:
    return {name for name, value in protocol.__dict__.items() if not name.startswith("_") and inspect.isfunction(value)}


def test_repository_value_is_immutable_owner_free_and_credential_safe() -> None:
    channel = _channel(1)

    assert tuple(field.name for field in fields(IMChannel)) == (
        "id",
        "created_at",
        "updated_at",
        "provider",
        "provider_tenant_id",
        "encrypted_credentials",
        "app_identifier",
        "webhook_id",
        "config_version",
        "status",
        "status_reason",
    )
    assert "opaque-ciphertext-1" not in repr(channel)
    assert {status.value for status in IMChannelStatus} == {
        "connected",
        "invalid_credentials",
        "connection_failure",
    }
    assert IMChannelAlreadyConfiguredError.__bases__ == (Exception,)
    assert StaleIMChannelWriteError.__bases__ == (Exception,)
    frozen_attribute = "app_identifier"
    with pytest.raises(FrozenInstanceError):
        setattr(channel, frozen_attribute, "mutated")


def test_protocols_and_constructors_expose_only_the_frozen_persistence_contract() -> None:
    assert _public_methods(IMChannelReader) == {"get"}
    assert _public_methods(IMChannelWriter) == {"create", "update", "replace", "delete"}
    assert tuple(inspect.signature(IMChannelReader.get).parameters) == ("self",)
    assert tuple(inspect.signature(IMChannelWriter.create).parameters) == ("self", "channel")
    assert tuple(inspect.signature(IMChannelWriter.update).parameters) == (
        "self",
        "channel",
        "expected_config_version",
    )
    assert tuple(inspect.signature(IMChannelWriter.replace).parameters) == (
        "self",
        "current_channel_id",
        "expected_config_version",
        "replacement",
    )
    assert tuple(inspect.signature(IMChannelWriter.delete).parameters) == (
        "self",
        "channel_id",
        "expected_config_version",
    )
    assert tuple(inspect.signature(WorkspaceIMChannelReader).parameters) == ("session", "tenant_id")
    assert tuple(inspect.signature(WorkspaceIMChannelWriter).parameters) == (
        "session",
        "tenant_id",
        "configured_by_account_id",
    )
    assert tuple(inspect.signature(DeploymentIMChannelReader).parameters) == ("session",)
    assert tuple(inspect.signature(DeploymentIMChannelWriter).parameters) == ("session",)


@pytest.mark.parametrize("owner_kind", ["workspace", "deployment"])
def test_create_maps_every_channel_value_and_caller_rollback_removes_it(
    channel_engine: Engine,
    owner_kind: _OwnerKind,
) -> None:
    channel = _channel(
        1,
        provider=IMProvider.SLACK,
        status=IMChannelStatus.CONNECTION_FAILURE,
        status_reason="safe failure",
    )
    with Session(channel_engine, expire_on_commit=False) as session:
        created = _writer(session, owner_kind).create(channel)
        record = session.get_one(HumanInputIMChannel, str(channel.id))

        assert created == channel
        assert created.encrypted_credentials is channel.encrypted_credentials
        assert _reader(session, owner_kind).get() == channel
        assert record.owner_key == (f"workspace:{_WORKSPACE_ONE}" if owner_kind == "workspace" else "deployment")
        assert record.configured_by_account_id == (str(_ACCOUNT_ONE) if owner_kind == "workspace" else None)
        assert record.provider_tenant_id == channel.provider_tenant_id
        assert record.encrypted_credentials == channel.encrypted_credentials
        assert record.webhook_id == channel.webhook_id
        assert record.status is channel.status
        assert record.status_reason == channel.status_reason
        session.rollback()

    with Session(channel_engine) as verification_session:
        assert _reader(verification_session, owner_kind).get() is None


def test_readers_return_only_their_current_owner_slot(channel_engine: Engine) -> None:
    workspace_one = _channel(1)
    workspace_two = _channel(2)
    deployment = _channel(3)
    with Session(channel_engine, expire_on_commit=False) as session, session.begin():
        _writer(session, "workspace", _WORKSPACE_ONE, _ACCOUNT_ONE).create(workspace_one)
        _writer(session, "workspace", _WORKSPACE_TWO, _ACCOUNT_TWO).create(workspace_two)
        _writer(session, "deployment").create(deployment)

    with Session(channel_engine) as session:
        assert _reader(session, "workspace", _WORKSPACE_ONE).get() == workspace_one
        assert _reader(session, "workspace", _WORKSPACE_TWO).get() == workspace_two
        assert _reader(session, "workspace", TenantId("00000000-0000-0000-0000-000000000103")).get() is None
        assert _reader(session, "deployment").get() == deployment


@pytest.mark.parametrize("owner_kind", ["workspace", "deployment"])
def test_update_uses_id_and_scalar_version_cas_and_is_rollback_safe(
    channel_engine: Engine,
    owner_kind: _OwnerKind,
) -> None:
    current = _channel(1)
    updated = replace(
        current,
        updated_at=_LATER,
        provider_tenant_id="provider-tenant-updated",
        encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-rotated-ciphertext"),
        app_identifier="app-updated",
        webhook_id=WebhookId("f" * 32),
        config_version=2,
        status=IMChannelStatus.INVALID_CREDENTIALS,
        status_reason="credentials rejected",
    )
    _commit_channel(channel_engine, owner_kind, current)

    with Session(channel_engine, expire_on_commit=False) as session:
        assert _writer(session, owner_kind).update(updated, expected_config_version=1) == updated
        assert _reader(session, owner_kind).get() == updated
        session.rollback()

    with Session(channel_engine) as session:
        assert _reader(session, owner_kind).get() == current

    with Session(channel_engine, expire_on_commit=False) as session, session.begin():
        _writer(session, owner_kind).update(updated, expected_config_version=1)
    with Session(channel_engine) as session:
        record = session.get_one(HumanInputIMChannel, str(current.id))
        assert _reader(session, owner_kind).get() == updated
        assert record.owner_key == (f"workspace:{_WORKSPACE_ONE}" if owner_kind == "workspace" else "deployment")
        assert record.configured_by_account_id == (str(_ACCOUNT_ONE) if owner_kind == "workspace" else None)


def test_update_rejects_invalid_next_version_before_mutation_sql(channel_engine: Engine) -> None:
    current = _channel(1)
    _commit_channel(channel_engine, "workspace", current)
    statements: list[str] = []

    def capture(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(channel_engine, "before_cursor_execute", capture)
    try:
        with Session(channel_engine) as session:
            with pytest.raises(ValueError, match="increment by one"):
                _writer(session, "workspace").update(current, expected_config_version=1)
    finally:
        event.remove(channel_engine, "before_cursor_execute", capture)

    assert not any(statement.lstrip().upper().startswith("UPDATE") for statement in statements)
    with Session(channel_engine) as session:
        assert _reader(session, "workspace").get() == current


@pytest.mark.parametrize(
    ("candidate", "expected_version"),
    [
        (_channel(2, version=2), 1),
        (_channel(1, version=3), 2),
    ],
    ids=["wrong-id", "stale-version"],
)
def test_update_reports_wrong_id_and_stale_version_without_mutation(
    channel_engine: Engine,
    candidate: IMChannel,
    expected_version: int,
) -> None:
    current = _channel(1)
    _commit_channel(channel_engine, "workspace", current)

    with Session(channel_engine) as session:
        with pytest.raises(StaleIMChannelWriteError):
            _writer(session, "workspace").update(candidate, expected_config_version=expected_version)

    with Session(channel_engine) as session:
        assert _reader(session, "workspace").get() == current


@pytest.mark.parametrize("owner_kind", ["workspace", "deployment"])
def test_replace_prevents_aba_and_caller_rollback_restores_current_row(
    channel_engine: Engine,
    owner_kind: _OwnerKind,
) -> None:
    current = _channel(1)
    replacement = _channel(2)
    _commit_channel(channel_engine, owner_kind, current)

    with Session(channel_engine, expire_on_commit=False) as session:
        assert _writer(session, owner_kind).replace(current.id, 1, replacement) == replacement
        assert _reader(session, owner_kind).get() == replacement
        session.rollback()
    with Session(channel_engine) as session:
        assert _reader(session, owner_kind).get() == current

    with Session(channel_engine, expire_on_commit=False) as session, session.begin():
        _writer(session, owner_kind).replace(current.id, 1, replacement)
    with Session(channel_engine) as session:
        writer = _writer(session, owner_kind)
        record = session.get_one(HumanInputIMChannel, str(replacement.id))
        assert record.configured_by_account_id == (str(_ACCOUNT_ONE) if owner_kind == "workspace" else None)
        with pytest.raises(StaleIMChannelWriteError):
            writer.update(replace(current, config_version=2), expected_config_version=1)
        with pytest.raises(StaleIMChannelWriteError):
            writer.delete(current.id, expected_config_version=1)
        assert _reader(session, owner_kind).get() == replacement


@pytest.mark.parametrize(
    "replacement",
    [_channel(1), _channel(2, version=2)],
    ids=["same-id", "noninitial-version"],
)
def test_replace_rejects_invalid_replacement_before_mutation_sql(
    channel_engine: Engine,
    replacement: IMChannel,
) -> None:
    current = _channel(1)
    _commit_channel(channel_engine, "workspace", current)
    statements: list[str] = []

    def capture(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(channel_engine, "before_cursor_execute", capture)
    try:
        with Session(channel_engine) as session:
            with pytest.raises(ValueError):
                _writer(session, "workspace").replace(current.id, 1, replacement)
    finally:
        event.remove(channel_engine, "before_cursor_execute", capture)

    assert not any(statement.lstrip().upper().startswith(("DELETE", "INSERT")) for statement in statements)


@pytest.mark.parametrize("owner_kind", ["workspace", "deployment"])
def test_delete_is_cas_guarded_rollback_safe_and_releases_committed_owner_slot(
    channel_engine: Engine,
    owner_kind: _OwnerKind,
) -> None:
    current = _channel(1)
    replacement = _channel(2)
    _commit_channel(channel_engine, owner_kind, current)

    with Session(channel_engine) as session:
        with pytest.raises(StaleIMChannelWriteError):
            _writer(session, owner_kind).delete(current.id, expected_config_version=2)
        assert _reader(session, owner_kind).get() == current
        _writer(session, owner_kind).delete(current.id, expected_config_version=1)
        assert _reader(session, owner_kind).get() is None
        session.rollback()
    with Session(channel_engine) as session:
        assert _reader(session, owner_kind).get() == current

    with Session(channel_engine) as session, session.begin():
        _writer(session, owner_kind).delete(current.id, expected_config_version=1)
    with Session(channel_engine) as session, session.begin():
        _writer(session, owner_kind).create(replacement)
    with Session(channel_engine) as session:
        assert _reader(session, owner_kind).get() == replacement


def test_cross_owner_ids_are_stale_and_never_mutate_foreign_rows(channel_engine: Engine) -> None:
    workspace_one = _channel(1)
    workspace_two = _channel(2)
    deployment = _channel(3)
    with Session(channel_engine, expire_on_commit=False) as session, session.begin():
        _writer(session, "workspace", _WORKSPACE_ONE, _ACCOUNT_ONE).create(workspace_one)
        _writer(session, "workspace", _WORKSPACE_TWO, _ACCOUNT_TWO).create(workspace_two)
        _writer(session, "deployment").create(deployment)

    with Session(channel_engine) as session:
        writer = _writer(session, "workspace", _WORKSPACE_TWO, _ACCOUNT_TWO)
        with pytest.raises(StaleIMChannelWriteError):
            writer.update(replace(workspace_one, config_version=2), expected_config_version=1)
        with pytest.raises(StaleIMChannelWriteError):
            writer.replace(workspace_one.id, 1, _channel(4))
        with pytest.raises(StaleIMChannelWriteError):
            writer.delete(workspace_one.id, 1)

    with Session(channel_engine) as session:
        assert _reader(session, "workspace", _WORKSPACE_ONE).get() == workspace_one
        assert _reader(session, "workspace", _WORKSPACE_TWO).get() == workspace_two
        assert _reader(session, "deployment").get() == deployment


def test_create_classifies_only_owner_slot_collision_as_already_configured(channel_engine: Engine) -> None:
    current = _channel(1)
    _commit_channel(channel_engine, "workspace", current)

    with Session(channel_engine) as session:
        with pytest.raises(IMChannelAlreadyConfiguredError):
            _writer(session, "workspace").create(_channel(2))

    with Session(channel_engine) as session:
        with pytest.raises(IntegrityError) as captured:
            _writer(session, "workspace", _WORKSPACE_TWO, _ACCOUNT_TWO).create(_channel(3, webhook_index=1))
        assert not isinstance(captured.value, IMChannelAlreadyConfiguredError)


@pytest.mark.parametrize("config_version", [0, 2])
def test_create_rejects_noninitial_version_before_insert_sql(
    channel_engine: Engine,
    config_version: int,
) -> None:
    statements: list[str] = []

    def capture(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(channel_engine, "before_cursor_execute", capture)
    try:
        with Session(channel_engine) as session:
            with pytest.raises(ValueError, match="version must be 1"):
                _writer(session, "workspace").create(_channel(1, version=config_version))
    finally:
        event.remove(channel_engine, "before_cursor_execute", capture)

    assert not any(statement.lstrip().upper().startswith("INSERT") for statement in statements)


def test_replacement_insert_failure_propagates_and_caller_rollback_restores_old_row(
    channel_engine: Engine,
) -> None:
    current = _channel(1)
    foreign = _channel(2)
    with Session(channel_engine, expire_on_commit=False) as session, session.begin():
        _writer(session, "workspace", _WORKSPACE_ONE, _ACCOUNT_ONE).create(current)
        _writer(session, "workspace", _WORKSPACE_TWO, _ACCOUNT_TWO).create(foreign)

    with Session(channel_engine) as session:
        with pytest.raises(IntegrityError):
            _writer(session, "workspace", _WORKSPACE_ONE, _ACCOUNT_ONE).replace(
                current.id,
                1,
                _channel(3, webhook_index=2),
            )
        session.rollback()

    with Session(channel_engine) as session:
        assert _reader(session, "workspace", _WORKSPACE_ONE).get() == current
        assert _reader(session, "workspace", _WORKSPACE_TWO).get() == foreign


@pytest.mark.parametrize("operation", ["get", "create", "update", "replace", "delete"])
def test_operations_do_not_flush_unrelated_pending_session_state(
    channel_engine: Engine,
    operation: str,
) -> None:
    current = _channel(1)
    if operation != "create":
        _commit_channel(channel_engine, "workspace", current)

    with Session(channel_engine, expire_on_commit=False) as session:
        pending = _pending_email_configuration()
        session.add(pending)
        if operation == "get":
            assert _reader(session, "workspace").get() == current
        elif operation == "create":
            _writer(session, "workspace").create(current)
        elif operation == "update":
            _writer(session, "workspace").update(replace(current, config_version=2), 1)
        elif operation == "replace":
            _writer(session, "workspace").replace(current.id, 1, _channel(2))
        else:
            _writer(session, "workspace").delete(current.id, 1)

        state = sa.inspect(pending)
        assert state.pending
        assert not state.persistent
        session.rollback()

    with Session(channel_engine) as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputEmailProvider.id))) == 0


def test_repository_sql_accesses_only_the_im_channel_table(channel_engine: Engine) -> None:
    current = _channel(1)
    updated = replace(current, config_version=2, updated_at=_LATER)
    replacement = _channel(2)
    _commit_channel(channel_engine, "workspace", current)
    statements: list[str] = []

    def capture(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(channel_engine, "before_cursor_execute", capture)
    try:
        with Session(channel_engine, expire_on_commit=False) as session:
            reader = _reader(session, "workspace")
            writer = _writer(session, "workspace")
            assert reader.get() == current
            writer.update(updated, 1)
            writer.replace(current.id, 2, replacement)
            writer.delete(replacement.id, 1)
            session.rollback()
    finally:
        event.remove(channel_engine, "before_cursor_execute", capture)

    assert statements
    assert all("human_input_im_channels" in statement.lower() for statement in statements)

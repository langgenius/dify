"""Defensive tests for UploadFileTenantValidator (Stage 4 §5.3).

The validator must never raise on pathological inputs: the Agent backend may
hand us garbage in the ``file_id`` slot because the protocol layer only
asserts ``{"type": "string"}``. Anything that isn't a real UUID belonging to
the current tenant should simply return False.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.agent_v2.file_tenant_validator import UploadFileTenantValidator
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod
from models import CreatorUserRole, ToolFile, UploadFile

TABLES = (ToolFile, UploadFile)
TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture(autouse=True)
def _bind_sqlite_session_factory(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> None:
    """Bind the validator's service-owned sessions to the isolated SQLite engine."""
    sqlite_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr("core.db.session_factory._session_maker", sqlite_session_maker)


@pytest.fixture
def executed_statements(sqlite_engine: Engine) -> Iterator[list[str]]:
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        yield statements
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)


def test_empty_inputs_return_false_without_db_hit(executed_statements: list[str]):
    validator = UploadFileTenantValidator()
    assert (
        validator.is_accessible_file_mapping(
            file_id="",
            tenant_id="tenant-1",
            transfer_method=FileTransferMethod.LOCAL_FILE,
        )
        is False
    )
    assert (
        validator.is_accessible_file_mapping(
            file_id="abc",
            tenant_id="",
            transfer_method=FileTransferMethod.LOCAL_FILE,
        )
        is False
    )
    assert executed_statements == []


@pytest.mark.parametrize(
    "bad_file_id",
    [
        "not-a-uuid",
        "this-id-does-not-exist",
        "0123",
        "🤖🤖🤖",
        "../../etc/passwd",
        "550e8400-e29b-41d4-a716-446655440000-trailing",
    ],
)
def test_non_uuid_file_ids_return_false_without_db_hit(bad_file_id: str, executed_statements: list[str]):
    validator = UploadFileTenantValidator()
    assert (
        validator.is_accessible_file_mapping(
            file_id=bad_file_id,
            tenant_id="tenant-1",
            transfer_method=FileTransferMethod.LOCAL_FILE,
        )
        is False
    )
    assert executed_statements == []


def test_db_error_swallowed_and_returns_false(sqlite_engine: Engine):
    """Any DB-level fault (timeout, dialect quirk, connection drop) must reject
    the file rather than crash the workflow node."""
    validator = UploadFileTenantValidator()
    valid_uuid = "550e8400-e29b-41d4-a716-446655440000"
    rollbacks: list[bool] = []

    def fail_query(*_args) -> None:
        raise SQLAlchemyError("boom")

    def record_rollback(_connection) -> None:
        rollbacks.append(True)

    event.listen(sqlite_engine, "before_cursor_execute", fail_query)
    event.listen(sqlite_engine, "rollback", record_rollback)
    try:
        assert (
            validator.is_accessible_file_mapping(
                file_id=valid_uuid,
                tenant_id="tenant-1",
                transfer_method=FileTransferMethod.LOCAL_FILE,
            )
            is False
        )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", fail_query)
        event.remove(sqlite_engine, "rollback", record_rollback)

    assert rollbacks == [True]


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_accessible_file_mapping_checks_transfer_method_family(sqlite_session: Session):
    validator = UploadFileTenantValidator()
    upload_file = UploadFile(
        tenant_id=TENANT_ID,
        storage_type=StorageType.LOCAL,
        key="uploads/report.pdf",
        name="report.pdf",
        size=42,
        extension="pdf",
        mime_type="application/pdf",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=USER_ID,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        used=False,
    )
    tool_file = ToolFile(
        user_id=USER_ID,
        tenant_id=TENANT_ID,
        conversation_id=None,
        file_key="tools/chart.png",
        mimetype="image/png",
        name="chart.png",
        size=99,
    )
    sqlite_session.add_all([upload_file, tool_file])
    sqlite_session.commit()

    assert validator.is_accessible_file_mapping(
        file_id=upload_file.id,
        tenant_id=TENANT_ID,
        transfer_method=FileTransferMethod.LOCAL_FILE,
    )
    assert validator.is_accessible_file_mapping(
        file_id=upload_file.id,
        tenant_id=TENANT_ID,
        transfer_method=FileTransferMethod.DATASOURCE_FILE,
    )
    assert validator.is_accessible_file_mapping(
        file_id=tool_file.id,
        tenant_id=TENANT_ID,
        transfer_method=FileTransferMethod.TOOL_FILE,
    )
    assert not validator.is_accessible_file_mapping(
        file_id=upload_file.id,
        tenant_id=OTHER_TENANT_ID,
        transfer_method=FileTransferMethod.LOCAL_FILE,
    )
    assert not validator.is_accessible_file_mapping(
        file_id=tool_file.id,
        tenant_id=OTHER_TENANT_ID,
        transfer_method=FileTransferMethod.TOOL_FILE,
    )
    assert not validator.is_accessible_file_mapping(
        file_id=upload_file.id,
        tenant_id=TENANT_ID,
        transfer_method=FileTransferMethod.TOOL_FILE,
    )
    assert not validator.is_accessible_file_mapping(
        file_id=tool_file.id,
        tenant_id=TENANT_ID,
        transfer_method=FileTransferMethod.LOCAL_FILE,
    )

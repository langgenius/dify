"""Unit tests for the agent drive service (ENG-591).

Pure helpers (key safety / drive-ref parsing) plus the commit/manifest lifecycle
exercised against the project's in-memory SQLite engine with seeded ToolFiles.
"""

from __future__ import annotations

import datetime
from collections.abc import Generator
from unittest.mock import patch

import pytest
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from extensions.storage.storage_type import StorageType
from models.agent import AgentDriveFile
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile
from services.agent_drive_service import (
    AgentDriveError,
    AgentDriveService,
    DriveCommitItem,
    normalize_drive_key,
    parse_agent_drive_ref,
)

TENANT = "11111111-1111-1111-1111-111111111111"
AGENT = "22222222-2222-2222-2222-222222222222"
USER = "33333333-3333-3333-3333-333333333333"


# ── pure helpers ──────────────────────────────────────────────────────────────


def test_parse_agent_drive_ref():
    assert parse_agent_drive_ref("agent-abc") == "abc"
    for bad in ["abc", "agent-", ""]:
        with pytest.raises(AgentDriveError):
            parse_agent_drive_ref(bad)


def test_normalize_drive_key_ok_and_collapses_slashes():
    assert normalize_drive_key("a/b/c.txt") == "a/b/c.txt"
    assert normalize_drive_key("/a//b.txt") == "a/b.txt"
    assert normalize_drive_key("skill-name/SKILL.md") == "skill-name/SKILL.md"


@pytest.mark.parametrize("bad", ["", "   ", "a/../b", "../etc", "a/\x00b", "a" * 1100])
def test_normalize_drive_key_rejects_unsafe(bad: str):
    with pytest.raises(AgentDriveError):
        normalize_drive_key(bad)


# ── service lifecycle (in-memory ORM) ─────────────────────────────────────────


@pytest.fixture(autouse=True)
def _tables() -> Generator[None, None, None]:
    engine = session_factory.get_session_maker().kw["bind"]
    for model in (ToolFile, UploadFile, AgentDriveFile):
        model.__table__.create(bind=engine, checkfirst=True)
    yield
    with session_factory.create_session() as session:
        session.execute(delete(AgentDriveFile))
        session.execute(delete(ToolFile))
        session.commit()
    AgentDriveFile.__table__.drop(bind=engine, checkfirst=True)


def _seed_tool_file(*, user_id: str = USER, name: str = "f.txt") -> str:
    tool_file = ToolFile(
        user_id=user_id,
        tenant_id=TENANT,
        conversation_id=None,
        file_key=f"tools/{TENANT}/{name}",
        mimetype="text/plain",
        name=name,
        size=5,
    )
    with session_factory.create_session() as session:
        session.add(tool_file)
        session.commit()
        return tool_file.id


def _commit(key: str, tool_file_id: str, *, owned: bool = True):
    return AgentDriveService().commit(
        tenant_id=TENANT,
        user_id=USER,
        agent_id=AGENT,
        items=[
            DriveCommitItem(
                key=key,
                file_ref={"kind": "tool_file", "id": tool_file_id},
                value_owned_by_drive=owned,
            )
        ],
    )


def test_commit_then_manifest_lists_the_entry():
    tf = _seed_tool_file()
    _commit("data/report.txt", tf)

    items = AgentDriveService().manifest(tenant_id=TENANT, agent_id=AGENT)
    assert [i["key"] for i in items] == ["data/report.txt"]
    assert items[0]["file_kind"] == "tool_file"
    assert items[0]["file_id"] == tf
    assert items[0]["mime_type"] == "text/plain"

    # prefix filter
    assert AgentDriveService().manifest(tenant_id=TENANT, agent_id=AGENT, prefix="data/") != []
    assert AgentDriveService().manifest(tenant_id=TENANT, agent_id=AGENT, prefix="other/") == []


def test_commit_rejects_tool_file_not_owned_by_user():
    other = _seed_tool_file(user_id="99999999-9999-9999-9999-999999999999")
    with pytest.raises(AgentDriveError) as exc_info:
        _commit("x.txt", other)
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "source_not_found"


def test_overwrite_cleans_old_drive_owned_value():
    tf1 = _seed_tool_file(name="v1.txt")
    tf2 = _seed_tool_file(name="v2.txt")
    _commit("doc.txt", tf1, owned=True)

    with patch("services.agent_drive_service.storage") as storage_mock:
        _commit("doc.txt", tf2, owned=True)
        storage_mock.delete.assert_called_once()

    # old ToolFile physically removed; key now points at tf2
    with session_factory.create_session() as session:
        assert session.scalar(select(ToolFile).where(ToolFile.id == tf1)) is None
        assert session.scalar(select(ToolFile).where(ToolFile.id == tf2)) is not None
        rows = list(session.scalars(select(AgentDriveFile).where(AgentDriveFile.key == "doc.txt")))
    assert len(rows) == 1
    assert rows[0].file_id == tf2


def test_validate_source_db_error_maps_to_404():
    """A malformed id (non-UUID hitting a UUID column -> DataError) must not 500."""
    from unittest.mock import MagicMock

    from sqlalchemy.exc import DataError

    from models.agent import AgentDriveFileKind

    session = MagicMock()
    session.scalar.side_effect = DataError("bad uuid", {}, Exception("invalid input syntax for uuid"))

    with pytest.raises(AgentDriveError) as exc_info:
        AgentDriveService()._validate_source(
            session,
            tenant_id=TENANT,
            user_id="not-a-uuid",
            file_kind=AgentDriveFileKind.TOOL_FILE,
            file_id="also-bad",
        )
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "source_not_found"
    session.rollback.assert_called_once()


def test_recommit_same_value_is_idempotent_and_keeps_value():
    tf = _seed_tool_file()
    _commit("a.txt", tf)
    _commit("a.txt", tf)  # no error, no cleanup

    with session_factory.create_session() as session:
        assert session.scalar(select(ToolFile).where(ToolFile.id == tf)) is not None
        rows = list(session.scalars(select(AgentDriveFile).where(AgentDriveFile.key == "a.txt")))
    assert len(rows) == 1


def _seed_upload_file(*, name: str = "u.txt") -> str:
    upload = UploadFile(
        tenant_id=TENANT,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{TENANT}/{name}",
        name=name,
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=USER,
        created_at=datetime.datetime.now(tz=datetime.UTC),
        used=False,
    )
    with session_factory.create_session() as session:
        session.add(upload)
        session.commit()
        return upload.id


def _commit_upload(key: str, upload_file_id: str, *, owned: bool = True):
    return AgentDriveService().commit(
        tenant_id=TENANT,
        user_id=USER,
        agent_id=AGENT,
        items=[
            DriveCommitItem(
                key=key,
                file_ref={"kind": "upload_file", "id": upload_file_id},
                value_owned_by_drive=owned,
            )
        ],
    )


def test_commit_upload_file_source_and_manifest():
    uf = _seed_upload_file()
    _commit_upload("docs/u.txt", uf)

    items = AgentDriveService().manifest(tenant_id=TENANT, agent_id=AGENT)
    assert items[0]["file_kind"] == "upload_file"
    assert items[0]["file_id"] == uf
    assert items[0]["mime_type"] == "text/plain"


def test_commit_rejects_missing_upload_file():
    with pytest.raises(AgentDriveError) as exc_info:
        _commit_upload("x.txt", "44444444-4444-4444-4444-444444444444")
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "source_not_found"


def test_overwrite_cleans_old_upload_file_value():
    u1 = _seed_upload_file(name="v1.txt")
    u2 = _seed_upload_file(name="v2.txt")
    _commit_upload("doc.txt", u1, owned=True)

    with patch("services.agent_drive_service.storage") as storage_mock:
        _commit_upload("doc.txt", u2, owned=True)
        storage_mock.delete.assert_called_once()

    with session_factory.create_session() as session:
        assert session.scalar(select(UploadFile).where(UploadFile.id == u1)) is None
        assert session.scalar(select(UploadFile).where(UploadFile.id == u2)) is not None


def test_manifest_includes_internal_download_url():
    tf = _seed_tool_file()
    _commit("data/r.txt", tf)

    with (
        patch("services.agent_drive_service.file_factory.build_from_mapping", return_value=object()),
        patch("services.agent_drive_service.DifyWorkflowFileRuntime") as runtime_cls,
    ):
        runtime_cls.return_value.resolve_file_url.return_value = "http://internal/files/x?sign=1"
        items = AgentDriveService().manifest(tenant_id=TENANT, agent_id=AGENT, include_download_url=True)

    assert items[0]["download_url"] == "http://internal/files/x?sign=1"
    # drive-owned resolution: internal URL (for_external=False)
    assert runtime_cls.return_value.resolve_file_url.call_args.kwargs["for_external"] is False


def test_manifest_download_url_none_when_unresolvable():
    tf = _seed_tool_file()
    _commit("data/r.txt", tf)

    with patch(
        "services.agent_drive_service.file_factory.build_from_mapping",
        side_effect=ValueError("not found"),
    ):
        items = AgentDriveService().manifest(tenant_id=TENANT, agent_id=AGENT, include_download_url=True)
    assert items[0]["download_url"] is None

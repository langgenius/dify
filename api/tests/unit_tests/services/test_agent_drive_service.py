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
from models.agent import Agent, AgentDriveFile, AgentScope, AgentSource
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile
from services.agent_drive_service import (
    AgentDriveError,
    AgentDriveService,
    DriveCommitItem,
    DriveSkillMetadata,
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
    for model in (Agent, ToolFile, UploadFile, AgentDriveFile):
        model.__table__.create(bind=engine, checkfirst=True)
    _seed_agent()
    yield
    with session_factory.create_session() as session:
        session.execute(delete(AgentDriveFile))
        session.execute(delete(UploadFile))
        session.execute(delete(ToolFile))
        session.execute(delete(Agent))
        session.commit()
    AgentDriveFile.__table__.drop(bind=engine, checkfirst=True)


def _seed_agent(*, tenant_id: str = TENANT, agent_id: str = AGENT) -> None:
    agent = Agent(
        id=agent_id,
        tenant_id=tenant_id,
        name="Drive Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
    )
    with session_factory.create_session() as session:
        session.add(agent)
        session.commit()


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


def test_commit_rejects_agent_from_another_tenant():
    tf = _seed_tool_file()
    with pytest.raises(AgentDriveError) as exc_info:
        AgentDriveService().commit(
            tenant_id="99999999-9999-9999-9999-999999999999",
            user_id=USER,
            agent_id=AGENT,
            items=[
                DriveCommitItem(
                    key="x.txt",
                    file_ref={"kind": "tool_file", "id": tf},
                    value_owned_by_drive=True,
                )
            ],
        )
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "agent_not_found"


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


def test_batch_failure_does_not_delete_old_storage_before_commit():
    tf1 = _seed_tool_file(name="v1.txt")
    tf2 = _seed_tool_file(name="v2.txt")
    _commit("doc.txt", tf1, owned=True)

    with patch("services.agent_drive_service.storage") as storage_mock:
        with pytest.raises(AgentDriveError):
            AgentDriveService().commit(
                tenant_id=TENANT,
                user_id=USER,
                agent_id=AGENT,
                items=[
                    DriveCommitItem(
                        key="doc.txt",
                        file_ref={"kind": "tool_file", "id": tf2},
                        value_owned_by_drive=True,
                    ),
                    DriveCommitItem(
                        key="bad.txt",
                        file_ref={"kind": "tool_file", "id": "44444444-4444-4444-4444-444444444444"},
                        value_owned_by_drive=True,
                    ),
                ],
            )
        storage_mock.delete.assert_not_called()

    with session_factory.create_session() as session:
        row = session.scalar(select(AgentDriveFile).where(AgentDriveFile.key == "doc.txt"))
        assert row is not None
        assert row.file_id == tf1
        assert session.scalar(select(ToolFile).where(ToolFile.id == tf1)) is not None
        assert session.scalar(select(ToolFile).where(ToolFile.id == tf2)) is not None


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


# ── ENG-625 D5: delete ────────────────────────────────────────────────────────


def test_delete_by_key_cleans_drive_owned_value():
    tf = _seed_tool_file(name="doomed.txt")
    _commit("files/doomed.txt", tf, owned=True)

    with patch("services.agent_drive_service.storage") as storage_mock:
        removed = AgentDriveService().delete(tenant_id=TENANT, agent_id=AGENT, key="files/doomed.txt")
        storage_mock.delete.assert_called_once()

    assert removed == ["files/doomed.txt"]
    with session_factory.create_session() as session:
        assert session.scalar(select(ToolFile).where(ToolFile.id == tf)) is None
        assert list(session.scalars(select(AgentDriveFile))) == []


def test_delete_by_prefix_removes_all_skill_keys():
    md = _seed_tool_file(name="SKILL.md")
    zf = _seed_tool_file(name="full.zip")
    _commit("tender-analyzer/SKILL.md", md, owned=True)
    _commit("tender-analyzer/.DIFY-SKILL-FULL.zip", zf, owned=True)
    other = _seed_tool_file(name="other.txt")
    _commit("files/other.txt", other, owned=True)

    with patch("services.agent_drive_service.storage"):
        removed = AgentDriveService().delete(tenant_id=TENANT, agent_id=AGENT, prefix="tender-analyzer/")

    assert sorted(removed) == ["tender-analyzer/.DIFY-SKILL-FULL.zip", "tender-analyzer/SKILL.md"]
    with session_factory.create_session() as session:
        # both skill ToolFiles physically removed, the unrelated file untouched
        assert session.scalar(select(ToolFile).where(ToolFile.id == md)) is None
        assert session.scalar(select(ToolFile).where(ToolFile.id == zf)) is None
        assert session.scalar(select(ToolFile).where(ToolFile.id == other)) is not None
        keys = [row.key for row in session.scalars(select(AgentDriveFile))]
    assert keys == ["files/other.txt"]


def test_delete_is_idempotent():
    assert AgentDriveService().delete(tenant_id=TENANT, agent_id=AGENT, key="files/never-there.txt") == []
    assert AgentDriveService().delete(tenant_id=TENANT, agent_id=AGENT, prefix="ghost-skill/") == []


def test_delete_requires_exactly_one_scope():
    with pytest.raises(AgentDriveError) as exc_info:
        AgentDriveService().delete(tenant_id=TENANT, agent_id=AGENT)
    assert exc_info.value.code == "invalid_delete_scope"
    with pytest.raises(AgentDriveError):
        AgentDriveService().delete(tenant_id=TENANT, agent_id=AGENT, prefix="a/", key="a/b")


def test_delete_keeps_shared_value_records():
    tf = _seed_tool_file(name="shared.txt")
    _commit("files/shared.txt", tf, owned=False)

    with patch("services.agent_drive_service.storage") as storage_mock:
        removed = AgentDriveService().delete(tenant_id=TENANT, agent_id=AGENT, key="files/shared.txt")
        storage_mock.delete.assert_not_called()

    assert removed == ["files/shared.txt"]
    with session_factory.create_session() as session:
        # only the KV row dropped; the shared ToolFile survives
        assert session.scalar(select(ToolFile).where(ToolFile.id == tf)) is not None


def test_restandardize_same_slug_overwrites_both_keys_and_cleans_old_toolfiles():
    """ENG-625 §5.3 replacement semantics: re-standardizing a same-name skill
    overwrites <slug>/SKILL.md and <slug>/.DIFY-SKILL-FULL.zip, physically
    cleaning both old drive-owned ToolFiles."""
    old_md = _seed_tool_file(name="SKILL.md")
    old_zip = _seed_tool_file(name="full-v1.zip")
    _commit("pdf-toolkit/SKILL.md", old_md, owned=True)
    _commit("pdf-toolkit/.DIFY-SKILL-FULL.zip", old_zip, owned=True)

    new_md = _seed_tool_file(name="SKILL-v2.md")
    new_zip = _seed_tool_file(name="full-v2.zip")
    with patch("services.agent_drive_service.storage") as storage_mock:
        _commit("pdf-toolkit/SKILL.md", new_md, owned=True)
        _commit("pdf-toolkit/.DIFY-SKILL-FULL.zip", new_zip, owned=True)
        assert storage_mock.delete.call_count == 2

    with session_factory.create_session() as session:
        assert session.scalar(select(ToolFile).where(ToolFile.id == old_md)) is None
        assert session.scalar(select(ToolFile).where(ToolFile.id == old_zip)) is None
        rows = {row.key: row.file_id for row in session.scalars(select(AgentDriveFile))}
    assert rows == {
        "pdf-toolkit/SKILL.md": new_md,
        "pdf-toolkit/.DIFY-SKILL-FULL.zip": new_zip,
    }


# ── ENG-624: console drive inspector (service layer) ─────────────────────────


def test_preview_returns_text_with_truncation_flags():
    tf = _seed_tool_file(name="SKILL.md")
    _commit("pdf-toolkit/SKILL.md", tf)

    with patch("services.agent_drive_service.storage") as storage_mock:
        storage_mock.load_stream.return_value = iter([b"# PDF Toolkit\nUse responsibly.\n"])
        result = AgentDriveService().preview(tenant_id=TENANT, agent_id=AGENT, key="pdf-toolkit/SKILL.md")

    assert result == {
        "key": "pdf-toolkit/SKILL.md",
        "size": 5,
        "truncated": False,
        "binary": False,
        "text": "# PDF Toolkit\nUse responsibly.\n",
    }


def test_preview_marks_binary_and_oversized_content():
    tf = _seed_tool_file(name="blob.bin")
    _commit("files/blob.bin", tf)

    with patch("services.agent_drive_service.storage") as storage_mock:
        storage_mock.load_stream.return_value = iter([b"\x00\x01\x02"])
        binary = AgentDriveService().preview(tenant_id=TENANT, agent_id=AGENT, key="files/blob.bin")
    assert binary["binary"] is True
    assert binary["text"] is None

    with patch("services.agent_drive_service.storage") as storage_mock:
        storage_mock.load_stream.return_value = iter([b"x" * (AgentDriveService.PREVIEW_MAX_BYTES + 10)])
        oversized = AgentDriveService().preview(tenant_id=TENANT, agent_id=AGENT, key="files/blob.bin")
    assert oversized["truncated"] is True
    assert oversized["binary"] is False
    assert len(oversized["text"]) == AgentDriveService.PREVIEW_MAX_BYTES


def test_preview_unknown_key_is_404():
    with pytest.raises(AgentDriveError) as exc_info:
        AgentDriveService().preview(tenant_id=TENANT, agent_id=AGENT, key="ghost/SKILL.md")
    assert exc_info.value.code == "drive_key_not_found"
    assert exc_info.value.status_code == 404


def test_preview_rejects_cross_tenant_agent():
    with pytest.raises(AgentDriveError) as exc_info:
        AgentDriveService().preview(
            tenant_id="99999999-9999-9999-9999-999999999999", agent_id=AGENT, key="pdf-toolkit/SKILL.md"
        )
    assert exc_info.value.code == "agent_not_found"


def test_download_url_signs_external_audience():
    tf = _seed_tool_file(name="full.zip")
    _commit("pdf-toolkit/.DIFY-SKILL-FULL.zip", tf)

    with patch.object(AgentDriveService, "_resolve_download_url", return_value="https://signed.example/x") as resolver:
        url = AgentDriveService().download_url(tenant_id=TENANT, agent_id=AGENT, key="pdf-toolkit/.DIFY-SKILL-FULL.zip")

    assert url == "https://signed.example/x"
    # console downloads are for browsers: external signing, never the internal URL
    assert resolver.call_args.kwargs["for_external"] is True
    assert resolver.call_args.kwargs["as_attachment"] is True


def test_upload_file_download_url_uses_attachment_filename():
    upload_file_id = _seed_upload_file(name="report.pdf")
    _commit_upload("files/report.pdf", upload_file_id)

    with patch("services.agent_drive_service.DifyWorkflowFileRuntime") as runtime_cls:
        runtime_cls.return_value.resolve_upload_file_url.return_value = "https://files.example/report.pdf"
        url = AgentDriveService().download_url(tenant_id=TENANT, agent_id=AGENT, key="files/report.pdf")

    assert url == "https://files.example/report.pdf"
    assert runtime_cls.return_value.resolve_upload_file_url.call_args.kwargs["for_external"] is True
    assert runtime_cls.return_value.resolve_upload_file_url.call_args.kwargs["as_attachment"] is True


def test_manifest_items_carry_created_at_for_inspector():
    tf = _seed_tool_file()
    _commit("files/x.txt", tf)
    items = AgentDriveService().manifest(tenant_id=TENANT, agent_id=AGENT)
    assert items[0]["created_at"] is None or isinstance(items[0]["created_at"], int)


# ── DIFY-2517: skill catalog / inspect ───────────────────────────────────────


def _commit_skill(*, manifest_files: list[str] | None = None) -> None:
    md = _seed_tool_file(name="SKILL.md")
    zf = _seed_tool_file(name="full.zip")
    AgentDriveService().commit(
        tenant_id=TENANT,
        user_id=USER,
        agent_id=AGENT,
        items=[
            DriveCommitItem(
                key="pdf-toolkit/SKILL.md",
                file_ref={"kind": "tool_file", "id": md},
                value_owned_by_drive=True,
                is_skill=True,
                skill_metadata=DriveSkillMetadata(
                    name="PDF Toolkit",
                    description="Work with PDFs.",
                    manifest_files=manifest_files,
                ),
            ),
            DriveCommitItem(
                key="pdf-toolkit/.DIFY-SKILL-FULL.zip",
                file_ref={"kind": "tool_file", "id": zf},
                value_owned_by_drive=True,
            ),
        ],
    )


def test_list_skills_uses_canonical_skill_rows():
    _commit_skill(manifest_files=["SKILL.md", "scripts/run.py"])

    skills = AgentDriveService().list_skills(tenant_id=TENANT, agent_id=AGENT)

    created_at = skills[0].pop("created_at")
    assert skills == [
        {
            "path": "pdf-toolkit",
            "skill_md_key": "pdf-toolkit/SKILL.md",
            "archive_key": "pdf-toolkit/.DIFY-SKILL-FULL.zip",
            "name": "PDF Toolkit",
            "description": "Work with PDFs.",
            "size": 5,
            "mime_type": "text/plain",
            "hash": None,
        }
    ]
    assert created_at is None or isinstance(created_at, int)


def test_inspect_skill_returns_manifest_files_and_file_tree():
    _commit_skill(manifest_files=["SKILL.md", "references/guide.md", "scripts/run.py"])

    with patch("services.agent_drive_service.storage") as storage_mock:
        storage_mock.load_stream.return_value = iter([b"# PDF Toolkit\n"])
        result = AgentDriveService().inspect_skill(tenant_id=TENANT, agent_id=AGENT, skill_path="pdf-toolkit")

    assert result["source"] == "skill_md"
    assert result["warnings"] == []
    assert [file["path"] for file in result["files"]] == ["SKILL.md", "references/guide.md", "scripts/run.py"]
    assert result["files"][0]["available_in_drive"] is True
    assert result["files"][1]["available_in_drive"] is False
    assert result["file_tree"][0]["name"] == "references"
    assert result["file_tree"][1]["name"] == "scripts"
    assert result["file_tree"][2]["name"] == "SKILL.md"
    assert result["skill_md"]["text"] == "# PDF Toolkit\n"


def test_inspect_skill_falls_back_to_drive_keys_when_manifest_missing():
    _commit_skill(manifest_files=None)

    with patch("services.agent_drive_service.storage") as storage_mock:
        storage_mock.load_stream.return_value = iter([b"# PDF Toolkit\n"])
        result = AgentDriveService().inspect_skill(tenant_id=TENANT, agent_id=AGENT, skill_path="pdf-toolkit")

    assert result["warnings"] == ["manifest_files_unavailable"]
    assert [file["path"] for file in result["files"]] == ["SKILL.md"]


def test_skill_metadata_rejects_non_canonical_rows():
    tf = _seed_tool_file(name="not-skill.md")
    with pytest.raises(AgentDriveError) as exc_info:
        AgentDriveService().commit(
            tenant_id=TENANT,
            user_id=USER,
            agent_id=AGENT,
            items=[
                DriveCommitItem(
                    key="files/not-skill.md",
                    file_ref={"kind": "tool_file", "id": tf},
                    value_owned_by_drive=True,
                    is_skill=True,
                    skill_metadata=DriveSkillMetadata(name="Bad"),
                )
            ],
        )
    assert exc_info.value.code == "invalid_skill_key"

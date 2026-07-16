"""Focused tests for the Agent Soul-backed config service."""

from __future__ import annotations

import io
import zipfile
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
)
from models.agent_config_entities import (
    AgentConfigFileRefConfig,
    AgentConfigSkillRefConfig,
    AgentEnvVariableConfig,
    AgentFileRefConfig,
    AgentSoulConfig,
)
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile
from services.agent.skill_package_service import SkillPackageError
from services.agent_config_service import (
    AgentConfigService,
    AgentConfigServiceError,
    AgentConfigTarget,
    AgentConfigVersionKind,
    ConfigPushPayload,
    ConfigPushSkillItem,
)

MODULE = "services.agent_config_service"
TENANT = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT = "22222222-2222-2222-2222-222222222222"
AGENT = "33333333-3333-3333-3333-333333333333"
USER = "44444444-4444-4444-4444-444444444444"
END_USER = "55555555-5555-5555-5555-555555555555"
SNAPSHOT = "66666666-6666-6666-6666-666666666666"
DRAFT = "77777777-7777-7777-7777-777777777777"
BUILD_DRAFT = "88888888-8888-8888-8888-888888888888"
TOOL_FILE = "99999999-9999-9999-9999-999999999999"
SKILL_FILE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
UPLOAD_FILE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
NORMALIZED_SKILL_FILE = "cccccccc-cccc-cccc-cccc-cccccccccccc"

AGENT_CONFIG_TABLES = (Agent, AgentConfigDraft, AgentConfigSnapshot)


def _soul(**updates) -> AgentSoulConfig:
    payload = AgentSoulConfig().model_dump(mode="json")
    payload.update(updates)
    return AgentSoulConfig.model_validate(payload)


def _agent(*, tenant_id: str = TENANT) -> Agent:
    return Agent(
        id=AGENT,
        tenant_id=tenant_id,
        name="Config Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )


def _draft(
    *,
    version_id: str = DRAFT,
    draft_type: AgentConfigDraftType = AgentConfigDraftType.DRAFT,
    account_id: str | None = None,
    soul: AgentSoulConfig | None = None,
) -> AgentConfigDraft:
    return AgentConfigDraft(
        id=version_id,
        tenant_id=TENANT,
        agent_id=AGENT,
        draft_type=draft_type,
        account_id=account_id,
        draft_owner_key=account_id or "",
        config_snapshot=soul or _soul(),
    )


def _snapshot(*, soul: AgentSoulConfig | None = None) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id=SNAPSHOT,
        tenant_id=TENANT,
        agent_id=AGENT,
        version=1,
        config_snapshot=soul or _soul(),
    )


def _service(sqlite_session: Session) -> AgentConfigService:
    """Bind service-owned sessions to the current test's isolated SQLite engine."""

    return AgentConfigService(
        session_factory=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
    )


def _persist_target(
    sqlite_session: Session,
    version: AgentConfigDraft | AgentConfigSnapshot,
    *,
    tenant_id: str = TENANT,
) -> None:
    sqlite_session.add_all([_agent(tenant_id=tenant_id), version])
    sqlite_session.commit()


def _version(*, version_id: str = "version-1", snapshot: AgentSoulConfig | None = None) -> SimpleNamespace:
    agent_soul = snapshot or _soul()
    return SimpleNamespace(
        id=version_id,
        config_snapshot_dict=agent_soul.model_dump(mode="json"),
        config_snapshot=agent_soul,
    )


def _target(
    *,
    kind: AgentConfigVersionKind,
    writable: bool,
    version_id: str = "version-1",
    soul: AgentSoulConfig | None = None,
) -> AgentConfigTarget:
    agent_soul = soul or _soul()
    return AgentConfigTarget(
        agent_id=AGENT,
        version_id=version_id,
        kind=kind,
        writable=writable,
        version=_version(version_id=version_id, snapshot=agent_soul),
        agent_soul=agent_soul,
    )


def _zip_bytes(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in members.items():
            zip_info = zipfile.ZipInfo(filename=name)
            zip_info.date_time = (1980, 1, 1, 0, 0, 0)
            archive.writestr(zip_info, payload)
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("kind", "user_id", "version_id", "expected_writable"),
    [
        (AgentConfigVersionKind.SNAPSHOT, None, SNAPSHOT, False),
        (AgentConfigVersionKind.DRAFT, USER, DRAFT, False),
        (AgentConfigVersionKind.BUILD_DRAFT, USER, BUILD_DRAFT, True),
    ],
)
@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_resolve_target_supports_snapshot_draft_and_build_draft(
    kind: AgentConfigVersionKind,
    user_id: str | None,
    version_id: str,
    expected_writable: bool,
    sqlite_session: Session,
) -> None:
    if kind == AgentConfigVersionKind.SNAPSHOT:
        version = _snapshot()
    else:
        version = _draft(
            version_id=version_id,
            draft_type=(
                AgentConfigDraftType.DEBUG_BUILD
                if kind == AgentConfigVersionKind.BUILD_DRAFT
                else AgentConfigDraftType.DRAFT
            ),
            account_id=USER if kind == AgentConfigVersionKind.BUILD_DRAFT else None,
        )
    _persist_target(sqlite_session, version)

    target = _service(sqlite_session).resolve_target(
        tenant_id=TENANT,
        agent_id=AGENT,
        config_version_id=version_id,
        config_version_kind=kind,
        user_id=user_id,
    )

    assert target.agent_id == AGENT
    assert target.version_id == version_id
    assert target.kind == kind
    assert target.writable is expected_writable
    assert target.agent_soul == _soul()


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_resolve_target_requires_user_for_build_draft(sqlite_session: Session) -> None:
    _persist_target(
        sqlite_session,
        _draft(
            version_id=BUILD_DRAFT,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id=USER,
        ),
    )

    with pytest.raises(AgentConfigServiceError, match="user_id is required") as exc_info:
        _service(sqlite_session).resolve_target(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id=BUILD_DRAFT,
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
        )

    assert exc_info.value.code == "missing_user_id"


@pytest.mark.parametrize(
    ("agent_tenant_id", "expected_code"),
    [
        (OTHER_TENANT, "agent_not_found"),
        (TENANT, "config_version_not_found"),
    ],
)
@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_resolve_target_maps_missing_agent_and_version(
    agent_tenant_id: str,
    expected_code: str,
    sqlite_session: Session,
) -> None:
    sqlite_session.add(_agent(tenant_id=agent_tenant_id))
    sqlite_session.commit()

    with pytest.raises(AgentConfigServiceError) as exc_info:
        _service(sqlite_session).resolve_target(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id=SNAPSHOT,
            config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            user_id=USER,
        )

    assert exc_info.value.code == expected_code


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_push_rejects_non_build_draft_writes(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _draft(soul=_soul(config_note="before")))

    with pytest.raises(AgentConfigServiceError, match="build drafts") as exc_info:
        _service(sqlite_session).push(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=DRAFT,
            config_version_kind=AgentConfigVersionKind.DRAFT,
            payload=ConfigPushPayload(note="ignored"),
        )

    assert exc_info.value.code == "config_not_writable"
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_note == "before"


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_push_for_console_allows_shared_draft_mutations(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _draft(soul=_soul(config_note="before")))

    manifest = _service(sqlite_session).push_for_console(
        tenant_id=TENANT,
        agent_id=AGENT,
        user_id=USER,
        config_version_id=DRAFT,
        config_version_kind=AgentConfigVersionKind.DRAFT,
        payload=ConfigPushPayload(note="after"),
    )

    assert manifest["note"] == "after"
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_note == "after"


@pytest.mark.parametrize("sqlite_session", [(*AGENT_CONFIG_TABLES, ToolFile)], indirect=True)
def test_push_accepts_tenant_scoped_tool_file_sources_from_different_upload_owner(
    sqlite_session: Session,
) -> None:
    _persist_target(
        sqlite_session,
        _draft(
            version_id=BUILD_DRAFT,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id=USER,
        ),
    )
    file_source = ToolFile(
        tenant_id=TENANT,
        user_id=END_USER,
        conversation_id=None,
        size=7,
        mimetype="text/plain",
        file_key="file-key",
        name="guide.txt",
    )
    file_source.id = TOOL_FILE
    skill_source = ToolFile(
        tenant_id=TENANT,
        user_id=END_USER,
        conversation_id=None,
        size=123,
        mimetype="application/zip",
        file_key="skill-key",
        name="alpha.zip",
    )
    skill_source.id = SKILL_FILE
    sqlite_session.add_all([file_source, skill_source])
    sqlite_session.commit()
    skill_ref = AgentConfigSkillRefConfig(
        name="alpha",
        description="Alpha skill",
        file_id=NORMALIZED_SKILL_FILE,
        size=321,
        mime_type="application/zip",
    )
    service = _service(sqlite_session)

    with (
        patch(f"{MODULE}.storage.load_once", return_value=b"skill-archive"),
        patch.object(
            service._skill_normalizer,
            "normalize",
            return_value=(skill_ref, object()),
        ),
    ):
        manifest = service.push(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=BUILD_DRAFT,
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            payload=ConfigPushPayload.model_validate(
                {
                    "files": [{"name": "guide.txt", "file_ref": {"kind": "tool_file", "id": TOOL_FILE}}],
                    "skills": [{"name": "alpha", "file_ref": {"kind": "tool_file", "id": SKILL_FILE}}],
                }
            ),
        )

    files = manifest["files"]
    skills = manifest["skills"]
    assert isinstance(files, dict)
    assert isinstance(skills, dict)
    assert files["items"][0]["file_id"] == TOOL_FILE
    assert files["items"][0]["is_missing"] is False
    assert skills["items"][0]["file_id"] == NORMALIZED_SKILL_FILE
    assert skills["items"][0]["is_missing"] is False
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, BUILD_DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_files[0].file_id == TOOL_FILE
    assert persisted.config_snapshot.config_skills[0].file_id == NORMALIZED_SKILL_FILE
    persisted_source = sqlite_session.get(ToolFile, TOOL_FILE)
    assert persisted_source is not None
    assert persisted_source.user_id == END_USER


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_push_file_for_console_rejects_snapshot_writes(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _snapshot())

    with pytest.raises(AgentConfigServiceError, match="editable drafts") as exc_info:
        _service(sqlite_session).push_file_for_console(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id=SNAPSHOT,
            config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            upload_file_id=UPLOAD_FILE,
        )

    assert exc_info.value.code == "config_not_writable"
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigSnapshot, SNAPSHOT)
    assert persisted is not None
    assert persisted.config_snapshot.config_files == []


@pytest.mark.parametrize("sqlite_session", [(*AGENT_CONFIG_TABLES, UploadFile)], indirect=True)
def test_push_file_for_console_uses_service_owned_upload_lookup_and_naming(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _draft())
    upload_file = UploadFile(
        tenant_id=TENANT,
        storage_type=StorageType.LOCAL,
        key="uploads/guide.txt",
        name="guide.txt",
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=USER,
        created_at=datetime(2025, 1, 1),
        used=False,
        hash="sha256:abc",
    )
    upload_file.id = UPLOAD_FILE
    sqlite_session.add(upload_file)
    sqlite_session.commit()

    response = _service(sqlite_session).push_file_for_console(
        tenant_id=TENANT,
        agent_id=AGENT,
        user_id=USER,
        config_version_id=DRAFT,
        config_version_kind=AgentConfigVersionKind.DRAFT,
        upload_file_id=UPLOAD_FILE,
    )

    assert response == {
        "file": {
            "id": "guide.txt",
            "name": "guide.txt",
            "file_id": UPLOAD_FILE,
            "is_missing": False,
            "size": 7,
            "hash": "sha256:abc",
            "mime_type": "text/plain",
        },
        "config_version": {
            "id": DRAFT,
            "kind": "draft",
            "writable": True,
        },
    }
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_files[0].file_id == UPLOAD_FILE


@pytest.mark.parametrize("sqlite_session", [AGENT_CONFIG_TABLES], indirect=True)
def test_upload_skill_for_console_maps_package_validation_failures(sqlite_session: Session) -> None:
    _persist_target(sqlite_session, _draft())
    service = _service(sqlite_session)
    message = "skill package must contain exactly one skill; multiple skill folders in one archive are not supported"

    with patch.object(
        service._skill_normalizer,
        "normalize",
        side_effect=SkillPackageError("files_outside_skill_root", message, status_code=400),
    ):
        with pytest.raises(AgentConfigServiceError, match="exactly one skill") as exc_info:
            service.upload_skill_for_console(
                tenant_id=TENANT,
                agent_id=AGENT,
                user_id=USER,
                config_version_id=DRAFT,
                config_version_kind=AgentConfigVersionKind.DRAFT,
                content=b"bad-archive",
                filename="skills.zip",
            )

    assert exc_info.value.code == "files_outside_skill_root"
    assert exc_info.value.message == message
    assert exc_info.value.status_code == 400
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, DRAFT)
    assert persisted is not None
    assert persisted.config_snapshot.config_skills == []


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_apply_skill_updates_rejects_non_tool_file_refs(sqlite_session: Session) -> None:
    service = AgentConfigService()

    with pytest.raises(AgentConfigServiceError, match="tool files") as exc_info:
        service._apply_skill_updates(
            sqlite_session,
            tenant_id=TENANT,
            user_id=USER,
            current=[],
            updates=[
                ConfigPushSkillItem.model_validate(
                    {"name": "alpha", "file_ref": {"kind": "upload_file", "id": "upload-1"}}
                )
            ],
        )

    assert exc_info.value.code == "invalid_skill_file_ref"


@pytest.mark.parametrize(
    ("error_code", "message"),
    [
        ("skill_name_mismatch", "skill name does not match requested config key"),
        ("invalid_archive", "stored tool file is not a valid skill archive"),
    ],
)
@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_apply_skill_updates_maps_normalizer_failures(
    error_code: str,
    message: str,
    sqlite_session: Session,
) -> None:
    service = AgentConfigService()
    tool_file = SimpleNamespace(name="alpha.zip", file_key="tool-files/alpha.zip")

    with (
        patch.object(service, "_require_tool_file_source", return_value=tool_file),
        patch(f"{MODULE}.storage.load_once", return_value=b"bad-archive"),
        patch.object(
            service._skill_normalizer,
            "normalize",
            side_effect=SkillPackageError(error_code, message, status_code=400),
        ),
    ):
        with pytest.raises(AgentConfigServiceError, match=message) as exc_info:
            service._apply_skill_updates(
                sqlite_session,
                tenant_id=TENANT,
                user_id=USER,
                current=[],
                updates=[
                    ConfigPushSkillItem.model_validate(
                        {"name": "alpha", "file_ref": {"kind": "tool_file", "id": "tool-file-1"}}
                    )
                ],
            )

    assert exc_info.value.code == error_code


def test_apply_env_text_supports_delete_comments_export_and_keeps_unmentioned_values() -> None:
    current = [
        AgentEnvVariableConfig(key="KEEP", name="KEEP", value="old"),
        AgentEnvVariableConfig(key="REMOVE", name="REMOVE", value="gone"),
        AgentEnvVariableConfig(key="UNTOUCHED", name="UNTOUCHED", value="still-here"),
    ]

    updated = AgentConfigService._apply_env_text(
        current,
        "# comment\nexport KEEP=new-value\nREMOVE=\nNEW='two words'\n",
    )

    values = {item.key: item.value for item in updated}
    assert values == {
        "KEEP": "new-value",
        "UNTOUCHED": "still-here",
        "NEW": "two words",
    }


@pytest.mark.parametrize(
    "archive_bytes",
    [
        pytest.param(b"not-a-zip-archive", id="not-a-zip-archive"),
        pytest.param(_zip_bytes({"README.md": b"missing skill md"}), id="missing-skill-md"),
    ],
)
def test_inspect_skill_maps_invalid_archives_to_service_errors(archive_bytes: bytes) -> None:
    service = AgentConfigService()
    target = _target(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        writable=True,
        soul=_soul(config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id="tool-file-1")]),
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch.object(service, "_load_tool_file_bytes", return_value=(archive_bytes, "application/zip")),
    ):
        with pytest.raises(AgentConfigServiceError, match="stored config skill archive is invalid") as exc_info:
            service.inspect_skill(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="alpha",
                user_id=USER,
            )

    assert exc_info.value.code == "skill_archive_invalid"
    assert exc_info.value.status_code == 500


def test_manifest_uses_items_shape_without_download_urls() -> None:
    target = _target(
        kind=AgentConfigVersionKind.DRAFT,
        writable=False,
        soul=_soul(
            config_skills=[AgentConfigSkillRefConfig(name="alpha", description="Alpha skill", file_id="tool-file-1")],
            config_files=[AgentConfigFileRefConfig(name="guide.txt", file_kind="upload_file", file_id="upload-file-1")],
            config_note="Use the guide.",
        ),
    )

    manifest = AgentConfigService._manifest_for_target(target)

    assert manifest == {
        "agent_id": AGENT,
        "config_version": {
            "id": "version-1",
            "kind": "draft",
            "writable": True,
        },
        "skills": {
            "items": [
                {
                    "id": "alpha",
                    "name": "alpha",
                    "file_id": "tool-file-1",
                    "is_missing": False,
                    "description": "Alpha skill",
                    "size": None,
                    "hash": None,
                    "mime_type": "application/zip",
                }
            ]
        },
        "files": {
            "items": [
                {
                    "id": "guide.txt",
                    "name": "guide.txt",
                    "file_id": "upload-file-1",
                    "is_missing": False,
                    "size": None,
                    "hash": None,
                    "mime_type": None,
                }
            ]
        },
        "env_keys": [],
        "note": "Use the guide.",
    }


def test_manifest_preserves_missing_config_assets_and_pull_rejects_them() -> None:
    soul = _soul(
        config_skills=[{"name": "alpha", "file_id": "", "is_missing": True}],
        config_files=[{"name": "guide.txt", "file_kind": "upload_file", "file_id": "", "is_missing": True}],
    )
    target = _target(kind=AgentConfigVersionKind.DRAFT, writable=False, soul=soul)
    service = AgentConfigService()

    manifest = service._manifest_for_target(target)

    assert manifest["skills"]["items"][0]["is_missing"] is True  # type: ignore[index]
    assert manifest["files"]["items"][0]["is_missing"] is True  # type: ignore[index]
    with patch.object(service, "resolve_target", return_value=target):
        with pytest.raises(AgentConfigServiceError) as skill_error:
            service.pull_skill(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="draft-1",
                config_version_kind=AgentConfigVersionKind.DRAFT,
                name="alpha",
                user_id=USER,
            )
        with pytest.raises(AgentConfigServiceError) as file_error:
            service.pull_file(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="draft-1",
                config_version_kind=AgentConfigVersionKind.DRAFT,
                name="guide.txt",
                user_id=USER,
            )

    assert (skill_error.value.code, skill_error.value.status_code) == ("config_skill_missing", 409)
    assert (file_error.value.code, file_error.value.status_code) == ("config_file_missing", 409)


def test_config_asset_refs_require_file_id_unless_marked_missing() -> None:
    assert AgentFileRefConfig().file_id is None
    assert (
        AgentConfigFileRefConfig(
            name="guide.txt",
            file_kind="upload_file",
            is_missing=True,
        ).file_id
        == ""
    )
    with pytest.raises(ValueError, match="file_id is required"):
        AgentConfigSkillRefConfig(name="alpha")
    with pytest.raises(ValueError, match="must not retain"):
        AgentConfigFileRefConfig(
            name="guide.txt",
            file_kind="upload_file",
            file_id="workspace-file-id",
            is_missing=True,
        )


def test_preview_skill_file_returns_text_preview() -> None:
    service = AgentConfigService()
    target = _target(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        writable=True,
        soul=_soul(config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id="tool-file-1")]),
    )
    archive_bytes = _zip_bytes(
        {
            "SKILL.md": b"# Alpha\n",
            "references/guide.md": b"hello world",
        }
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch.object(service, "_load_tool_file_bytes", return_value=(archive_bytes, "application/zip")),
    ):
        preview = service.preview_skill_file(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id="build-draft-1",
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            name="alpha",
            path="references/guide.md",
            user_id=USER,
        )

    assert preview == {
        "path": "references/guide.md",
        "size": 11,
        "truncated": False,
        "binary": False,
        "text": "hello world",
    }


def test_preview_skill_file_marks_binary_and_truncated_payloads() -> None:
    service = AgentConfigService()
    target = _target(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        writable=True,
        soul=_soul(config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id="tool-file-1")]),
    )
    archive_bytes = _zip_bytes(
        {
            "SKILL.md": b"# Alpha\n",
            "bin/data.bin": b"\x00" + (b"x" * (AgentConfigService.PREVIEW_MAX_BYTES + 10)),
        }
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch.object(service, "_load_tool_file_bytes", return_value=(archive_bytes, "application/zip")),
    ):
        preview = service.preview_skill_file(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id="build-draft-1",
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            name="alpha",
            path="bin/data.bin",
            user_id=USER,
        )

    assert preview == {
        "path": "bin/data.bin",
        "size": AgentConfigService.PREVIEW_MAX_BYTES + 11,
        "truncated": True,
        "binary": True,
        "text": None,
    }


def test_resolve_skill_file_member_path_requires_existing_member() -> None:
    service = AgentConfigService()
    target = _target(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        writable=True,
        soul=_soul(config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id="tool-file-1")]),
    )
    archive_bytes = _zip_bytes(
        {
            "SKILL.md": b"# Alpha\n",
            "references/guide.md": b"hello world",
        }
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch.object(service, "_load_tool_file_bytes", return_value=(archive_bytes, "application/zip")),
    ):
        assert (
            service.resolve_skill_file_member_path(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="alpha",
                path="references/guide.md",
                user_id=USER,
            )
            == "references/guide.md"
        )

        with pytest.raises(AgentConfigServiceError, match="config skill file not found") as exc_info:
            service.resolve_skill_file_member_path(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="alpha",
                path="references/missing.md",
                user_id=USER,
            )

    assert exc_info.value.code == "config_skill_file_not_found"
    assert exc_info.value.status_code == 404


def test_download_url_helpers_use_shared_url_resolution() -> None:
    service = AgentConfigService()
    target = _target(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        writable=True,
        soul=_soul(
            config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id="tool-file-1")],
            config_files=[AgentConfigFileRefConfig(name="guide.txt", file_kind="upload_file", file_id="upload-file-1")],
        ),
    )

    with (
        patch.object(service, "resolve_target", return_value=target),
        patch.object(
            service,
            "_resolve_download_url",
            side_effect=["https://example.com/alpha.zip", "https://example.com/guide.txt"],
        ),
    ):
        assert (
            service.download_skill_url(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="alpha",
                user_id=USER,
            )
            == "https://example.com/alpha.zip"
        )
        assert (
            service.download_file_url(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                name="guide.txt",
                user_id=USER,
            )
            == "https://example.com/guide.txt"
        )

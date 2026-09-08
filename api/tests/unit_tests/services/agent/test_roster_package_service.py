from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Callable, Generator

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus
from models.model import App, AppMode, IconType
from models.skill import AgentSkillBindingSnapshot, Skill, SkillVersion, SkillVersionManifest
from models.tools import ToolFile
from services.agent import roster_package_exporter as roster_package_exporter_module
from services.agent import roster_package_reader as roster_package_reader_module
from services.agent.errors import (
    InvalidRosterAgentPackageError,
    RosterAgentPackageExportFailedError,
    RosterAgentPackageTooLargeError,
)
from services.agent.roster_package_entities import (
    ROSTER_AGENT_PACKAGE_MAX_MANIFEST_BYTES,
    RosterAgentPackageFile,
    RosterAgentPackageManifest,
    RosterAgentPackageMetadata,
    RosterAgentPackageSkill,
)
from services.agent.roster_package_exporter import RosterAgentPackageExporter
from services.agent.roster_package_reader import RosterAgentPackageReader
from tests.unit_tests.config_override import apply_config_overrides


class _MemoryStorage:
    def __init__(self, files: dict[str, bytes], *, before_read: Callable[[], None] | None = None) -> None:
        self.files = files
        self.before_read = before_read

    def load_stream(self, filename: str) -> Generator[bytes, None, None]:
        if self.before_read is not None:
            self.before_read()
        content = self.files[filename]
        for offset in range(0, len(content), 7):
            yield content[offset : offset + 7]


def _zip(members: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, payload in members.items():
            archive.writestr(path, payload)
    return output.getvalue()


def _skill_archive(name: str = "research") -> bytes:
    return _zip(
        {
            "SKILL.md": (f"---\nname: {name}\ndescription: Research skill.\n---\n\n# Research\n").encode(),
            "scripts/run.py": b"print('ok')\n",
        }
    )


def _manifest(*, skill_payload: bytes, file_payload: bytes) -> RosterAgentPackageManifest:
    soul = AgentSoulConfig.model_validate(
        {
            "config_skills": [{"name": "research", "file_id": "s_000001"}],
            "config_files": [
                {
                    "name": "guide.pdf",
                    "file_kind": "tool_file",
                    "file_id": "f_000001",
                }
            ],
        }
    )
    return RosterAgentPackageManifest(
        metadata=RosterAgentPackageMetadata(name="Research Agent"),
        soul=soul,
        skills=[
            RosterAgentPackageSkill(
                id="s_000001",
                scope="agent_config",
                name="research",
                description="Research skill.",
                path="s_000001.zip",
                size=len(skill_payload),
                sha256=hashlib.sha256(skill_payload).hexdigest(),
            )
        ],
        files=[
            RosterAgentPackageFile(
                id="f_000001",
                role="agent_config_file",
                path="f_000001.pdf",
                original_name="guide.pdf",
                mime_type="application/pdf",
                size=len(file_payload),
                sha256=hashlib.sha256(file_payload).hexdigest(),
            )
        ],
    )


def _app(app_id: str) -> App:
    return App(
        id=app_id,
        tenant_id="tenant-1",
        name="Research Agent",
        description="",
        mode=AppMode.AGENT,
        icon_type=IconType.EMOJI,
        icon="R",
        icon_background="#FFFFFF",
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
        max_active_requests=None,
        created_by="account-1",
    )


def _package_bytes(
    manifest: RosterAgentPackageManifest,
    *,
    skill_payload: bytes,
    file_payload: bytes,
    extra_members: dict[str, bytes] | None = None,
) -> bytes:
    return _zip(
        {
            "manifest.json": manifest.model_dump_json(exclude_none=True).encode(),
            "s_000001.zip": skill_payload,
            "f_000001.pdf": file_payload,
            **(extra_members or {}),
        }
    )


def test_manifest_rejects_dangling_resource_references() -> None:
    with pytest.raises(ValidationError, match="config skill reference must resolve"):
        RosterAgentPackageManifest(
            metadata=RosterAgentPackageMetadata(name="Research Agent"),
            soul=AgentSoulConfig.model_validate({"config_skills": [{"name": "research", "file_id": "s_000001"}]}),
        )


def test_binary_dependency_requires_platform_and_arch_together() -> None:
    with pytest.raises(ValidationError, match="platform and arch together"):
        RosterAgentPackageFile(
            id="f_000001",
            role="binary_dependency",
            path="f_000001.so",
            original_name="tool.so",
            mime_type="application/octet-stream",
            platform="linux",
            size=1,
            sha256="0" * 64,
        )


@pytest.mark.parametrize(
    ("error", "error_code", "status"),
    [
        (InvalidRosterAgentPackageError(), "invalid_roster_agent_package", 400),
        (RosterAgentPackageTooLargeError(), "roster_agent_package_too_large", 413),
        (RosterAgentPackageExportFailedError(), "roster_agent_package_export_failed", 500),
    ],
)
def test_roster_package_errors_use_standard_http_payload(
    error: InvalidRosterAgentPackageError | RosterAgentPackageTooLargeError | RosterAgentPackageExportFailedError,
    error_code: str,
    status: int,
) -> None:
    assert error.error_code == error_code
    assert error.code == status
    assert error.data == {"code": error_code, "message": error.description, "status": status}


def test_preflight_validates_resources_and_accepts_ignored_signature() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(
        manifest,
        skill_payload=skill_payload,
        file_payload=file_payload,
        extra_members={"signature.sig": b"not-verified-in-v1"},
    )

    with RosterAgentPackageReader().read(io.BytesIO(package)) as prepared:
        assert prepared.manifest == manifest
        assert prepared.members["s_000001.zip"].sha256 == hashlib.sha256(skill_payload).hexdigest()
        assert prepared.members["f_000001.pdf"].size == len(file_payload)


def test_reader_accepts_manifest_larger_than_legacy_limit() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest_data = _manifest(skill_payload=skill_payload, file_payload=file_payload).model_dump(mode="json")
    manifest_data["soul"]["prompt"]["system_prompt"] = "x" * (1024 * 1024)
    manifest = RosterAgentPackageManifest.model_validate(manifest_data)
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)

    assert len(manifest.model_dump_json().encode()) > 1024 * 1024
    with RosterAgentPackageReader().read(io.BytesIO(package)) as prepared:
        assert prepared.manifest.soul.prompt.system_prompt == manifest.soul.prompt.system_prompt


def test_reader_rejects_manifest_larger_than_five_mib() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest_data = _manifest(skill_payload=skill_payload, file_payload=file_payload).model_dump(mode="json")
    manifest_data["soul"]["prompt"]["system_prompt"] = "x" * ROSTER_AGENT_PACKAGE_MAX_MANIFEST_BYTES
    manifest = RosterAgentPackageManifest.model_validate(manifest_data)
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)

    with pytest.raises(RosterAgentPackageTooLargeError):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_reader_applies_the_whole_package_size_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)
    monkeypatch.setattr(roster_package_reader_module, "ROSTER_AGENT_PACKAGE_MAX_BYTES", len(package) - 1)

    with pytest.raises(RosterAgentPackageTooLargeError):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_preflight_rejects_tampered_payload() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(
        manifest,
        skill_payload=skill_payload,
        file_payload=b"tampered",
    )

    with pytest.raises(InvalidRosterAgentPackageError, match="failed integrity checks"):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_preflight_rejects_members_not_declared_by_manifest() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(
        manifest,
        skill_payload=skill_payload,
        file_payload=file_payload,
        extra_members={"undeclared.txt": b"unexpected"},
    )

    with pytest.raises(InvalidRosterAgentPackageError, match="members do not match"):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_preflight_rejects_unsafe_member_path() -> None:
    package = _zip({"../manifest.json": b"{}"})

    with pytest.raises(InvalidRosterAgentPackageError, match="unsafe path"):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_preflight_rejects_duplicate_manifest_keys() -> None:
    package = _zip({"manifest.json": b'{"format":"dify.roster-agent","format":"dify.roster-agent"}'})

    with pytest.raises(InvalidRosterAgentPackageError, match="manifest is invalid"):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_preflight_rejects_invalid_skill_payload() -> None:
    skill_payload = _zip({"README.md": b"missing skill manifest"})
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)

    with pytest.raises(InvalidRosterAgentPackageError, match="package Skill 'research' is invalid"):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_preflight_rejects_oversized_skill_before_materializing(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, UPLOAD_SKILL_FILE_SIZE_LIMIT=0)
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)

    with pytest.raises(RosterAgentPackageTooLargeError) as exc_info:
        RosterAgentPackageReader().read(io.BytesIO(package))

    assert exc_info.value.error_code == "roster_agent_package_too_large"
    assert exc_info.value.code == 413


def test_read_member_enforces_actual_output_limit() -> None:
    package = _zip({"payload.bin": b"x" * 32})

    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        with pytest.raises(RosterAgentPackageTooLargeError) as exc_info:
            RosterAgentPackageReader._read_member(
                archive,
                archive.getinfo("payload.bin"),
                collect=True,
                max_bytes=8,
            )

    assert exc_info.value.error_code == "roster_agent_package_too_large"


def test_export_accepts_legacy_agent_and_preserves_caller_transaction(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    skill_payload = _skill_archive()
    file_payload = b"guide"
    read_sessions: list[Session] = []

    def create_read_session() -> Session:
        session = sqlite_session_factory()
        read_sessions.append(session)
        return session

    def assert_read_session_closed() -> None:
        assert read_sessions
        assert not read_sessions[-1].in_transaction()

    monkeypatch.setattr(roster_package_exporter_module.session_factory, "create_session", create_read_session)

    storage = _MemoryStorage(
        {"tools/skill.zip": skill_payload, "tools/guide.pdf": file_payload},
        before_read=assert_read_session_closed,
    )
    skill_file = ToolFile(
        user_id="account-1",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tools/skill.zip",
        mimetype="application/zip",
        name="research.zip",
        size=len(skill_payload),
        original_url=None,
    )
    skill_file.id = "11111111-1111-4111-8111-111111111111"
    config_file = ToolFile(
        user_id="account-1",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tools/guide.pdf",
        mimetype="application/pdf",
        name="guide.pdf",
        size=len(file_payload),
        original_url=None,
    )
    config_file.id = "22222222-2222-4222-8222-222222222222"
    published_soul = AgentSoulConfig.model_validate({"prompt": {"system_prompt": "published"}})
    draft_soul = AgentSoulConfig.model_validate(
        {
            "prompt": {"system_prompt": "draft"},
            "config_skills": [
                {"name": "research", "file_id": skill_file.id},
                {"name": "missing-skill", "file_id": "", "is_missing": True},
            ],
            "config_files": [
                {"name": "guide.pdf", "file_kind": "tool_file", "file_id": config_file.id},
                {"name": "missing.txt", "file_kind": "upload_file", "file_id": "", "is_missing": True},
            ],
        }
    )
    agent = Agent(
        tenant_id="tenant-1",
        name="Research Agent",
        description="description",
        role="researcher",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        app_id="33333333-3333-4333-8333-333333333333",
        backing_app_id=None,
        status=AgentStatus.ACTIVE,
        created_by="account-1",
        updated_by="account-1",
    )
    agent.id = "44444444-4444-4444-8444-444444444444"
    snapshot = AgentConfigSnapshot(
        tenant_id="tenant-1",
        agent_id=agent.id,
        version=1,
        config_snapshot=published_soul,
        created_by="account-1",
    )
    snapshot.id = "55555555-5555-4555-8555-555555555555"
    agent.active_config_snapshot_id = snapshot.id
    draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        base_snapshot_id=snapshot.id,
        config_snapshot=draft_soul,
        created_by="account-1",
        updated_by="account-1",
    )
    sqlite_session.add_all(
        [_app("33333333-3333-4333-8333-333333333333"), skill_file, config_file, agent, snapshot, draft]
    )
    sqlite_session.commit()

    caller_owned_file = ToolFile(
        user_id="account-1",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tools/caller-owned.txt",
        mimetype="text/plain",
        name="caller-owned.txt",
        size=1,
        original_url=None,
    )
    caller_owned_file.id = "77777777-7777-4777-8777-777777777777"
    sqlite_session.add(caller_owned_file)
    sqlite_session.flush()
    assert caller_owned_file not in sqlite_session.new

    exporter = RosterAgentPackageExporter(
        storage_backend=storage,
        dependency_provider=lambda _tenant_id, _dependencies: [],
    )
    with exporter.export(tenant_id="tenant-1", agent_id=agent.id) as exported:
        archive_bytes = exported.archive.read()
        assert exported.filename == "research-agent.ifpkg"
        assert exported.manifest.soul.prompt.system_prompt == "draft"
        assert exported.manifest.soul.config_skills[0].file_id == "s_000001"
        assert exported.manifest.soul.config_files[0].file_id == "f_000001"
        assert exported.manifest.soul.config_skills[1].is_missing is True
        assert exported.manifest.soul.config_skills[1].file_id == ""
        assert exported.manifest.soul.config_files[1].is_missing is True
        assert exported.manifest.soul.config_files[1].file_id == ""
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            assert set(archive.namelist()) == {"manifest.json", "s_000001.zip", "f_000001.pdf"}
            assert archive.read("s_000001.zip") == skill_payload
            assert "signature.sig" not in archive.namelist()

        with RosterAgentPackageReader().read(io.BytesIO(archive_bytes)) as prepared:
            assert prepared.manifest.soul.prompt.system_prompt == "draft"

    assert sqlite_session.in_transaction()
    assert sqlite_session.get(ToolFile, caller_owned_file.id) is caller_owned_file

    monkeypatch.setattr(roster_package_exporter_module, "ROSTER_AGENT_PACKAGE_MAX_MANIFEST_BYTES", 1)
    with pytest.raises(RosterAgentPackageTooLargeError):
        exporter.export(tenant_id="tenant-1", agent_id=agent.id)
    monkeypatch.setattr(
        roster_package_exporter_module,
        "ROSTER_AGENT_PACKAGE_MAX_MANIFEST_BYTES",
        ROSTER_AGENT_PACKAGE_MAX_MANIFEST_BYTES,
    )

    monkeypatch.setattr(
        roster_package_exporter_module,
        "ROSTER_AGENT_PACKAGE_MAX_BYTES",
        len(skill_payload) + len(file_payload),
    )
    with pytest.raises(RosterAgentPackageTooLargeError):
        exporter.export(tenant_id="tenant-1", agent_id=agent.id)


def test_export_uses_current_workspace_skill_bindings(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    workspace_payload = _skill_archive("legacy-published")
    storage = _MemoryStorage({"tools/workspace.zip": workspace_payload})
    monkeypatch.setattr(
        "services.skill_management_service.SkillManagementService._load_tool_file_bytes",
        staticmethod(lambda **_kwargs: workspace_payload),
    )
    archive_file = ToolFile(
        user_id="account-1",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tools/workspace.zip",
        mimetype="application/zip",
        name="workspace-research.zip",
        size=len(workspace_payload),
        original_url=None,
    )
    archive_file.id = "11111111-1111-4111-8111-111111111111"
    skill = Skill(
        tenant_id="tenant-1",
        name="renamed-workspace",
        display_name="Renamed Workspace",
        description="Renamed description.",
        created_by="account-1",
        updated_by="account-1",
    )
    skill.id = "22222222-2222-4222-8222-222222222222"
    version = SkillVersion(
        skill_id=skill.id,
        version_number=1,
        version_name="1.0",
        publish_note="",
        manifest=SkillVersionManifest(
            name=None,
            display_name=None,
            description=None,
            files=[],
        ),
        archive_tool_file_id=archive_file.id,
        hash_code="hash-code",
        archive_size=len(workspace_payload),
        published_by="account-1",
    )
    version.id = "33333333-3333-4333-8333-333333333333"
    skill.latest_published_version_id = version.id
    agent = Agent(
        tenant_id="tenant-1",
        name="Research Agent",
        description="",
        role="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        app_id="44444444-4444-4444-8444-444444444444",
        backing_app_id="44444444-4444-4444-8444-444444444444",
        status=AgentStatus.ACTIVE,
        created_by="account-1",
        updated_by="account-1",
    )
    agent.id = "55555555-5555-4555-8555-555555555555"
    snapshot = AgentConfigSnapshot(
        tenant_id="tenant-1",
        agent_id=agent.id,
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {"config_skills": [{"name": "legacy-published", "file_id": "", "is_missing": True}]}
        ),
        created_by="account-1",
    )
    snapshot.id = "66666666-6666-4666-8666-666666666666"
    agent.active_config_snapshot_id = snapshot.id
    binding = AgentSkillBindingSnapshot(
        tenant_id="tenant-1",
        agent_id=agent.id,
        config_snapshot_id=snapshot.id,
        skill_id=skill.id,
        priority=0,
        created_by="account-1",
    )
    sqlite_session.add_all(
        [_app("44444444-4444-4444-8444-444444444444"), archive_file, skill, version, agent, snapshot, binding]
    )
    sqlite_session.commit()

    exporter = RosterAgentPackageExporter(
        storage_backend=storage,
        dependency_provider=lambda _tenant_id, _dependencies: [],
    )
    with exporter.export(tenant_id="tenant-1", agent_id=agent.id) as exported:
        assert len(exported.manifest.skills) == 1
        assert exported.manifest.skills[0].scope == "workspace"
        assert exported.manifest.skills[0].priority == 0
        assert exported.manifest.skills[0].name == "legacy-published"
        assert exported.manifest.skills[0].display_name == "Legacy Published"
        assert exported.manifest.skills[0].description == "Research skill."
        assert exported.manifest.soul.config_skills[0].is_missing is True
        with RosterAgentPackageReader().read(exported.archive) as prepared:
            assert prepared.manifest.skills[0].sha256 == hashlib.sha256(workspace_payload).hexdigest()

    draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        base_snapshot_id=snapshot.id,
        config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "current draft"}}),
        created_by="account-1",
        updated_by="account-1",
    )
    sqlite_session.add(draft)
    sqlite_session.commit()

    with exporter.export(tenant_id="tenant-1", agent_id=agent.id) as exported:
        assert exported.manifest.soul.prompt.system_prompt == "current draft"
        assert exported.manifest.skills == []


def test_manifest_json_is_strict() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload).model_dump(mode="json")
    manifest["unexpected"] = True

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        RosterAgentPackageManifest.model_validate(json.loads(json.dumps(manifest)))

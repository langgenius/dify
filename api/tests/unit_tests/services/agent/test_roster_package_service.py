from __future__ import annotations

import hashlib
import io
import zipfile
from collections.abc import Callable, Generator

import pytest
import yaml
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
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
from services.agent.dsl_entities import AgentAppDsl, AgentPackage, AgentPackageMetadata, make_agent_app_dsl
from services.agent.errors import (
    InvalidRosterAgentPackageError,
    RosterAgentPackageExportFailedError,
    RosterAgentPackageTooLargeError,
)
from services.agent.roster_package_entities import (
    ROSTER_AGENT_PACKAGE_FORMAT,
    ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
    RosterAgentPackageFile,
    RosterAgentPackageManifest,
    RosterAgentPackageSkill,
)
from services.agent.roster_package_exporter import RosterAgentPackageExporter
from services.agent.roster_package_reader import RosterAgentPackageReader
from services.app_dsl_service import AppDslService
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from tests.unit_tests.config_override import apply_config_overrides


class _MemoryStorage:
    def __init__(self, files: dict[str, bytes], *, before_read: Callable[[], None] | None = None) -> None:
        self.files = files
        self.before_read = before_read
        self.read_count = 0
        self.bytes_yielded: dict[str, int] = {}

    def load_stream(self, filename: str) -> Generator[bytes, None, None]:
        self.read_count += 1
        if self.before_read is not None:
            self.before_read()
        content = self.files[filename]
        for offset in range(0, len(content), 7):
            chunk = content[offset : offset + 7]
            self.bytes_yielded[filename] = self.bytes_yielded.get(filename, 0) + len(chunk)
            yield chunk


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


def _package_app(soul: AgentSoulConfig | None = None) -> AgentAppDsl:
    soul = soul or AgentSoulConfig.model_validate(
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
    return make_agent_app_dsl(
        _app("app-1"),
        package_ref="agent_1",
        packages={"agent_1": AgentPackage(metadata=AgentPackageMetadata(name="Research Agent"), soul=soul)},
        dependencies=[],
    )


def _yaml_bytes(document: RosterAgentPackageManifest | AgentAppDsl) -> bytes:
    return yaml.safe_dump(document.model_dump(mode="json", exclude_none=True)).encode()


def _manifest(*, skill_payload: bytes, file_payload: bytes) -> RosterAgentPackageManifest:
    return RosterAgentPackageManifest(
        format=ROSTER_AGENT_PACKAGE_FORMAT,
        format_version=ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
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
    app: AgentAppDsl | None = None,
) -> bytes:
    return _zip(
        {
            "manifest.yaml": _yaml_bytes(manifest),
            "app.yaml": _yaml_bytes(app or _package_app()),
            "s_000001.zip": skill_payload,
            "f_000001.pdf": file_payload,
            **(extra_members or {}),
        }
    )


def test_manifest_rejects_dangling_resource_references() -> None:
    manifest = RosterAgentPackageManifest(
        format=ROSTER_AGENT_PACKAGE_FORMAT,
        format_version=ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
    )
    with pytest.raises(ValueError, match="config skill reference must resolve"):
        manifest.validate_app(_package_app())


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"path": "wrong.zip"}, "skill path must be"),
        ({"scope": "workspace"}, "workspace skill priority is required"),
        ({"priority": 0}, "agent config skill priority must be omitted"),
        ({"sha256": "not-a-digest"}, "sha256 must be"),
    ],
)
def test_skill_resource_rejects_invalid_metadata(overrides: dict[str, object], message: str) -> None:
    values: dict[str, object] = {
        "id": "s_000001",
        "scope": "agent_config",
        "name": "research",
        "path": "s_000001.zip",
        "size": 1,
        "sha256": "0" * 64,
    }
    values.update(overrides)

    with pytest.raises(ValidationError, match=message):
        RosterAgentPackageSkill.model_validate(values)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"path": "f_000001"}, "file path must start"),
        ({"path": "f_000001.dir/file"}, "root-level archive member"),
        ({"platform": "linux"}, "agent config files must not declare"),
    ],
)
def test_file_resource_rejects_invalid_metadata(overrides: dict[str, object], message: str) -> None:
    values: dict[str, object] = {
        "id": "f_000001",
        "role": "agent_config_file",
        "path": "f_000001.pdf",
        "original_name": "guide.pdf",
        "mime_type": "application/pdf",
        "size": 1,
        "sha256": "0" * 64,
    }
    values.update(overrides)

    with pytest.raises(ValidationError, match=message):
        RosterAgentPackageFile.model_validate(values)


def test_manifest_rejects_unsupported_soul_version() -> None:
    manifest = _manifest(skill_payload=_skill_archive(), file_payload=b"pdf-content")
    with pytest.raises(ValueError, match="unsupported Agent Soul schema version"):
        manifest.validate_app(_package_app(AgentSoulConfig(schema_version=2)))


def test_manifest_rejects_duplicate_resource_ids() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    values = _manifest(skill_payload=skill_payload, file_payload=file_payload).model_dump(mode="json")
    duplicate = {**values["skills"][0], "name": "duplicate"}
    values["skills"].append(duplicate)

    with pytest.raises(ValidationError, match="resource ids must be unique"):
        RosterAgentPackageManifest.model_validate(values)


def test_manifest_rejects_duplicate_localized_skill_names() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    values = _manifest(skill_payload=skill_payload, file_payload=file_payload).model_dump(mode="json")
    duplicate = {
        **values["skills"][0],
        "id": "s_000002",
        "path": "s_000002.zip",
        "scope": "workspace",
        "priority": 0,
    }
    values["skills"].append(duplicate)

    with pytest.raises(ValidationError, match="skill names must be unique"):
        RosterAgentPackageManifest.model_validate(values)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        ("skill_name", "config skill name must match"),
        ("unreferenced_skill", "agent_config skill resources must be referenced"),
        ("missing_file", "config file reference must resolve"),
        ("file_name", "config file name must match"),
        ("unreferenced_file", "agent_config_file resources must be referenced"),
    ],
)
def test_manifest_rejects_inconsistent_resource_index(mutation: str, message: str) -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    values = _manifest(skill_payload=skill_payload, file_payload=file_payload).model_dump(mode="json")
    app = _package_app()
    if mutation == "skill_name":
        values["skills"][0]["name"] = "renamed"
    elif mutation == "unreferenced_skill":
        app.package.soul.config_skills = []
    elif mutation == "missing_file":
        values["files"] = list[dict[str, object]]()
    elif mutation == "file_name":
        values["files"][0]["original_name"] = "renamed.pdf"
    else:
        app.package.soul.config_files = []

    with pytest.raises(ValueError, match=message):
        RosterAgentPackageManifest.model_validate(values).validate_app(app)


@pytest.mark.parametrize("missing_field", ["format", "format_version"])
def test_reader_rejects_manifest_without_format_discriminator(missing_field: str) -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload).model_dump(mode="json")
    manifest.pop(missing_field)
    package = _zip(
        {
            "manifest.yaml": yaml.safe_dump(manifest).encode(),
            "app.yaml": _yaml_bytes(_package_app()),
            "s_000001.zip": skill_payload,
            "f_000001.pdf": file_payload,
        }
    )

    with pytest.raises(InvalidRosterAgentPackageError, match="manifest is invalid"):
        RosterAgentPackageReader().read(io.BytesIO(package))


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


def test_reader_accepts_app_larger_than_legacy_limit() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    app = _package_app()
    app.package.soul.prompt.system_prompt = "x" * (1024 * 1024)
    package = _package_bytes(manifest, app=app, skill_payload=skill_payload, file_payload=file_payload)

    assert len(_yaml_bytes(app)) > 1024 * 1024
    with RosterAgentPackageReader().read(io.BytesIO(package)) as prepared:
        assert prepared.app == app


@pytest.mark.parametrize("path", ["manifest.yaml", "app.yaml"])
def test_reader_rejects_oversized_documents(path: str, monkeypatch: pytest.MonkeyPatch) -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    limit = 4096
    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_MANIFEST_BYTES=limit)
    package = _package_bytes(
        manifest,
        skill_payload=skill_payload,
        file_payload=file_payload,
        extra_members={path: b"x" * (limit + 1)},
    )
    with pytest.raises(RosterAgentPackageTooLargeError, match=path):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_reader_applies_the_whole_package_size_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)
    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_BYTES=len(package) - 1)

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
    package = _zip({"../manifest.yaml": b"{}"})

    with pytest.raises(InvalidRosterAgentPackageError, match="unsafe path"):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_high_compression_ratio_uses_absolute_package_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    skill_payload = _skill_archive()
    file_payload = b"x" * (1024 * 1024)
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)
    reader = RosterAgentPackageReader()
    with reader.read(io.BytesIO(package)) as prepared:
        assert prepared.members["f_000001.pdf"].size == len(file_payload)
    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_BYTES=128 * 1024)
    with pytest.raises(RosterAgentPackageTooLargeError, match="uncompressed size"):
        reader.read(io.BytesIO(package))


@pytest.mark.parametrize("path", ["manifest.yaml", "app.yaml"])
@pytest.mark.parametrize(
    "payload",
    [
        b"format: dify.roster-agent\nformat: dify.roster-agent\n",
        b"metadata:\n  name: first\n  name: second\n",
        b"value: &value [1]\ncopy: *value\n",
        b"value: !!python/object/apply:os.system ['false']\n",
        b"[invalid",
        b"\xff",
        b"null",
        b"[]",
        b"1: value",
        b"---\n{}\n---\n{}",
    ],
)
def test_preflight_rejects_invalid_yaml_documents(path: str, payload: bytes) -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    package = _package_bytes(
        _manifest(skill_payload=skill_payload, file_payload=file_payload),
        skill_payload=skill_payload,
        file_payload=file_payload,
        extra_members={path: payload},
    )
    with pytest.raises(InvalidRosterAgentPackageError, match=f"{path.removesuffix('.yaml')} is invalid"):
        RosterAgentPackageReader().read(io.BytesIO(package))


@pytest.mark.parametrize("missing_path", ["manifest.yaml", "app.yaml"])
def test_reader_requires_both_yaml_documents(missing_path: str) -> None:
    documents = {
        "manifest.yaml": _yaml_bytes(_manifest(skill_payload=_skill_archive(), file_payload=b"pdf-content")),
        "app.yaml": _yaml_bytes(_package_app()),
    }
    del documents[missing_path]
    with pytest.raises(InvalidRosterAgentPackageError, match=f"missing {missing_path}"):
        RosterAgentPackageReader().read(io.BytesIO(_zip(documents)))


@pytest.mark.parametrize(
    "mutation",
    [
        "legacy_app",
        "wrong_kind",
        "wrong_mode",
        "missing_ref",
        "dangling_ref",
        "extra_package",
        "invalid_version",
        "future_version",
    ],
)
def test_reader_rejects_invalid_agent_app_dsl(mutation: str) -> None:
    app = _package_app().model_dump(mode="json")
    if mutation == "legacy_app":
        app = {
            "metadata": app["agent_packages"]["agent_1"]["metadata"],
            "soul": app["agent_packages"]["agent_1"]["soul"],
        }
    elif mutation == "wrong_kind":
        app["kind"] = "workflow"
    elif mutation == "wrong_mode":
        app["app"]["mode"] = "workflow"
    elif mutation == "missing_ref":
        app["agent"] = dict[str, str]()
    elif mutation == "dangling_ref":
        app["agent"]["package_ref"] = "agent_2"
    elif mutation == "extra_package":
        app["agent_packages"]["agent_2"] = app["agent_packages"]["agent_1"]
    else:
        app["version"] = "invalid" if mutation == "invalid_version" else "999.0.0"
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    package = _package_bytes(
        _manifest(skill_payload=skill_payload, file_payload=file_payload),
        skill_payload=skill_payload,
        file_payload=file_payload,
        extra_members={"app.yaml": yaml.safe_dump(app).encode()},
    )
    with pytest.raises(InvalidRosterAgentPackageError, match="app is invalid"):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_reader_rejects_cross_document_reference_mismatch() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    app = _package_app()
    app.package.soul.config_skills[0].file_id = "s_000002"
    package = _package_bytes(
        _manifest(skill_payload=skill_payload, file_payload=file_payload),
        app=app,
        skill_payload=skill_payload,
        file_payload=file_payload,
    )
    with pytest.raises(InvalidRosterAgentPackageError, match="app is invalid"):
        RosterAgentPackageReader().read(io.BytesIO(package))


def test_preflight_records_invalid_skill_payload() -> None:
    skill_payload = _zip({"README.md": b"missing skill manifest"})
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)

    with RosterAgentPackageReader().read(io.BytesIO(package)) as prepared:
        assert prepared.invalid_skills == {"s_000001": "missing_skill_md"}


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


def test_preflight_rejects_aggregate_nested_skill_expansion(monkeypatch: pytest.MonkeyPatch) -> None:
    skill_payloads = {
        "s_000001.zip": _zip(
            {
                "SKILL.md": b"---\nname: research-one\ndescription: Research skill.\n---\n",
                "data.bin": b"x" * 8192,
            }
        ),
        "s_000002.zip": _zip(
            {
                "SKILL.md": b"---\nname: research-two\ndescription: Research skill.\n---\n",
                "data.bin": b"x" * 8192,
            }
        ),
    }
    soul = AgentSoulConfig.model_validate(
        {
            "config_skills": [
                {"name": "research-one", "file_id": "s_000001"},
                {"name": "research-two", "file_id": "s_000002"},
            ]
        }
    )
    manifest = RosterAgentPackageManifest(
        format=ROSTER_AGENT_PACKAGE_FORMAT,
        format_version=ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
        skills=[
            RosterAgentPackageSkill(
                id=path.removesuffix(".zip"),
                scope="agent_config",
                name=f"research-{index}",
                description="Research skill.",
                path=path,
                size=len(payload),
                sha256=hashlib.sha256(payload).hexdigest(),
            )
            for index, (path, payload) in zip(("one", "two"), skill_payloads.items())
        ],
    )
    package = _zip(
        {
            "manifest.yaml": _yaml_bytes(manifest),
            "app.yaml": _yaml_bytes(_package_app(soul)),
            **skill_payloads,
        }
    )
    nested_limit = 12 * 1024
    assert len(package) < nested_limit
    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_BYTES=nested_limit)

    with pytest.raises(RosterAgentPackageTooLargeError, match="nested Skill contents"):
        RosterAgentPackageReader().read(io.BytesIO(package))

    exporter = RosterAgentPackageExporter(storage_backend=_MemoryStorage(skill_payloads))
    sources = [
        roster_package_exporter_module._SkillSource(
            path=item.path,
            storage_key=item.path,
            id=item.id,
            scope=item.scope,
            name=item.name,
            display_name=item.display_name,
            description=item.description,
            priority=item.priority,
            audit_ref="source",
        )
        for item in manifest.skills
    ]
    with pytest.raises(RosterAgentPackageTooLargeError, match="nested Skill contents"):
        exporter._build_archive(app=_package_app(soul), skill_sources=sources, file_sources=[])


@pytest.mark.parametrize("failure", ["checksum", "size", "name", "crc"])
def test_reader_records_unusable_skills_and_preserves_other_members(failure: str) -> None:
    skill_payload = _skill_archive("different" if failure == "name" else "research")
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    if failure == "checksum":
        manifest.skills[0].sha256 = "0" * 64
    elif failure == "size":
        manifest.skills[0].size += 1
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)
    if failure == "crc":
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("manifest.yaml", _yaml_bytes(manifest))
            archive.writestr("app.yaml", _yaml_bytes(_package_app()))
            archive.writestr("s_000001.zip", skill_payload)
            archive.writestr("f_000001.pdf", file_payload)
        package = output.getvalue().replace(skill_payload, b"X" + skill_payload[1:])
    reader = RosterAgentPackageReader()
    with reader.read(io.BytesIO(package)) as prepared:
        expected = {
            "checksum": "checksum_mismatch",
            "size": "archive_integrity_failed",
            "name": "skill_name_mismatch",
            "crc": "archive_integrity_failed",
        }
        assert prepared.invalid_skills == {"s_000001": expected[failure]}
        assert reader.read_member_bytes(prepared, "f_000001.pdf", max_bytes=len(file_payload)) == file_payload


def test_member_read_rechecks_limit_and_integrity_after_preflight() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload)
    package = _package_bytes(manifest, skill_payload=skill_payload, file_payload=file_payload)
    reader = RosterAgentPackageReader()
    with reader.read(io.BytesIO(package)) as prepared:
        assert reader.read_member_bytes(prepared, "s_000001.zip", max_bytes=len(skill_payload)) == skill_payload
        with pytest.raises(RosterAgentPackageTooLargeError):
            reader.read_member_bytes(prepared, "f_000001.pdf", max_bytes=len(file_payload) - 1)
        with pytest.raises(InvalidRosterAgentPackageError, match="unavailable"):
            reader.read_member_bytes(prepared, "unknown", max_bytes=100)
        modified = _package_bytes(manifest, skill_payload=skill_payload, file_payload=b"bad-content")
        prepared.archive.seek(0)
        prepared.archive.truncate()
        prepared.archive.write(modified)
        with pytest.raises(InvalidRosterAgentPackageError, match="integrity checks"):
            reader.read_member_bytes(prepared, "f_000001.pdf", max_bytes=len(file_payload))


@pytest.mark.parametrize(
    ("case", "error_type", "message"),
    [
        ("missing_manifest", RosterAgentPackageExportFailedError, "unusable Skill"),
        ("name_mismatch", RosterAgentPackageExportFailedError, "unusable Skill"),
        ("size_limit", RosterAgentPackageTooLargeError, "exceeds the size limit"),
    ],
)
def test_export_rejects_unusable_or_oversized_skill_payload(
    case: str,
    error_type: type[RosterAgentPackageExportFailedError | RosterAgentPackageTooLargeError],
    message: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _zip({"README.md": b"missing skill manifest"}) if case == "missing_manifest" else _skill_archive("other")
    if case == "size_limit":
        apply_config_overrides(monkeypatch, UPLOAD_SKILL_FILE_SIZE_LIMIT=0)
    source = roster_package_exporter_module._SkillSource(
        path="s_000001.zip",
        storage_key="skill",
        id="s_000001",
        scope="agent_config",
        name="research",
        display_name=None,
        description="Research skill.",
        priority=None,
        audit_ref="source",
    )
    app = _package_app()
    app.package.soul.config_files = []
    exporter = RosterAgentPackageExporter(storage_backend=_MemoryStorage({"skill": payload}))
    with pytest.raises(error_type, match=message):
        exporter._build_archive(app=app, skill_sources=[source], file_sources=[])


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


@pytest.mark.parametrize("expected_size", [8, 64])
def test_read_member_validates_actual_size_while_streaming(expected_size: int) -> None:
    package = _zip({"payload.bin": b"x" * 32})

    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        with pytest.raises(InvalidRosterAgentPackageError, match="failed integrity checks"):
            RosterAgentPackageReader._read_member(
                archive,
                archive.getinfo("payload.bin"),
                collect=False,
                expected_size=expected_size,
            )


def test_export_accepts_legacy_agent_and_preserves_caller_transaction(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    skill_payload = _skill_archive()
    file_payload = b"0" * (1024 * 1024)
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
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "langgenius/openai/openai",
                "model": "gpt-test",
                "credential_ref": {"type": "provider", "id": "private-model"},
            },
            "tools": {
                "dify_tools": [
                    {
                        "provider_id": "langgenius/google/google",
                        "provider_type": "plugin",
                        "tool_name": "search",
                        "credential_type": "api-key",
                        "credential_ref": {"type": "tool", "id": "private-tool"},
                        "runtime_parameters": {"query": "retain", "api_key": "private-value"},
                    }
                ],
            },
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
    monkeypatch.setattr(DependenciesAnalysisService, "generate_dependencies", lambda **_kwargs: [])
    app_model = sqlite_session.get(App, agent.app_id)
    assert app_model is not None
    standalone_dsl = yaml.safe_load(AppDslService.export_dsl(app_model, session=sqlite_session))
    with exporter.export(tenant_id="tenant-1", agent_id=agent.id) as exported:
        archive_bytes = exported.archive.read()
        assert exported.filename == "research-agent.ifpkg"
        exported_soul = exported.app.package.soul
        assert exported_soul.model is not None
        assert exported_soul.model.credential_ref is None
        assert exported_soul.tools.dify_tools[0].credential_ref is None
        assert exported_soul.tools.dify_tools[0].runtime_parameters == {"query": "retain", "api_key": None}
        assert "private-" not in exported.app.model_dump_json()
        assert draft_soul.model is not None
        assert draft_soul.model.credential_ref is not None
        assert draft_soul.tools.dify_tools[0].runtime_parameters["api_key"] == "private-value"
        assert exported.app.package.soul.prompt.system_prompt == "draft"
        assert exported.app.package.soul.config_skills[0].file_id == "s_000001"
        assert exported.app.package.soul.config_files[0].file_id == "f_000001"
        assert exported.app.package.soul.config_skills[1].is_missing is True
        assert exported.app.package.soul.config_skills[1].file_id == ""
        assert exported.app.package.soul.config_files[1].is_missing is True
        assert exported.app.package.soul.config_files[1].file_id == ""
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            assert set(archive.namelist()) == {"manifest.yaml", "app.yaml", "s_000001.zip", "f_000001.pdf"}
            manifest_data = yaml.safe_load(archive.read("manifest.yaml"))
            app_data = yaml.safe_load(archive.read("app.yaml"))
            assert set(manifest_data) == {"format", "format_version", "audit", "skills", "files"}
            assert set(app_data) == {"version", "kind", "app", "agent", "agent_packages", "dependencies"}
            assert app_data["kind"] == "app"
            assert app_data["app"]["mode"] == "agent"
            assert app_data["app"]["icon"] == "R"
            assert app_data["agent"]["package_ref"] == "agent_1"
            assert "audit" not in app_data["agent_packages"]["agent_1"]["metadata"]
            assert AgentAppDsl.model_validate(app_data) == exported.app
            for key in ("version", "kind", "app", "agent", "dependencies"):
                assert app_data[key] == standalone_dsl[key]
            standalone_package = AgentPackage.model_validate(standalone_dsl["agent_packages"]["agent_1"])
            assert exported.app.package.metadata == standalone_package.metadata
            assert standalone_package.soul.config_skills[0].is_missing is True
            assert standalone_package.soul.config_skills[0].file_id == ""
            assert standalone_package.soul.config_files[0].is_missing is True
            assert {item.name for item in exported.app.package.omitted_assets} == {"missing-skill", "missing.txt"}
            assert {item.name for item in standalone_package.omitted_assets} == {
                "research",
                "guide.pdf",
                "missing-skill",
                "missing.txt",
            }
            assert archive.read("s_000001.zip") == skill_payload
            assert all(info.compress_type == zipfile.ZIP_STORED for info in archive.infolist())
            assert "signature.sig" not in archive.namelist()

        with RosterAgentPackageReader().read(io.BytesIO(archive_bytes)) as prepared:
            assert prepared.app.package.soul.prompt.system_prompt == "draft"

    assert sqlite_session.in_transaction()
    assert sqlite_session.get(ToolFile, caller_owned_file.id) is caller_owned_file

    max_entries = dify_config.AGENT_PACKAGE_MAX_ENTRIES
    max_manifest_bytes = dify_config.AGENT_PACKAGE_MAX_MANIFEST_BYTES
    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_ENTRIES=4)
    with exporter.export(tenant_id="tenant-1", agent_id=agent.id) as exported:
        with zipfile.ZipFile(exported.archive) as archive:
            assert len(archive.infolist()) == 4

    reads_before_limit_check = storage.read_count
    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_ENTRIES=3)
    with pytest.raises(RosterAgentPackageTooLargeError):
        exporter.export(tenant_id="tenant-1", agent_id=agent.id)
    assert storage.read_count == reads_before_limit_check
    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_ENTRIES=max_entries)

    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_MANIFEST_BYTES=1)
    with pytest.raises(RosterAgentPackageTooLargeError):
        exporter.export(tenant_id="tenant-1", agent_id=agent.id)
    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_MANIFEST_BYTES=max_manifest_bytes)

    file_bytes_before_limit_check = storage.bytes_yielded["tools/guide.pdf"]
    apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_BYTES=len(skill_payload) + 1)
    with pytest.raises(RosterAgentPackageTooLargeError):
        exporter.export(tenant_id="tenant-1", agent_id=agent.id)
    assert storage.bytes_yielded["tools/guide.pdf"] - file_bytes_before_limit_check == 7


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
        assert exported.app.package.soul.config_skills[0].is_missing is True
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
        assert exported.app.package.soul.prompt.system_prompt == "current draft"
        assert exported.manifest.skills == []


def test_manifest_yaml_is_strict() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    manifest = _manifest(skill_payload=skill_payload, file_payload=file_payload).model_dump(mode="json")
    manifest["unexpected"] = True

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        RosterAgentPackageManifest.model_validate(yaml.safe_load(yaml.safe_dump(manifest)))


@pytest.mark.parametrize(
    ("case", "message"),
    [
        ("empty", "package is empty"),
        ("entries", "too many members"),
        ("duplicate", "duplicate member paths"),
        ("directory", "root-level files"),
        ("control_character", "unsafe path"),
        ("symlink", "symbolic links"),
        ("encrypted", "encrypted members"),
        ("compression", "unsupported compression"),
    ],
)
def test_reader_rejects_invalid_container_before_parsing_manifest(
    case: str, message: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    if case == "empty":
        content = _zip({})
    elif case == "entries":
        apply_config_overrides(monkeypatch, AGENT_PACKAGE_MAX_ENTRIES=1)
        content = _zip({"manifest.yaml": b"", "app.yaml": b""})
    elif case == "duplicate":
        content = _zip({"manifest.yaml": b"", "MANIFEST.YAML": b""})
    elif case == "directory":
        content = _zip({"directory/": b""})
    elif case == "control_character":
        content = _zip({"bad\nname": b""})
    elif case == "symlink":
        output = io.BytesIO()
        info = zipfile.ZipInfo("manifest.yaml")
        info.create_system = 3
        info.external_attr = 0o120777 << 16
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr(info, b"target.yaml")
        content = output.getvalue()
    elif case == "encrypted":
        data = bytearray(_zip({"manifest.yaml": b"manifest"}))
        directory = data.index(b"PK\x01\x02")
        data[directory + 8] |= 1
        content = bytes(data)
    else:
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_BZIP2) as archive:
            archive.writestr("manifest.yaml", b"manifest")
        content = output.getvalue()
    with pytest.raises(InvalidRosterAgentPackageError, match=message):
        RosterAgentPackageReader().read(io.BytesIO(content))


def test_member_read_reports_closed_prepared_archive() -> None:
    skill_payload = _skill_archive()
    file_payload = b"pdf-content"
    content = _package_bytes(
        _manifest(skill_payload=skill_payload, file_payload=file_payload),
        skill_payload=skill_payload,
        file_payload=file_payload,
    )
    reader = RosterAgentPackageReader()
    prepared = reader.read(io.BytesIO(content))
    prepared.close()
    with pytest.raises(InvalidRosterAgentPackageError, match="member is unavailable"):
        reader.read_member_bytes(prepared, "f_000001.pdf", max_bytes=len(file_payload))

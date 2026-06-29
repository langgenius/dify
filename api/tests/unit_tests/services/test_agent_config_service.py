"""Focused tests for the Agent Soul-backed config service."""

from __future__ import annotations

import io
import zipfile
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from models.agent_config_entities import AgentConfigSkillRefConfig, AgentEnvVariableConfig, AgentSoulConfig
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
TENANT = "tenant-1"
AGENT = "agent-1"
USER = "user-1"


def _session_cm(session: MagicMock) -> MagicMock:
    context_manager = MagicMock()
    context_manager.__enter__.return_value = session
    context_manager.__exit__.return_value = None
    return context_manager


def _soul(**updates) -> AgentSoulConfig:
    payload = AgentSoulConfig().model_dump(mode="json")
    payload.update(updates)
    return AgentSoulConfig.model_validate(payload)


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
            archive.writestr(name, payload)
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("kind", "user_id", "version_row", "expected_writable"),
    [
        (AgentConfigVersionKind.SNAPSHOT, None, _version(version_id="snapshot-1"), False),
        (AgentConfigVersionKind.DRAFT, USER, _version(version_id="draft-1"), False),
        (AgentConfigVersionKind.BUILD_DRAFT, USER, _version(version_id="build-draft-1"), True),
    ],
)
def test_resolve_target_supports_snapshot_draft_and_build_draft(
    kind: AgentConfigVersionKind,
    user_id: str | None,
    version_row: SimpleNamespace,
    expected_writable: bool,
) -> None:
    session = MagicMock()
    session.scalar.side_effect = [AGENT, version_row]
    service = AgentConfigService()

    with patch(f"{MODULE}.session_factory.create_session", return_value=_session_cm(session)):
        target = service.resolve_target(
            tenant_id=TENANT,
            agent_id=AGENT,
            config_version_id=version_row.id,
            config_version_kind=kind,
            user_id=user_id,
        )

    assert target.agent_id == AGENT
    assert target.version_id == version_row.id
    assert target.kind == kind
    assert target.writable is expected_writable


def test_resolve_target_requires_user_for_build_draft() -> None:
    session = MagicMock()
    session.scalar.side_effect = [AGENT]
    service = AgentConfigService()

    with patch(f"{MODULE}.session_factory.create_session", return_value=_session_cm(session)):
        with pytest.raises(AgentConfigServiceError, match="user_id is required") as exc_info:
            service.resolve_target(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="build-draft-1",
                config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            )

    assert exc_info.value.code == "missing_user_id"


@pytest.mark.parametrize(
    ("first_scalar", "expected_code"),
    [
        (None, "agent_not_found"),
        (AGENT, "config_version_not_found"),
    ],
)
def test_resolve_target_maps_missing_agent_and_version(first_scalar: str | None, expected_code: str) -> None:
    session = MagicMock()
    if first_scalar is None:
        session.scalar.return_value = None
    else:
        session.scalar.side_effect = [first_scalar, None]
    service = AgentConfigService()

    with patch(f"{MODULE}.session_factory.create_session", return_value=_session_cm(session)):
        with pytest.raises(AgentConfigServiceError) as exc_info:
            service.resolve_target(
                tenant_id=TENANT,
                agent_id=AGENT,
                config_version_id="missing",
                config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                user_id=USER,
            )

    assert exc_info.value.code == expected_code


def test_push_rejects_non_build_draft_writes() -> None:
    session = MagicMock()
    service = AgentConfigService()

    with (
        patch(f"{MODULE}.session_factory.create_session", return_value=_session_cm(session)),
        patch.object(
            service,
            "_resolve_target_in_session",
            return_value=_target(kind=AgentConfigVersionKind.DRAFT, writable=False),
        ),
    ):
        with pytest.raises(AgentConfigServiceError, match="build drafts") as exc_info:
            service.push(
                tenant_id=TENANT,
                agent_id=AGENT,
                user_id=USER,
                config_version_id="draft-1",
                config_version_kind=AgentConfigVersionKind.DRAFT,
                payload=ConfigPushPayload(note="ignored"),
            )

    assert exc_info.value.code == "config_not_writable"
    session.commit.assert_not_called()


def test_push_for_console_allows_shared_draft_mutations() -> None:
    session = MagicMock()
    service = AgentConfigService()
    target = _target(kind=AgentConfigVersionKind.DRAFT, writable=False, soul=_soul(config_note="before"))

    with (
        patch(f"{MODULE}.session_factory.create_session", return_value=_session_cm(session)),
        patch.object(service, "_resolve_target_in_session", return_value=target),
    ):
        manifest = service.push_for_console(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id="draft-1",
            config_version_kind=AgentConfigVersionKind.DRAFT,
            payload=ConfigPushPayload(note="after"),
        )

    assert manifest["note"] == "after"
    assert target.version.config_snapshot.config_note == "after"
    session.commit.assert_called_once()


def test_push_file_for_console_rejects_snapshot_writes() -> None:
    session = MagicMock()
    service = AgentConfigService()

    with (
        patch(f"{MODULE}.session_factory.create_session", return_value=_session_cm(session)),
        patch.object(
            service,
            "_resolve_target_in_session",
            return_value=_target(kind=AgentConfigVersionKind.SNAPSHOT, writable=False),
        ),
    ):
        with pytest.raises(AgentConfigServiceError, match="editable drafts") as exc_info:
            service.push_file_for_console(
                tenant_id=TENANT,
                agent_id=AGENT,
                user_id=USER,
                config_version_id="snapshot-1",
                config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                upload_file_id="upload-1",
            )

    assert exc_info.value.code == "config_not_writable"


def test_push_file_for_console_uses_service_owned_upload_lookup_and_naming() -> None:
    session = MagicMock()
    service = AgentConfigService()
    target = _target(kind=AgentConfigVersionKind.DRAFT, writable=False)
    upload_file = SimpleNamespace(
        id="upload-1",
        name="guide.txt",
        size=7,
        hash="sha256:abc",
        mime_type="text/plain",
    )

    with (
        patch(f"{MODULE}.session_factory.create_session", return_value=_session_cm(session)),
        patch.object(service, "_resolve_target_in_session", return_value=target),
        patch.object(service, "_require_console_upload_file_source", return_value=upload_file),
    ):
        manifest = service.push_file_for_console(
            tenant_id=TENANT,
            agent_id=AGENT,
            user_id=USER,
            config_version_id="draft-1",
            config_version_kind=AgentConfigVersionKind.DRAFT,
            upload_file_id="upload-1",
        )

    assert manifest["files"] == [
        {
            "name": "guide.txt",
            "size": 7,
            "hash": "sha256:abc",
            "mime_type": "text/plain",
        }
    ]
    session.commit.assert_called_once()


def test_apply_skill_updates_rejects_non_tool_file_refs() -> None:
    service = AgentConfigService()

    with pytest.raises(AgentConfigServiceError, match="tool files") as exc_info:
        service._apply_skill_updates(
            MagicMock(),
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
def test_apply_skill_updates_maps_normalizer_failures(error_code: str, message: str) -> None:
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
                MagicMock(),
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
        b"not-a-zip-archive",
        _zip_bytes({"README.md": b"missing skill md"}),
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

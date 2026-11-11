"""Unit tests for the console agent config inspector routes.

These tests unwrap the Flask decorators and focus on version resolution,
workflow-node agent binding, and service delegation for the new config surface.
"""

from __future__ import annotations

from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.orm import Session

from controllers.console.app import agent_config_inspector as inspector
from controllers.console.app.agent_config_inspector import (
    AgentConfigFileDownloadApi,
    AgentConfigFilePreviewApi,
    AgentConfigFilesApi,
    AgentConfigFilesByAgentApi,
    AgentConfigManifestApi,
    AgentConfigManifestByAgentApi,
    AgentConfigSkillFileDownloadApi,
    AgentConfigSkillFileDownloadByAgentApi,
    AgentConfigSkillFilePreviewByAgentApi,
    AgentConfigSkillInspectByAgentApi,
    AgentConfigSkillsApi,
    AgentConfigSkillUploadByAgentApi,
)
from extensions.storage.storage_type import StorageType
from models.account import Account
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentScope,
    AgentSource,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.enums import CreatorUserRole
from models.model import App, AppMode, UploadFile
from models.workflow import Workflow, WorkflowType
from services.agent_config_service import AgentConfigServiceError
from tests.helpers.unit.controllers.error_body import raised_error

_MOD = "controllers.console.app.agent_config_inspector"
app = Flask(__name__)


def _raw(method):
    return unwrap(method)


_APP = App(
    id="app-1",
    tenant_id="tenant-1",
    name="Agent app",
    description="",
    mode=AppMode.AGENT,
    enable_site=True,
    enable_api=True,
    max_active_requests=0,
)
_APP.bound_agent_id_with_session = lambda *, session: "agent-1"  # type: ignore[method-assign]
_USER = Account(name="User", email="user@example.com")
_USER.id = "acct-1"


def test_resolve_bound_agent_uses_injected_session(unbound_session: Session):
    session = unbound_session
    resolver = MagicMock(return_value="agent-1")
    app_model = App(
        id="app-2",
        tenant_id="tenant-1",
        name="Agent app",
        description="",
        mode=AppMode.AGENT,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
    app_model.bound_agent_id_with_session = resolver  # type: ignore[method-assign]
    result = inspector._resolve_agent_id(session, app_model, None)

    assert result == "agent-1"
    resolver.assert_called_once_with(session=session)
    assert resolver.call_args.kwargs["session"] is session


def test_manifest_by_agent_resolves_build_draft_version(unbound_session: Session):
    raw = _raw(AgentConfigManifestByAgentApi.get)
    with app.test_request_context("/?draft_type=debug_build"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            config_service.return_value.manifest.return_value = {
                "agent_id": "agent-1",
                "config_version": {"id": "build-draft-1", "kind": "build_draft", "writable": True},
                "skills": {"items": []},
                "files": {"items": []},
                "env_keys": [],
                "note": "",
            }
            body = raw(AgentConfigManifestByAgentApi(), unbound_session, "tenant-1", _USER, "agent-1")
    assert body["config_version"]["kind"] == "build_draft"
    assert config_service.return_value.manifest.call_args.kwargs["config_version_id"] == "build-draft-1"
    assert config_service.return_value.manifest.call_args.kwargs["config_version_kind"].value == "build_draft"


def test_manifest_resolves_workflow_node_agent_and_normal_draft(unbound_session: Session):
    raw = _raw(AgentConfigManifestApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentConfigService") as config_service:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.manifest.return_value = {
                "agent_id": "wf-agent-9",
                "config_version": {"id": "draft-1", "kind": "draft", "writable": True},
                "skills": {"items": []},
                "files": {"items": []},
                "env_keys": [],
                "note": "",
            }
            body = raw(AgentConfigManifestApi(), unbound_session, _USER, _APP)
    assert body["agent_id"] == "wf-agent-9"
    assert composer.resolve_workflow_node_agent_id.call_args.kwargs["node_id"] == "node-1"
    assert config_service.return_value.manifest.call_args.kwargs["config_version_kind"].value == "draft"


def test_normal_draft_read_resolution_does_not_commit(sqlite_session: Session) -> None:
    session = sqlite_session
    commits: list[str] = []
    event.listen(session, "after_commit", lambda _session: commits.append("commit"))
    with patch(f"{_MOD}.AgentComposerService") as composer:
        composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
        version_id, version_kind = inspector._resolve_console_version(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="acct-1",
            version_id=None,
            draft_type="draft",
        )
    assert version_id == "draft-1"
    assert version_kind.value == "draft"
    assert commits == []


def test_normal_config_reads_fall_back_to_snapshot_without_creating_draft(unbound_session: Session) -> None:
    with patch(f"{_MOD}.AgentComposerService") as composer:
        composer.load_agent_composer.return_value = {"draft": None, "active_config_snapshot": {"id": "snapshot-1"}}
        version_id, version_kind = inspector._resolve_console_version(
            session=unbound_session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="acct-1",
            version_id=None,
            draft_type="draft",
        )
        composer.prepare_agent_composer_draft.assert_not_called()
    assert version_id == "snapshot-1"
    assert version_kind.value == "snapshot"


def test_stale_inline_config_reads_use_effective_snapshot(unbound_session: Session) -> None:
    with patch(f"{_MOD}.AgentComposerService") as composer:
        composer.load_agent_composer.return_value = {
            "agent": {"scope": "workflow_only"},
            "draft": {"id": "draft-1", "base_snapshot_id": "snapshot-1"},
            "active_config_snapshot": {"id": "snapshot-2"},
        }
        version_id, version_kind = inspector._resolve_console_version(
            session=unbound_session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="acct-1",
            version_id=None,
            draft_type="draft",
        )
        composer.prepare_agent_composer_draft.assert_not_called()
    assert version_id == "snapshot-2"
    assert version_kind.value == "snapshot"


def test_config_write_prepares_draft_before_independent_service_session(sqlite_session: Session) -> None:
    commits: list[str] = []
    event.listen(sqlite_session, "after_commit", lambda _session: commits.append("commit"))
    with app.test_request_context("/", method="POST"), patch(f"{_MOD}.AgentComposerService") as composer:
        composer.prepare_agent_composer_draft.return_value = SimpleNamespace(id="draft-1")
        target = inspector._resolve_target(
            session=sqlite_session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="acct-1",
            version_id=None,
            draft_type="draft",
        )
        composer.prepare_agent_composer_draft.assert_called_once_with(
            session=sqlite_session, tenant_id="tenant-1", agent_id="agent-1", account_id="acct-1"
        )
        composer.load_agent_composer.assert_not_called()
    assert target.version_id == "draft-1"
    assert target.version_kind.value == "draft"
    assert commits == ["commit"]


def test_skill_inspect_by_agent_returns_strict_json_response(unbound_session: Session):
    raw = _raw(AgentConfigSkillInspectByAgentApi.get)
    with app.test_request_context("/"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.inspect_skill.return_value = {
                "id": "pdf-toolkit",
                "name": "pdf-toolkit",
                "description": "Work with PDFs.",
                "size": 42,
                "mime_type": "application/zip",
                "hash": "sha256:abc",
                "source": "config_skill_zip",
                "files": [
                    {"path": "SKILL.md", "name": "SKILL.md", "type": "file", "previewable": True, "downloadable": True}
                ],
                "skill_md": {
                    "path": "SKILL.md",
                    "size": 24,
                    "truncated": False,
                    "binary": False,
                    "text": "# PDF Toolkit\nUse it.\n",
                },
                "warnings": [],
            }
            response = raw(
                AgentConfigSkillInspectByAgentApi(), unbound_session, "tenant-1", _USER, "agent-1", "pdf-toolkit"
            )
    assert response.status_code == 200
    assert response.get_json()["name"] == "pdf-toolkit"
    assert b"PDF Toolkit" in response.get_data()


def test_file_preview_api_passes_through_and_maps_errors(unbound_session: Session):
    raw = _raw(AgentConfigFilePreviewApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentConfigService") as config_service:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.preview_file.return_value = {
                "name": "sample.txt",
                "size": 5,
                "truncated": False,
                "binary": False,
                "text": "hello",
            }
            body = raw(AgentConfigFilePreviewApi(), unbound_session, _USER, _APP, "sample.txt")
    assert body["text"] == "hello"
    with app.test_request_context("/?node_id=node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentConfigService") as config_service:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.preview_file.side_effect = AgentConfigServiceError(
                "config_file_not_found", "missing", status_code=404
            )
            body, status = raised_error(
                lambda: raw(AgentConfigFilePreviewApi(), unbound_session, _USER, _APP, "missing.txt")
            )
    assert status == 404
    assert body["code"] == "config_file_not_found"


def test_skill_upload_by_agent_delegates_after_version_resolution(unbound_session: Session):
    raw = _raw(AgentConfigSkillUploadByAgentApi.post)
    with app.test_request_context("/?draft_type=debug_build"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(
                f"{_MOD}._upload_skill_for_target",
                return_value=(
                    {
                        "skill": {"id": "alpha", "name": "alpha", "file_id": "tool-file-1", "description": "Alpha"},
                        "config_version": {"id": "build-draft-1", "kind": "build_draft", "writable": True},
                    },
                    201,
                ),
            ) as upload_skill,
        ):
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            body, status = raw(AgentConfigSkillUploadByAgentApi(), unbound_session, "tenant-1", _USER, "agent-1")
    assert status == 201
    assert body["skill"]["name"] == "alpha"
    assert upload_skill.call_args.kwargs["version_id"] == "build-draft-1"
    assert upload_skill.call_args.kwargs["version_kind"].value == "build_draft"


def test_file_upload_by_agent_delegates_to_service_owned_upload_lookup(unbound_session: Session):
    raw = _raw(AgentConfigFilesByAgentApi.post)
    with app.test_request_context("/?draft_type=debug_build", json={"upload_file_id": "upload-1"}):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            config_service.return_value.push_file_for_console.return_value = {
                "file": {"id": "guide.txt", "name": "guide.txt", "file_id": "upload-1"},
                "config_version": {"id": "build-draft-1", "kind": "build_draft", "writable": True},
            }
            body, status = raw(
                AgentConfigFilesByAgentApi(),
                inspector.AgentConfigFileUploadPayload(upload_file_id="upload-1"),
                unbound_session,
                "tenant-1",
                _USER,
                "agent-1",
            )
    assert status == 201
    assert body["file"]["name"] == "guide.txt"
    assert config_service.return_value.push_file_for_console.call_args.kwargs["upload_file_id"] == "upload-1"
    assert config_service.return_value.push_file_for_console.call_args.kwargs["config_version_id"] == "build-draft-1"
    assert (
        config_service.return_value.push_file_for_console.call_args.kwargs["config_version_kind"].value == "build_draft"
    )


def test_skill_list_api_uses_config_list_shape(unbound_session: Session) -> None:
    raw = _raw(AgentConfigSkillsApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentConfigService") as config_service:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.list_skills.return_value = {
                "agent_id": "wf-agent-9",
                "config_version": {"id": "draft-1", "kind": "draft", "writable": True},
                "items": [{"id": "alpha", "name": "alpha", "file_id": "tool-file-1", "description": "Alpha"}],
            }
            body = raw(AgentConfigSkillsApi(), unbound_session, _USER, _APP)
    assert body["items"][0]["name"] == "alpha"
    assert body["items"][0]["file_id"] == "tool-file-1"
    assert config_service.return_value.list_skills.call_args.kwargs["agent_id"] == "wf-agent-9"


def test_file_list_api_uses_config_list_shape(unbound_session: Session) -> None:
    raw = _raw(AgentConfigFilesApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentConfigService") as config_service:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.list_files.return_value = {
                "agent_id": "wf-agent-9",
                "config_version": {"id": "draft-1", "kind": "draft", "writable": True},
                "items": [
                    {
                        "id": "guide.txt",
                        "name": "guide.txt",
                        "file_id": "upload-file-1",
                        "hash": "sha256:file-1",
                        "mime_type": "text/plain",
                        "size": 7,
                    }
                ],
            }
            body = raw(AgentConfigFilesApi(), unbound_session, _USER, _APP)
    assert body == {
        "agent_id": "wf-agent-9",
        "config_version": {"id": "draft-1", "kind": "draft", "writable": True},
        "items": [
            {
                "id": "guide.txt",
                "name": "guide.txt",
                "file_id": "upload-file-1",
                "hash": "sha256:file-1",
                "mime_type": "text/plain",
                "size": 7,
            }
        ],
    }
    assert config_service.return_value.list_files.call_args.kwargs["agent_id"] == "wf-agent-9"


def test_skill_file_preview_by_agent_reads_path_query(unbound_session: Session) -> None:
    raw = _raw(AgentConfigSkillFilePreviewByAgentApi.get)
    with app.test_request_context("/?draft_type=debug_build&path=references/guide.md"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            config_service.return_value.preview_skill_file.return_value = {
                "path": "references/guide.md",
                "size": 11,
                "truncated": False,
                "binary": False,
                "text": "hello world",
            }
            body = raw(AgentConfigSkillFilePreviewByAgentApi(), unbound_session, "tenant-1", _USER, "agent-1", "alpha")
    assert body["path"] == "references/guide.md"
    assert config_service.return_value.preview_skill_file.call_args.kwargs["path"] == "references/guide.md"


def test_skill_file_download_by_agent_returns_proxy_url(unbound_session: Session) -> None:
    raw = _raw(AgentConfigSkillFileDownloadByAgentApi.get)
    with app.test_request_context("/?draft_type=debug_build&path=references/guide.md"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
            patch(
                f"{_MOD}.url_for",
                return_value="/console/api/agent/agent-1/config/skills/alpha/files/content?path=references%2Fguide.md&draft_type=debug_build",
            ),
        ):
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            config_service.return_value.resolve_skill_file_member_path.return_value = "references/guide.md"
            response = raw(
                AgentConfigSkillFileDownloadByAgentApi(), unbound_session, "tenant-1", _USER, "agent-1", "alpha"
            )
    assert response.status_code == 200
    assert response.get_json()["url"].endswith(
        "/agent/agent-1/config/skills/alpha/files/content?path=references%2Fguide.md&draft_type=debug_build"
    )


def test_skill_file_download_by_agent_validates_member_path(unbound_session: Session) -> None:
    raw = _raw(AgentConfigSkillFileDownloadByAgentApi.get)
    with app.test_request_context("/?draft_type=debug_build&path=references/missing.md"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            config_service.return_value.resolve_skill_file_member_path.side_effect = AgentConfigServiceError(
                "config_skill_file_not_found", "missing", status_code=404
            )
            body, status = raised_error(
                lambda: raw(
                    AgentConfigSkillFileDownloadByAgentApi(), unbound_session, "tenant-1", _USER, "agent-1", "alpha"
                )
            )
    assert status == 404
    assert body["code"] == "config_skill_file_not_found"


def test_skill_file_download_api_forwards_workflow_node_and_draft_type(unbound_session: Session) -> None:
    raw = _raw(AgentConfigSkillFileDownloadApi.get)
    with app.test_request_context("/?node_id=node-1&draft_type=debug_build&path=references/guide.md"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
            patch(
                f"{_MOD}.url_for",
                return_value="/console/api/apps/app-1/agent/config/skills/alpha/files/content?node_id=node-1&draft_type=debug_build&path=references%2Fguide.md",
            ) as url_for_mock,
        ):
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            config_service.return_value.resolve_skill_file_member_path.return_value = "references/guide.md"
            response = raw(AgentConfigSkillFileDownloadApi(), unbound_session, _USER, _APP, "alpha")
    assert response.status_code == 200
    assert response.get_json()["url"].endswith(
        "/apps/app-1/agent/config/skills/alpha/files/content?node_id=node-1&draft_type=debug_build&path=references%2Fguide.md"
    )
    assert url_for_mock.call_args.kwargs == {
        "_external": False,
        "app_id": "app-1",
        "draft_type": "debug_build",
        "name": "alpha",
        "node_id": "node-1",
        "path": "references/guide.md",
    }


def test_skill_file_download_api_propagates_member_lookup_404s(unbound_session: Session) -> None:
    raw = _raw(AgentConfigSkillFileDownloadApi.get)
    with app.test_request_context("/?node_id=node-1&path=references/missing.md"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentConfigService") as config_service:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.resolve_skill_file_member_path.side_effect = AgentConfigServiceError(
                "config_skill_file_not_found", "missing", status_code=404
            )
            body, status = raised_error(
                lambda: raw(AgentConfigSkillFileDownloadApi(), unbound_session, _USER, _APP, "alpha")
            )
    assert status == 404
    assert body["code"] == "config_skill_file_not_found"


def test_file_download_api_returns_signed_url_json(unbound_session: Session) -> None:
    raw = _raw(AgentConfigFileDownloadApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentConfigService") as config_service:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.download_file_url.return_value = "https://example.com/guide.txt"
            response = raw(AgentConfigFileDownloadApi(), unbound_session, _USER, _APP, "guide.txt")
    assert response.status_code == 200
    assert response.get_json() == {"url": "https://example.com/guide.txt"}


@pytest.mark.parametrize("upload_ids", [[], ["invalid-uuid"]])
def test_batch_file_upload_payload_requires_nonempty_uuid_list(upload_ids: list[str]) -> None:
    with pytest.raises(ValidationError):
        inspector.AgentConfigFilesUploadPayload.model_validate({"upload_file_ids": upload_ids})


@pytest.mark.parametrize("workflow_node", [False, True])
def test_batch_file_upload_routes_bind_and_serialize_real_workspace_files(
    sqlite_session: Session, workflow_node: bool
) -> None:
    tenant_id = "11111111-1111-1111-1111-111111111111"
    agent_id = "22222222-2222-2222-2222-222222222222"
    app_id = "33333333-3333-3333-3333-333333333333"
    account_id = "44444444-4444-4444-4444-444444444444"
    draft_id = "55555555-5555-5555-5555-555555555555"
    file_id = "66666666-6666-6666-6666-666666666666"
    workflow_id = "77777777-7777-7777-7777-777777777777"
    user = Account(name="Batch uploader", email="batch@example.com")
    user.id = account_id
    app_model = App(
        id=app_id,
        tenant_id=tenant_id,
        name="Batch app",
        description="",
        mode=AppMode.WORKFLOW if workflow_node else AppMode.AGENT,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
    agent = Agent(
        id=agent_id,
        tenant_id=tenant_id,
        app_id=app_id,
        name="Batch agent",
        scope=AgentScope.WORKFLOW_ONLY if workflow_node else AgentScope.ROSTER,
        source=AgentSource.WORKFLOW if workflow_node else AgentSource.AGENT_APP,
    )
    draft = AgentConfigDraft(
        id=draft_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        draft_type=AgentConfigDraftType.DRAFT,
        config_snapshot=AgentSoulConfig(),
    )
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="uploads/batch.txt",
        name="batch.txt",
        size=5,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=datetime(2025, 1, 1),
        used=False,
    )
    upload.id = file_id
    sqlite_session.add_all([app_model, agent, draft, upload])
    if workflow_node:
        sqlite_session.add(
            Workflow(
                id=workflow_id,
                tenant_id=tenant_id,
                app_id=app_id,
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph="{}",
                _features="{}",
                created_by=account_id,
            )
        )
        sqlite_session.add(
            WorkflowAgentNodeBinding(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_version="draft",
                node_id="node-1",
                binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                agent_id=agent_id,
                node_job_config=WorkflowNodeJobConfig(),
            )
        )
    sqlite_session.commit()
    payload = inspector.AgentConfigFilesUploadPayload(upload_file_ids=[UUID(file_id)])
    query = "/?node_id=node-1&draft_type=draft" if workflow_node else "/?draft_type=draft"
    with app.test_request_context(query, method="POST"):
        if workflow_node:
            endpoint = inspector.AgentConfigFilesUploadApi()
            body, status = _raw(endpoint.post)(endpoint, payload, sqlite_session, user, app_model)
        else:
            endpoint = inspector.AgentConfigFilesUploadByAgentApi()
            body, status = _raw(endpoint.post)(endpoint, payload, sqlite_session, tenant_id, user, UUID(agent_id))

    assert status == 201
    assert body["files"] == [
        {
            "id": "batch.txt",
            "name": "batch.txt",
            "file_id": file_id,
            "is_missing": False,
            "size": 5,
            "mime_type": "text/plain",
            "hash": None,
        }
    ]
    assert body["config_version"] == {"id": draft_id, "kind": "draft", "writable": True}
    sqlite_session.expire_all()
    persisted = sqlite_session.get(AgentConfigDraft, draft_id)
    assert persisted is not None
    assert [file_ref.file_id for file_ref in persisted.config_snapshot.config_files] == [file_id]

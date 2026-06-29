"""Unit tests for the console agent config inspector routes.

These tests unwrap the Flask decorators and focus on version resolution,
workflow-node agent binding, and service delegation for the new config surface.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

from flask import Flask

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
    console_ns,
)
from services.agent_config_service import AgentConfigServiceError

_MOD = "controllers.console.app.agent_config_inspector"
app = Flask(__name__)


def _raw(method):
    return inspect.unwrap(method)


_APP = SimpleNamespace(id="app-1", tenant_id="tenant-1", bound_agent_id="agent-1")
_USER = SimpleNamespace(id="acct-1")


def test_manifest_by_agent_resolves_build_draft_version():
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
            body = raw(AgentConfigManifestByAgentApi(), "tenant-1", _USER, "agent-1")

    assert body["config_version"]["kind"] == "build_draft"
    assert config_service.return_value.manifest.call_args.kwargs["config_version_id"] == "build-draft-1"
    assert config_service.return_value.manifest.call_args.kwargs["config_version_kind"].value == "build_draft"


def test_manifest_resolves_workflow_node_agent_and_normal_draft():
    raw = _raw(AgentConfigManifestApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
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
            body = raw(AgentConfigManifestApi(), _USER, _APP)

    assert body["agent_id"] == "wf-agent-9"
    assert composer.resolve_workflow_node_agent_id.call_args.kwargs["node_id"] == "node-1"
    assert config_service.return_value.manifest.call_args.kwargs["config_version_kind"].value == "draft"


def test_normal_draft_resolution_commits_created_draft_before_service_session() -> None:
    with (
        patch(f"{_MOD}.AgentComposerService") as composer,
        patch(f"{_MOD}.db") as db,
    ):
        composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}

        version_id, version_kind = inspector._resolve_console_version(
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="acct-1",
            version_id=None,
            draft_type="draft",
        )

    assert version_id == "draft-1"
    assert version_kind.value == "draft"
    db.session.commit.assert_called_once()


def test_skill_inspect_by_agent_returns_strict_json_response():
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
                    {
                        "path": "SKILL.md",
                        "name": "SKILL.md",
                        "type": "file",
                        "previewable": True,
                        "downloadable": True,
                    }
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
            response = raw(AgentConfigSkillInspectByAgentApi(), "tenant-1", _USER, "agent-1", "pdf-toolkit")

    assert response.status_code == 200
    assert response.get_json()["name"] == "pdf-toolkit"
    assert b"PDF Toolkit" in response.get_data()


def test_file_preview_api_passes_through_and_maps_errors():
    raw = _raw(AgentConfigFilePreviewApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.preview_file.return_value = {
                "name": "sample.txt",
                "size": 5,
                "truncated": False,
                "binary": False,
                "text": "hello",
            }
            body = raw(AgentConfigFilePreviewApi(), _USER, _APP, "sample.txt")
    assert body["text"] == "hello"

    with app.test_request_context("/?node_id=node-1"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.preview_file.side_effect = AgentConfigServiceError(
                "config_file_not_found", "missing", status_code=404
            )
            body, status = raw(AgentConfigFilePreviewApi(), _USER, _APP, "missing.txt")
    assert status == 404
    assert body["code"] == "config_file_not_found"


def test_skill_upload_by_agent_delegates_after_version_resolution():
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
            body, status = raw(AgentConfigSkillUploadByAgentApi(), "tenant-1", _USER, "agent-1")

    assert status == 201
    assert body["skill"]["name"] == "alpha"
    assert upload_skill.call_args.kwargs["version_id"] == "build-draft-1"
    assert upload_skill.call_args.kwargs["version_kind"].value == "build_draft"


def test_file_upload_by_agent_delegates_to_service_owned_upload_lookup():
    raw = _raw(AgentConfigFilesByAgentApi.post)
    with app.test_request_context("/?draft_type=debug_build"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value={"upload_file_id": "upload-1"},
            ),
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            config_service.return_value.push_file_for_console.return_value = {
                "file": {"id": "guide.txt", "name": "guide.txt", "file_id": "upload-1"},
                "config_version": {"id": "build-draft-1", "kind": "build_draft", "writable": True},
            }
            body, status = raw(AgentConfigFilesByAgentApi(), "tenant-1", _USER, "agent-1")

    assert status == 201
    assert body["file"]["name"] == "guide.txt"
    assert config_service.return_value.push_file_for_console.call_args.kwargs["upload_file_id"] == "upload-1"
    assert config_service.return_value.push_file_for_console.call_args.kwargs["config_version_id"] == "build-draft-1"
    assert (
        config_service.return_value.push_file_for_console.call_args.kwargs["config_version_kind"].value == "build_draft"
    )


def test_skill_list_api_uses_config_list_shape() -> None:
    raw = _raw(AgentConfigSkillsApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.list_skills.return_value = {
                "agent_id": "wf-agent-9",
                "config_version": {"id": "draft-1", "kind": "draft", "writable": True},
                "items": [{"id": "alpha", "name": "alpha", "file_id": "tool-file-1", "description": "Alpha"}],
            }
            body = raw(AgentConfigSkillsApi(), _USER, _APP)

    assert body["items"][0]["name"] == "alpha"
    assert body["items"][0]["file_id"] == "tool-file-1"
    assert config_service.return_value.list_skills.call_args.kwargs["agent_id"] == "wf-agent-9"


def test_file_list_api_uses_config_list_shape() -> None:
    raw = _raw(AgentConfigFilesApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
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
            body = raw(AgentConfigFilesApi(), _USER, _APP)

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


def test_skill_file_preview_by_agent_reads_path_query() -> None:
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
            body = raw(AgentConfigSkillFilePreviewByAgentApi(), "tenant-1", _USER, "agent-1", "alpha")

    assert body["path"] == "references/guide.md"
    assert config_service.return_value.preview_skill_file.call_args.kwargs["path"] == "references/guide.md"


def test_skill_file_download_by_agent_returns_proxy_url() -> None:
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
            response = raw(AgentConfigSkillFileDownloadByAgentApi(), "tenant-1", _USER, "agent-1", "alpha")

    assert response.status_code == 200
    assert response.get_json()["url"].endswith(
        "/agent/agent-1/config/skills/alpha/files/content?path=references%2Fguide.md&draft_type=debug_build"
    )


def test_skill_file_download_by_agent_validates_member_path() -> None:
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
            body, status = raw(AgentConfigSkillFileDownloadByAgentApi(), "tenant-1", _USER, "agent-1", "alpha")

    assert status == 404
    assert body["code"] == "config_skill_file_not_found"


def test_skill_file_download_api_forwards_workflow_node_and_draft_type() -> None:
    raw = _raw(AgentConfigSkillFileDownloadApi.get)
    with app.test_request_context("/?node_id=node-1&draft_type=debug_build&path=references/guide.md"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
            patch(
                f"{_MOD}.url_for",
                return_value=(
                    "/console/api/apps/app-1/agent/config/skills/alpha/files/content"
                    "?node_id=node-1&draft_type=debug_build&path=references%2Fguide.md"
                ),
            ) as url_for_mock,
        ):
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            config_service.return_value.resolve_skill_file_member_path.return_value = "references/guide.md"
            response = raw(AgentConfigSkillFileDownloadApi(), _USER, _APP, "alpha")

    assert response.status_code == 200
    assert response.get_json()["url"].endswith(
        "/apps/app-1/agent/config/skills/alpha/files/content"
        "?node_id=node-1&draft_type=debug_build&path=references%2Fguide.md"
    )
    assert url_for_mock.call_args.kwargs == {
        "_external": False,
        "app_id": "app-1",
        "draft_type": "debug_build",
        "name": "alpha",
        "node_id": "node-1",
        "path": "references/guide.md",
    }


def test_skill_file_download_api_propagates_member_lookup_404s() -> None:
    raw = _raw(AgentConfigSkillFileDownloadApi.get)
    with app.test_request_context("/?node_id=node-1&path=references/missing.md"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.resolve_skill_file_member_path.side_effect = AgentConfigServiceError(
                "config_skill_file_not_found", "missing", status_code=404
            )
            body, status = raw(AgentConfigSkillFileDownloadApi(), _USER, _APP, "alpha")

    assert status == 404
    assert body["code"] == "config_skill_file_not_found"


def test_file_download_api_returns_signed_url_json() -> None:
    raw = _raw(AgentConfigFileDownloadApi.get)
    with app.test_request_context("/?node_id=node-1"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentConfigService") as config_service,
        ):
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            composer.load_agent_composer.return_value = {"draft": {"id": "draft-1"}}
            config_service.return_value.download_file_url.return_value = "https://example.com/guide.txt"
            response = raw(AgentConfigFileDownloadApi(), _USER, _APP, "guide.txt")

    assert response.status_code == 200
    assert response.get_json() == {"url": "https://example.com/guide.txt"}

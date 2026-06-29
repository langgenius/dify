"""Unit tests for the console agent config inspector routes.

These tests unwrap the Flask decorators and focus on version resolution,
workflow-node agent binding, and service delegation for the new config surface.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import PropertyMock, patch

from flask import Flask

from controllers.console.app.agent_config_inspector import (
    AgentConfigFilePreviewApi,
    AgentConfigFilesByAgentApi,
    AgentConfigManifestApi,
    AgentConfigManifestByAgentApi,
    AgentConfigSkillInspectByAgentApi,
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
                "skills": [],
                "files": [],
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
                "config_version": {"id": "draft-1", "kind": "draft", "writable": False},
                "skills": [],
                "files": [],
                "env_keys": [],
                "note": "",
            }
            body = raw(AgentConfigManifestApi(), _USER, _APP)

    assert body["agent_id"] == "wf-agent-9"
    assert composer.resolve_workflow_node_agent_id.call_args.kwargs["node_id"] == "node-1"
    assert config_service.return_value.manifest.call_args.kwargs["config_version_kind"].value == "draft"


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
                "name": "pdf-toolkit",
                "description": "Work with PDFs.",
                "files": ["SKILL.md", "refs/spec.md"],
                "skill_md": "# PDF Toolkit\nUse it.\n",
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
                "key": "sample.txt",
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
            patch(f"{_MOD}._upload_skill_for_target", return_value=({"result": "ok"}, 201)) as upload_skill,
        ):
            composer.load_agent_app_build_draft.return_value = {"draft": {"id": "build-draft-1"}}
            body, status = raw(AgentConfigSkillUploadByAgentApi(), "tenant-1", _USER, "agent-1")

    assert status == 201
    assert body == {"result": "ok"}
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
            config_service.return_value.push_file_for_console.return_value = {"result": "ok"}
            body, status = raw(AgentConfigFilesByAgentApi(), "tenant-1", _USER, "agent-1")

    assert status == 201
    assert body == {"result": "ok"}
    assert config_service.return_value.push_file_for_console.call_args.kwargs["upload_file_id"] == "upload-1"
    assert config_service.return_value.push_file_for_console.call_args.kwargs["config_version_id"] == "build-draft-1"
    assert (
        config_service.return_value.push_file_for_console.call_args.kwargs["config_version_kind"].value == "build_draft"
    )

"""Unit tests for the console agent drive inspector (ENG-624).

Handlers are unwrapped past the login/app-model decorators and invoked inside a
bare Flask request context with the drive service mocked — covering agent
resolution, query handling, and error mapping, not auth.
"""

from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

from controllers.console.app import agent_drive_inspector as inspector
from controllers.console.app.agent_drive_inspector import (
    AgentDriveDownloadApi,
    AgentDriveDownloadByAgentApi,
    AgentDriveListApi,
    AgentDriveListByAgentApi,
    AgentDrivePreviewApi,
    AgentDrivePreviewByAgentApi,
    AgentDriveSkillInspectApi,
    AgentDriveSkillInspectByAgentApi,
    AgentDriveSkillListApi,
    AgentDriveSkillListByAgentApi,
)
from services.agent_drive_service import AgentDriveError

_MOD = "controllers.console.app.agent_drive_inspector"
app = Flask(__name__)


def _raw(method):
    return unwrap(method)


_APP = SimpleNamespace(
    id="app-1",
    tenant_id="tenant-1",
    bound_agent_id_with_session=lambda *, session: "agent-1",
)


def test_resolve_bound_agent_uses_injected_session():
    session = MagicMock()
    resolver = MagicMock(return_value="agent-1")
    app_model = SimpleNamespace(bound_agent_id_with_session=resolver)
    result = inspector._resolve_agent_id(session, app_model, None)

    assert result == "agent-1"
    resolver.assert_called_once_with(session=session)
    assert resolver.call_args.kwargs["session"] is session


def test_list_filters_value_pointers_out_of_console_payload():
    raw = _raw(AgentDriveListApi.get)
    with app.test_request_context("/?prefix=pdf-toolkit/"):
        with patch(f"{_MOD}.AgentDriveService") as drive:
            drive.return_value.manifest.return_value = [
                {
                    "key": "pdf-toolkit/SKILL.md",
                    "size": 5,
                    "hash": "h",
                    "mime_type": "text/markdown",
                    "file_kind": "tool_file",
                    "file_id": "tf-1",
                    "created_at": 1718000000,
                }
            ]
            body = raw(AgentDriveListApi(), MagicMock(), _APP)
    assert body["items"][0]["key"] == "pdf-toolkit/SKILL.md"
    assert "file_id" not in body["items"][0]
    assert drive.return_value.manifest.call_args.kwargs["prefix"] == "pdf-toolkit/"


def test_list_by_agent_filters_value_pointers_out_of_console_payload():
    raw = _raw(AgentDriveListByAgentApi.get)
    session = MagicMock()
    with app.test_request_context("/?prefix=pdf-toolkit/"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            drive.return_value.manifest.return_value = [
                {
                    "key": "pdf-toolkit/SKILL.md",
                    "size": 5,
                    "hash": "h",
                    "mime_type": "text/markdown",
                    "file_kind": "tool_file",
                    "file_id": "tf-1",
                    "created_at": 1718000000,
                }
            ]
            body = raw(AgentDriveListByAgentApi(), session, "tenant-1", "agent-1")
    assert body["items"][0]["key"] == "pdf-toolkit/SKILL.md"
    assert "file_id" not in body["items"][0]
    resolve_app.assert_called_once_with(session=session, tenant_id="tenant-1", agent_id="agent-1")
    assert drive.return_value.manifest.call_args.kwargs["agent_id"] == "agent-1"
    assert drive.return_value.manifest.call_args.kwargs["session"] is session


def test_list_resolves_workflow_node_binding_agent():
    raw = _raw(AgentDriveListApi.get)
    with app.test_request_context("/?node_id=agent-node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentDriveService") as drive:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            drive.return_value.manifest.return_value = []
            raw(AgentDriveListApi(), MagicMock(), _APP)
    assert drive.return_value.manifest.call_args.kwargs["agent_id"] == "wf-agent-9"
    assert composer.resolve_workflow_node_agent_id.call_args.kwargs["node_id"] == "agent-node-1"


def test_skill_list_by_agent_calls_service():
    raw = _raw(AgentDriveSkillListByAgentApi.get)
    session = MagicMock()
    with app.test_request_context("/"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            drive.return_value.list_skills.return_value = [
                {
                    "path": "pdf-toolkit",
                    "skill_md_key": "pdf-toolkit/SKILL.md",
                    "archive_key": "pdf-toolkit/.DIFY-SKILL-FULL.zip",
                    "name": "PDF Toolkit",
                    "description": "Work with PDFs.",
                    "size": 5,
                    "mime_type": "text/markdown",
                    "hash": None,
                    "created_at": 1718000000,
                }
            ]
            body = raw(AgentDriveSkillListByAgentApi(), session, "tenant-1", "agent-1")
    assert body["items"][0]["path"] == "pdf-toolkit"
    resolve_app.assert_called_once_with(session=session, tenant_id="tenant-1", agent_id="agent-1")
    assert drive.return_value.list_skills.call_args.kwargs["agent_id"] == "agent-1"
    assert drive.return_value.list_skills.call_args.kwargs["session"] is session


def test_skill_list_resolves_workflow_node_binding_agent():
    raw = _raw(AgentDriveSkillListApi.get)
    with app.test_request_context("/?node_id=agent-node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentDriveService") as drive:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            drive.return_value.list_skills.return_value = []
            body = raw(AgentDriveSkillListApi(), MagicMock(), _APP)
    assert body == {"items": []}
    assert drive.return_value.list_skills.call_args.kwargs["agent_id"] == "wf-agent-9"


def test_skill_inspect_by_agent_returns_strict_json_response():
    raw = _raw(AgentDriveSkillInspectByAgentApi.get)
    session = MagicMock()
    payload = {
        "path": "pdf-toolkit",
        "skill_md_key": "pdf-toolkit/SKILL.md",
        "archive_key": "pdf-toolkit/.DIFY-SKILL-FULL.zip",
        "name": "PDF Toolkit",
        "description": "Work with PDFs.",
        "size": 5,
        "mime_type": "text/markdown",
        "hash": None,
        "created_at": 1718000000,
        "source": "skill_md",
        "files": [
            {
                "path": "SKILL.md",
                "name": "SKILL.md",
                "type": "file",
                "drive_key": "pdf-toolkit/SKILL.md",
                "available_in_drive": True,
            }
        ],
        "file_tree": [],
        "skill_md": {
            "key": "pdf-toolkit/SKILL.md",
            "size": 5,
            "truncated": False,
            "binary": False,
            "text": "# PDF Toolkit\nUse it.\n",
        },
        "warnings": [],
    }
    with app.test_request_context("/"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            drive.return_value.inspect_skill.return_value = payload
            response = raw(AgentDriveSkillInspectByAgentApi(), session, "tenant-1", "agent-1", "pdf-toolkit")
    assert response.status_code == 200
    assert response.get_json()["skill_md"]["text"] == "# PDF Toolkit\nUse it.\n"
    assert b"# PDF Toolkit\\nUse it.\\n" in response.get_data()
    assert drive.return_value.inspect_skill.call_args.kwargs["session"] is session


def test_skill_inspect_resolves_workflow_node_binding_agent():
    raw = _raw(AgentDriveSkillInspectApi.get)
    payload = {
        "path": "pdf-toolkit",
        "skill_md_key": "pdf-toolkit/SKILL.md",
        "archive_key": None,
        "name": "PDF Toolkit",
        "description": "",
        "size": 5,
        "mime_type": "text/markdown",
        "hash": None,
        "created_at": None,
        "source": "skill_md",
        "files": [],
        "file_tree": [],
        "skill_md": {"key": "pdf-toolkit/SKILL.md", "size": 5, "truncated": False, "binary": False, "text": "# hi"},
        "warnings": [],
    }
    with app.test_request_context("/?node_id=agent-node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentDriveService") as drive:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            drive.return_value.inspect_skill.return_value = payload
            response = raw(AgentDriveSkillInspectApi(), MagicMock(), _APP, "pdf-toolkit")
    assert response.get_json()["path"] == "pdf-toolkit"
    assert drive.return_value.inspect_skill.call_args.kwargs["agent_id"] == "wf-agent-9"


def test_list_400_when_no_agent_bound():
    raw = _raw(AgentDriveListApi.get)
    resolver = MagicMock(return_value=None)
    app_without_agent = SimpleNamespace(bound_agent_id_with_session=resolver)
    session = MagicMock()
    with app.test_request_context("/"):
        body, status = raw(AgentDriveListApi(), session, app_without_agent)
    assert status == 400
    assert body["code"] == "agent_not_bound"
    resolver.assert_called_once_with(session=session)


def test_preview_passes_through_and_maps_errors():
    raw = _raw(AgentDrivePreviewApi.get)
    with app.test_request_context("/?key=pdf-toolkit/SKILL.md"):
        with patch(f"{_MOD}.AgentDriveService") as drive:
            drive.return_value.preview.return_value = {
                "key": "pdf-toolkit/SKILL.md",
                "size": 5,
                "truncated": False,
                "binary": False,
                "text": "# hi",
            }
            body = raw(AgentDrivePreviewApi(), MagicMock(), _APP)
    assert body["text"] == "# hi"
    with app.test_request_context("/?key=ghost/SKILL.md"):
        with patch(f"{_MOD}.AgentDriveService") as drive:
            drive.return_value.preview.side_effect = AgentDriveError(
                "drive_key_not_found", "no drive entry", status_code=404
            )
            body, status = raw(AgentDrivePreviewApi(), MagicMock(), _APP)
    assert status == 404
    assert body["code"] == "drive_key_not_found"


def test_preview_by_agent_passes_through_and_maps_errors():
    raw = _raw(AgentDrivePreviewByAgentApi.get)
    session = MagicMock()
    with app.test_request_context("/?key=pdf-toolkit/SKILL.md"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            drive.return_value.preview.return_value = {
                "key": "pdf-toolkit/SKILL.md",
                "size": 5,
                "truncated": False,
                "binary": False,
                "text": "# hi",
            }
            body = raw(AgentDrivePreviewByAgentApi(), session, "tenant-1", "agent-1")
    assert body["text"] == "# hi"
    resolve_app.assert_called_once_with(session=session, tenant_id="tenant-1", agent_id="agent-1")
    assert drive.return_value.preview.call_args.kwargs["session"] is session
    with app.test_request_context("/?key=ghost/SKILL.md"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            drive.return_value.preview.side_effect = AgentDriveError(
                "drive_key_not_found", "no drive entry", status_code=404
            )
            body, status = raw(AgentDrivePreviewByAgentApi(), session, "tenant-1", "agent-1")
    assert status == 404
    assert body["code"] == "drive_key_not_found"


def test_download_returns_signed_url_json():
    raw = _raw(AgentDriveDownloadApi.get)
    with app.test_request_context("/?key=pdf-toolkit/.DIFY-SKILL-FULL.zip"):
        with patch(f"{_MOD}.AgentDriveService") as drive:
            drive.return_value.download_url.return_value = "https://signed.example/zip"
            body = raw(AgentDriveDownloadApi(), MagicMock(), _APP)
    assert body == {"url": "https://signed.example/zip"}


def test_download_by_agent_returns_signed_url_json():
    raw = _raw(AgentDriveDownloadByAgentApi.get)
    session = MagicMock()
    with app.test_request_context("/?key=pdf-toolkit/.DIFY-SKILL-FULL.zip"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            drive.return_value.download_url.return_value = "https://signed.example/zip"
            body = raw(AgentDriveDownloadByAgentApi(), session, "tenant-1", "agent-1")
    assert body == {"url": "https://signed.example/zip"}
    resolve_app.assert_called_once_with(session=session, tenant_id="tenant-1", agent_id="agent-1")
    assert drive.return_value.download_url.call_args.kwargs["session"] is session

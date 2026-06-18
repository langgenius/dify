"""Unit tests for the console agent drive inspector (ENG-624).

Handlers are unwrapped past the login/app-model decorators and invoked inside a
bare Flask request context with the drive service mocked — covering agent
resolution, query handling, and error mapping, not auth.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from controllers.console.app.agent_drive_inspector import (
    AgentDriveDownloadApi,
    AgentDriveDownloadByAgentApi,
    AgentDriveListApi,
    AgentDriveListByAgentApi,
    AgentDrivePreviewApi,
    AgentDrivePreviewByAgentApi,
)
from services.agent_drive_service import AgentDriveError

_MOD = "controllers.console.app.agent_drive_inspector"
app = Flask(__name__)


def _raw(method):
    return inspect.unwrap(method)


_APP = SimpleNamespace(id="app-1", tenant_id="tenant-1", bound_agent_id="agent-1")


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
            body = raw(AgentDriveListApi(), _APP)

    assert body["items"][0]["key"] == "pdf-toolkit/SKILL.md"
    assert "file_id" not in body["items"][0]
    assert drive.return_value.manifest.call_args.kwargs["prefix"] == "pdf-toolkit/"


def test_list_by_agent_filters_value_pointers_out_of_console_payload():
    raw = _raw(AgentDriveListByAgentApi.get)
    with app.test_request_context("/?prefix=pdf-toolkit/"):
        with (
            patch(f"{_MOD}.resolve_agent_app_model", return_value=_APP) as resolve_app,
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
            body = raw(AgentDriveListByAgentApi(), "tenant-1", "agent-1")

    assert body["items"][0]["key"] == "pdf-toolkit/SKILL.md"
    assert "file_id" not in body["items"][0]
    resolve_app.assert_called_once_with(tenant_id="tenant-1", agent_id="agent-1")
    assert drive.return_value.manifest.call_args.kwargs["agent_id"] == "agent-1"


def test_list_resolves_workflow_node_binding_agent():
    raw = _raw(AgentDriveListApi.get)
    with app.test_request_context("/?node_id=agent-node-1"):
        with (
            patch(f"{_MOD}.AgentComposerService") as composer,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-9"
            drive.return_value.manifest.return_value = []
            raw(AgentDriveListApi(), _APP)

    assert drive.return_value.manifest.call_args.kwargs["agent_id"] == "wf-agent-9"
    assert composer.resolve_workflow_node_agent_id.call_args.kwargs["node_id"] == "agent-node-1"


def test_list_400_when_no_agent_bound():
    raw = _raw(AgentDriveListApi.get)
    app_without_agent = SimpleNamespace(id="app-1", tenant_id="tenant-1", bound_agent_id=None)
    with app.test_request_context("/"):
        body, status = raw(AgentDriveListApi(), app_without_agent)
    assert status == 400
    assert body["code"] == "agent_not_bound"


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
            body = raw(AgentDrivePreviewApi(), _APP)
    assert body["text"] == "# hi"

    with app.test_request_context("/?key=ghost/SKILL.md"):
        with patch(f"{_MOD}.AgentDriveService") as drive:
            drive.return_value.preview.side_effect = AgentDriveError(
                "drive_key_not_found", "no drive entry", status_code=404
            )
            body, status = raw(AgentDrivePreviewApi(), _APP)
    assert status == 404
    assert body["code"] == "drive_key_not_found"


def test_preview_by_agent_passes_through_and_maps_errors():
    raw = _raw(AgentDrivePreviewByAgentApi.get)
    with app.test_request_context("/?key=pdf-toolkit/SKILL.md"):
        with (
            patch(f"{_MOD}.resolve_agent_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            drive.return_value.preview.return_value = {
                "key": "pdf-toolkit/SKILL.md",
                "size": 5,
                "truncated": False,
                "binary": False,
                "text": "# hi",
            }
            body = raw(AgentDrivePreviewByAgentApi(), "tenant-1", "agent-1")
    assert body["text"] == "# hi"
    resolve_app.assert_called_once_with(tenant_id="tenant-1", agent_id="agent-1")

    with app.test_request_context("/?key=ghost/SKILL.md"):
        with (
            patch(f"{_MOD}.resolve_agent_app_model", return_value=_APP),
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            drive.return_value.preview.side_effect = AgentDriveError(
                "drive_key_not_found", "no drive entry", status_code=404
            )
            body, status = raw(AgentDrivePreviewByAgentApi(), "tenant-1", "agent-1")
    assert status == 404
    assert body["code"] == "drive_key_not_found"


def test_download_returns_signed_url_json():
    raw = _raw(AgentDriveDownloadApi.get)
    with app.test_request_context("/?key=pdf-toolkit/.DIFY-SKILL-FULL.zip"):
        with patch(f"{_MOD}.AgentDriveService") as drive:
            drive.return_value.download_url.return_value = "https://signed.example/zip"
            body = raw(AgentDriveDownloadApi(), _APP)
    assert body == {"url": "https://signed.example/zip"}


def test_download_by_agent_returns_signed_url_json():
    raw = _raw(AgentDriveDownloadByAgentApi.get)
    with app.test_request_context("/?key=pdf-toolkit/.DIFY-SKILL-FULL.zip"):
        with (
            patch(f"{_MOD}.resolve_agent_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            drive.return_value.download_url.return_value = "https://signed.example/zip"
            body = raw(AgentDriveDownloadByAgentApi(), "tenant-1", "agent-1")
    assert body == {"url": "https://signed.example/zip"}
    resolve_app.assert_called_once_with(tenant_id="tenant-1", agent_id="agent-1")

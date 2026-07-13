"""Unit tests for the agent drive inner-API controller (ENG-591).

Handlers are unwrapped past the auth/setup decorators and invoked inside a bare
Flask request context, with AgentDriveService mocked — so this covers the
controller's request parsing + error mapping, not auth (tested separately).
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import ANY, patch

import pytest
from flask import Flask

from controllers.inner_api.plugin.agent_drive import AgentDriveCommitApi, AgentDriveManifestApi, AgentDriveSkillsApi
from services.agent_drive_service import AgentDriveError

_MOD = "controllers.inner_api.plugin.agent_drive"
app = Flask(__name__)


def _raw(method):
    return inspect.unwrap(method)


def test_manifest_parses_query_and_returns_items():
    raw = _raw(AgentDriveManifestApi.get)
    with app.test_request_context("/?tenant_id=tenant-1&prefix=docs/&include_download_url=true"):
        with patch(f"{_MOD}.AgentDriveService") as svc:
            svc.return_value.manifest.return_value = [{"key": "docs/a.txt"}]
            result = raw(AgentDriveManifestApi(), "agent-agent-1")
    assert result == {"items": [{"key": "docs/a.txt"}]}
    svc.return_value.manifest.assert_called_once_with(
        tenant_id="tenant-1", agent_id="agent-1", prefix="docs/", include_download_url=True, session=ANY
    )


def test_manifest_missing_tenant_id_is_400():
    raw = _raw(AgentDriveManifestApi.get)
    with app.test_request_context("/"):
        body, status = raw(AgentDriveManifestApi(), "agent-agent-1")
    assert status == 400
    assert body["code"] == "missing_tenant_id"


def test_manifest_bad_drive_ref_is_400():
    raw = _raw(AgentDriveManifestApi.get)
    with app.test_request_context("/?tenant_id=tenant-1"):
        body, status = raw(AgentDriveManifestApi(), "not-an-agent-ref")
    assert status == 400
    assert body["code"] == "invalid_drive_ref"


def test_skills_requires_tenant_id_and_returns_items():
    raw = _raw(AgentDriveSkillsApi.get)

    with app.test_request_context("/"):
        body, status = raw(AgentDriveSkillsApi(), "agent-agent-1")
    assert status == 400
    assert body["code"] == "missing_tenant_id"

    with app.test_request_context("/?tenant_id=tenant-1"):
        with patch(f"{_MOD}.AgentDriveService") as svc:
            svc.return_value.list_skills.return_value = [
                {
                    "path": "tender-analyzer",
                    "skill_md_key": "tender-analyzer/SKILL.md",
                    "archive_key": None,
                    "name": "Tender Analyzer",
                    "description": "Parses RFPs.",
                }
            ]
            result = raw(AgentDriveSkillsApi(), "agent-agent-1")

    assert result == {
        "items": [
            {
                "path": "tender-analyzer",
                "skill_md_key": "tender-analyzer/SKILL.md",
                "archive_key": None,
                "name": "Tender Analyzer",
                "description": "Parses RFPs.",
            }
        ]
    }
    assert svc.return_value.list_skills.call_args.kwargs == {
        "tenant_id": "tenant-1",
        "agent_id": "agent-1",
        "session": ANY,
    }


def test_commit_parses_body_and_returns_items():
    raw = _raw(AgentDriveCommitApi.post)
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "items": [{"key": "a.txt", "file_ref": {"kind": "tool_file", "id": "tf-1"}}],
    }
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{_MOD}.get_user", return_value=SimpleNamespace(id="user-1")) as get_user,
            patch(f"{_MOD}.AgentDriveService") as svc,
        ):
            svc.return_value.commit.return_value = [{"key": "a.txt"}]
            result = raw(AgentDriveCommitApi(), "agent-agent-1")
    assert result == {"items": [{"key": "a.txt"}]}
    assert get_user.call_args.args == ("tenant-1", "user-1")
    assert svc.return_value.commit.call_args.kwargs["agent_id"] == "agent-1"
    assert svc.return_value.commit.call_args.kwargs["user_id"] == "user-1"


def test_commit_canonicalizes_user_before_service_call():
    raw = _raw(AgentDriveCommitApi.post)
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "session-1",
        "items": [{"key": "a.txt", "file_ref": {"kind": "tool_file", "id": "tf-1"}}],
    }
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{_MOD}.get_user", return_value=SimpleNamespace(id="end-user-1")),
            patch(f"{_MOD}.AgentDriveService") as svc,
        ):
            svc.return_value.commit.return_value = [{"key": "a.txt"}]
            result = raw(AgentDriveCommitApi(), "agent-agent-1")

    assert result == {"items": [{"key": "a.txt"}]}
    assert svc.return_value.commit.call_args.kwargs["user_id"] == "end-user-1"


def test_commit_invalid_body_is_400():
    raw = _raw(AgentDriveCommitApi.post)
    with app.test_request_context("/", method="POST", json={"tenant_id": "t"}):  # missing user_id/items
        body, status = raw(AgentDriveCommitApi(), "agent-agent-1")
    assert status == 400
    assert body["code"] == "invalid_request"


def test_commit_maps_service_error():
    raw = _raw(AgentDriveCommitApi.post)
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "items": [{"key": "a.txt", "file_ref": {"kind": "tool_file", "id": "tf-1"}}],
    }
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{_MOD}.get_user", return_value=SimpleNamespace(id="user-1")),
            patch(f"{_MOD}.AgentDriveService") as svc,
        ):
            svc.return_value.commit.side_effect = AgentDriveError("source_not_found", "nope", status_code=404)
            body, status = raw(AgentDriveCommitApi(), "agent-agent-1")
    assert status == 404
    assert body["code"] == "source_not_found"


@pytest.mark.parametrize("api_cls", [AgentDriveManifestApi, AgentDriveSkillsApi, AgentDriveCommitApi])
def test_endpoints_have_handlers(api_cls):
    assert callable(getattr(api_cls(), "get", None) or getattr(api_cls(), "post", None))

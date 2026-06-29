"""Unit tests for the Agent config inner-API controller."""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from controllers.inner_api.plugin.agent_config import (
    AgentConfigEnvApi,
    AgentConfigFilePullApi,
    AgentConfigManifestApi,
    AgentConfigNoteApi,
    AgentConfigPushApi,
    AgentConfigSkillInspectApi,
    AgentConfigSkillPullApi,
)
from services.agent_config_service import AgentConfigServiceError

MODULE = "controllers.inner_api.plugin.agent_config"
app = Flask(__name__)


def _raw(method):
    return inspect.unwrap(method)


def test_manifest_happy_path_calls_service() -> None:
    raw = _raw(AgentConfigManifestApi.get)

    with app.test_request_context(
        "/?tenant_id=tenant-1&user_id=user-1&config_version_id=cfg-1&config_version_kind=build_draft"
    ):
        with patch(f"{MODULE}.AgentConfigService") as service:
            service.return_value.manifest.return_value = {
                "agent_id": "agent-1",
                "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": True},
                "skills": {
                    "items": [
                        {
                            "id": "alpha",
                            "name": "alpha",
                            "file_id": "tool-file-1",
                            "description": "Alpha skill",
                            "size": 123,
                            "hash": "sha256:abc",
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
                            "size": 7,
                            "hash": "sha256:def",
                            "mime_type": "text/plain",
                        }
                    ]
                },
                "env_keys": ["KEY"],
                "note": "hello",
            }
            body = raw(AgentConfigManifestApi(), "agent-1")

    assert body == {
        "agent_id": "agent-1",
        "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": True},
        "skills": {
            "items": [
                {
                    "id": "alpha",
                    "name": "alpha",
                    "file_id": "tool-file-1",
                    "description": "Alpha skill",
                    "size": 123,
                    "hash": "sha256:abc",
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
                    "size": 7,
                    "hash": "sha256:def",
                    "mime_type": "text/plain",
                }
            ]
        },
        "env_keys": ["KEY"],
        "note": "hello",
    }
    assert service.return_value.manifest.call_args.kwargs == {
        "tenant_id": "tenant-1",
        "agent_id": "agent-1",
        "user_id": "user-1",
        "config_version_id": "cfg-1",
        "config_version_kind": service.return_value.manifest.call_args.kwargs["config_version_kind"],
    }
    assert service.return_value.manifest.call_args.kwargs["config_version_kind"].value == "build_draft"


def test_skill_pull_returns_send_file_response() -> None:
    raw = _raw(AgentConfigSkillPullApi.get)

    with app.test_request_context(
        "/?tenant_id=tenant-1&user_id=user-1&config_version_id=cfg-1&config_version_kind=build_draft"
    ):
        with patch(f"{MODULE}.AgentConfigService") as service:
            service.return_value.pull_skill.return_value = SimpleNamespace(
                payload=b"zip-bytes",
                mime_type="application/zip",
                filename="alpha.zip",
            )
            response = raw(AgentConfigSkillPullApi(), "agent-1", "alpha")

    response.direct_passthrough = False
    assert response.status_code == 200
    assert response.mimetype == "application/zip"
    assert response.get_data() == b"zip-bytes"
    assert 'filename=alpha.zip' in response.headers["Content-Disposition"]
    assert service.return_value.pull_skill.call_args.kwargs["user_id"] == "user-1"


def test_skill_inspect_happy_path_returns_service_payload() -> None:
    raw = _raw(AgentConfigSkillInspectApi.get)

    with app.test_request_context(
        "/?tenant_id=tenant-1&user_id=user-1&config_version_id=cfg-1&config_version_kind=build_draft"
    ):
        with patch(f"{MODULE}.AgentConfigService") as service:
            service.return_value.inspect_skill.return_value = {"name": "alpha", "files": ["SKILL.md"]}
            body = raw(AgentConfigSkillInspectApi(), "agent-1", "alpha")

    assert body == {"name": "alpha", "files": ["SKILL.md"]}
    assert service.return_value.inspect_skill.call_args.kwargs["user_id"] == "user-1"


def test_file_pull_returns_send_file_response() -> None:
    raw = _raw(AgentConfigFilePullApi.get)

    with app.test_request_context(
        "/?tenant_id=tenant-1&user_id=user-1&config_version_id=cfg-1&config_version_kind=build_draft"
    ):
        with patch(f"{MODULE}.AgentConfigService") as service:
            service.return_value.pull_file.return_value = SimpleNamespace(
                payload=b"file-bytes",
                mime_type="text/plain",
                filename="guide.txt",
            )
            response = raw(AgentConfigFilePullApi(), "agent-1", "guide.txt")

    response.direct_passthrough = False
    assert response.status_code == 200
    assert response.mimetype == "text/plain"
    assert response.get_data() == b"file-bytes"
    assert 'filename=guide.txt' in response.headers["Content-Disposition"]
    assert service.return_value.pull_file.call_args.kwargs["user_id"] == "user-1"


def test_push_happy_path_validates_body_and_preserves_execution_user() -> None:
    raw = _raw(AgentConfigPushApi.post)
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "account-user-1",
        "config_version_id": "cfg-1",
        "config_version_kind": "build_draft",
        "files": [{"name": "guide.txt", "file_ref": {"kind": "tool_file", "id": "tool-file-1"}}],
        "skills": [],
        "env_text": "KEY=value\n",
        "note": "hello",
    }

    with app.test_request_context("/", method="POST", json=payload):
        with patch(f"{MODULE}.AgentConfigService") as service:
            service.return_value.push.return_value = {
                "agent_id": "agent-1",
                "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": True},
                "skills": {"items": []},
                "files": {"items": []},
                "env_keys": ["KEY"],
                "note": "hello",
            }
            body = raw(AgentConfigPushApi(), "agent-1")

    assert body == {
        "agent_id": "agent-1",
        "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": True},
        "skills": {"items": []},
        "files": {"items": []},
        "env_keys": ["KEY"],
        "note": "hello",
    }
    assert service.return_value.push.call_args.kwargs["user_id"] == "account-user-1"
    assert service.return_value.push.call_args.kwargs["config_version_kind"].value == "build_draft"


def test_env_happy_path_calls_service() -> None:
    raw = _raw(AgentConfigEnvApi.patch)
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "account-user-1",
        "config_version_id": "cfg-1",
        "config_version_kind": "build_draft",
        "env_text": "KEY=value\n",
    }

    with app.test_request_context("/", method="PATCH", json=payload):
        with patch(f"{MODULE}.AgentConfigService") as service:
            service.return_value.update_env.return_value = {"env_keys": ["KEY"]}
            body = raw(AgentConfigEnvApi(), "agent-1")

    assert body == {"env_keys": ["KEY"]}
    assert service.return_value.update_env.call_args.kwargs["user_id"] == "account-user-1"
    assert service.return_value.update_env.call_args.kwargs["env_text"] == "KEY=value\n"


def test_note_happy_path_calls_service() -> None:
    raw = _raw(AgentConfigNoteApi.put)
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "account-user-1",
        "config_version_id": "cfg-1",
        "config_version_kind": "build_draft",
        "note": "hello",
    }

    with app.test_request_context("/", method="PUT", json=payload):
        with patch(f"{MODULE}.AgentConfigService") as service:
            service.return_value.update_note.return_value = {"note": "hello"}
            body = raw(AgentConfigNoteApi(), "agent-1")

    assert body == {"note": "hello"}
    assert service.return_value.update_note.call_args.kwargs["user_id"] == "account-user-1"
    assert service.return_value.update_note.call_args.kwargs["note"] == "hello"


def test_manifest_invalid_query_returns_400() -> None:
    raw = _raw(AgentConfigManifestApi.get)

    with app.test_request_context("/?tenant_id=tenant-1"):
        body, status = raw(AgentConfigManifestApi(), "agent-1")

    assert status == 400
    assert body["code"] == "invalid_request"


def test_push_invalid_body_returns_400() -> None:
    raw = _raw(AgentConfigPushApi.post)

    with app.test_request_context("/", method="POST", json={"tenant_id": "tenant-1"}):
        body, status = raw(AgentConfigPushApi(), "agent-1")

    assert status == 400
    assert body["code"] == "invalid_request"


def test_manifest_maps_service_errors() -> None:
    raw = _raw(AgentConfigManifestApi.get)

    with app.test_request_context(
        "/?tenant_id=tenant-1&config_version_id=cfg-1&config_version_kind=build_draft"
    ):
        with patch(f"{MODULE}.AgentConfigService") as service:
            service.return_value.manifest.side_effect = AgentConfigServiceError(
                "config_version_not_found",
                "missing",
                status_code=404,
            )
            body, status = raw(AgentConfigManifestApi(), "agent-1")

    assert status == 404
    assert body == {"code": "config_version_not_found", "message": "missing"}


def test_push_maps_service_errors() -> None:
    raw = _raw(AgentConfigPushApi.post)
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "account-user-1",
        "config_version_id": "cfg-1",
        "config_version_kind": "build_draft",
        "files": [],
        "skills": [],
    }

    with app.test_request_context("/", method="POST", json=payload):
        with patch(f"{MODULE}.AgentConfigService") as service:
            service.return_value.push.side_effect = AgentConfigServiceError(
                "config_not_writable",
                "denied",
                status_code=403,
            )
            body, status = raw(AgentConfigPushApi(), "agent-1")

    assert status == 403
    assert body == {"code": "config_not_writable", "message": "denied"}

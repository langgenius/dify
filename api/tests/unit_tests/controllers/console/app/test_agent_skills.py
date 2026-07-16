"""Unit tests for the console agent Skill endpoints (ENG-370 / ENG-594).

Handlers are unwrapped past the login/app-model decorators and invoked inside a
bare Flask request context with the services mocked — covering request handling
+ error mapping, not auth.
"""

from __future__ import annotations

import io
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.app import agent as agent_controller
from controllers.console.app.agent import (
    AgentDriveFilesByAgentApi,
    AgentSkillByAgentApi,
    AgentSkillInferToolsByAgentApi,
    AgentSkillUploadApi,
    AgentSkillUploadByAgentApi,
)
from models.model import AppMode
from services.agent.skill_package_service import SkillPackageError
from services.agent_drive_service import AgentDriveError

_MOD = "controllers.console.app.agent"
app = Flask(__name__)


def _raw(method):
    return unwrap(method)


def _file_ctx(*, files: dict[str, bytes] | None = None):
    data = {name: (io.BytesIO(content), name) for name, content in (files or {}).items()}
    return app.test_request_context("/", method="POST", data=data, content_type="multipart/form-data")


_USER = SimpleNamespace(id="user-1")
_APP = SimpleNamespace(
    id="app-1",
    tenant_id="tenant-1",
    mode=AppMode.AGENT,
    bound_agent_id_with_session=lambda *, session: "agent-1",
)
_WORKFLOW_APP = SimpleNamespace(
    id="app-1",
    tenant_id="tenant-1",
    mode=AppMode.WORKFLOW,
    bound_agent_id_with_session=lambda *, session: None,
)


def test_resolve_bound_agent_uses_injected_session():
    session = MagicMock()
    resolver = MagicMock(return_value="agent-1")
    app_model = SimpleNamespace(bound_agent_id_with_session=resolver)
    result = agent_controller._resolve_agent_id(session, app_model, None)

    assert result == "agent-1"
    resolver.assert_called_once_with(session=session)
    assert resolver.call_args.kwargs["session"] is session


def test_upload_standardizes_into_drive_and_returns_skill_ref():
    raw = _raw(AgentSkillUploadApi.post)
    with _file_ctx(files={"file": b"zip-bytes"}):
        with patch(f"{_MOD}.SkillStandardizeService") as svc:
            svc.return_value.standardize.return_value = {
                "skill": {"path": "skill-a", "skill_md_key": "skill-a/SKILL.md"},
                "manifest": {"name": "Skill A"},
            }
            body, status = raw(AgentSkillUploadApi(), MagicMock(), _USER, _APP)
    assert status == 201
    assert body["skill"] == {"path": "skill-a", "skill_md_key": "skill-a/SKILL.md"}
    assert svc.return_value.standardize.call_args.kwargs["agent_id"] == "agent-1"


def test_upload_by_agent_resolves_app_and_standardizes_into_drive():
    raw = _raw(AgentSkillUploadByAgentApi.post)
    with _file_ctx(files={"file": b"zip-bytes"}):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.SkillStandardizeService") as svc,
        ):
            session = MagicMock()
            svc.return_value.standardize.return_value = {"skill": {"path": "skill-a"}, "manifest": {}}
            body, status = raw(AgentSkillUploadByAgentApi(), session, "tenant-1", _USER, "agent-1")
    assert status == 201
    assert body["skill"] == {"path": "skill-a"}
    resolve_app.assert_called_once_with(session=session, tenant_id="tenant-1", agent_id="agent-1")
    assert svc.return_value.standardize.call_args.kwargs["agent_id"] == "agent-1"


def test_upload_no_file_is_400():
    raw = _raw(AgentSkillUploadApi.post)
    with _file_ctx(files={}):
        body, status = raw(AgentSkillUploadApi(), MagicMock(), _USER, _APP)
    assert status == 400
    assert body["code"] == "no_file"


def test_upload_maps_package_error():
    raw = _raw(AgentSkillUploadApi.post)
    with _file_ctx(files={"file": b"bad"}):
        with patch(f"{_MOD}.SkillStandardizeService") as svc:
            svc.return_value.standardize.side_effect = SkillPackageError(
                "missing_skill_md", "no SKILL.md", status_code=400
            )
            body, status = raw(AgentSkillUploadApi(), MagicMock(), _USER, _APP)
    assert status == 400
    assert body["code"] == "missing_skill_md"


def test_upload_no_bound_agent_is_400():
    raw = _raw(AgentSkillUploadApi.post)
    resolver = MagicMock(return_value=None)
    app_without_agent = SimpleNamespace(bound_agent_id_with_session=resolver)
    session = MagicMock()
    with _file_ctx(files={"file": b"zip"}):
        body, status = raw(AgentSkillUploadApi(), session, _USER, app_without_agent)
    assert status == 400
    assert body["code"] == "agent_not_bound"
    resolver.assert_called_once_with(session=session)


def test_upload_resolves_workflow_node_agent():
    raw = _raw(AgentSkillUploadApi.post)
    with app.test_request_context(
        "/?node_id=agent-node-1", method="POST", data={"file": (io.BytesIO(b"zip"), "skill.zip")}
    ):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.SkillStandardizeService") as svc:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-1"
            svc.return_value.standardize.return_value = {"skill": {"path": "s"}, "manifest": {}}
            body, status = raw(AgentSkillUploadApi(), MagicMock(), _USER, _WORKFLOW_APP)
    assert status == 201
    assert body["skill"] == {"path": "s"}
    assert svc.return_value.standardize.call_args.kwargs["agent_id"] == "wf-agent-1"


def test_upload_maps_drive_error():
    raw = _raw(AgentSkillUploadApi.post)
    with _file_ctx(files={"file": b"zip"}):
        with patch(f"{_MOD}.SkillStandardizeService") as svc:
            svc.return_value.standardize.side_effect = AgentDriveError("source_not_found", "nope", status_code=404)
            body, status = raw(AgentSkillUploadApi(), MagicMock(), _USER, _APP)
    assert status == 404
    assert body["code"] == "source_not_found"


def _json_ctx(payload: dict | None = None, *, method: str = "POST", query_string: str = ""):
    return app.test_request_context(f"/?{query_string}", method=method, json=payload or {})


def test_files_commit_validates_upload_and_returns_drive_ref():
    from controllers.console.app.agent import AgentDriveFilesApi

    raw = _raw(AgentDriveFilesApi.post)
    upload = SimpleNamespace(id="uf-1", name="sample qna.pdf")
    with _json_ctx({"upload_file_id": "0fa6f9bc-3416-4476-8857-a13129704dd9"}):
        with patch(f"{_MOD}.console_ns") as ns, patch(f"{_MOD}.AgentDriveService") as drive:
            session = MagicMock()
            ns.payload = {"upload_file_id": "0fa6f9bc-3416-4476-8857-a13129704dd9"}
            session.scalar.return_value = upload
            drive.return_value.commit.return_value = [
                {"key": "files/sample qna.pdf", "size": 5, "mime_type": "application/pdf"}
            ]
            body, status = raw(AgentDriveFilesApi(), session, _USER, _APP)
    assert status == 201
    assert body["file"]["drive_key"] == "files/sample qna.pdf"
    assert body["file"]["file_id"] == "uf-1"
    item = drive.return_value.commit.call_args.kwargs["items"][0]
    assert item.value_owned_by_drive is True
    assert item.file_ref.kind == "upload_file"


def test_files_by_agent_commit_uses_agent_route_and_ignores_node_id():
    raw = _raw(AgentDriveFilesByAgentApi.post)
    upload = SimpleNamespace(id="uf-1", name="sample.pdf")
    with _json_ctx({"upload_file_id": "0fa6f9bc-3416-4476-8857-a13129704dd9"}, query_string="node_id=ignored"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.console_ns") as ns,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            session = MagicMock()
            ns.payload = {"upload_file_id": "0fa6f9bc-3416-4476-8857-a13129704dd9"}
            session.scalar.return_value = upload
            drive.return_value.commit.return_value = [
                {"key": "files/sample.pdf", "size": 5, "mime_type": "application/pdf"}
            ]
            body, status = raw(AgentDriveFilesByAgentApi(), session, "tenant-1", _USER, "agent-1")
    assert status == 201
    resolve_app.assert_called_once_with(session=session, tenant_id="tenant-1", agent_id="agent-1")


def test_files_commit_404_when_upload_not_in_tenant():
    from controllers.console.app.agent import AgentDriveFilesApi

    raw = _raw(AgentDriveFilesApi.post)
    with _json_ctx({"upload_file_id": "0fa6f9bc-3416-4476-8857-a13129704dd9"}):
        with patch(f"{_MOD}.console_ns") as ns:
            session = MagicMock()
            ns.payload = {"upload_file_id": "0fa6f9bc-3416-4476-8857-a13129704dd9"}
            session.scalar.return_value = None
            body, status = raw(AgentDriveFilesApi(), session, _USER, _APP)
    assert status == 404
    assert body["code"] == "upload_file_not_found"


def test_files_commit_resolves_workflow_node_agent():
    from controllers.console.app.agent import AgentDriveFilesApi

    raw = _raw(AgentDriveFilesApi.post)
    upload = SimpleNamespace(id="uf-1", name="sample.pdf")
    with _json_ctx({"upload_file_id": "0fa6f9bc-3416-4476-8857-a13129704dd9"}, query_string="node_id=agent-node-1"):
        with (
            patch(f"{_MOD}.console_ns") as ns,
            patch(f"{_MOD}.AgentDriveService") as drive,
            patch(f"{_MOD}.AgentComposerService") as composer,
        ):
            session = MagicMock()
            ns.payload = {"upload_file_id": "0fa6f9bc-3416-4476-8857-a13129704dd9"}
            session.scalar.return_value = upload
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-1"
            drive.return_value.commit.return_value = [
                {"key": "files/sample.pdf", "size": 5, "mime_type": "application/pdf"}
            ]
            body, status = raw(AgentDriveFilesApi(), session, _USER, _WORKFLOW_APP)
    assert status == 201
    assert drive.return_value.commit.call_args.kwargs["agent_id"] == "wf-agent-1"


def test_files_delete_updates_soul_then_drive():
    from controllers.console.app.agent import AgentDriveFilesApi

    raw = _raw(AgentDriveFilesApi.delete)
    calls: list[str] = []
    with _json_ctx(method="DELETE", query_string="key=files/sample.pdf"):
        with patch(f"{_MOD}.AgentDriveService") as drive:
            drive.return_value.commit.side_effect = lambda **kw: (
                calls.append("drive") or [{"key": "files/sample.pdf", "removed": True}]
            )
            body = raw(AgentDriveFilesApi(), MagicMock(), _USER, _APP)
    assert calls == ["drive"]
    assert body == {"result": "success", "removed_keys": ["files/sample.pdf"]}


def test_files_by_agent_delete_uses_agent_route_and_ignores_node_id():
    raw = _raw(AgentDriveFilesByAgentApi.delete)
    with _json_ctx(method="DELETE", query_string="key=files/sample.pdf&node_id=ignored"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            session = MagicMock()
            drive.return_value.commit.return_value = [{"key": "files/sample.pdf", "removed": True}]
            body = raw(AgentDriveFilesByAgentApi(), session, "tenant-1", _USER, "agent-1")
    assert body == {"result": "success", "removed_keys": ["files/sample.pdf"]}
    resolve_app.assert_called_once_with(session=session, tenant_id="tenant-1", agent_id="agent-1")


def test_files_delete_resolves_workflow_node_agent():
    from controllers.console.app.agent import AgentDriveFilesApi

    raw = _raw(AgentDriveFilesApi.delete)
    with _json_ctx(method="DELETE", query_string="key=files/sample.pdf&node_id=agent-node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.AgentDriveService") as drive:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-1"
            drive.return_value.commit.return_value = [{"key": "files/sample.pdf", "removed": True}]
            body = raw(AgentDriveFilesApi(), MagicMock(), _USER, _WORKFLOW_APP)
    assert body == {"result": "success", "removed_keys": ["files/sample.pdf"]}
    assert drive.return_value.commit.call_args.kwargs["agent_id"] == "wf-agent-1"


def test_files_delete_survives_drive_failure():
    from controllers.console.app.agent import AgentDriveFilesApi

    raw = _raw(AgentDriveFilesApi.delete)
    with _json_ctx(method="DELETE", query_string="key=files/sample.pdf"):
        with patch(f"{_MOD}.AgentDriveService") as drive:
            drive.return_value.commit.side_effect = RuntimeError("storage down")
            with pytest.raises(RuntimeError, match="storage down"):
                raw(AgentDriveFilesApi(), MagicMock(), _USER, _APP)


def test_skill_delete_uses_slug_prefix_and_is_idempotent():
    from controllers.console.app.agent import AgentSkillApi

    raw = _raw(AgentSkillApi.delete)
    with _json_ctx(method="DELETE"):
        with patch(f"{_MOD}.AgentDriveService") as drive:
            drive.return_value.commit.return_value = [
                {"key": "tender-analyzer/SKILL.md", "removed": True},
                {"key": "tender-analyzer/.DIFY-SKILL-FULL.zip", "removed": True},
            ]
            body = raw(AgentSkillApi(), MagicMock(), _USER, _APP, "tender-analyzer")
    assert body == {
        "result": "success",
        "removed_keys": ["tender-analyzer/SKILL.md", "tender-analyzer/.DIFY-SKILL-FULL.zip"],
    }


def test_skill_delete_by_agent_uses_agent_route():
    raw = _raw(AgentSkillByAgentApi.delete)
    with _json_ctx(method="DELETE", query_string="node_id=ignored"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.AgentDriveService") as drive,
        ):
            session = MagicMock()
            drive.return_value.commit.return_value = [{"key": "tender-analyzer/SKILL.md", "removed": True}]
            body = raw(AgentSkillByAgentApi(), session, "tenant-1", _USER, "agent-1", "tender-analyzer")
    assert body == {"result": "success", "removed_keys": ["tender-analyzer/SKILL.md"]}
    resolve_app.assert_called_once_with(session=session, tenant_id="tenant-1", agent_id="agent-1")


def test_skill_delete_rejects_path_like_slug():
    from controllers.console.app.agent import AgentSkillApi

    raw = _raw(AgentSkillApi.delete)
    with _json_ctx(method="DELETE"):
        body, status = raw(AgentSkillApi(), MagicMock(), _USER, _APP, "a/b")
    assert status == 400
    assert body["code"] == "drive_key_invalid"


def test_infer_tools_returns_draft_suggestions():
    from controllers.console.app.agent import AgentSkillInferToolsApi

    raw = _raw(AgentSkillInferToolsApi.post)
    with _json_ctx():
        with patch(f"{_MOD}.SkillToolInferenceService") as svc:
            svc.return_value.infer.return_value = {
                "inferable": True,
                "cli_tools": [{"name": "ffmpeg", "inferred_from": "audio-transcribe"}],
                "reason": None,
            }
            body = raw(AgentSkillInferToolsApi(), MagicMock(), _APP, "audio-transcribe")
    assert body["inferable"] is True
    assert svc.return_value.infer.call_args.kwargs["slug"] == "audio-transcribe"


def test_infer_tools_by_agent_uses_agent_route():
    raw = _raw(AgentSkillInferToolsByAgentApi.post)
    with _json_ctx(query_string="node_id=ignored"):
        with (
            patch(f"{_MOD}.resolve_agent_runtime_app_model", return_value=_APP) as resolve_app,
            patch(f"{_MOD}.SkillToolInferenceService") as svc,
        ):
            session = MagicMock()
            svc.return_value.infer.return_value = {"inferable": True, "cli_tools": [], "reason": None}
            body = raw(AgentSkillInferToolsByAgentApi(), session, "tenant-1", "agent-1", "audio-transcribe")
    assert body["inferable"] is True
    resolve_app.assert_called_once_with(session=session, tenant_id="tenant-1", agent_id="agent-1")
    assert svc.return_value.infer.call_args.kwargs["agent_id"] == "agent-1"


def test_infer_tools_resolves_workflow_node_agent():
    from controllers.console.app.agent import AgentSkillInferToolsApi

    raw = _raw(AgentSkillInferToolsApi.post)
    with _json_ctx(query_string="node_id=agent-node-1"):
        with patch(f"{_MOD}.AgentComposerService") as composer, patch(f"{_MOD}.SkillToolInferenceService") as svc:
            composer.resolve_workflow_node_agent_id.return_value = "wf-agent-1"
            svc.return_value.infer.return_value = {"inferable": False, "cli_tools": [], "reason": "none"}
            body = raw(AgentSkillInferToolsApi(), MagicMock(), _WORKFLOW_APP, "audio-transcribe")
    assert body["inferable"] is False
    assert svc.return_value.infer.call_args.kwargs["agent_id"] == "wf-agent-1"


def test_infer_tools_maps_inference_errors():
    from controllers.console.app.agent import AgentSkillInferToolsApi
    from services.agent.skill_tool_inference_service import SkillToolInferenceError

    raw = _raw(AgentSkillInferToolsApi.post)
    with _json_ctx():
        with patch(f"{_MOD}.SkillToolInferenceService") as svc:
            svc.return_value.infer.side_effect = SkillToolInferenceError(
                "default_model_not_configured", "no model", status_code=400
            )
            body, status = raw(AgentSkillInferToolsApi(), MagicMock(), _APP, "audio-transcribe")
    assert status == 400
    assert body["code"] == "default_model_not_configured"


def test_infer_tools_rejects_path_like_slug_and_unbound_app():
    from controllers.console.app.agent import AgentSkillInferToolsApi

    raw = _raw(AgentSkillInferToolsApi.post)
    with _json_ctx():
        body, status = raw(AgentSkillInferToolsApi(), MagicMock(), _APP, "a/b")
    assert (status, body["code"]) == (400, "drive_key_invalid")
    app_without_agent = SimpleNamespace(bound_agent_id_with_session=MagicMock(return_value=None))
    with _json_ctx():
        body, status = raw(AgentSkillInferToolsApi(), MagicMock(), app_without_agent, "x")
    assert (status, body["code"]) == (400, "agent_not_bound")

"""Unit tests for the console agent Skill endpoints (ENG-370 / ENG-594).

Handlers are unwrapped past the login/app-model decorators and invoked inside a
bare Flask request context with the services mocked — covering request handling
+ error mapping, not auth.
"""

from __future__ import annotations

import inspect
import io
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

from controllers.console.app.agent import AgentSkillStandardizeApi, AgentSkillUploadApi
from services.agent.skill_package_service import SkillPackageError
from services.agent_drive_service import AgentDriveError

_MOD = "controllers.console.app.agent"
app = Flask(__name__)


def _raw(method):
    return inspect.unwrap(method)


def _file_ctx(*, files: dict[str, bytes] | None = None):
    data = {name: (io.BytesIO(content), name) for name, content in (files or {}).items()}
    return app.test_request_context("/", method="POST", data=data, content_type="multipart/form-data")


_USER = SimpleNamespace(id="user-1")
_APP = SimpleNamespace(tenant_id="tenant-1", bound_agent_id="agent-1")


def test_upload_validates_and_returns_skill_ref():
    raw = _raw(AgentSkillUploadApi.post)
    manifest = MagicMock()
    manifest.to_skill_ref.return_value.model_dump.return_value = {"name": "S", "file_id": "uf-1"}
    manifest.model_dump.return_value = {"name": "S"}

    with _file_ctx(files={"file": b"zip-bytes"}):
        with (
            patch(f"{_MOD}.SkillPackageService") as pkg,
            patch(f"{_MOD}.FileService") as fs,
            patch(f"{_MOD}.db"),
        ):
            pkg.return_value.validate_and_extract.return_value = manifest
            fs.return_value.upload_file.return_value = SimpleNamespace(id="uf-1")
            body, status = raw(AgentSkillUploadApi(), _USER, _APP)

    assert status == 201
    assert body["skill"] == {"name": "S", "file_id": "uf-1"}
    manifest.to_skill_ref.assert_called_once_with(file_id="uf-1")


def test_upload_no_file_is_400():
    raw = _raw(AgentSkillUploadApi.post)
    with _file_ctx(files={}):
        body, status = raw(AgentSkillUploadApi(), _USER, _APP)
    assert status == 400
    assert body["code"] == "no_file"


def test_upload_maps_package_error():
    raw = _raw(AgentSkillUploadApi.post)
    with _file_ctx(files={"file": b"bad"}):
        with patch(f"{_MOD}.SkillPackageService") as pkg:
            pkg.return_value.validate_and_extract.side_effect = SkillPackageError(
                "missing_skill_md", "no SKILL.md", status_code=400
            )
            body, status = raw(AgentSkillUploadApi(), _USER, _APP)
    assert status == 400
    assert body["code"] == "missing_skill_md"


def test_standardize_returns_result():
    raw = _raw(AgentSkillStandardizeApi.post)
    with _file_ctx(files={"file": b"zip"}):
        with patch(f"{_MOD}.SkillStandardizeService") as svc:
            svc.return_value.standardize.return_value = {"skill": {"path": "s"}, "manifest": {}}
            body, status = raw(AgentSkillStandardizeApi(), _USER, _APP)
    assert status == 201
    assert body["skill"] == {"path": "s"}
    assert svc.return_value.standardize.call_args.kwargs["agent_id"] == "agent-1"


def test_standardize_no_bound_agent_is_400():
    raw = _raw(AgentSkillStandardizeApi.post)
    app_without_agent = SimpleNamespace(tenant_id="tenant-1", bound_agent_id=None)
    with _file_ctx(files={"file": b"zip"}):
        body, status = raw(AgentSkillStandardizeApi(), _USER, app_without_agent)
    assert status == 400
    assert body["code"] == "no_bound_agent"


def test_standardize_maps_drive_error():
    raw = _raw(AgentSkillStandardizeApi.post)
    with _file_ctx(files={"file": b"zip"}):
        with patch(f"{_MOD}.SkillStandardizeService") as svc:
            svc.return_value.standardize.side_effect = AgentDriveError("source_not_found", "nope", status_code=404)
            body, status = raw(AgentSkillStandardizeApi(), _USER, _APP)
    assert status == 404
    assert body["code"] == "source_not_found"

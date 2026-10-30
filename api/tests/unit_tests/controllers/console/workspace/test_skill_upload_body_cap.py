from __future__ import annotations

import io
from inspect import unwrap as inspect_unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, request

from configs import dify_config
from controllers.console.workspace.skills import (
    _MULTIPART_ENVELOPE_BYTES,
    WorkspaceSkillFileUploadApi,
    WorkspaceSkillImportApi,
    _max_draft_file_bytes,
    _skill_archive_bytes,
)
from machinery.context import RequestContext

_UPLOAD_FILE_OK = {"id": "tool-file-1", "name": "policy.md", "mime_type": "text/markdown", "size": 1, "hash": "h"}


@pytest.fixture
def app() -> Flask:
    flask_app = Flask("test_skill_upload_body_cap")
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="user-1",
        active_workspace_id="tenant-1",
    )


def _run(
    app: Flask,
    api: object,
    request_context: RequestContext,
    data: dict[str, object],
) -> tuple[object, int | None, MagicMock]:
    """Drive the handler far enough to install the cap, then report it.

    The service is patched out so the assertions are about the route's own
    read, not about storage.
    """
    method = inspect_unwrap(api.post)  # type: ignore[attr-defined]
    with (
        app.test_request_context("/", method="POST", data=data, content_type="multipart/form-data"),
        patch("controllers.console.workspace.skills.SkillManagementService") as service_cls,
    ):
        service = service_cls.return_value
        service.upload_file.return_value = _UPLOAD_FILE_OK
        service.import_skill.return_value = {"id": "skill-1"}
        outcome: object = None
        try:
            outcome = method(api, request_context)
        except Exception as error:  # the oversized case is expected to raise
            outcome = error
        return outcome, request.max_content_length, service


def test_skill_import_caps_the_body_before_reading_the_archive(app: Flask, request_context: RequestContext) -> None:
    """import_skill compares len(content) after the whole archive is in memory.

    The route has to bound the read itself, otherwise the size limit only
    documents what the process has already buffered.
    """
    api = WorkspaceSkillImportApi()
    _, cap, _ = _run(app, api, request_context, {"file": (io.BytesIO(b"zip"), "skill.zip")})

    assert cap == _skill_archive_bytes() + _MULTIPART_ENVELOPE_BYTES


def test_skill_file_upload_caps_the_body_before_reading_the_file(app: Flask, request_context: RequestContext) -> None:
    """upload_file checks the per-extension limit after file.stream.read()."""
    api = WorkspaceSkillFileUploadApi()
    _, cap, _ = _run(app, api, request_context, {"file": (io.BytesIO(b"text"), "policy.md")})

    assert cap == _max_draft_file_bytes() + _MULTIPART_ENVELOPE_BYTES


def test_skill_archive_cap_follows_the_configured_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """An operator raising the limit must raise the read cap with it."""
    monkeypatch.setattr(dify_config, "UPLOAD_SKILL_FILE_SIZE_LIMIT", 7)
    assert _skill_archive_bytes() == 7 * 1024 * 1024


def test_draft_file_cap_covers_every_extension_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """The draft cap is decided before the filename is known, so it must not
    reject a file the per-extension check would accept."""
    monkeypatch.setattr(dify_config, "UPLOAD_FILE_SIZE_LIMIT", 15)
    monkeypatch.setattr(dify_config, "UPLOAD_IMAGE_FILE_SIZE_LIMIT", 10)
    monkeypatch.setattr(dify_config, "UPLOAD_VIDEO_FILE_SIZE_LIMIT", 100)
    monkeypatch.setattr(dify_config, "UPLOAD_AUDIO_FILE_SIZE_LIMIT", 50)

    assert _max_draft_file_bytes() == 100 * 1024 * 1024


def test_skill_import_request_over_the_cap_is_refused(
    app: Flask, request_context: RequestContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An oversized archive must fail the read that crosses the cap."""
    monkeypatch.setattr(dify_config, "UPLOAD_SKILL_FILE_SIZE_LIMIT", 1)
    monkeypatch.setattr("controllers.console.workspace.skills._MULTIPART_ENVELOPE_BYTES", 1)
    api = WorkspaceSkillImportApi()
    oversized = b"x" * (2 * 1024 * 1024)

    outcome, _, service = _run(app, api, request_context, {"file": (io.BytesIO(oversized), "skill.zip")})

    assert isinstance(outcome, Exception), "an oversized archive must not reach the service"
    assert "too large" in str(outcome).lower()
    service.import_skill.assert_not_called()

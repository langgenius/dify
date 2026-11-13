from __future__ import annotations

import io
from collections.abc import Callable
from inspect import signature
from inspect import unwrap as inspect_unwrap
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, request
from sqlalchemy.orm import Session
from werkzeug.exceptions import RequestEntityTooLarge

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

# Fully populated so dump_response validates it; the tests are about the request
# read, not about the response model.
_IMPORTED_SKILL: dict[str, object] = {
    "id": "skill-1",
    "name": "finance-sop",
    "display_name": "Finance SOP",
    "icon": "📄",
    "description": "",
    "tags": [],
    "name_manually_edited": False,
    "visibility": "workspace",
    "latest_published_version_id": None,
    "reference_count": 0,
    "created_by": "user-1",
    "created_by_name": "Test User",
    "updated_by": "user-1",
    "updated_by_name": "Test User",
    "created_at": 1,
    "updated_at": 1,
    "files": [
        {
            "id": "file-1",
            "path": "SKILL.md",
            "kind": "file",
            "storage": "text",
            "mime_type": "text/markdown",
            "content": "# Body",
            "tool_file_id": None,
            "size": 32,
            "hash": "hash",
        }
    ],
}


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


def _unwrap_with_session[ReturnT](func: Callable[..., ReturnT]) -> Callable[..., ReturnT]:
    """Mirror the module-local helper in test_skills.py.

    The controller methods take an injected ``session`` after unwrapping, so a
    direct call with only (self, request_context) raises TypeError and never
    reaches the code under test.
    """
    unwrapped = cast(Callable[..., ReturnT], inspect_unwrap(func))
    parameters = list(signature(unwrapped).parameters.values())
    if len(parameters) > 1 and parameters[1].name == "session":

        def invoke(*args: object, **kwargs: object) -> ReturnT:
            with Session() as session:
                return unwrapped(args[0], session, *args[1:], **kwargs)

        return invoke
    return unwrapped


def _run(
    app: Flask,
    api: object,
    request_context: RequestContext,
    data: dict[str, object],
) -> tuple[object, int | None, MagicMock]:
    """Drive the handler far enough to install the cap, then report it.

    The service is patched out so the assertions are about the route's own read,
    not about storage. The cap is captured while the request context is still
    active: Flask rebinds ``request`` when the context exits.
    """
    method = _unwrap_with_session(api.post)  # type: ignore[attr-defined]
    with (
        app.test_request_context("/", method="POST", data=data, content_type="multipart/form-data"),
        patch("controllers.console.workspace.skills.SkillManagementService") as service_cls,
    ):
        service = service_cls.return_value
        service.upload_file.return_value = _UPLOAD_FILE_OK
        service.import_skill.return_value = _IMPORTED_SKILL
        outcome: object = None
        try:
            outcome = method(api, request_context)
        except Exception as error:
            outcome = error
        return outcome, request.max_content_length, service


def test_skill_import_caps_the_body_before_reading_the_archive(app: Flask, request_context: RequestContext) -> None:
    """import_skill compares len(content) after the whole archive is in memory.

    The route has to bound the read itself, otherwise the size limit only
    documents what the process has already buffered.
    """
    api = WorkspaceSkillImportApi()
    outcome, cap, _ = _run(app, api, request_context, {"file": (io.BytesIO(b"zip"), "skill.zip")})

    assert not isinstance(outcome, Exception), f"legal body refused: {outcome!r}"
    assert cap == _skill_archive_bytes() + _MULTIPART_ENVELOPE_BYTES


def test_skill_file_upload_caps_the_body_before_reading_the_file(app: Flask, request_context: RequestContext) -> None:
    """upload_file checks the per-extension limit after file.stream.read()."""
    api = WorkspaceSkillFileUploadApi()
    outcome, cap, _ = _run(app, api, request_context, {"file": (io.BytesIO(b"text"), "policy.md")})

    assert not isinstance(outcome, Exception), f"legal body refused: {outcome!r}"
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
    monkeypatch.setattr(dify_config, "UPLOAD_SKILL_FILE_SIZE_LIMIT", 0)
    api = WorkspaceSkillImportApi()
    # The archive limit is now 0, so any body past the multipart envelope is
    # over the cap.
    oversized = b"x" * (2 * 1024 * 1024)

    outcome, cap, service = _run(app, api, request_context, {"file": (io.BytesIO(oversized), "skill.zip")})

    assert isinstance(outcome, RequestEntityTooLarge)
    assert cap == _MULTIPART_ENVELOPE_BYTES
    service.import_skill.assert_not_called()

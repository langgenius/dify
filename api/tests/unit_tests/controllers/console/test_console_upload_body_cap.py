from __future__ import annotations

import io

import pytest
from flask import Flask, request
from werkzeug.exceptions import RequestEntityTooLarge

from configs import dify_config
from controllers.common.errors import NoFileUploadedError, TooManyFilesError
from controllers.console.files import (
    _MULTIPART_ENVELOPE_BYTES,
    _cap_upload_body,
    _max_upload_bytes,
    _parse_file_upload,
)


@pytest.fixture
def app() -> Flask:
    flask_app = Flask("test_console_upload_body_cap")
    flask_app.config["TESTING"] = True
    return flask_app


def test_parse_file_upload_caps_the_body_before_reading_it(app: Flask) -> None:
    """`content=file.stream.read()` runs after this helper, and the size check
    lives in FileService, so the cap has to be installed here.

    Werkzeug captures max_content_length when `request.files` is first accessed,
    which is what `_parse_file_upload` does, so asserting the value afterwards
    proves the ordering only if the access happened later. The malformed cases
    below reach the same helper without a file part, which is exactly the point
    where the cap must already be on.
    """
    with app.test_request_context("/", method="POST", data={"file": (io.BytesIO(b"hello"), "a.txt")}):
        _parse_file_upload()
        assert request.max_content_length == _max_upload_bytes() + _MULTIPART_ENVELOPE_BYTES


def test_cap_is_installed_even_when_the_request_has_no_file_part(app: Flask) -> None:
    """The cap must not depend on the multipart shape: an empty or malformed
    body has to be bounded too, and the size answer must not be a missing-field
    answer."""
    with app.test_request_context("/", method="POST", data={}):
        with pytest.raises(NoFileUploadedError):
            _parse_file_upload()
        assert request.max_content_length is not None


def test_multiple_file_parts_are_still_rejected_under_the_cap(app: Flask) -> None:
    """TooManyFilesError keeps its meaning; the cap must not swallow it."""
    with app.test_request_context(
        "/",
        method="POST",
        data={"file": (io.BytesIO(b"a"), "a.txt"), "other": (io.BytesIO(b"b"), "b.txt")},
    ):
        with pytest.raises(TooManyFilesError):
            _parse_file_upload()
        assert request.max_content_length is not None


def test_cap_follows_the_widest_configured_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """The body limit depends on the extension and, for datasets, on the plan,
    all of which arrive with the body. The envelope ceiling must cover the
    widest of them so it never rejects a file the later check would accept."""
    monkeypatch.setattr(dify_config, "UPLOAD_FILE_SIZE_LIMIT", 15)
    monkeypatch.setattr(dify_config, "UPLOAD_IMAGE_FILE_SIZE_LIMIT", 10)
    monkeypatch.setattr(dify_config, "UPLOAD_VIDEO_FILE_SIZE_LIMIT", 100)
    monkeypatch.setattr(dify_config, "UPLOAD_AUDIO_FILE_SIZE_LIMIT", 50)
    monkeypatch.setattr(dify_config, "KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN", 200)

    assert _max_upload_bytes() == 200 * 1024 * 1024


def test_knowledge_plan_limit_alone_raises_the_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    """A paid plan widens the dataset limit without touching the media limits;
    the cap has to follow that too."""
    monkeypatch.setattr(dify_config, "UPLOAD_FILE_SIZE_LIMIT", 15)
    monkeypatch.setattr(dify_config, "UPLOAD_IMAGE_FILE_SIZE_LIMIT", 10)
    monkeypatch.setattr(dify_config, "UPLOAD_VIDEO_FILE_SIZE_LIMIT", 100)
    monkeypatch.setattr(dify_config, "UPLOAD_AUDIO_FILE_SIZE_LIMIT", 50)
    monkeypatch.setattr(dify_config, "KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN", 500)

    assert _max_upload_bytes() == 500 * 1024 * 1024


def test_cap_refuses_a_body_over_the_limit(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """An upload past the cap must fail instead of being buffered whole."""
    monkeypatch.setattr("controllers.console.files._MULTIPART_ENVELOPE_BYTES", 1)
    monkeypatch.setattr(dify_config, "UPLOAD_FILE_SIZE_LIMIT", 1)
    monkeypatch.setattr(dify_config, "UPLOAD_IMAGE_FILE_SIZE_LIMIT", 1)
    monkeypatch.setattr(dify_config, "UPLOAD_VIDEO_FILE_SIZE_LIMIT", 1)
    monkeypatch.setattr(dify_config, "UPLOAD_AUDIO_FILE_SIZE_LIMIT", 1)
    monkeypatch.setattr(dify_config, "KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN", 1)
    oversized = b"x" * (2 * 1024 * 1024)

    with app.test_request_context("/", method="POST", data={"file": (io.BytesIO(oversized), "big.bin")}):
        _cap_upload_body()
        with pytest.raises(RequestEntityTooLarge):
            request.files["file"].read()

import builtins
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from flask import Flask
from flask.views import MethodView

from extensions import ext_fastopenapi

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def test_console_remote_files_fastopenapi_get_info(app: Flask):
    ext_fastopenapi.init_app(app)

    response = httpx.Response(
        200,
        request=httpx.Request("HEAD", "http://example.com/file.txt"),
        headers={"Content-Type": "text/plain", "Content-Length": "10"},
    )

    with patch("controllers.console.remote_files.ssrf_proxy.head", return_value=response):
        client = app.test_client()
        encoded_url = "http%3A%2F%2Fexample.com%2Ffile.txt"
        resp = client.get(f"/console/api/remote-files/{encoded_url}")

    assert resp.status_code == 200
    assert resp.get_json() == {"file_type": "text/plain", "file_length": 10}


def test_console_remote_files_fastopenapi_upload(app: Flask):
    ext_fastopenapi.init_app(app)

    head_response = httpx.Response(
        200,
        request=httpx.Request("GET", "http://example.com/file.txt"),
        content=b"hello",
    )
    file_info = SimpleNamespace(
        extension="txt",
        size=5,
        filename="file.txt",
        mimetype="text/plain",
    )
    uploaded = SimpleNamespace(
        id="file-id",
        name="file.txt",
        size=5,
        extension="txt",
        mime_type="text/plain",
        created_by="user-id",
        created_at=datetime(2024, 1, 1),
    )

    with (
        patch("controllers.console.remote_files.db", new=SimpleNamespace(engine=object())),
        patch("controllers.console.remote_files.ssrf_proxy.head", return_value=head_response),
        patch("controllers.console.remote_files.helpers.guess_file_info_from_response", return_value=file_info),
        patch("controllers.console.remote_files.FileService.is_file_size_within_limit", return_value=True),
        patch("controllers.console.remote_files.FileService.__init__", return_value=None),
        patch("controllers.console.remote_files.current_account_with_tenant", return_value=(object(), "tenant-id")),
        patch("controllers.console.remote_files.FileService.upload_file", return_value=uploaded),
        patch("controllers.console.remote_files.file_helpers.get_signed_file_url", return_value="signed-url"),
    ):
        client = app.test_client()
        resp = client.post(
            "/console/api/remote-files/upload",
            json={"url": "http://example.com/file.txt"},
        )

    assert resp.status_code == 201
    assert resp.get_json() == {
        "id": "file-id",
        "name": "file.txt",
        "size": 5,
        "extension": "txt",
        "url": "signed-url",
        "mime_type": "text/plain",
        "created_by": "user-id",
        "created_at": int(uploaded.created_at.timestamp()),
    }

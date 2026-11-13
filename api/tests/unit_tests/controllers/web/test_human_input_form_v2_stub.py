from datetime import datetime

import pytest
from flask import Flask
from sqlalchemy.orm import sessionmaker

from controllers.web import human_input_form_access_request as controller
from libs.external_api import ExternalApi
from services.file_service import FileService
from services.human_input_file_upload_service import HumanInputUploadToken
from services.human_input_v2.file_upload_service import HumanInputV2FileUploadService
from services.remote_file_service import RemoteFileService


def test_public_v2_upload_token_uses_independent_route(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    sessions = sessionmaker()
    files = FileService(sessions)
    service = HumanInputV2FileUploadService(
        session_factory=sessions, files=files, remote_files=RemoteFileService(files=files)
    )
    grant = HumanInputUploadToken(upload_token="hitl_v2_upload_grant", expires_at=datetime(2030, 1, 1))
    monkeypatch.setattr(service, "issue_public_upload_token", lambda _form_token: grant)
    monkeypatch.setattr(controller, "build_file_upload_service", lambda: service)
    ExternalApi(app).add_namespace(controller.web_ns)
    client = app.test_client()
    response = client.post("/form/human-input/v2/public/token/upload-token")
    assert response.status_code == 200
    assert response.json == {"upload_token": "hitl_v2_upload_grant", "expires_at": 1893456000}
    assert client.post("/form/human-input/token/upload-token").status_code == 404

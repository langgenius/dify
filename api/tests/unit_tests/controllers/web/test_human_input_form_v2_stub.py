from datetime import datetime
from unittest.mock import Mock

from flask import Flask

from controllers.web import human_input_form_access_request as controller
from libs.external_api import ExternalApi
from services.human_input_file_upload_service import HumanInputUploadToken


def test_public_v2_upload_token_uses_independent_route(app: Flask, monkeypatch) -> None:
    service = Mock()
    service.issue_public_upload_token.return_value = HumanInputUploadToken(
        upload_token="hitl_v2_upload_grant", expires_at=datetime(2030, 1, 1)
    )
    monkeypatch.setattr(controller, "build_file_upload_service", lambda: service, raising=False)
    ExternalApi(app).add_namespace(controller.web_ns)
    client = app.test_client()
    response = client.post("/form/human-input/v2/public/token/upload-token")
    assert response.status_code == 200
    assert response.json == {"upload_token": "hitl_v2_upload_grant", "expires_at": 1893456000}
    assert client.post("/form/human-input/token/upload-token").status_code == 404

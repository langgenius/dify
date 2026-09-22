from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from flask import Flask

from controllers.console.app import preview_admission
from controllers.console.explore.trial import TrialAgentPreviewApi
from libs.external_api import ExternalApi
from services.app_preview_query_service import AppPreviewQueryService, AppPreviewRef, TrialAgentPreview


def test_public_preview_admission_and_response(monkeypatch):
    app_id = str(uuid4())
    app_ref = AppPreviewRef(app_id=app_id, tenant_id="source-tenant")
    is_previewable, query = Mock(return_value=True), Mock()
    query.get_app.return_value = app_ref
    query.get_agent_preview.return_value = TrialAgentPreview(
        system_prompt="Published", model=None, tools=[], skills=[], files=[], knowledge=[]
    )
    services = SimpleNamespace(app_previews=AppPreviewQueryService(apps=query, is_previewable=is_previewable))
    monkeypatch.setattr(preview_admission, "application_services", lambda: services)
    monkeypatch.setattr("controllers.console.explore.trial.application_services", lambda: services)
    app = Flask(__name__)
    ExternalApi(app).add_resource(TrialAgentPreviewApi, "/trial-apps/<uuid:app_id>/agent-preview")
    response = app.test_client().get(f"/trial-apps/{app_id}/agent-preview")
    assert response.status_code == 200
    assert response.json["system_prompt"] == "Published"
    query.get_agent_preview.assert_called_once_with(app=app_ref)

    query.reset_mock()
    is_previewable.return_value = False
    response = app.test_client().get(f"/trial-apps/{app_id}/agent-preview")
    assert response.status_code == 404
    query.get_agent_preview.assert_not_called()

    is_previewable.return_value = True
    query.get_agent_preview.return_value = None
    response = app.test_client().get(f"/trial-apps/{app_id}/agent-preview")
    assert response.status_code == 400
    assert response.json["code"] == "app_unavailable"

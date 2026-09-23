from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask

from controllers.console.app import preview_admission
from controllers.console.explore.trial import TrialAgentComposerApi
from libs.external_api import ExternalApi
from services.app_preview_query_service import AppPreviewQueryService, AppPreviewRef


def test_public_preview_admission_and_response(monkeypatch: pytest.MonkeyPatch) -> None:
    app_id = str(uuid4())
    app_ref = AppPreviewRef(app_id=app_id, tenant_id="source-tenant")
    is_previewable, query = Mock(return_value=True), Mock()
    query.get_app.return_value = app_ref
    composer: dict[str, object] = {
        "variant": "agent_app",
        "agent": {
            "id": str(uuid4()),
            "name": "Published",
            "description": "",
            "scope": "roster",
            "status": "active",
        },
        "agent_soul": {"prompt": {"system_prompt": "Published"}},
        "active_config_is_published": True,
        "save_options": [],
    }
    query.get_agent_composer.return_value = composer
    services = SimpleNamespace(app_previews=AppPreviewQueryService(apps=query, is_previewable=is_previewable))
    monkeypatch.setattr(preview_admission, "application_services", lambda: services)
    monkeypatch.setattr("controllers.console.explore.trial.application_services", lambda: services)
    app = Flask(__name__)
    ExternalApi(app).add_resource(TrialAgentComposerApi, "/trial-apps/<uuid:app_id>/agent-composer")
    response = app.test_client().get(f"/trial-apps/{app_id}/agent-composer")
    assert response.status_code == 200
    assert response.json is not None
    assert response.json["agent_soul"]["prompt"]["system_prompt"] == "Published"
    query.get_agent_composer.assert_called_once_with(app=app_ref)

    query.reset_mock()
    is_previewable.return_value = False
    response = app.test_client().get(f"/trial-apps/{app_id}/agent-composer")
    assert response.status_code == 404
    query.get_agent_composer.assert_not_called()

    is_previewable.return_value = True
    query.get_agent_composer.return_value = None
    response = app.test_client().get(f"/trial-apps/{app_id}/agent-composer")
    assert response.status_code == 400
    assert response.json is not None
    assert response.json["code"] == "app_unavailable"

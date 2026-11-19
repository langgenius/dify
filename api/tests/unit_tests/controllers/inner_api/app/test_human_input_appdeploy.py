"""Exercise the served AppDeploy contract over the existing v2 services."""

from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from controllers.inner_api import bp
from core.helper import encrypter
from enums import DeploymentEdition
from libs.datetime_utils import naive_utc_now
from models.enums import EndUserType
from models.model import AppMode, EndUser
from tests.helpers.unit.model_factories import make_app, make_tenant


@pytest.mark.parametrize("version", ["1", "2"])
@pytest.mark.parametrize("caller", ["web_app", "service_api"])
def test_prepare_replay_submit_and_expire(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, version: str, caller: str
) -> None:
    tenant = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=tenant.id, mode=AppMode.WORKFLOW)
    end_user = EndUser(
        id=str(uuid4()), tenant_id=tenant.id, app_id=app.id, type=EndUserType.BROWSER, session_id="appdeploy"
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, app, end_user])
    monkeypatch.setattr("core.db.session_factory.session_factory.create_session", sqlite_session_factory)
    monkeypatch.setattr("core.db.session_factory.session_factory.get_session_maker", lambda: sqlite_session_factory)
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(dify_config, "INNER_API", True)
    monkeypatch.setattr(dify_config, "INNER_API_KEY", "hitl-contract-key")
    monkeypatch.setattr(
        "services.enterprise.human_input_run_gateway.EnterpriseRequest.send_request",
        lambda *_args, **_kwargs: {"state": "paused", "has_checkpoint": True},
    )
    monkeypatch.setattr(
        "services.human_input_v2.im_card_service.HumanInputIMCardService.enqueue_updates", lambda *_args: None
    )
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(encrypter, "encrypt_token", lambda _, token: cipher.encrypt(token.encode()).decode())
    monkeypatch.setattr(encrypter, "decrypt_token", lambda _, token: cipher.decrypt(token.encode()).decode())
    flask_app = Flask(__name__)
    flask_app.register_blueprint(bp)
    client = flask_app.test_client()
    headers = {"X-Inner-Api-Key": "hitl-contract-key"}
    run_id = str(uuid4())
    base = f"/inner/api/enterprise/apps/{app.id}/workflow-runs/{run_id}/human-input-forms"
    node = {
        "title": "Approve",
        "form_content": "Review {{#$output.note#}}",
        "inputs": [{"type": "paragraph", "output_variable_name": "note"}],
        "user_actions": [{"id": "approve", "title": "Approve"}],
    }
    if version == "1":
        node["delivery_methods"] = [{"type": "webapp", "enabled": True, "id": str(uuid4())}]
    else:
        node.update(
            recipients_spec=[{"type": "initiator"}],
            message_template={"subject": "Review", "body": "Open {{#url#}}"},
            debug_mode={"enabled": False, "channels": []},
        )
    payload = {
        "owner_ref": {"environment_id": "env", "deployment_id": "deploy", "revision_id": "rev"},
        "node_execution_id": str(uuid4()),
        "node_id": "approval",
        "form_version": version,
        "node_data": node,
        "variables": {},
        "initiator": {"type": "end_user", "id": end_user.id},
        "run_created_at": naive_utc_now().isoformat(),
    }
    raw_user = "customer/email@example.com:原始用户"
    if caller == "service_api":
        payload["initiator"] = {"type": "end_user", "id": raw_user, "source": "service_api"}
    response = client.post(base + ":prepare", json=payload, headers=headers)
    assert response.status_code == 200, response.json
    prepared = response.json
    assert prepared["event"]["node_id"] == "approval"
    assert prepared["event"]["node_title"] == "Approve"
    assert prepared["event"]["form_version"] == version
    assert client.post(base + ":prepare", json=payload, headers=headers).json == prepared
    replay = client.get(base, headers=headers)
    assert replay.status_code == 200
    extra = replay.json["data"][0]["extra_content"]
    assert extra["workflow_run_id"] == run_id
    assert extra["submitted"] is False
    assert extra["form_definition"]["form_version"] == version
    token = prepared["form_token"]
    form_base = f"/inner/api/enterprise/apps/{app.id}/human-input-forms/{token}"
    query = f"?caller={caller}&end_user_id={end_user.id if caller == 'web_app' else raw_user}"
    assert client.get(form_base + query, headers=headers).status_code == 200
    submit = {
        "caller": caller,
        "end_user_id": end_user.id if caller == "web_app" else raw_user,
        "action": "approve",
        "inputs": {"note": "OK"},
    }
    response = client.post(form_base + ":submit", json=submit, headers=headers)
    assert response.status_code == 200, response.json
    assert response.json == {"workflow_run_id": run_id}
    result = client.post(base + ":prepare", json=payload, headers=headers)
    assert result.json["outputs"]["note"] == "OK"
    assert result.json["edge_source_handle"] == "approve"
    extra = client.get(base, headers=headers).json["data"][0]["extra_content"]
    assert extra["submitted"] is True
    assert extra["form_submission_data"]["submitted_data"] == {"note": "OK"}
    assert client.post(form_base + ":submit", json=submit, headers=headers).status_code == (
        412 if version == "1" or caller == "service_api" else 409
    )
    assert client.post(base + ":expire", headers=headers).status_code == 200

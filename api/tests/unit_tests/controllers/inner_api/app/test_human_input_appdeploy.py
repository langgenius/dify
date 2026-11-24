"""Exercise the served AppDeploy contract over the existing v2 services."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from controllers.inner_api import bp
from core.helper import encrypter
from core.human_input_v2.shared.values import TenantId
from enums import DeploymentEdition
from libs.datetime_utils import naive_utc_now
from models.enums import EndUserType
from models.model import AppMode, EndUser
from repositories.file_grant_repository import FileGrantRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from services.file_grant_service import FileGrantService
from services.file_service import FileService
from services.human_input_file_upload_service import InvalidUploadTokenError
from services.human_input_v2.file_upload_service import V2_UPLOAD_TOKEN_PREFIX, HumanInputV2FileUploadService
from services.human_input_v2.submission_service import HumanInputFormError
from services.remote_file_service import RemoteFileService
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
    monkeypatch.setattr(dify_config, "SECRET_KEY", "upload-contract-signing-key-long-enough")
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
        "form_content": "Review {{#start.reviewer#}} {{#$output.note#}}",
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
        "variables": {"start.sys.user_id": "system-user-17", "start.reviewer": "reviewer-42"},
        "initiator": {"type": "end_user", "id": end_user.id},
        "run_created_at": (naive_utc_now() - timedelta(hours=1)).isoformat(),
    }
    raw_user = "customer/email@example.com:原始用户"
    if caller == "service_api":
        payload["initiator"] = {"type": "end_user", "id": raw_user, "source": "service_api"}
    payload["file_owner_subject"] = "unminted-subject"
    assert client.post(base + ":prepare", json=payload, headers=headers).status_code == 400
    subject = "minted-run-subject"
    FileGrantRepository(session_factory=sqlite_session_factory).get_or_create_subject(
        tenant_id=tenant.id,
        app_id=app.id,
        session_id=FileGrantService.session_id_for_subject(subject),
        external_user_id=subject,
        is_anonymous=False,
    )
    payload["file_owner_subject"] = subject
    response = client.post(base + ":prepare", json=payload, headers=headers)
    assert response.status_code == 200, response.json
    prepared = response.json
    with sqlite_session_factory() as session:
        persisted = SQLAlchemyFormRepository(session, TenantId(tenant.id), app.id).get_form_by_id(prepared["form_id"])
    assert persisted is not None
    assert persisted.owner_ref["file_owner_subject"] == subject
    origin = persisted.created_at if version == "1" else datetime.fromisoformat(payload["run_created_at"])
    assert persisted.global_timeout_deadline == origin + timedelta(
        seconds=dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS
    )
    assert prepared["event"]["node_id"] == "approval"
    assert prepared["event"]["node_title"] == "Approve"
    assert prepared["event"]["form_version"] == version
    assert "reviewer-42" in prepared["event"]["form_content"]
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
    files = FileService(sqlite_session_factory)
    uploads = HumanInputV2FileUploadService(
        session_factory=sqlite_session_factory, files=files, remote_files=RemoteFileService(files=files)
    )
    monkeypatch.setattr("controllers.inner_api.app.human_input.build_file_upload_service", lambda: uploads)
    upload_body = {"caller": caller, "end_user_id": end_user.id if caller == "web_app" else raw_user}
    upload_path = form_base + ":uploadToken"
    assert client.post(upload_path, json=upload_body).status_code == 401
    assert client.post(upload_path, json={"caller": "unknown"}, headers=headers).status_code == 400
    if caller == "web_app":
        assert (
            client.post(upload_path, json={"caller": caller, "end_user_id": str(uuid4())}, headers=headers).status_code
            == 404
        )
    upload_response = client.post(upload_path, json=upload_body, headers=headers)
    assert upload_response.status_code == 200, upload_response.json
    grant = upload_response.json["upload_token"]
    assert grant.startswith(V2_UPLOAD_TOKEN_PREFIX)
    assert upload_response.json["expires_at"] == int(
        min(persisted.expiration_time, persisted.global_timeout_deadline).timestamp()
    )
    context = uploads.validate_upload_token(grant)
    assert context.owner.id != end_user.id
    assert context.form.id == persisted.id
    with sqlite_session_factory.begin() as session:
        session.get_one(EndUser, context.owner.id).type = EndUserType.TRIGGER
    with pytest.raises(InvalidUploadTokenError):
        uploads.validate_upload_token(grant)
    assert client.post(upload_path, json=upload_body, headers=headers).status_code == 403
    with sqlite_session_factory.begin() as session:
        session.get_one(EndUser, context.owner.id).type = EndUserType.APP_DEPLOY
    submit = {
        "caller": caller,
        "end_user_id": end_user.id if caller == "web_app" else raw_user,
        "action": "approve",
        "inputs": {"note": "OK"},
    }
    monkeypatch.setattr(
        "services.enterprise.human_input_run_gateway.EnterpriseRequest.send_request",
        lambda *_args, **_kwargs: {"state": "stopped", "has_checkpoint": True},
    )
    rejected = client.post(form_base + ":submit", json=submit, headers=headers)
    assert rejected.status_code == (400 if version == "1" or caller == "service_api" else 409)
    with sqlite_session_factory() as session:
        waiting = SQLAlchemyFormRepository(session, TenantId(tenant.id), app.id).get_form_by_id(prepared["form_id"])
    assert waiting is not None
    assert waiting.status.value == "waiting"
    monkeypatch.setattr(
        "services.enterprise.human_input_run_gateway.EnterpriseRequest.send_request",
        lambda *_args, **_kwargs: {"state": "paused", "has_checkpoint": True},
    )
    response = client.post(form_base + ":submit", json=submit, headers=headers)
    assert response.status_code == 200, response.json
    assert response.json == {"workflow_run_id": run_id}
    assert client.post(upload_path, json=upload_body, headers=headers).status_code == (
        412 if version == "1" or caller == "service_api" else 409
    )
    with pytest.raises(HumanInputFormError):
        uploads.validate_upload_token(grant)
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
    assert client.post(base + ":expire", headers=headers).status_code == 200
    with sqlite_session_factory() as session:
        submitted_form = SQLAlchemyFormRepository(session, TenantId(tenant.id), app.id).get_form_by_id(
            prepared["form_id"]
        )
    assert submitted_form is not None
    assert submitted_form.submission is not None

    # Stop a second waiting run and retry the same delivery after response loss.
    stopped_base = base.replace(run_id, str(uuid4()))
    stopped_payload = {**payload, "node_execution_id": str(uuid4())}
    stopped = client.post(stopped_base + ":prepare", json=stopped_payload, headers=headers)
    assert stopped.status_code == 200, stopped.json
    assert client.post(stopped_base + ":expire", headers=headers).status_code == 200
    assert client.post(stopped_base + ":expire", headers=headers).status_code == 200
    with sqlite_session_factory() as session:
        expired = SQLAlchemyFormRepository(session, TenantId(tenant.id), app.id).get_form_by_id(stopped.json["form_id"])
    assert expired is not None
    assert expired.status.value == "expired"

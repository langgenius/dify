"""Deployment IM uses the inner bridge and never a workspace key."""

import hashlib
import hmac
import json
import secrets
import time
from base64 import b64encode
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.human_input_v2.entities import IMProvider
from enums import DeploymentEdition
from libs.datetime_utils import naive_utc_now
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
from repositories.human_input_v2.sqlalchemy_im_channel_repository import DeploymentIMChannelWriter
from services.enterprise.base import EnterpriseRequest
from services.enterprise.human_input_im import EnterpriseIMCipher
from services.human_input_v2.im_credential_codec import IMCredentialError
from services.human_input_v2.im_webhook_runtime import IMWebhookIngressService


def test_cipher_paths_exclude_inner_prefix(monkeypatch):
    paths = []

    def send(_method, endpoint, **_kwargs):
        paths.append(endpoint)
        return {"reference": "reference", "credentials": "plaintext"}

    monkeypatch.setattr(EnterpriseRequest, "send_request", send)
    assert EnterpriseIMCipher().encrypt("plaintext") == b"reference"
    assert EnterpriseIMCipher().decrypt(b"reference") == "plaintext"
    assert paths == ["/integrations/im/credentials:seal", "/integrations/im/credentials:resolve"]


def test_deployment_route_signed_http_callback(sqlite_session_factory: sessionmaker[Session], monkeypatch):
    from flask import Flask

    from controllers.web.human_input_v2_im_webhook import bp

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    signing = secrets.token_hex(16)
    credentials = json.dumps(
        {
            "provider": "slack",
            "client_id": "test",
            "client_secret": secrets.token_hex(16),
            "signing_secret": signing,
            "bot_token": "xoxb-" + secrets.token_hex(16),
        }
    )
    calls = []

    def send(_method, endpoint, **_kwargs):
        calls.append(endpoint)
        return {"credentials": credentials}

    monkeypatch.setattr(EnterpriseRequest, "send_request", send)
    now = naive_utc_now()
    webhook = WebhookId(uuid4().hex)
    with sqlite_session_factory.begin() as session:
        DeploymentIMChannelWriter(session).create(
            IMChannel(
                id=IMChannelId(str(uuid4())),
                created_at=now,
                updated_at=now,
                provider=IMProvider.SLACK,
                provider_tenant_id="T_test",
                encrypted_credentials=ChannelEncryptedCredentials(ciphertext=b64encode(b"reference").decode()),
                app_identifier="test",
                webhook_id=webhook,
                config_version=1,
                status=IMChannelStatus.CONNECTED,
            )
        )
    ingress = IMWebhookIngressService(sessions=sqlite_session_factory, key_provider=None)
    monkeypatch.setattr("controllers.web.human_input_v2_im_webhook.build_im_webhook_ingress_service", lambda: ingress)
    app = Flask(__name__)
    app.register_blueprint(bp)
    body = json.dumps({"type": "url_verification", "challenge": "verified"}).encode()
    timestamp = str(int(time.time()))
    signature = (
        "v0=" + hmac.new(signing.encode(), b"v0:" + timestamp.encode() + b":" + body, hashlib.sha256).hexdigest()
    )
    response = app.test_client().post(
        "/callbacks/human-input/v2/im/" + webhook,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Slack-Request-Timestamp": timestamp,
            "X-Slack-Signature": signature,
        },
    )
    assert response.status_code == 200
    assert response.json == {"challenge": "verified"}
    assert app.test_client().post("/callbacks/human-input/v2/im/" + webhook, data=body).status_code == 401
    assert calls == ["/integrations/im/credentials:resolve"] * 2


def test_cipher_invalid_payload_is_safe(monkeypatch):
    monkeypatch.setattr(EnterpriseRequest, "send_request", lambda *_a, **_k: {})
    with pytest.raises(IMCredentialError):
        EnterpriseIMCipher().decrypt(b"reference")


def test_deployment_management_create_update_delete(sqlite_session_factory, monkeypatch):
    from flask import Flask
    from flask_restx import Api

    from controllers.inner_api.human_input_im import EnterpriseIMManagement
    from core.human_input_v2.im_integration.adapters.entities import CredentialTestSuccess
    from services.enterprise.human_input_im import DeploymentIMChannelService

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(dify_config, "INNER_API", True)
    monkeypatch.setattr(dify_config, "INNER_API_KEY", "test-inner")
    monkeypatch.setattr(dify_config, "TRIGGER_URL", "https://callback.example.com")
    saved = {}

    def bridge(_method, endpoint, **kwargs):
        if endpoint.endswith(":seal"):
            reference = str(uuid4())
            saved[reference] = kwargs["json"]["credentials"]
            return {"reference": reference}
        return {"credentials": saved[kwargs["json"]["reference"]]}

    monkeypatch.setattr(EnterpriseRequest, "send_request", bridge)
    monkeypatch.setattr(
        DeploymentIMChannelService,
        "_test_credentials",
        lambda _self, credentials: CredentialTestSuccess(credentials.provider, "T_test"),
    )
    monkeypatch.setattr(
        "controllers.inner_api.human_input_im.session_factory.get_session_maker", lambda: sqlite_session_factory
    )
    app = Flask(__name__)
    Api(app).add_resource(EnterpriseIMManagement, "/im")
    client = app.test_client()
    credentials = {
        "provider": "slack",
        "client_id": "test",
        "client_secret": secrets.token_hex(16),
        "signing_secret": secrets.token_hex(16),
        "bot_token": "xoxb-" + secrets.token_hex(16),
    }
    assert client.post("/im", json={"operation": "list"}).status_code == 401
    headers = {"X-Inner-Api-Key": "test-inner"}
    created = client.post("/im", headers=headers, json={"operation": "create", "credentials": credentials})
    assert created.status_code == 200
    summary = created.json["summary"]
    assert summary["config_version"] == 1
    addressed = {"channel_id": summary["id"], "expected_config_version": 1}
    detail = client.post("/im", headers=headers, json={"operation": "get", "channel_id": summary["id"]})
    assert detail.status_code == 200
    assert credentials["bot_token"] not in detail.text
    edited = client.post(
        "/im",
        headers=headers,
        json={
            **addressed,
            "operation": "update",
            "credentials": {"provider": "slack", "client_secret": secrets.token_hex(16)},
            "update_fields": ["client_secret"],
        },
    )
    assert edited.status_code == 200
    assert edited.json["summary"]["config_version"] == 2
    assert client.post("/im", headers=headers, json={**addressed, "operation": "delete"}).status_code == 409
    assert (
        client.post(
            "/im", headers=headers, json={**addressed, "expected_config_version": 2, "operation": "delete"}
        ).status_code
        == 200
    )
    assert client.post("/im", headers=headers, json={"operation": "list"}).json == {"channels": []}

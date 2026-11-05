"""Subscription HTTP reads use real plugin HTTP, RSA, SQL and Redis credential caches."""

import json
from collections.abc import Iterator
from contextvars import Context
from http import HTTPStatus
from pathlib import Path
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.helper.encrypter import encrypt_token
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.utils.encryption import TriggerProviderCredentialsCache, TriggerProviderPropertiesCache
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from extensions.ext_redis import redis_client
from models.base import TypeBase
from models.credential_permission import CredentialPermission
from models.credential_permission import CredentialType as PermissionCredentialType
from models.enums import PermissionEnum
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_provider_query
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _Daemon, _provider
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_query import _LIST, _add_subscription

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_provider_query.daemon


@pytest.fixture
def sqlite_engine(flask_app_with_containers: Flask, tmp_path: Path) -> Iterator[Engine]:
    # Reuse the real HTTP/admission harness with an isolated SQL database. Redis
    # is the container-backed production cache, initialized by the Flask fixture.
    assert redis_client is flask_app_with_containers.extensions["redis"]
    engine = create_engine(f"sqlite:///{tmp_path / 'subscriptions.sqlite3'}")
    TypeBase.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def sqlite_session_factory(sqlite_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=sqlite_engine, expire_on_commit=False)


def _provider_with_secrets() -> dict[str, object]:
    provider = _provider()
    declaration = provider["declaration"]
    assert isinstance(declaration, dict)
    credential_schema = [
        ProviderConfig(name="token", type=ProviderConfigType.SECRET_INPUT).model_dump(mode="json"),
        ProviderConfig(name="username", type=ProviderConfigType.TEXT_INPUT).model_dump(mode="json"),
    ]
    declaration["subscription_constructor"] = {
        "credentials_schema": credential_schema,
        "oauth_schema": {"credentials_schema": credential_schema},
    }
    declaration["subscription_schema"] = [
        ProviderConfig(name="secret", type=ProviderConfigType.SECRET_INPUT).model_dump(mode="json"),
        ProviderConfig(name="repository", type=ProviderConfigType.TEXT_INPUT).model_dump(mode="json"),
    ]
    return provider


@pytest.mark.parametrize(
    "credential_type", [CredentialType.API_KEY, CredentialType.OAUTH2, CredentialType.UNAUTHORIZED]
)
def test_subscription_http_masks_real_secrets_and_preserves_visibility_and_workflow_counts(
    harness: _Harness, daemon: _Daemon, credential_type: CredentialType
) -> None:
    daemon.response = _provider_with_secrets()
    with harness.app.app_context():
        ciphertext = encrypt_token(harness.tenant_id, "credential-secret")
        property_ciphertext = encrypt_token(harness.tenant_id, "property-secret")
    credentials = {} if credential_type == CredentialType.UNAUTHORIZED else {"token": ciphertext, "username": "octocat"}
    visible = [
        _add_subscription(
            harness,
            name="personal",
            credential_type=credential_type,
            credentials=credentials,
            properties={"secret": property_ciphertext, "repository": "dify"},
            visibility=PermissionEnum.ONLY_ME,
        ),
        _add_subscription(harness, name="team", user_id=str(uuid4())),
        _add_subscription(harness, name="shared", user_id=str(uuid4()), visibility=PermissionEnum.PARTIAL_TEAM),
    ]
    _add_subscription(harness, name="private", user_id=str(uuid4()), visibility=PermissionEnum.ONLY_ME)
    revoked = _add_subscription(harness, name="revoked", user_id=str(uuid4()), visibility=PermissionEnum.PARTIAL_TEAM)
    _add_subscription(harness, name="foreign-tenant", tenant_id=str(uuid4()))
    _add_subscription(harness, name="foreign-provider", provider_id="langgenius/github/other")
    app_id = str(uuid4())
    with harness.session_factory.begin() as session:
        session.add_all(
            [
                CredentialPermission(
                    credential_id=row.id,
                    credential_type=PermissionCredentialType.TRIGGER_SUBSCRIPTION,
                    account_id=harness.account_id,
                    tenant_id=harness.tenant_id,
                    has_permission=allowed,
                )
                for row, allowed in [(visible[2], True), (revoked, False)]
            ]
            + [
                WorkflowPluginTrigger(
                    app_id=app_id,
                    node_id=f"node-{index}",
                    tenant_id=harness.tenant_id,
                    provider_id=_PROVIDER,
                    event_name="push",
                    subscription_id=visible[0].id,
                )
                for index in range(2)
            ]
            + [
                WorkflowPluginTrigger(
                    app_id=str(uuid4()),
                    node_id="foreign-node",
                    tenant_id=str(uuid4()),
                    provider_id=_PROVIDER,
                    event_name="push",
                    subscription_id=visible[0].id,
                )
            ]
        )

    response = Context().run(harness.call, "GET", url=_LIST)

    assert response.status_code == HTTPStatus.OK
    assert response.content_type == "application/json"
    rows = {row["id"]: row for row in response.get_json()}
    assert rows.keys() == {row.id for row in visible}
    target = visible[0]
    assert rows[target.id] == {
        "id": target.id,
        "name": "personal",
        "provider": _PROVIDER,
        "credential_type": credential_type.value,
        "credentials": {}
        if credential_type == CredentialType.UNAUTHORIZED
        else {"token": "cr*************et", "username": "octocat"},
        "endpoint": generate_plugin_trigger_endpoint_url(target.endpoint_id),
        "parameters": {"event": "push"},
        "properties": {"secret": "pr***********et", "repository": "dify"},
        "workflows_in_use": 1,
    }
    assert all(rows[row.id]["workflows_in_use"] == 0 for row in visible[1:])
    assert len(daemon.requests) == 1
    assert not daemon.requests[0].open_transactions
    with harness.session_factory() as session:
        saved = session.scalar(select(TriggerSubscription).where(TriggerSubscription.id == target.id))
        assert saved is not None
        assert saved.credentials == credentials
        assert saved.properties == {"secret": property_ciphertext, "repository": "dify"}

    # The normal cache must contain decrypted values while the HTTP response
    # remains masked, including on a second request served from that cache.
    key = TriggerProviderPropertiesCache(harness.tenant_id, _PROVIDER, target.id).cache_key
    cached = redis_client.get(key)
    assert cached is not None
    assert json.loads(cached) == {"secret": "property-secret", "repository": "dify"}
    credential_key = TriggerProviderCredentialsCache(harness.tenant_id, _PROVIDER, target.id).cache_key
    cached_credentials = redis_client.get(credential_key)
    assert cached_credentials is not None
    assert json.loads(cached_credentials) == (
        {} if credential_type == CredentialType.UNAUTHORIZED else {"token": "credential-secret", "username": "octocat"}
    )
    repeated = Context().run(harness.call, "GET", url=_LIST)
    assert repeated.status_code == HTTPStatus.OK
    assert repeated.get_json() == response.get_json()

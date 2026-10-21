"""OAuth client routes exercise admission, credentials and persistence together."""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from http import HTTPStatus
from tempfile import TemporaryDirectory
from uuid import uuid4

import pytest
from flask import Blueprint, Flask, Response
from flask.testing import FlaskClient
from redis import Redis
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import HEADER_NAME_CSRF_TOKEN, HIDDEN_VALUE, UNKNOWN_VALUE
from controllers.console.workspace.trigger_providers import TriggerOAuthClientManageApi
from controllers.console.wraps import _is_setup_completed
from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.helper.encrypter import decrypt_token
from core.plugin.entities.oauth import OAuthSchema
from core.tools.entities.common_entities import I18nObject
from core.trigger.entities.entities import SubscriptionConstructor, TriggerProviderEntity, TriggerProviderIdentity
from core.trigger.provider import PluginTriggerProviderController
from enums import DeploymentEdition
from extensions.ext_application_services import application_services, build_application_services
from extensions.ext_key_provider import key_provider_manager
from extensions.ext_login import DifyLoginManager, bind_account_loader, load_user_from_request, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models import Account, DifySetup, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.engine import db
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerOAuthSystemClient, TriggerOAuthTenantClient
from repositories.trigger.oauth_client_repository import TriggerOAuthClientRepository
from services.trigger.oauth_client_service import TriggerOAuthClientService
from tests.unit_tests.config_override import config_overrides_context

_PROVIDER = "langgenius/github/github"
_URL = f"/console/api/workspaces/current/trigger-provider/{_PROVIDER}/oauth/client"
_SCHEMA = [
    ProviderConfig(name="client_id", type=ProviderConfigType.TEXT_INPUT),
    ProviderConfig(name="client_secret", type=ProviderConfigType.SECRET_INPUT),
]


@dataclass
class _PluginMetadata:
    """Only plugin-daemon metadata is supplied locally; credential logic is real."""

    provider: PluginTriggerProviderController
    sessions: list[Session]
    verified: bool = True
    provider_requests: int = 0
    # None means metadata arrives immediately; a callback controls one external
    # lookup so tests can interleave a real concurrent persistence operation.
    before_provider: Callable[[], None] | None = None

    def get_provider(self, tenant_id: str, provider_id: TriggerProviderID) -> PluginTriggerProviderController:
        assert all(not session.in_transaction() for session in self.sessions)
        assert tenant_id == self.provider.tenant_id
        assert str(provider_id) == str(self.provider.provider_id)
        self.provider_requests += 1
        before_provider = self.before_provider
        self.before_provider = None
        if before_provider is not None:
            before_provider()
        return self.provider

    def is_verified(self, tenant_id: str, plugin_unique_identifier: str) -> bool:
        assert all(not session.in_transaction() for session in self.sessions)
        assert tenant_id == self.provider.tenant_id
        assert plugin_unique_identifier == self.provider.plugin_unique_identifier
        return self.verified


@dataclass(frozen=True)
class _Harness:
    app: Flask
    client: FlaskClient
    session_factory: sessionmaker[Session]
    account_id: str
    tenant_id: str
    headers: dict[str, str]
    metadata: _PluginMetadata

    def call(self, method: str, *, payload: dict[str, object] | None = None, url: str = _URL) -> TestResponse:
        return self.client.open(url, method=method, headers=self.headers, json=payload)

    def set_role(self, role: TenantAccountRole) -> None:
        with self.session_factory.begin() as session:
            membership = session.scalar(
                select(TenantAccountJoin).where(TenantAccountJoin.account_id == self.account_id)
            )
            assert membership is not None
            membership.role = role

    def add_client(self, *, tenant_id: str, encrypted_params: str = "{}", enabled: bool = True) -> str:
        with self.session_factory.begin() as session:
            client = TriggerOAuthTenantClient(
                tenant_id=tenant_id,
                plugin_id="langgenius/github",
                provider="github",
                encrypted_oauth_params=encrypted_params,
                enabled=enabled,
            )
            session.add(client)
            session.flush()
            return client.id

    def saved_params(self) -> dict[str, object]:
        with self.session_factory() as session:
            client = session.scalar(
                select(TriggerOAuthTenantClient).where(TriggerOAuthTenantClient.tenant_id == self.tenant_id)
            )
            assert client is not None
            params = json.loads(client.encrypted_oauth_params)
            assert isinstance(params, dict)
            return params


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    previous_storage = storage.__dict__.copy()
    previous_key_provider = key_provider_manager._provider
    with (
        TemporaryDirectory(prefix="trigger-oauth-keys-") as storage_path,
        Redis() as redis_client,
        config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            RBAC_ENABLED=False,
            LOGIN_DISABLED=False,
            INIT_PASSWORD="",
            SECRET_KEY="trigger-oauth-http-secret-at-least-32-bytes",
            CONSOLE_API_URL="https://console.example.test",
            KEY_PROVIDER_TYPE="local",
            STORAGE_TYPE="local",
            STORAGE_LOCAL_PATH=storage_path,
        ),
    ):
        app = Flask(__name__)
        app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
        db.init_app(app)
        storage.init_app(app)
        key_provider_manager.init_app(app)
        now = naive_utc_now()
        with sqlite_session_factory.begin() as session:
            account = Account(
                email="oauth@example.com", name="OAuth admin", status=AccountStatus.ACTIVE, initialized_at=now
            )
            account.last_active_at = now
            tenant = Tenant(name="OAuth workspace")
            session.add_all([account, tenant, DifySetup(version="test")])
            session.flush()
            tenant.encrypt_public_key = key_provider_manager.provider.generate_key_pair(tenant.id)
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                    current=True,
                )
            )
            account_id, tenant_id = account.id, tenant.id

        sessions: list[Session] = []
        provider = PluginTriggerProviderController(
            entity=TriggerProviderEntity(
                identity=TriggerProviderIdentity(
                    author="Dify",
                    name="github",
                    label=I18nObject(en_US="GitHub"),
                    description=I18nObject(en_US="GitHub trigger"),
                ),
                subscription_constructor=SubscriptionConstructor(oauth_schema=OAuthSchema(client_schema=_SCHEMA)),
            ),
            plugin_id="langgenius/github",
            plugin_unique_identifier="langgenius/github:1.0.0@test",
            provider_id=TriggerProviderID(_PROVIDER),
            tenant_id=tenant_id,
        )
        metadata = _PluginMetadata(provider, sessions)
        redis = RedisClientWrapper()
        redis.initialize(redis_client)
        services = build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=redis,
        )
        oauth_clients = TriggerOAuthClientService(
            clients=TriggerOAuthClientRepository(session_factory=sqlite_session_factory),
            get_provider=metadata.get_provider,
            is_plugin_verified=metadata.is_verified,
        )
        services = replace(services, workspaces=replace(services.workspaces, trigger_oauth_clients=oauth_clients))
        app.extensions["application_services"] = services
        bind_account_loader(app, services.accounts.identity.load_user)
        login_manager = DifyLoginManager()
        login_manager.request_loader(load_user_from_request)
        login_manager.unauthorized_handler(unauthorized_handler)
        login_manager.init_app(app)
        blueprint = Blueprint("console", __name__, url_prefix="/console/api")
        api = ExternalApi(blueprint)
        api.add_resource(
            TriggerOAuthClientManageApi, "/workspaces/current/trigger-provider/<path:provider>/oauth/client"
        )
        app.register_blueprint(blueprint)

        with app.app_context():
            _is_setup_completed.reset_success()
            assert _is_setup_completed()
            db.session.remove()
        client = app.test_client()
        csrf_token = generate_csrf_token(account_id)
        client.set_cookie(_real_cookie_name("csrf_token"), csrf_token)
        headers = {
            "Authorization": f"Bearer {PassportService().issue({'user_id': account_id})}",
            HEADER_NAME_CSRF_TOKEN: csrf_token,
        }

        def observe_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            sessions.append(session)

        @app.after_request
        def assert_repository_sessions_closed(response: Response) -> Response:
            assert all(not session.in_transaction() and not session.identity_map for session in sessions)
            return response

        # The existing RSA provider uses Flask's scoped session for its tenant
        # key lookup. Observe the injected repository factory independently.
        event.listen(sqlite_session_factory.class_, "after_begin", observe_session)
        try:
            yield _Harness(app, client, sqlite_session_factory, account_id, tenant_id, headers, metadata)
        finally:
            event.remove(sqlite_session_factory.class_, "after_begin", observe_session)
            _is_setup_completed.reset_success()
            with app.app_context():
                db.session.remove()
                db.engine.dispose()
            storage.__dict__.clear()
            storage.__dict__.update(previous_storage)
            key_provider_manager._provider = previous_key_provider


def test_missing_configuration_returns_complete_shape(harness: _Harness) -> None:
    response = harness.call("GET")

    assert response.status_code == HTTPStatus.OK
    assert response.content_type == "application/json"
    assert response.get_json() == {
        "configured": False,
        "system_configured": False,
        "custom_configured": False,
        "custom_enabled": False,
        "oauth_client_schema": [field.model_dump(mode="json") for field in _SCHEMA],
        "redirect_uri": f"https://console.example.test/console/api/oauth/plugin/{_PROVIDER}/trigger/callback",
        "params": {},
    }


def test_credentials_encrypt_mask_and_preserve_hidden_secret(harness: _Harness) -> None:
    secret = "oauth-secret-value"
    response = harness.call("POST", payload={"client_params": {"client_id": "before", "client_secret": secret}})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    encrypted = harness.saved_params()["client_secret"]
    assert isinstance(encrypted, str)
    assert encrypted != secret
    with harness.app.app_context():
        assert decrypt_token(harness.tenant_id, encrypted) == secret

    response = harness.call("GET")
    assert response.status_code == HTTPStatus.OK
    body = response.get_json()
    assert body["configured"] is True
    assert body["custom_configured"] is True
    assert body["custom_enabled"] is True
    assert body["params"] == {"client_id": "before", "client_secret": "oa**************ue"}
    assert secret not in response.get_data(as_text=True)

    response = harness.call(
        "POST", payload={"client_params": {"client_id": "after", "client_secret": HIDDEN_VALUE}, "enabled": False}
    )
    assert response.status_code == HTTPStatus.OK
    saved = harness.saved_params()
    assert saved["client_id"] == "after"
    assert isinstance(saved["client_secret"], str)
    with harness.app.app_context():
        assert decrypt_token(harness.tenant_id, saved["client_secret"]) == secret
    response = harness.call("GET")
    assert response.get_json()["custom_enabled"] is False
    assert response.get_json()["params"]["client_id"] == "after"


@pytest.mark.parametrize("payload", [{}, {"client_params": None, "enabled": None}])
def test_empty_update_is_noop_without_plugin_lookup(harness: _Harness, payload: dict[str, object]) -> None:
    response = harness.call("POST", payload=payload)

    assert response.status_code == HTTPStatus.OK
    assert harness.metadata.provider_requests == 0
    with harness.session_factory() as session:
        assert session.scalar(select(TriggerOAuthTenantClient)) is None


def test_enabled_only_update_retains_existing_clear_credentials_behavior(harness: _Harness) -> None:
    harness.add_client(tenant_id=harness.tenant_id, encrypted_params='{"client_id":"existing"}')

    response = harness.call("POST", payload={"enabled": False})

    assert response.status_code == HTTPStatus.OK
    assert harness.saved_params() == {}
    response = harness.call("GET")
    assert response.get_json()["custom_configured"] is False
    assert response.get_json()["custom_enabled"] is False


def test_hidden_value_without_prior_value_uses_existing_unknown_fallback(harness: _Harness) -> None:
    response = harness.call("POST", payload={"client_params": {"client_id": HIDDEN_VALUE}})

    assert response.status_code == HTTPStatus.OK
    assert harness.saved_params() == {"client_id": UNKNOWN_VALUE}


def test_concurrent_delete_does_not_resurrect_a_hidden_secret(harness: _Harness) -> None:
    secret = "deleted-oauth-secret"
    response = harness.call("POST", payload={"client_params": {"client_secret": secret}})
    assert response.status_code == HTTPStatus.OK

    def delete_during_provider_lookup() -> None:
        repository = TriggerOAuthClientRepository(session_factory=harness.session_factory)
        repository.delete(tenant_id=harness.tenant_id, provider_id=TriggerProviderID(_PROVIDER))

    harness.metadata.before_provider = delete_during_provider_lookup
    response = harness.call("POST", payload={"client_params": {"client_secret": HIDDEN_VALUE}})

    assert response.status_code == HTTPStatus.CONFLICT
    assert response.get_json()["code"] == "trigger_oauth_client_changed"
    assert secret not in response.get_data(as_text=True)
    with harness.session_factory() as session:
        assert session.scalar(select(TriggerOAuthTenantClient)) is None


@pytest.mark.parametrize("existing", [False, True])
def test_concurrent_save_preserves_winning_secret(harness: _Harness, existing: bool) -> None:
    old_secret = "old-oauth-secret"
    winning_secret = "rotated-oauth-secret"
    if existing:
        response = harness.call("POST", payload={"client_params": {"client_secret": old_secret}})
        assert response.status_code == HTTPStatus.OK

    def save_during_provider_lookup() -> None:
        application_services().workspaces.trigger_oauth_clients.save(
            tenant_id=harness.tenant_id,
            provider_id=TriggerProviderID(_PROVIDER),
            client_params={"client_id": "winning-client", "client_secret": winning_secret},
            enabled=False,
        )

    harness.metadata.before_provider = save_during_provider_lookup
    response = harness.call(
        "POST",
        payload={"client_params": {"client_secret": HIDDEN_VALUE if existing else old_secret}, "enabled": True},
    )

    assert response.status_code == HTTPStatus.CONFLICT
    assert response.get_json()["code"] == "trigger_oauth_client_changed"
    assert old_secret not in response.get_data(as_text=True)
    assert winning_secret not in response.get_data(as_text=True)
    saved = harness.saved_params()
    assert saved["client_id"] == "winning-client"
    encrypted_secret = saved["client_secret"]
    assert isinstance(encrypted_secret, str)
    with harness.app.app_context():
        assert decrypt_token(harness.tenant_id, encrypted_secret) == winning_secret
    assert harness.call("GET").get_json()["custom_enabled"] is False


@pytest.mark.parametrize("verified", [True, False])
def test_system_configuration_requires_verified_plugin(harness: _Harness, verified: bool) -> None:
    harness.metadata.verified = verified
    with harness.session_factory.begin() as session:
        session.add(
            TriggerOAuthSystemClient(
                plugin_id="langgenius/github", provider="github", encrypted_oauth_params='{"secret":"system-secret"}'
            )
        )

    response = harness.call("GET")

    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["system_configured"] is verified
    assert response.get_json()["configured"] is verified
    assert response.get_json()["params"] == {}
    assert "system-secret" not in response.get_data(as_text=True)


def test_client_read_and_delete_do_not_touch_other_workspace(harness: _Harness) -> None:
    other_client_id = harness.add_client(tenant_id=str(uuid4()), encrypted_params='{"client_id":"other-workspace"}')
    assert harness.call("GET").get_json()["params"] == {}
    harness.call("POST", payload={"client_params": {"client_id": "own-workspace"}})

    for _ in range(2):
        response = harness.call("DELETE")
        assert response.status_code == HTTPStatus.OK
        assert response.get_json() == {"result": "success"}
    with harness.session_factory() as session:
        clients = session.scalars(select(TriggerOAuthTenantClient)).all()
        assert [client.id for client in clients] == [other_client_id]
        assert clients[0].oauth_params == {"client_id": "other-workspace"}


@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize("stored_params", ["{broken-json", "[]"])
def test_corrupt_persisted_configuration_is_server_error(harness: _Harness, method: str, stored_params: str) -> None:
    harness.add_client(tenant_id=harness.tenant_id, encrypted_params=stored_params)

    response = harness.call(method, payload={"client_params": {"client_id": "new"}} if method == "POST" else None)

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.get_json()["code"] == "trigger_oauth_client_config_invalid"
    assert _PROVIDER in response.get_json()["message"]
    assert stored_params not in response.get_data(as_text=True)


@pytest.mark.parametrize("method", ["GET", "POST", "DELETE"])
@pytest.mark.parametrize(
    "role", [TenantAccountRole.EDITOR, TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR]
)
def test_configuration_requires_workspace_admin(harness: _Harness, method: str, role: TenantAccountRole) -> None:
    harness.set_role(role)

    response = harness.call(method, payload={"enabled": True} if method == "POST" else None)

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert harness.metadata.provider_requests == 0
    with harness.session_factory() as session:
        assert session.scalar(select(TriggerOAuthTenantClient)) is None


def test_admin_can_manage_configuration(harness: _Harness) -> None:
    harness.set_role(TenantAccountRole.ADMIN)

    assert harness.call("POST", payload={"client_params": {"client_id": "admin"}}).status_code == HTTPStatus.OK
    assert harness.call("GET").get_json()["params"] == {"client_id": "admin"}
    assert harness.call("DELETE").status_code == HTTPStatus.OK


@pytest.mark.parametrize("method", ["GET", "POST", "DELETE"])
def test_invalid_provider_has_client_error(harness: _Harness, method: str) -> None:
    response = harness.call(method, payload={"enabled": True}, url=_URL.replace(_PROVIDER, "not/a/valid/provider"))

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert harness.metadata.provider_requests == 0


@pytest.mark.parametrize("payload", [{"client_params": []}, {"enabled": "not-a-bool"}])
def test_invalid_payload_returns_validation_error(harness: _Harness, payload: dict[str, object]) -> None:
    response = harness.call("POST", payload=payload)

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert harness.metadata.provider_requests == 0


@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_write_requires_csrf(harness: _Harness, method: str) -> None:
    response = harness.client.open(
        _URL, method=method, headers={"Authorization": harness.headers["Authorization"]}, json={"enabled": True}
    )

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert harness.metadata.provider_requests == 0


def test_configuration_requires_login(harness: _Harness) -> None:
    response = harness.client.get(_URL)

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert harness.metadata.provider_requests == 0

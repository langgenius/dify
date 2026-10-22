"""OAuth harness with real Client resolution, persistence and one-use context serialization."""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from threading import Event, Lock
from typing import Any, override
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy.orm import Session, sessionmaker
from werkzeug import Request

from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.plugin.entities.oauth import OAuthSchema
from core.plugin.entities.plugin_daemon import PluginOAuthAuthorizationUrlResponse, PluginOAuthCredentialsResponse
from core.plugin.impl.oauth import OAuthHandler
from core.tools.entities.common_entities import I18nObject
from extensions.ext_redis import redis_client
from libs.uuid_utils import uuidv7
from models.enums import CustomizeTokenStrategy
from models.model import Site
from models.tools import ToolOAuthTenantClient
from models.workflow import Workflow
from services.end_user_connection_adapters import PublishedConnectionTargetResolver
from services.end_user_connection_oauth_adapters import (
    PluginConnectionOAuthGateway,
    RedisConnectionOAuthAttempts,
    RedisOAuthRefreshSingleFlight,
)
from services.end_user_connections.contracts import ConnectionOAuthStart, ConnectionSummary, StartConnectionOAuthInput
from services.end_user_connections.management import ConnectionService
from services.end_user_connections.oauth import OAuthConnectionService
from services.end_user_connections.oauth_lifecycle import OAuthConnectionLifecycleService
from tests.helpers.end_user_api_key import PROVIDER, ConnectionHarness, TestProviders, make_harness, plugin_provider


class ScriptedOAuthHandler(OAuthHandler):
    def __init__(self) -> None:
        self.result = PluginOAuthCredentialsResponse(
            credentials={"access_token": "access-secret", "refresh_token": "refresh-secret"},
            metadata={"email": "alice@example.com", "private": "hidden-metadata"},
            expires_at=2000000000,
        )
        self.on_exchange: Callable[[], None] | None = None
        self.callback_headers: dict[str, str] = {}
        self.exchanges = 0
        self.refreshes: list[dict[str, Any]] = []
        self.on_refresh: Callable[[], None] | None = None
        self.refresh_error: Exception | None = None
        self.refresh_result = PluginOAuthCredentialsResponse(
            credentials={"access_token": "new-access-secret"},
            expires_at=2000000000,
        )

    @override
    def get_authorization_url(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, Any],
    ) -> PluginOAuthAuthorizationUrlResponse:
        return PluginOAuthAuthorizationUrlResponse(
            authorization_url=f"https://provider.example/authorize?state={uuidv7()}"
        )

    @override
    def get_credentials(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, Any],
        request: Request,
    ) -> PluginOAuthCredentialsResponse:
        self.exchanges += 1
        self.callback_headers = dict(request.headers)
        if callback := self.on_exchange:
            self.on_exchange = None
            callback()
        return self.result

    @override
    def refresh_credentials(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, Any],
        credentials: Mapping[str, Any],
    ) -> PluginOAuthCredentialsResponse:
        self.refreshes.append(dict(credentials))
        if callback := self.on_refresh:
            self.on_refresh = None
            callback()
        if self.refresh_error is not None:
            raise self.refresh_error
        return self.refresh_result


@dataclass
class OAuthHarness:
    base: ConnectionHarness
    service: OAuthConnectionService
    gateway: PluginConnectionOAuthGateway
    handler: ScriptedOAuthHandler
    attempts: RedisConnectionOAuthAttempts
    redis_values: dict[str, str]
    client_id: str
    app_code: str
    flight_joined: Event

    def command(self) -> StartConnectionOAuthInput:
        return StartConnectionOAuthInput(
            workflow_id=self.base.command().workflow_id, node_id="tool-1", name="My calendar"
        )

    def start(self) -> ConnectionOAuthStart:
        return self.service.start_oauth(
            self.base.context,
            self.command(),
            callback_url="http://web-api.example/api/connections/oauth",
        )

    @staticmethod
    def query(start: ConnectionOAuthStart) -> bytes:
        state = parse_qs(urlsplit(start.authorization_url).query)["state"][0]
        return f"state={state}&code=authorization-code".encode()

    def finish(self, start: ConnectionOAuthStart) -> ConnectionSummary:
        attempt = self.service.consume_attempt(start.context_id, provider=PROVIDER)
        return self.service.complete_oauth(attempt, query_string=self.query(start))


def make_oauth_harness(sessions: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    base = make_harness(sessions)
    controller = plugin_provider(base.context.tenant_id)
    label = I18nObject(en_US="OAuth")
    controller.entity.oauth_schema = OAuthSchema(
        client_schema=[
            ProviderConfig(name="client_id", label=label, type=ProviderConfigType.TEXT_INPUT, required=True)
        ],
        credentials_schema=[
            ProviderConfig(name="access_token", label=label, type=ProviderConfigType.SECRET_INPUT, required=True)
        ],
    )
    app_code = str(uuidv7())
    with sessions.begin() as session:
        workflow = session.get(Workflow, base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["end_user_auth"]["allowed_credential_types"] = ["api-key", "oauth2"]
        workflow.graph = json.dumps(graph)
        config = ToolOAuthTenantClient(
            tenant_id=base.context.tenant_id, plugin_id="vendor/calendar", provider="calendar"
        )
        config.encrypted_oauth_params = json.dumps({"client_id": "public-client"})
        session.add(config)
        session.add(
            Site(
                app_id=base.context.app_id,
                title="App",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                code=app_code,
            )
        )
        session.flush()
        client_id = config.id
    values: dict[str, str] = {}

    def setex(key: str, ttl: int, value: str) -> None:
        assert ttl == 300
        values[key] = value

    monkeypatch.setattr(redis_client, "setex", setex)
    monkeypatch.setattr(redis_client, "get", lambda key: values.get(key))
    monkeypatch.setattr(redis_client, "delete", lambda key: int(values.pop(key, None) is not None))
    mutex = Lock()
    flight_joined = Event()

    def evaluate(script: str, key_count: int, *args: object) -> object:
        with mutex:
            key = str(args[0])
            if script == RedisOAuthRefreshSingleFlight._JOIN:
                assert key_count == 1
                assert args[2] == 60
                if key in values:
                    flight_joined.set()
                    return [0, values[key]]
                token = str(args[1])
                values[key] = token
                return [1, token]
            assert script == RedisOAuthRefreshSingleFlight._PUBLISH
            assert key_count == 2
            assert args[4] == 60
            if values.get(key) != args[2]:
                return 0
            values[str(args[1])] = str(args[3])
            del values[key]
            return 1

    def get(key: str) -> str | None:
        with mutex:
            return values.get(key)

    monkeypatch.setattr(redis_client, "get", get)
    monkeypatch.setattr(redis_client, "eval", evaluate)
    providers = TestProviders(base.auth, controller)
    handler = ScriptedOAuthHandler()
    gateway = PluginConnectionOAuthGateway(
        clients=base.repository, providers=providers, handler=handler, auth=base.auth
    )
    attempts = RedisConnectionOAuthAttempts()
    service = OAuthConnectionService(
        store=base.repository,
        targets=PublishedConnectionTargetResolver(workflows=base.repository, providers=providers),
        gateway=gateway,
        attempts=attempts,
        cipher=base.cipher,
    )
    base.service = ConnectionService(
        store=base.repository,
        targets=PublishedConnectionTargetResolver(workflows=base.repository, providers=providers),
        credentials=providers,
        cipher=base.cipher,
        oauth=OAuthConnectionLifecycleService(
            store=base.repository,
            gateway=gateway,
            cipher=base.cipher,
            refreshes=RedisOAuthRefreshSingleFlight(redis=redis_client),
        ),
    )
    return OAuthHarness(base, service, gateway, handler, attempts, values, client_id, app_code, flight_joined)

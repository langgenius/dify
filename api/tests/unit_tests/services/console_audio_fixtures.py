"""Console audio HTTP tests using the real composition root, SQLite and plugin protocol."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from io import BytesIO
from typing import Literal
from uuid import uuid4

import httpx
import pytest
from flask import Flask
from redis import Redis
from sqlalchemy import Connection, Engine, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.app import audio
from controllers.console.wraps import _is_setup_completed
from core.plugin.impl import base as plugin_http
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import build_application_services
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from graphon.model_runtime.entities.model_entities import ModelType
from libs.external_api import ExternalApi
from libs.token import generate_csrf_token
from models import Account, App, AppModelConfig, Message, Tenant, TenantAccountJoin
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource
from models.model import AppMode, DifySetup
from models.provider import Provider, TenantDefaultModel
from tests.unit_tests.model_factories import make_account, make_app, make_message
from tests.unit_tests.services.audio_runtime_fixtures import AudioPlugin

type AudioOperation = Literal["asr", "tts", "voices"]


@dataclass
class ConsoleAudioHarness:
    app: Flask
    factory: sessionmaker[Session]
    account: Account
    tenant: Tenant
    target: App
    config: AppModelConfig
    message: Message
    plugin: AudioPlugin
    agent_id: str = field(default_factory=lambda: str(uuid4()))
    sessions: list[Session] = field(default_factory=list)

    def request(
        self,
        operation: AudioOperation,
        *,
        agent: bool = False,
        payload: dict[str, object] | None = None,
        content: bytes | None = b"recording",
        mime_type: str = "audio/mp3",
        authenticated: bool = True,
        csrf: bool = True,
    ) -> TestResponse:
        client = self.app.test_client()
        headers: dict[str, str] = {}
        if authenticated:
            with client.session_transaction() as session:
                session["_user_id"] = self.account.id
                session["_fresh"] = True
            if csrf:
                token = generate_csrf_token(self.account.id)
                client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
                headers[HEADER_NAME_CSRF_TOKEN] = token
        resource = f"agent/{self.agent_id}" if agent else f"apps/{self.target.id}"
        if operation == "voices":
            response = client.get(
                f"/{resource}/text-to-audio/voices", query_string=payload, headers=headers, buffered=True
            )
        elif operation == "tts":
            response = client.post(f"/{resource}/text-to-audio", json=payload, headers=headers, buffered=True)
        else:
            data = dict(payload or {})
            if content is not None:
                data["file"] = (BytesIO(content), "recording.mp3", mime_type)
            response = client.post(f"/{resource}/audio-to-text", data=data, headers=headers, buffered=True)
        self.assert_closed()
        return response

    def assert_closed(self) -> None:
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)

    def add_agent(
        self,
        *,
        scope: AgentScope = AgentScope.ROSTER,
        backing: bool = True,
        published_enabled: bool = True,
        draft_enabled: bool = True,
        debug_enabled: bool | None = None,
        debug_account_id: str | None = None,
    ) -> None:
        def soul(enabled: bool) -> AgentSoulConfig:
            return AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": enabled}}})

        with self.factory.begin() as session:
            session.execute(update(App).where(App.id == self.target.id).values(mode=AppMode.AGENT))
            snapshot = AgentConfigSnapshot(
                tenant_id=self.tenant.id, agent_id=self.agent_id, version=1, config_snapshot=soul(published_enabled)
            )
            session.add(snapshot)
            session.flush()
            workflow_only = scope == AgentScope.WORKFLOW_ONLY
            session.add(
                Agent(
                    id=self.agent_id,
                    tenant_id=self.tenant.id,
                    name="Audio agent",
                    scope=scope,
                    source=AgentSource.WORKFLOW if workflow_only else AgentSource.AGENT_APP,
                    status=AgentStatus.ACTIVE,
                    app_id=str(uuid4()) if workflow_only else self.target.id,
                    backing_app_id=self.target.id if workflow_only and backing else None,
                    workflow_id=str(uuid4()) if workflow_only else None,
                    workflow_node_id="audio-node" if workflow_only else None,
                    active_config_snapshot_id=snapshot.id,
                    created_by=self.account.id,
                    updated_by=self.account.id,
                )
            )
            session.add(
                AgentConfigDraft(
                    tenant_id=self.tenant.id,
                    agent_id=self.agent_id,
                    draft_type=AgentConfigDraftType.DRAFT,
                    draft_owner_key="",
                    base_snapshot_id=snapshot.id,
                    config_snapshot=soul(draft_enabled),
                )
            )
            if debug_enabled is not None:
                owner = debug_account_id or self.account.id
                session.add(
                    AgentConfigDraft(
                        tenant_id=self.tenant.id,
                        agent_id=self.agent_id,
                        draft_type=AgentConfigDraftType.DEBUG_BUILD,
                        account_id=owner,
                        draft_owner_key=owner,
                        base_snapshot_id=snapshot.id,
                        config_snapshot=soul(debug_enabled),
                    )
                )


@pytest.fixture
def console_audio(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    audio_plugin: AudioPlugin,
) -> Iterator[ConsoleAudioHarness]:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        LOGIN_DISABLED=False,
        RBAC_ENABLED=False,
        SECRET_KEY="console-audio-http-tests-at-least-32-bytes",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
        COOKIE_DOMAIN="",
    )
    tenant = Tenant(name="Console audio workspace")
    account = make_account(account_id=str(uuid4()), timezone="UTC")
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id)
    config = AppModelConfig(
        app_id=target.id,
        speech_to_text='{"enabled":true}',
        text_to_speech='{"enabled":true,"voice":"published-voice"}',
    )
    message = make_message(
        message_id=str(uuid4()),
        app_id=target.id,
        conversation_id=str(uuid4()),
        inputs={},
        message={},
        query="Question",
        answer=" Owned console answer ",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
                account,
                target,
                config,
                message,
                DifySetup(version="test"),
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
                Provider(tenant_id=tenant.id, provider_name="testing/audio/audio", is_valid=True),
                *(
                    TenantDefaultModel(
                        tenant_id=tenant.id,
                        provider_name="testing/audio/audio",
                        model_name="audio-model",
                        model_type=model_type,
                    )
                    for model_type in (ModelType.SPEECH2TEXT, ModelType.TTS)
                ),
            ]
        )
        session.flush()
        target.app_model_config_id = config.id
    app = Flask(__name__)
    app.config.update(
        TESTING=True,
        RESTX_ERROR_404_HELP=False,
        SECRET_KEY="console-test-session",
        SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url),
    )
    db.init_app(app)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)

    @login_manager.user_loader
    def load_account(account_id: str) -> Account | None:
        with sqlite_session_factory() as session:
            loaded = session.get(Account, account_id)
            if loaded is not None:
                loaded.set_tenant_id_with_session(tenant.id, session=session)
        return loaded

    # The SDK's inherited credential session is deliberately not included here:
    # this migration closes the admission and audio configuration transactions.
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    redis = RedisClientWrapper()
    redis.initialize(Redis(host="127.0.0.1", port=1))
    app.extensions["application_services"] = build_application_services(
        database_client=factory, deployment_edition=DeploymentEdition.COMMUNITY, initialization_password="", redis=redis
    )
    api = ExternalApi(app)
    for prefix, asr, tts, voices in (
        ("apps/<uuid:app_id>", audio.ChatMessageAudioApi, audio.ChatMessageTextApi, audio.TextModesApi),
        (
            "agent/<uuid:agent_id>",
            audio.AgentChatMessageAudioApi,
            audio.AgentChatMessageTextApi,
            audio.AgentTextToSpeechVoicesApi,
        ),
    ):
        api.add_resource(asr, f"/{prefix}/audio-to-text")
        api.add_resource(tts, f"/{prefix}/text-to-audio")
        api.add_resource(voices, f"/{prefix}/text-to-audio/voices")
    harness = ConsoleAudioHarness(app, sqlite_session_factory, account, tenant, target, config, message, audio_plugin)

    def observe_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        harness.sessions.append(session)

    def observe_provider(_request: httpx.Request) -> None:
        assert harness.sessions
        harness.assert_closed()

    event.listen(factory, "after_begin", observe_session)
    _is_setup_completed.reset_success()
    plugin_http._httpx_client.event_hooks["request"].append(observe_provider)
    try:
        yield harness
    finally:
        _is_setup_completed.reset_success()
        plugin_http._httpx_client.event_hooks["request"].remove(observe_provider)
        event.remove(factory, "after_begin", observe_session)
        with app.app_context():
            db.session.remove()
            db.engine.dispose()

"""Exercise real model resolution, generation and failures with PostgreSQL/Redis.

Only provider discovery, decoded credentials and schema data are seeded in their
normal caches. ModelManager and HTTP transport run normally, against either a
loopback provider returning valid SSE or a daemon with a missing installation.
"""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from http import HTTPStatus
from threading import Thread

import httpx
import pytest
from flask import Flask, Response
from flask.testing import FlaskClient
from sqlalchemy import Connection, delete, event, select, update
from sqlalchemy.orm import Session, SessionTransaction
from werkzeug.serving import make_server
from yarl import URL

from configs import dify_config
from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from core.model_context import get_credit_usage_metadata
from core.model_manager import ModelManager
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from core.plugin.impl import base as plugin_base
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from core.plugin.plugin_service import PluginService
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod
from models.account import Account
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, Conversation, Message
from models.provider import LoadBalancingModelConfig, Provider, ProviderModelSetting, TenantDefaultModel
from services.entities.message_entities import MessageAccount
from services.message_suggested_questions_generator import SuggestedQuestionsGenerator
from services.message_suggested_questions_service import SuggestedQuestionsContext
from tests.e2e_tests.containers.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)

_PROVIDER = "tests/suggested/suggested"
_MODEL = "questions-model"


@dataclass(frozen=True)
class _Scenario:
    account: Account
    context: SuggestedQuestionsContext


@pytest.fixture
def scenario(db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch) -> _Scenario:
    monkeypatch.setattr(dify_config, "PLUGIN_MODEL_PROVIDERS_CACHE_ENABLED", True)
    session = db_session_with_containers
    account, tenant = create_console_account_and_tenant(session)
    app = create_console_app(session, tenant.id, account.id, AppMode.CHAT)
    config = AppModelConfig(app_id=app.id, suggested_questions_after_answer='{"enabled":true}')
    session.add(config)
    session.flush()
    app.app_model_config_id = config.id
    conversation = Conversation(
        app_id=app.id,
        app_model_config_id=config.id,
        mode=AppMode.CHAT,
        name="Suggested questions",
        _inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
    )
    session.add(conversation)
    session.flush()
    message = Message(
        app_id=app.id,
        conversation_id=conversation.id,
        _inputs={},
        query="How does this work?",
        message={},
        answer="Read the documentation.",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
    )
    provider = Provider(tenant_id=tenant.id, provider_name=_PROVIDER, is_valid=True)
    session.add_all([message, provider])
    session.flush()
    context = SuggestedQuestionsContext(
        app_id=app.id,
        tenant_id=tenant.id,
        app_mode=AppMode.CHAT,
        message_id=message.id,
        conversation_id=conversation.id,
        actor=MessageAccount(account.id),
        invoke_from="debugger",
        config={"enabled": True},
    )
    session.add(
        TenantDefaultModel(tenant_id=tenant.id, provider_name=_PROVIDER, model_name=_MODEL, model_type=ModelType.LLM)
    )
    schema = AIModelEntity(
        model=_MODEL,
        label=I18nObject(en_US="Questions"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        parameter_rules=[],
    )
    declaration = PluginModelProviderDeclaration(
        provider=_PROVIDER,
        plugin_unique_identifier="tests/suggested:0.0.1@" + "0" * 64,
        installation_source=None,
        label=I18nObject(en_US="Suggested questions"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[schema],
    )
    credentials = {"api_key": "unused-test-key"}
    PluginService._store_cached_plugin_model_providers(tenant.id, 0, [declaration])
    ProviderCredentialsCache(tenant.id, provider.id, ProviderCredentialsCacheType.PROVIDER).set(credentials)
    redis_client.setex(f"tenant:{tenant.id}:model_load_balancing_enabled", 60, "False")
    runtime = create_plugin_model_runtime(tenant_id=tenant.id)
    runtime.bind_provider_schema(declaration)
    schema_key = runtime._get_schema_cache_key(
        provider=_PROVIDER, model_type=ModelType.LLM, model=_MODEL, credentials=credentials
    )
    redis_client.setex(schema_key, 60, schema.model_dump_json())
    session.commit()

    # The container fixture reloads config after this module-level URL was bound.
    monkeypatch.setattr(plugin_base, "plugin_daemon_inner_api_baseurl", URL(str(dify_config.PLUGIN_DAEMON_URL)))
    return _Scenario(account=account, context=context)


@pytest.fixture
def _successful_model_provider(scenario: _Scenario, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    app = Flask(__name__)
    route = f"/plugin/{scenario.context.tenant_id}/dispatch/llm"

    @app.post(f"{route}/num_tokens")
    def count_tokens() -> Response:
        payload = {"code": 0, "message": "success", "data": {"num_tokens": 8}}
        return Response(f"data: {json.dumps(payload)}\n\n", mimetype="text/event-stream")

    @app.post(f"{route}/invoke")
    def invoke() -> Response:
        def chunks() -> Iterator[str]:
            for index, content in enumerate(
                ('```json\n["What should I try next?",', '"Can you show an example?"]\n```')
            ):
                payload = {
                    "code": 0,
                    "message": "success",
                    "data": {
                        "model": _MODEL,
                        "delta": {
                            "index": index,
                            "message": {"role": "assistant", "content": content},
                            "finish_reason": "stop" if index == 1 else None,
                        },
                    },
                }
                yield f"data: {json.dumps(payload)}\n\n"

        return Response(chunks(), mimetype="text/event-stream")

    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    monkeypatch.setattr(plugin_base, "plugin_daemon_inner_api_baseurl", URL(f"http://127.0.0.1:{server.server_port}"))
    try:
        yield
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


@pytest.mark.parametrize("configured_model", [False, True], ids=["default-model", "configured-model"])
@pytest.mark.usefixtures("_successful_model_provider")
def test_console_returns_generated_questions_through_real_http_provider(
    scenario: _Scenario,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
    configured_model: bool,
) -> None:
    feature: dict[str, object] = {"enabled": True, "prompt": "Give two concrete follow-ups."}
    if configured_model:
        feature["model"] = {"provider": _PROVIDER, "name": _MODEL, "completion_params": {"temperature": 0.2}}
    db.session.execute(
        update(AppModelConfig)
        .where(AppModelConfig.app_id == scenario.context.app_id)
        .values(suggested_questions_after_answer=json.dumps(feature))
    )
    db.session.commit()
    headers = authenticate_console_client(test_client_with_containers, scenario.account)
    monkeypatch.setattr(dify_config, "PLUGIN_BASED_TOKEN_COUNTING_ENABLED", True)
    db.session.remove()
    caller = db.session()
    sessions: list[Session] = []
    requests: list[httpx.Request] = []
    active_sessions: list[Session] = []

    def remember_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def observe_request(request: httpx.Request) -> None:
        requests.append(request)
        active_sessions.extend(session for session in sessions if session is not caller and session.in_transaction())

    event.listen(Session, "after_begin", remember_session)
    hooks = plugin_base._httpx_client.event_hooks["request"]
    hooks.append(observe_request)
    try:
        response = test_client_with_containers.get(
            f"/console/api/apps/{scenario.context.app_id}/chat-messages/"
            f"{scenario.context.message_id}/suggested-questions",
            headers=headers,
        )
    finally:
        hooks.remove(observe_request)
        event.remove(Session, "after_begin", remember_session)

    assert response.status_code == HTTPStatus.OK
    assert response.headers["Content-Type"] == "application/json"
    assert response.get_json() == {"data": ["What should I try next?", "Can you show an example?"]}
    assert [request.url.path for request in requests] == [
        f"/plugin/{scenario.context.tenant_id}/dispatch/llm/num_tokens",
        f"/plugin/{scenario.context.tenant_id}/dispatch/llm/invoke",
    ]
    assert not active_sessions
    invocation = requests[1]
    payload = json.loads(invocation.content)["data"]
    assert payload["provider"] == "suggested"
    assert payload["model"] == _MODEL
    assert payload["credentials"] == {"api_key": "unused-test-key"}
    assert payload["stream"] is False
    assert payload["model_parameters"] == (
        {"temperature": 0.2} if configured_model else {"max_tokens": 256, "temperature": 0.0}
    )
    assert len(payload["prompt_messages"]) == 1
    prompt = payload["prompt_messages"][0]
    assert prompt["role"] == "user"
    assert "Human: How does this work?\nAssistant: Read the documentation." in prompt["content"]
    assert "Give two concrete follow-ups." in prompt["content"]
    assert 'You must output a JSON array like ["question1", "question2", "question3"].' in prompt["content"]
    assert invocation.headers["X-Plugin-ID"] == "tests/suggested"
    assert invocation.headers["X-Plugin-Unique-Identifier"] == "tests/suggested:0.0.1@" + "0" * 64


@pytest.mark.parametrize("configured_provider", [_PROVIDER, "tests/missing/missing"])
def test_configured_model_resolution_and_default_fallback(scenario: _Scenario, configured_provider: str) -> None:
    prepared = SuggestedQuestionsGenerator._prepare_model(
        tenant_id=scenario.context.tenant_id,
        model_config={"provider": configured_provider, "name": _MODEL, "completion_params": {"temperature": 0.2}},
    )

    assert prepared is not None
    assert prepared.model_instance.provider == _PROVIDER
    assert prepared.model_instance.model_name == _MODEL
    assert prepared.model_instance.credentials == {"api_key": "unused-test-key"}
    assert prepared.completion_params == ({"temperature": 0.2} if configured_provider == _PROVIDER else None)


def test_unavailable_configured_and_default_models_return_none(scenario: _Scenario) -> None:
    db.session.execute(
        update(TenantDefaultModel)
        .where(TenantDefaultModel.tenant_id == scenario.context.tenant_id)
        .values(provider_name="tests/missing/missing")
    )
    db.session.commit()
    generator = SuggestedQuestionsGenerator()

    assert (
        generator._prepare_model(
            tenant_id=scenario.context.tenant_id, model_config={"provider": "tests/missing/missing", "name": _MODEL}
        )
        is None
    )
    with generator.prepare(context=scenario.context, instruction_prompt=None, model_config=None) as generate:
        assert generate is None


def test_missing_default_model_does_not_create_one_or_commit_caller_changes(scenario: _Scenario) -> None:
    db.session.execute(delete(TenantDefaultModel).where(TenantDefaultModel.tenant_id == scenario.context.tenant_id))
    db.session.commit()
    app = db.session.get(App, scenario.context.app_id)
    assert app is not None
    original_name = app.name
    app.name = "Uncommitted caller change"
    caller = db.session()

    try:
        with SuggestedQuestionsGenerator().prepare(
            context=scenario.context, instruction_prompt=None, model_config=None
        ) as generate:
            assert generate is None
            assert db.session() is not caller
            assert not db.session().in_transaction()
            with Session(db.engine) as verification:
                default = verification.scalar(
                    select(TenantDefaultModel).where(TenantDefaultModel.tenant_id == scenario.context.tenant_id)
                )
                assert default is None
                assert verification.scalar(select(App.name).where(App.id == app.id)) == original_name
        assert db.session() is caller
        assert app in caller.dirty
        assert app.name == "Uncommitted caller change"
    finally:
        caller.rollback()


@pytest.mark.parametrize("token_counting", [True, False])
def test_console_missing_plugin_token_error_propagates_but_invocation_returns_empty(
    scenario: _Scenario,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    token_counting: bool,
) -> None:
    headers = authenticate_console_client(test_client_with_containers, scenario.account)
    monkeypatch.setattr(dify_config, "PLUGIN_BASED_TOKEN_COUNTING_ENABLED", token_counting)
    db.session.remove()
    caller = db.session()
    sessions: list[Session] = []
    requests: list[httpx.Request] = []
    active_sessions: list[Session] = []
    metadata: list[dict[str, object]] = []

    def remember_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def observe_request(request: httpx.Request) -> None:
        requests.append(request)
        active_sessions.extend(session for session in sessions if session is not caller and session.in_transaction())
        metadata.append(dict(get_credit_usage_metadata() or {}))

    event.listen(Session, "after_begin", remember_session)
    hooks = plugin_base._httpx_client.event_hooks["request"]
    hooks.append(observe_request)
    try:
        response = test_client_with_containers.get(
            f"/console/api/apps/{scenario.context.app_id}/chat-messages/"
            f"{scenario.context.message_id}/suggested-questions",
            headers=headers,
        )
    finally:
        hooks.remove(observe_request)
        event.remove(Session, "after_begin", remember_session)

    assert len(requests) == 1
    suffix = "num_tokens" if token_counting else "invoke"
    assert requests[0].url.path == f"/plugin/{scenario.context.tenant_id}/dispatch/llm/{suffix}"
    assert not active_sessions
    errors = [record.exc_info[1] for record in caplog.records if record.exc_info and record.exc_info[1] is not None]
    # The daemon's -404 JSON response is translated to ValueError by the
    # streaming transport; only -500 responses deserialize a plugin exception.
    assert any(
        isinstance(error, ValueError) and "plugin not found" in str(error) and "code: -404" in str(error)
        for error in errors
    )
    payload = response.get_json()
    assert isinstance(payload, dict)
    if token_counting:
        assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
        assert payload["code"] == "internal_server_error"
    else:
        assert response.status_code == HTTPStatus.OK
        assert payload == {"data": []}
        assert requests[0].extensions["timeout"] == {"connect": 30.0, "read": 30.0, "write": 30.0, "pool": 30.0}
        assert metadata == [{"app_type": "chatbot", "created_by": "suggested_questions"}]


def test_console_token_counting_reports_credentials_in_cooldown(
    scenario: _Scenario,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = scenario.context.tenant_id
    balancing = LoadBalancingModelConfig(
        tenant_id=tenant_id, provider_name=_PROVIDER, model_name=_MODEL, model_type=ModelType.LLM, name="__inherit__"
    )
    backup = LoadBalancingModelConfig(
        tenant_id=tenant_id,
        provider_name=_PROVIDER,
        model_name=_MODEL,
        model_type=ModelType.LLM,
        name="Backup credentials",
        encrypted_config='{"api_key":"unused-test-key"}',
    )
    db.session.add_all(
        [
            balancing,
            backup,
            ProviderModelSetting(
                tenant_id=tenant_id,
                provider_name=_PROVIDER,
                model_name=_MODEL,
                model_type=ModelType.LLM,
                load_balancing_enabled=True,
            ),
        ]
    )
    db.session.commit()
    ProviderCredentialsCache(tenant_id, backup.id, ProviderCredentialsCacheType.LOAD_BALANCING_MODEL).set(
        {"api_key": "unused-test-key"}
    )
    redis_client.setex(f"tenant:{tenant_id}:model_load_balancing_enabled", 60, "True")
    model = ModelManager.for_tenant(tenant_id=tenant_id).get_default_model_instance(
        tenant_id=tenant_id, model_type=ModelType.LLM
    )
    manager = model.load_balancing_manager
    assert manager is not None
    assert {configuration.id for configuration in manager._load_balancing_configs} == {balancing.id, backup.id}
    for configuration in manager._load_balancing_configs:
        manager.cooldown(configuration)
        assert manager.in_cooldown(configuration)
    monkeypatch.setattr(dify_config, "PLUGIN_BASED_TOKEN_COUNTING_ENABLED", True)
    headers = authenticate_console_client(test_client_with_containers, scenario.account)
    db.session.remove()
    requests: list[httpx.Request] = []
    hooks = plugin_base._httpx_client.event_hooks["request"]
    hooks.append(requests.append)
    try:
        response = test_client_with_containers.get(
            f"/console/api/apps/{scenario.context.app_id}/chat-messages/"
            f"{scenario.context.message_id}/suggested-questions",
            headers=headers,
        )
    finally:
        hooks.remove(requests.append)

    assert requests == []
    assert response.status_code == HTTPStatus.BAD_REQUEST
    payload = response.get_json()
    assert isinstance(payload, dict)
    assert payload["code"] == "provider_not_initialize"
    assert payload["message"] == "Model credentials is not initialized."

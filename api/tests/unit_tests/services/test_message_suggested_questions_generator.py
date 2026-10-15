"""Real model-resolution failures and deterministic suggested-question transformations.

Successful model invocation requires a configured plugin/model backend. These
unit tests do not replace that backend or claim to cover successful LLM calls.
"""

from collections.abc import Callable, Iterator
from uuid import uuid4

import httpx
import pytest
from flask import Flask, current_app
from pydantic import ValidationError
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.exc import IntegrityError, PendingRollbackError
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from yarl import URL

import core.plugin.impl.base as plugin_base
import core.plugin.impl.model_runtime as model_runtime_module
from core.llm_generator.llm_generator import _normalize_completion_params
from core.llm_generator.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.llm_generator.prompts import DEFAULT_SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT
from core.memory.token_buffer_memory import HistoryPrompt, PreparedHistory
from core.model_context import get_credit_usage_metadata
from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from core.plugin.impl.base import _get_plugin_daemon_request_timeout
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from models.provider import Provider
from services.entities.message_entities import MessageEndUser
from services.message_suggested_questions_generator import (
    PreparedSuggestedQuestionsModel,
    SuggestedQuestionsGenerator,
    _default_suggested_questions_model_parameters,
)
from services.message_suggested_questions_service import SuggestedQuestionsContext
from tests.unit_tests.core.model_fixtures import make_model_instance
from tests.unit_tests.model_factories import make_app


@pytest.fixture
def invalid_provider_tenant(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[str]:
    tenant_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(Provider(tenant_id=tenant_id, provider_name="invalid/provider", is_valid=True))
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = str(sqlite_engine.url)
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}
    db.init_app(app)
    with app.app_context():
        yield tenant_id
        db.session.remove()
        db.engine.dispose()


def test_prepare_preserves_caller_transaction_when_stored_provider_is_invalid(
    invalid_provider_tenant: str, caplog: pytest.LogCaptureFixture
) -> None:
    context = SuggestedQuestionsContext(
        app_id=str(uuid4()),
        tenant_id=invalid_provider_tenant,
        app_mode="chat",
        message_id=str(uuid4()),
        conversation_id=str(uuid4()),
        actor=MessageEndUser(end_user_id=str(uuid4())),
        invoke_from="service-api",
        config={"enabled": True},
    )
    caller = db.session()
    provider = caller.scalars(select(Provider).where(Provider.tenant_id == invalid_provider_tenant)).one()
    provider.quota_limit = 27
    with SuggestedQuestionsGenerator().prepare(context=context, instruction_prompt=None, model_config=None) as generate:
        assert generate is None
    assert db.session() is caller
    assert caller.in_transaction()
    assert provider in caller.dirty
    assert provider.quota_limit == 27
    assert "Invalid plugin id invalid/provider" in caplog.text


@pytest.mark.parametrize(
    "model_config",
    [None, {}, {"provider": "invalid/provider", "name": "model", "completion_params": {"temperature": 0.2}}],
)
def test_model_selection_returns_none_for_invalid_stored_provider(
    invalid_provider_tenant: str, model_config: object, caplog: pytest.LogCaptureFixture
) -> None:
    metadata = get_credit_usage_metadata()
    assert SuggestedQuestionsGenerator._prepare_model(invalid_provider_tenant, model_config=model_config) is None
    assert "Invalid plugin id invalid/provider" in caplog.text
    assert get_credit_usage_metadata() == metadata


def test_invocation_failure_returns_empty_questions_and_restores_request_context(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # Use a real, uninitialized cache client, so no shared Redis mock participates.
    # The real runtime then rejects the malformed provider ID before transport I/O.
    monkeypatch.setattr(model_runtime_module, "redis_client", RedisClientWrapper())
    model = make_model_instance(provider="invalid/provider", model="unavailable")
    prepared = PreparedSuggestedQuestionsModel(model_instance=model, completion_params={"temperature": 0.2})
    metadata = get_credit_usage_metadata()
    timeout = _get_plugin_daemon_request_timeout()

    assert SuggestedQuestionsGenerator._invoke(prepared, "Human: hello\nAssistant: world") == []

    assert "Invalid plugin id invalid/provider" in caplog.text
    assert get_credit_usage_metadata() == metadata
    assert _get_plugin_daemon_request_timeout() == timeout


def test_default_parameters_survive_real_schema_lookup_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(model_runtime_module, "redis_client", RedisClientWrapper())
    model = make_model_instance(provider="invalid/provider", model="unavailable")

    assert _default_suggested_questions_model_parameters(model) == {"max_tokens": 256, "temperature": 0.0}
    assert "Invalid plugin id invalid/provider" in caplog.text


def test_token_transport_failure_propagates_before_best_effort_generation(
    config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    config_overrides(PLUGIN_BASED_TOKEN_COUNTING_ENABLED=True)
    # HTTPX rejects an unsupported configured scheme itself, without a network
    # request or a replaced transport. The real plugin client wraps that error.
    monkeypatch.setattr(plugin_base, "plugin_daemon_inner_api_baseurl", URL("unsupported://plugin-daemon"))
    history = PreparedHistory(
        prompts=(
            HistoryPrompt(
                text="How does this work?",
                is_user_message=True,
                files=(),
                tenant_id=str(uuid4()),
                image_detail=ImagePromptMessageContent.DETAIL.HIGH,
            ),
        )
    )
    context = SuggestedQuestionsContext(
        app_id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_mode="chat",
        message_id=str(uuid4()),
        conversation_id=str(uuid4()),
        actor=MessageEndUser(end_user_id=str(uuid4())),
        invoke_from="service-api",
        config={"enabled": True},
    )
    metadata = get_credit_usage_metadata()
    timeout = _get_plugin_daemon_request_timeout()
    with pytest.raises(PluginDaemonInnerError) as failure:
        SuggestedQuestionsGenerator().generate(
            history,
            history_model=make_model_instance(provider="langgenius/openai/openai", model="history-model"),
            context=context,
            instruction_prompt=None,
            model_config=None,
        )
    assert isinstance(failure.value.__context__, httpx.UnsupportedProtocol)
    assert get_credit_usage_metadata() == metadata
    assert _get_plugin_daemon_request_timeout() == timeout


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('["Question 1?", "还有吗？"]', ["Question 1?", "还有吗？"]),
        ('Here are questions:\n["Next?"]', ["Next?"]),
        ('["Next?", 1, null, true]', ["Next?"]),
        ("[]", []),
        ("", []),
        ("not a question array", []),
        ('["unfinished]', []),
    ],
)
def test_response_parser_handles_question_arrays(text: str, expected: list[str]) -> None:
    assert SuggestedQuestionsAfterAnswerOutputParser().parse(text) == expected


@pytest.mark.parametrize("instruction", [None, "", " "])
def test_empty_instruction_uses_default_prompt(instruction: str | None) -> None:
    parser = SuggestedQuestionsAfterAnswerOutputParser(instruction_prompt=instruction)
    assert parser.get_format_instructions() == DEFAULT_SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT


def test_custom_instruction_preserves_json_output_requirement() -> None:
    instructions = SuggestedQuestionsAfterAnswerOutputParser("Ask a follow-up").get_format_instructions()
    assert instructions.startswith("Ask a follow-up\n")
    assert 'JSON array like ["question1", "question2", "question3"]' in instructions


@pytest.mark.parametrize("limit", [0, -1, -0.5])
def test_non_positive_token_limits_are_removed_without_mutating_configuration(limit: int | float) -> None:
    configured: dict[str, object] = {
        "temperature": 0.2,
        "max_tokens": limit,
        "max_output_tokens": limit,
        "stop": ["END"],
    }
    parameters, stop = _normalize_completion_params(configured)
    assert parameters == {"temperature": 0.2}
    assert stop == ["END"]
    assert configured == {"temperature": 0.2, "max_tokens": limit, "max_output_tokens": limit, "stop": ["END"]}


def test_configured_parameters_keep_positive_limits() -> None:
    assert _normalize_completion_params({"max_tokens": 512, "max_output_tokens": 1024}) == (
        {"max_tokens": 512, "max_output_tokens": 1024},
        [],
    )


@pytest.mark.parametrize("tracing", ["invalid trace JSON", '{"enabled":{"invalid":"type"}}'])
def test_trace_config_failure_escapes_generation_and_closes_its_sessions(
    invalid_provider_tenant: str,
    sqlite_session_factory: sessionmaker[Session],
    tracing: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    app_record = make_app(app_id=str(uuid4()), tenant_id=invalid_provider_tenant)
    app_record.tracing = tracing
    with sqlite_session_factory.begin() as session:
        session.add(app_record)
    context = SuggestedQuestionsContext(
        app_id=app_record.id,
        tenant_id=invalid_provider_tenant,
        app_mode="chat",
        message_id=str(uuid4()),
        conversation_id=str(uuid4()),
        actor=MessageEndUser(end_user_id=str(uuid4())),
        invoke_from="service-api",
        config={"enabled": True},
    )
    caller = db.session()
    provider = caller.scalars(select(Provider).where(Provider.tenant_id == invalid_provider_tenant)).one()
    provider.quota_limit = 27
    transaction = caller.get_transaction()
    sessions: list[Session] = []

    def record_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    factory = db.session.session_factory
    event.listen(factory, "after_begin", record_session)
    try:
        # Empty detached history needs no token-counting call. The real failed
        # model lookup returns [], then trace construction reads the malformed
        # stored config before it could create a timer or dispatch telemetry.
        with pytest.raises(ValidationError), current_app.app_context():
            SuggestedQuestionsGenerator().generate(
                PreparedHistory(prompts=()),
                history_model=make_model_instance(provider="invalid/provider", model="unused"),
                context=context,
                instruction_prompt=None,
                model_config=None,
            )
    finally:
        event.remove(factory, "after_begin", record_session)

    assert "Invalid plugin id invalid/provider" in caplog.text
    assert len(sessions) == 2
    assert sessions[0] is not sessions[1]
    assert all(not session.in_transaction() and not session.identity_map for session in sessions)
    assert db.session() is caller
    assert caller.get_transaction() is transaction
    assert provider in caller.dirty
    assert provider.quota_limit == 27
    with sqlite_session_factory() as session:
        persisted = session.get(Provider, provider.id)
        assert persisted is not None
        assert persisted.quota_limit is None


def test_prepare_isolates_a_caller_transaction_failed_by_a_real_constraint(
    invalid_provider_tenant: str, caplog: pytest.LogCaptureFixture
) -> None:
    context = SuggestedQuestionsContext(
        app_id=str(uuid4()),
        tenant_id=invalid_provider_tenant,
        app_mode="chat",
        message_id=str(uuid4()),
        conversation_id=str(uuid4()),
        actor=MessageEndUser(end_user_id=str(uuid4())),
        invoke_from="service-api",
        config={"enabled": True},
    )
    caller = db.session()
    provider_id = caller.scalars(select(Provider.id).where(Provider.tenant_id == invalid_provider_tenant)).one()
    duplicate = Provider(tenant_id=invalid_provider_tenant, provider_name="duplicate", is_valid=True)
    duplicate.id = provider_id
    caller.add(duplicate)
    with pytest.raises(IntegrityError):
        caller.flush()
    failed_transaction = caller.get_transaction()
    assert failed_transaction is not None
    assert not caller.is_active

    with SuggestedQuestionsGenerator().prepare(context=context, instruction_prompt=None, model_config=None) as generate:
        assert generate is None

    # Model resolution used an independent usable session. It must neither
    # inherit the caller's failed transaction nor roll that transaction back.
    assert "Invalid plugin id invalid/provider" in caplog.text
    assert db.session() is caller
    assert caller.get_transaction() is failed_transaction
    assert not caller.is_active
    with pytest.raises(PendingRollbackError):
        caller.scalar(select(Provider.id))
    caller.rollback()
    assert caller.scalar(select(Provider.id).where(Provider.id == provider_id)) == provider_id

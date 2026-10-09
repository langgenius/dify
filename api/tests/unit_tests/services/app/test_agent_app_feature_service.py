"""Unit tests for AgentAppFeatureConfigService.

validate_features is the security boundary of the Agent App feature endpoint: it
must (a) drop any Soul-owned keys a caller tries to smuggle in and (b) fill
sane disabled/empty defaults for the presentation features the PRD requires.
update_features persists those flags as a new app_model_config version without
touching model / prompt / agent_mode.
"""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from events.app_event import app_model_config_was_updated
from extensions.application_services.agent import build_agent_app_services
from machinery.context import RequestContext
from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode, AppModelConfig
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app.agent_app_feature_gateway import AgentAppFeatureValidator

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


class TestValidateFeatures:
    def test_empty_config_fills_disabled_defaults(self) -> None:
        result = AgentAppFeatureValidator.validate_features(TENANT_ID, {})

        assert result["opening_statement"] == ""
        assert result["suggested_questions"] == []
        assert result["suggested_questions_after_answer"] == {"enabled": False}
        assert result["retriever_resource"] == {"enabled": False}
        assert result["speech_to_text"] == {"enabled": False}
        assert result["text_to_speech"]["enabled"] is False

    def test_opener_and_follow_up_round_trip(self) -> None:
        result = AgentAppFeatureValidator.validate_features(
            TENANT_ID,
            {
                "opening_statement": "Hi, I'm Iris.",
                "suggested_questions": ["What can you do?"],
                "suggested_questions_after_answer": {"enabled": True},
                "retriever_resource": {"enabled": True},
            },
        )

        assert result["opening_statement"] == "Hi, I'm Iris."
        assert result["suggested_questions"] == ["What can you do?"]
        assert result["suggested_questions_after_answer"]["enabled"] is True
        assert result["retriever_resource"]["enabled"] is True

    def test_soul_owned_keys_are_dropped(self) -> None:
        # model / pre_prompt / agent_mode / tools / user_input_form belong to the
        # Agent Soul and must never be settable through the feature endpoint.
        result = AgentAppFeatureValidator.validate_features(
            TENANT_ID,
            {
                "opening_statement": "hello",
                "model": {"provider": "x", "name": "y"},
                "pre_prompt": "system override",
                "agent_mode": {"enabled": True, "strategy": "react"},
                "tools": [{"a": 1}],
                "user_input_form": [{"text-input": {}}],
            },
        )

        for forbidden in ("model", "pre_prompt", "agent_mode", "tools", "user_input_form"):
            assert forbidden not in result

    def test_invalid_opening_statement_type_raises(self) -> None:
        with pytest.raises(ValueError, match="opening_statement must be of string type"):
            AgentAppFeatureValidator.validate_features(TENANT_ID, {"opening_statement": 123})

    def test_invalid_suggested_questions_type_raises(self) -> None:
        with pytest.raises(ValueError, match="suggested_questions must be of list type"):
            AgentAppFeatureValidator.validate_features(TENANT_ID, {"suggested_questions": "nope"})


@pytest.fixture
def agent_app(sqlite_session: Session) -> App:
    app = App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="Agent App",
        mode=AppMode.AGENT,
        status="normal",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    agent = Agent(
        id="agent",
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        name="Agent",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    sqlite_session.add_all([app, agent])
    sqlite_session.commit()
    return app


def test_feature_save_is_atomic(
    agent_app: App, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service = build_agent_app_services(database_client=sqlite_session_factory).features
    context = RequestContext("request", None, ACCOUNT_ID, TENANT_ID)
    calls: list[str] = []

    def observe(sender: App, *, app_model_config: AppModelConfig, session: Session) -> None:
        assert session.in_transaction()
        assert sender.app_model_config_id == app_model_config.id
        assert app_model_config.created_by == ACCOUNT_ID
        calls.append(app_model_config.id)

    with app_model_config_was_updated.connected_to(observe):
        service.update_features(context, "agent", {"opening_statement": "Hi!", "model": {"name": "ignore"}})
    sqlite_session.expire_all()
    assert agent_app.app_model_config_id == calls[0]
    config = sqlite_session.get(AppModelConfig, calls[0])
    assert config is not None
    assert config.opening_statement == "Hi!"
    assert config.model is config.agent_mode is config.pre_prompt is None
    assert agent_app.updated_by == ACCOUNT_ID
    sqlite_session.rollback()

    def fail(_sender: App, **_kwargs: object) -> None:
        raise RuntimeError("event failed")

    with app_model_config_was_updated.connected_to(fail), pytest.raises(RuntimeError, match="event failed"):
        service.update_features(context, "agent", {"opening_statement": "Must roll back"})
    sqlite_session.expire_all()
    assert agent_app.app_model_config_id == calls[0]
    assert len(sqlite_session.scalars(select(AppModelConfig)).all()) == 1


def test_feature_validation_failure_does_not_write(
    agent_app: App, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service = build_agent_app_services(database_client=sqlite_session_factory).features
    with pytest.raises(ValueError, match="opening_statement"):
        service.update_features(
            RequestContext("request", None, ACCOUNT_ID, TENANT_ID), "agent", {"opening_statement": 123}
        )
    sqlite_session.expire_all()
    assert agent_app.app_model_config_id is None
    assert sqlite_session.scalar(select(AppModelConfig)) is None


@pytest.mark.parametrize("invalid", ["agent-tenant", "app-tenant", "app-mode", "missing-app", "agent-status"])
def test_features_require_owned_active_agent_app(
    agent_app: App, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], invalid: str
) -> None:
    agent = sqlite_session.get(Agent, "agent")
    assert agent is not None
    if invalid == "agent-tenant":
        agent.tenant_id = "foreign"
    elif invalid == "app-tenant":
        agent_app.tenant_id = "foreign"
    elif invalid == "app-mode":
        agent_app.mode = AppMode.CHAT
    elif invalid == "missing-app":
        sqlite_session.delete(agent_app)
    else:
        agent.status = AgentStatus.ARCHIVED
    sqlite_session.commit()
    service = build_agent_app_services(database_client=sqlite_session_factory).features
    with pytest.raises(AgentAppNotFoundError):
        service.update_features(RequestContext("request", None, ACCOUNT_ID, TENANT_ID), "agent", {})
    assert sqlite_session.scalar(select(AppModelConfig)) is None

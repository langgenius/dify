"""Unit tests for AgentAppFeatureConfigService.

validate_features is the security boundary of the Agent App feature endpoint: it
must (a) drop any Soul-owned keys a caller tries to smuggle in and (b) fill
sane disabled/empty defaults for the presentation features the PRD requires.
update_features persists those flags as a new app_model_config version without
touching model / prompt / agent_mode.
"""

import pytest
from sqlalchemy.orm import Session

from models.account import Account
from models.model import App, AppMode, AppModelConfig
from services.agent_app_feature_service import AgentAppFeatureConfigService

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


class TestValidateFeatures:
    def test_empty_config_fills_disabled_defaults(self):
        result = AgentAppFeatureConfigService.validate_features(TENANT_ID, {})

        assert result["opening_statement"] == ""
        assert result["suggested_questions"] == []
        assert result["suggested_questions_after_answer"] == {"enabled": False}
        assert result["retriever_resource"] == {"enabled": False}
        assert result["speech_to_text"] == {"enabled": False}
        assert result["text_to_speech"]["enabled"] is False

    def test_opener_and_follow_up_round_trip(self):
        result = AgentAppFeatureConfigService.validate_features(
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

    def test_soul_owned_keys_are_dropped(self):
        # model / pre_prompt / agent_mode / tools / user_input_form belong to the
        # Agent Soul and must never be settable through the feature endpoint.
        result = AgentAppFeatureConfigService.validate_features(
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

    def test_invalid_opening_statement_type_raises(self):
        with pytest.raises(ValueError, match="opening_statement must be of string type"):
            AgentAppFeatureConfigService.validate_features(TENANT_ID, {"opening_statement": 123})

    def test_invalid_suggested_questions_type_raises(self):
        with pytest.raises(ValueError, match="suggested_questions must be of list type"):
            AgentAppFeatureConfigService.validate_features(TENANT_ID, {"suggested_questions": "nope"})


class TestUpdateFeatures:
    @pytest.mark.parametrize("sqlite_session", [(Account, App, AppModelConfig)], indirect=True)
    def test_persists_new_app_model_config_version(self, sqlite_session: Session):
        app_model = App(
            id=APP_ID,
            tenant_id=TENANT_ID,
            name="Agent App",
            description="",
            mode=AppMode.AGENT,
            enable_site=True,
            enable_api=True,
            max_active_requests=0,
        )
        account = Account(name="Test User", email="test@example.com")
        account.id = ACCOUNT_ID
        sqlite_session.add_all([account, app_model])
        sqlite_session.commit()

        new_config = AgentAppFeatureConfigService.update_features(
            app_model=app_model,
            account=account,
            config={"opening_statement": "Hi!", "suggested_questions_after_answer": {"enabled": True}},
            session=sqlite_session,
        )
        assert not sqlite_session.in_transaction()

        # New row carries the features but no Soul-owned model/prompt/agent_mode.
        assert new_config.app_id == APP_ID
        assert new_config.opening_statement == "Hi!"
        assert new_config.model is None
        assert new_config.agent_mode is None
        # App is repointed at the new version and the write is committed.
        assert app_model.app_model_config_id == new_config.id
        assert app_model.updated_by == ACCOUNT_ID
        sqlite_session.expunge_all()
        persisted_config = sqlite_session.get(AppModelConfig, new_config.id)
        persisted_app = sqlite_session.get(App, APP_ID)
        assert persisted_config is not None
        assert persisted_config.opening_statement == "Hi!"
        assert persisted_config.model is None
        assert persisted_config.agent_mode is None
        assert persisted_app is not None
        assert persisted_app.app_model_config_id == new_config.id
        assert persisted_app.updated_by == ACCOUNT_ID

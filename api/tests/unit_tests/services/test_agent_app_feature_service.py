"""Unit tests for AgentAppFeatureConfigService.

validate_features is the security boundary of the Agent App feature endpoint: it
must (a) drop any Soul-owned keys a caller tries to smuggle in and (b) fill
sane disabled/empty defaults for the presentation features the PRD requires.
update_features persists those flags as a new app_model_config version without
touching model / prompt / agent_mode.
"""

from types import SimpleNamespace
from typing import Any

import pytest

from services import agent_app_feature_service as svc_mod
from services.agent_app_feature_service import AgentAppFeatureConfigService

TENANT_ID = "11111111-1111-1111-1111-111111111111"


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


class _FakeWriteSession:
    def __init__(self) -> None:
        self.added: list[Any] = []
        self.flushed = 0
        self.committed = 0

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flushed += 1

    def commit(self) -> None:
        self.committed += 1


class TestUpdateFeatures:
    def test_persists_new_app_model_config_version(self, monkeypatch):
        session = _FakeWriteSession()
        monkeypatch.setattr(svc_mod.db, "session", session)
        app_model = SimpleNamespace(
            tenant_id=TENANT_ID, id="app-1", app_model_config_id=None, updated_by=None, updated_at=None
        )
        account = SimpleNamespace(id="acct-1")

        new_config = AgentAppFeatureConfigService.update_features(
            app_model=app_model,  # type: ignore[arg-type]
            account=account,  # type: ignore[arg-type]
            config={"opening_statement": "Hi!", "suggested_questions_after_answer": {"enabled": True}},
        )

        # New row carries the features but no Soul-owned model/prompt/agent_mode.
        assert new_config.app_id == "app-1"
        assert new_config.opening_statement == "Hi!"
        assert new_config.model is None
        assert new_config.agent_mode is None
        # App is repointed at the new version and the write is committed.
        assert app_model.app_model_config_id == new_config.id
        assert app_model.updated_by == "acct-1"
        assert new_config in session.added
        assert session.flushed == 1
        assert session.committed == 1

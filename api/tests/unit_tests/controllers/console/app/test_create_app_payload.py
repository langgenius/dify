"""Regression tests for CreateAppPayload mode validation."""

import pytest
from pydantic import ValidationError

from controllers.console.app.app import CreateAppPayload


class TestCreateAppPayloadMode:
    @pytest.mark.parametrize(
        "mode",
        ["chat", "agent-chat", "advanced-chat", "workflow", "completion"],
    )
    def test_accepts_supported_modes(self, mode: str):
        payload = CreateAppPayload.model_validate({"name": "X", "mode": mode})
        assert payload.mode == mode

    def test_rejects_agent_mode(self):
        with pytest.raises(ValidationError):
            CreateAppPayload.model_validate({"name": "X", "mode": "agent"})

    def test_rejects_unknown_mode(self):
        with pytest.raises(ValidationError):
            CreateAppPayload.model_validate({"name": "X", "mode": "not-a-mode"})

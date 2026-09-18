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


class TestCreateAppPayloadNaming:
    """App Builder creates from a prompt, so the client may send no name."""

    def test_accepts_a_prompt_without_a_name(self):
        payload = CreateAppPayload.model_validate(
            {"mode": "workflow", "prompt": "Refund approval for ecommerce orders"}
        )
        assert payload.name is None
        assert payload.prompt == "Refund approval for ecommerce orders"

    def test_accepts_neither_name_nor_prompt(self):
        payload = CreateAppPayload.model_validate({"mode": "workflow"})
        assert payload.name is None
        assert payload.prompt is None

    def test_still_rejects_an_empty_name(self):
        # Omitting the name asks the server to derive one; sending "" is a bug.
        with pytest.raises(ValidationError):
            CreateAppPayload.model_validate({"name": "", "mode": "workflow"})

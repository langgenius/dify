"""Regression tests for CreateAppPayload mode validation.

The HTTP create-app payload must accept the new "agent" app mode; without it a
user cannot create an Agent App through POST /console/api/apps even though the
service layer (CreateAppParams) supports it.
"""

import pytest
from pydantic import ValidationError

from controllers.console.app.app import CreateAppPayload


class TestCreateAppPayloadMode:
    @pytest.mark.parametrize(
        "mode",
        ["chat", "agent-chat", "agent", "advanced-chat", "workflow", "completion"],
    )
    def test_accepts_supported_modes(self, mode: str):
        payload = CreateAppPayload.model_validate({"name": "X", "mode": mode})
        assert payload.mode == mode

    def test_rejects_unknown_mode(self):
        with pytest.raises(ValidationError):
            CreateAppPayload.model_validate({"name": "X", "mode": "not-a-mode"})

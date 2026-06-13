"""Regression tests for create-app request and response contracts.

The HTTP create-app payload must accept the new "agent" app mode; without it a
user cannot create an Agent App through POST /console/api/apps even though the
service layer (CreateAppParams) supports it.
"""

import importlib
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from controllers.console.app.app import AppDetail, CopyAppPayload, CreateAppPayload, UpdateAppPayload
from libs.validators import MAX_APP_NAME_LENGTH


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


class TestAppPayloadNameValidation:
    @pytest.mark.parametrize(
        ("payload_cls", "payload"),
        [
            (CreateAppPayload, {"mode": "chat"}),
            (UpdateAppPayload, {}),
            (CopyAppPayload, {}),
        ],
    )
    def test_accepts_name_at_database_limit(self, payload_cls, payload):
        name = "x" * MAX_APP_NAME_LENGTH
        model = payload_cls.model_validate({"name": name, **payload})
        assert model.name == name

    @pytest.mark.parametrize(
        ("payload_cls", "payload"),
        [
            (CreateAppPayload, {"mode": "chat"}),
            (UpdateAppPayload, {}),
            (CopyAppPayload, {}),
        ],
    )
    def test_rejects_name_over_database_limit(self, payload_cls, payload):
        with pytest.raises(ValidationError):
            payload_cls.model_validate({"name": "x" * (MAX_APP_NAME_LENGTH + 1), **payload})

    @pytest.mark.parametrize(
        ("payload_cls", "payload"),
        [
            (CreateAppPayload, {"mode": "chat"}),
            (UpdateAppPayload, {}),
            (CopyAppPayload, {}),
        ],
    )
    def test_rejects_blank_name(self, payload_cls, payload):
        with pytest.raises(ValidationError):
            payload_cls.model_validate({"name": "   ", **payload})


def test_app_detail_includes_icon_url_for_image_icons(monkeypatch):
    app_module = importlib.import_module("controllers.console.app.app")
    monkeypatch.setattr(app_module, "build_icon_url", lambda icon_type, icon: f"/files/{icon_type}/{icon}")

    app = SimpleNamespace(
        id="app-1",
        name="Image App",
        description="",
        mode_compatible_with_agent="chat",
        icon_type="image",
        icon="file-1",
        icon_background=None,
        enable_site=True,
        enable_api=True,
    )

    payload = AppDetail.model_validate(app, from_attributes=True).model_dump(mode="json")

    assert payload["icon_type"] == "image"
    assert payload["icon_url"] == "/files/image/file-1"

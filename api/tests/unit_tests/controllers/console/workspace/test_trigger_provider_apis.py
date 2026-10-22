"""Unit tests for controllers.console.workspace.trigger_providers endpoints."""

from __future__ import annotations

from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest

from controllers.common.errors import NotFoundError
from controllers.console.workspace.trigger_providers import (
    TriggerSubscriptionBuilderUpdatePayload,
    TriggerSubscriptionBuilderVerifyPayload,
    TriggerSubscriptionUpdateApi,
    TriggerSubscriptionVerifyApi,
)
from core.plugin.entities.plugin_daemon import CredentialType
from models.account import Account


def mock_user() -> Account:
    user = Account(name="User", email="user.com")
    user.id = "u1"
    return user


class TestTriggerSubscriptionCrud:
    def test_update_rename_only(self, app: Flask) -> None:
        api = TriggerSubscriptionUpdateApi()
        method = unwrap(api.post)

        sub = MagicMock()
        sub.provider_id = "github"
        sub.credential_type = CredentialType.UNAUTHORIZED

        with (
            app.test_request_context("/", json={"name": "x"}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_subscription_by_id",
                return_value=sub,
            ),
            patch("controllers.console.workspace.trigger_providers.TriggerProviderService.update_trigger_subscription"),
        ):
            assert method(
                api,
                TriggerSubscriptionBuilderUpdatePayload(name="x"),
                "t1",
                "s1",
            ) == {"result": "success"}

    def test_update_not_found(self, app: Flask) -> None:
        api = TriggerSubscriptionUpdateApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"name": "x"}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_subscription_by_id",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFoundError):
                method(api, TriggerSubscriptionBuilderUpdatePayload(name="x"), "t1", "x")

    def test_update_rebuild(self, app: Flask) -> None:
        api = TriggerSubscriptionUpdateApi()
        method = unwrap(api.post)

        sub = MagicMock()
        sub.provider_id = "github"
        sub.credential_type = CredentialType.OAUTH2
        sub.credentials = {"token": "old"}
        sub.parameters = {"repo": "demo"}

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.get_subscription_by_id",
                return_value=sub,
            ),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.rebuild_trigger_subscription"
            ),
        ):
            assert method(
                api,
                TriggerSubscriptionBuilderUpdatePayload(credentials={}),
                "t1",
                "s1",
            ) == {"result": "success"}


class TestTriggerSubscriptionVerifyApi:
    def test_verify_success(self, app: Flask) -> None:
        api = TriggerSubscriptionVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.verify_subscription_credentials",
                return_value={"verified": True},
            ),
        ):
            assert method(
                api,
                TriggerSubscriptionBuilderVerifyPayload(credentials={}),
                "t1",
                mock_user(),
                "github",
                "s1",
            ) == {"verified": True}

    @pytest.mark.parametrize("raised_exception", [ValueError("bad"), Exception("boom")])
    def test_verify_errors(self, app: Flask, raised_exception: Exception) -> None:
        api = TriggerSubscriptionVerifyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"credentials": {}}),
            patch(
                "controllers.console.workspace.trigger_providers.TriggerProviderService.verify_subscription_credentials",
                side_effect=raised_exception,
            ),
        ):
            with pytest.raises(BadRequest):
                method(
                    api,
                    TriggerSubscriptionBuilderVerifyPayload(credentials={}),
                    "t1",
                    mock_user(),
                    "github",
                    "s1",
                )

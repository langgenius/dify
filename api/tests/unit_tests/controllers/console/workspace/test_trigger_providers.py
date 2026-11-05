from __future__ import annotations

from collections.abc import Iterator
from importlib import import_module
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.engine import Engine
from werkzeug.exceptions import BadRequest

from controllers.common.errors import NotFoundError
from controllers.console.workspace.trigger_providers import (
    TriggerSubscriptionBuilderUpdatePayload,
    TriggerSubscriptionBuilderVerifyPayload,
    TriggerSubscriptionDeleteApi,
    TriggerSubscriptionUpdateApi,
    TriggerSubscriptionVerifyApi,
    TriggerSubscriptionVerifyPayload,
)
from core.plugin.entities.plugin_daemon import CredentialType
from models.account import Account
from models.engine import db

"""Unit tests for controllers.console.workspace.trigger_providers endpoints."""


def mock_user() -> Account:
    user = Account(name="User", email="user.com")
    user.id = "u1"
    return user


class TestTriggerProviderApisCases:
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
                patch(
                    "controllers.console.workspace.trigger_providers.TriggerProviderService.update_trigger_subscription"
                ),
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


"""Unit tests for trigger-provider controller transaction boundaries."""


trigger_provider_module = import_module("controllers.console.workspace.trigger_providers")


class TestTriggerProvidersCases:
    @staticmethod
    @pytest.fixture
    def flask_sqlite_engine() -> Iterator[Engine]:
        app = Flask(__name__)
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        db.init_app(app)

        with app.app_context():
            yield db.engine

    @staticmethod
    def test_delete_subscription_uses_sqlite_transaction(flask_sqlite_engine: Engine) -> None:
        api = TriggerSubscriptionDeleteApi()
        method = unwrap(api.post)

        with (
            patch.object(trigger_provider_module.TriggerProviderService, "delete_trigger_provider") as delete_provider,
            patch.object(
                trigger_provider_module.TriggerSubscriptionOperatorService,
                "delete_plugin_trigger_by_subscription",
            ) as delete_triggers,
        ):
            result = method(api, "t1", "sub1")

        assert result == {"result": "success"}
        provider_session = delete_provider.call_args.kwargs["session"]
        trigger_session = delete_triggers.call_args.kwargs["session"]
        assert provider_session is trigger_session
        assert provider_session.get_bind() is flask_sqlite_engine

    @staticmethod
    @pytest.mark.usefixtures("flask_sqlite_engine")
    def test_delete_subscription_translates_value_error() -> None:
        api = TriggerSubscriptionDeleteApi()
        method = unwrap(api.post)

        with (
            patch.object(
                trigger_provider_module.TriggerProviderService,
                "delete_trigger_provider",
                side_effect=ValueError("bad"),
            ),
            pytest.raises(BadRequest, match="bad"),
        ):
            method(api, "t1", "sub1")

    @staticmethod
    def test_builder_verify_payload_allows_credentials_to_be_omitted() -> None:
        payload = TriggerSubscriptionBuilderVerifyPayload.model_validate({})

        assert payload.credentials is None

    @staticmethod
    def test_subscription_verify_payload_requires_credentials() -> None:
        with pytest.raises(ValidationError):
            TriggerSubscriptionVerifyPayload.model_validate({})

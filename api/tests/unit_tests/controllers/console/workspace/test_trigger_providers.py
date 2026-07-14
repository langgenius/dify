"""Unit tests for trigger-provider controller transaction boundaries."""

from importlib import import_module
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from werkzeug.exceptions import BadRequest

from controllers.console.workspace.trigger_providers import TriggerSubscriptionDeleteApi

trigger_provider_module = import_module("controllers.console.workspace.trigger_providers")


def test_delete_subscription_uses_sqlite_transaction(app: Flask, sqlite_engine: Engine) -> None:
    api = TriggerSubscriptionDeleteApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/"),
        patch.object(trigger_provider_module, "db", SimpleNamespace(engine=sqlite_engine)),
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
    assert provider_session.get_bind() is sqlite_engine


def test_delete_subscription_translates_value_error(app: Flask, sqlite_engine: Engine) -> None:
    api = TriggerSubscriptionDeleteApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/"),
        patch.object(trigger_provider_module, "db", SimpleNamespace(engine=sqlite_engine)),
        patch.object(
            trigger_provider_module.TriggerProviderService,
            "delete_trigger_provider",
            side_effect=ValueError("bad"),
        ),
        pytest.raises(BadRequest, match="bad"),
    ):
        method(api, "t1", "sub1")

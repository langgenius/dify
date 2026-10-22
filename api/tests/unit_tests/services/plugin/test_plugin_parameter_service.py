"""Unit tests for services.plugin.plugin_parameter_service.PluginParameterService.

Covers: dynamic select options via tool and trigger credential paths,
HIDDEN_VALUE replacement, and error handling for missing records.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from threading import Lock
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy.orm import Session, sessionmaker

import contexts
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import delete_cache_for_subscription
from extensions.ext_redis import RedisClientWrapper
from models.engine import db
from models.provider_ids import TriggerProviderID
from models.tools import BuiltinToolProvider
from repositories.trigger.subscription_builder_repository import RedisTriggerSubscriptionBuilderRepository
from repositories.trigger.subscription_repository import RedisTriggerSubscriptionLocks, TriggerSubscriptionRepository
from services.plugin.plugin_parameter_service import PluginParameterService
from services.trigger.subscription_gateway import PluginTriggerSubscriptionGateway
from services.trigger.subscription_service import TriggerSubscriptionService
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService
from tests.unit_tests.core.trigger.conftest import make_controller


@pytest.fixture(autouse=True)
def trigger_declaration() -> Iterator[None]:
    provider_id = TriggerProviderID("org/plugin/github")
    controller = make_controller(tenant_id="t1", provider_id=str(provider_id))
    controller.plugin_id = provider_id.plugin_id
    controller.plugin_unique_identifier = f"{provider_id.plugin_id}:1.0.0@{'a' * 32}"
    previous_providers = contexts.plugin_trigger_providers.get({})
    previous_lock = contexts.plugin_trigger_providers_lock.get(Lock())
    contexts.plugin_trigger_providers.set({str(provider_id): controller})
    contexts.plugin_trigger_providers_lock.set(Lock())
    try:
        yield
    finally:
        contexts.plugin_trigger_providers.set(previous_providers)
        contexts.plugin_trigger_providers_lock.set(previous_lock)


@pytest.fixture
def builders(sqlite_session_factory: sessionmaker[Session]) -> Iterator[TriggerSubscriptionBuilderService]:
    # Tool-provider paths receive the real dependency but must not query builder Redis.
    with Redis(socket_connect_timeout=0.1) as client:
        redis = RedisClientWrapper()
        redis.initialize(client)
        subscription_management = TriggerSubscriptionService(
            subscriptions=TriggerSubscriptionRepository(session_factory=sqlite_session_factory),
            providers=PluginTriggerSubscriptionGateway(),
            locks=RedisTriggerSubscriptionLocks(redis=redis),
            invalidate_cache=delete_cache_for_subscription,
        )
        yield TriggerSubscriptionBuilderService(
            builders=RedisTriggerSubscriptionBuilderRepository(redis=redis),
            get_provider=TriggerManager.get_trigger_provider,
            subscribe=TriggerManager.subscribe_trigger,
            create_subscription=subscription_management.create,
        )


@pytest.fixture
def plugin_parameter_db() -> Iterator[Session]:
    """Provide the production database extension with an isolated SQLite credential table."""
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    db.init_app(app)

    with app.app_context():
        BuiltinToolProvider.__table__.create(db.engine)
        with Session(db.engine, expire_on_commit=False) as session:
            yield session


class TestGetDynamicSelectOptionsTool:
    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.ToolManager")
    def test_no_credentials_needed(
        self, mock_tool_mgr: MagicMock, mock_client_cls: MagicMock, builders: TriggerSubscriptionBuilderService
    ) -> None:
        provider_ctrl = MagicMock()
        provider_ctrl.entity.identity.name = "google"
        provider_ctrl.plugin_unique_identifier = "org/plugin:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        provider_ctrl.need_credentials = False
        mock_tool_mgr.get_plugin_provider.return_value = provider_ctrl
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt1"]

        result = PluginParameterService.get_dynamic_select_options(
            tenant_id="t1",
            user_id="u1",
            plugin_id="org/plugin",
            provider="google",
            action="search",
            parameter="engine",
            credential_id=None,
            provider_type="tool",
            builders=builders,
        )

        assert result == ["opt1"]
        call_kwargs = mock_client_cls.return_value.fetch_dynamic_select_options.call_args
        assert call_kwargs[0][5] == {}  # empty credentials

    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.create_tool_provider_encrypter")
    @patch("services.plugin.plugin_parameter_service.ToolManager")
    def test_fetches_credentials_with_credential_id(
        self,
        mock_tool_mgr: MagicMock,
        mock_encrypter_fn: MagicMock,
        mock_client_cls: MagicMock,
        plugin_parameter_db: Session,
        builders: TriggerSubscriptionBuilderService,
    ) -> None:
        tenant_id = str(uuid4())
        provider_ctrl = MagicMock()
        provider_ctrl.entity.identity.name = "google"
        provider_ctrl.plugin_unique_identifier = "org/plugin:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        provider_ctrl.need_credentials = True
        mock_tool_mgr.get_plugin_provider.return_value = provider_ctrl
        encrypter = MagicMock()
        encrypter.decrypt.return_value = {"api_key": "decrypted"}
        mock_encrypter_fn.return_value = (encrypter, None)
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt1"]

        db_record = BuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=str(uuid4()),
            provider="google",
            name="API KEY 1",
            encrypted_credentials=json.dumps({"api_key": "encrypted"}),
            credential_type=CredentialType.API_KEY,
        )
        plugin_parameter_db.add(db_record)
        plugin_parameter_db.commit()

        result = PluginParameterService.get_dynamic_select_options(
            tenant_id=tenant_id,
            user_id="u1",
            plugin_id="org/plugin",
            provider="google",
            action="search",
            parameter="engine",
            credential_id=db_record.id,
            provider_type="tool",
            builders=builders,
        )

        assert result == ["opt1"]

    @patch("services.plugin.plugin_parameter_service.create_tool_provider_encrypter")
    @patch("services.plugin.plugin_parameter_service.ToolManager")
    def test_raises_when_tool_provider_not_found(
        self,
        mock_tool_mgr: MagicMock,
        mock_encrypter_fn: MagicMock,
        plugin_parameter_db: Session,
        builders: TriggerSubscriptionBuilderService,
    ) -> None:
        provider_ctrl = MagicMock()
        provider_ctrl.entity.identity.name = "google"
        provider_ctrl.plugin_unique_identifier = "org/plugin:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        provider_ctrl.need_credentials = True
        mock_tool_mgr.get_plugin_provider.return_value = provider_ctrl
        mock_encrypter_fn.return_value = (MagicMock(), None)

        with pytest.raises(ValueError, match="not found"):
            PluginParameterService.get_dynamic_select_options(
                tenant_id=str(uuid4()),
                user_id="u1",
                plugin_id="org/plugin",
                provider="google",
                action="search",
                parameter="engine",
                credential_id=None,
                provider_type="tool",
                builders=builders,
            )


class TestGetDynamicSelectOptionsWithCredentials:
    @patch("services.plugin.plugin_parameter_service.DynamicSelectClient")
    @patch("services.plugin.plugin_parameter_service.TriggerProviderService")
    def test_replaces_hidden_values(self, mock_provider_svc, mock_client_cls):
        from constants import HIDDEN_VALUE

        original = MagicMock()
        original.credentials = {"token": "real-secret", "name": "real-name"}
        original.credential_type = "api_key"
        mock_provider_svc.get_subscription_by_id.return_value = original
        mock_client_cls.return_value.fetch_dynamic_select_options.return_value.options = ["opt"]

        result = PluginParameterService.get_dynamic_select_options_with_credentials(
            tenant_id="t1",
            user_id="u1",
            plugin_id="org/plugin",
            provider="github",
            action="on_push",
            parameter="branch",
            credential_id="cred-1",
            credentials={"token": HIDDEN_VALUE, "name": "new-name"},
        )

        assert result == ["opt"]
        call_args = mock_client_cls.return_value.fetch_dynamic_select_options.call_args[0]
        resolved = call_args[5]
        assert resolved["token"] == "real-secret"  # replaced
        assert resolved["name"] == "new-name"  # kept as-is

    @patch("services.plugin.plugin_parameter_service.TriggerProviderService")
    def test_raises_when_subscription_not_found(self, mock_provider_svc):
        mock_provider_svc.get_subscription_by_id.return_value = None

        with pytest.raises(ValueError, match="not found"):
            PluginParameterService.get_dynamic_select_options_with_credentials(
                tenant_id="t1",
                user_id="u1",
                plugin_id="org/plugin",
                provider="github",
                action="on_push",
                parameter="branch",
                credential_id="nonexistent",
                credentials={"token": "val"},
            )

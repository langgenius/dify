"""Unit tests for services.app_service."""

import json
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

import pytest

from core.errors.error import ProviderTokenNotInitError
from models import Account, Tenant
from models.model import App, AppMode
from services.app_service import AppService


@pytest.fixture
def service() -> AppService:
    """Provide AppService instance."""
    return AppService()


@pytest.fixture
def account() -> Account:
    """Create account object for create_app tests."""
    tenant = Tenant(name="Tenant")
    tenant.id = "tenant-1"
    result = Account(name="Account User", email="account@example.com")
    result.id = "acc-1"
    result._current_tenant = tenant
    return result


@pytest.fixture
def default_args() -> dict:
    """Create default create_app args."""
    return {
        "name": "Test App",
        "mode": AppMode.CHAT.value,
        "icon": "🤖",
        "icon_background": "#FFFFFF",
    }


@pytest.fixture
def app_template() -> dict:
    """Create basic app template for create_app tests."""
    return {
        AppMode.CHAT: {
            "app": {},
            "model_config": {
                "model": {
                    "provider": "provider-a",
                    "name": "model-a",
                    "mode": "chat",
                    "completion_params": {},
                }
            },
        }
    }


def _make_current_user() -> Account:
    user = Account(name="Tester", email="tester@example.com")
    user.id = "user-1"
    tenant = Tenant(name="Tenant")
    tenant.id = "tenant-1"
    user._current_tenant = tenant
    return user


class TestAppServicePagination:
    """Test suite for get_paginate_apps."""

    def test_get_paginate_apps_should_return_none_when_tag_filter_empty(self, service: AppService) -> None:
        """Test pagination returns None when tag filter has no targets."""
        # Arrange
        args = {"mode": "chat", "page": 1, "limit": 20, "tag_ids": ["tag-1"]}

        with patch("services.app_service.TagService.get_target_ids_by_tag_ids", return_value=[]):
            # Act
            result = service.get_paginate_apps("user-1", "tenant-1", args)

            # Assert
            assert result is None

    def test_get_paginate_apps_should_delegate_to_db_paginate(self, service: AppService) -> None:
        """Test pagination delegates to db.paginate when filters are valid."""
        # Arrange
        args = {
            "mode": "workflow",
            "is_created_by_me": True,
            "name": "My_App%",
            "tag_ids": ["tag-1"],
            "page": 2,
            "limit": 10,
        }
        expected_pagination = MagicMock()

        with (
            patch("services.app_service.TagService.get_target_ids_by_tag_ids", return_value=["app-1"]),
            patch("libs.helper.escape_like_pattern", return_value="escaped"),
            patch("services.app_service.db") as mock_db,
        ):
            mock_db.paginate.return_value = expected_pagination

            # Act
            result = service.get_paginate_apps("user-1", "tenant-1", args)

            # Assert
            assert result is expected_pagination
            mock_db.paginate.assert_called_once()


class TestAppServiceCreate:
    """Test suite for create_app."""

    def test_create_app_should_create_with_matching_default_model(
        self,
        service: AppService,
        account: Account,
        default_args: dict,
        app_template: dict,
    ) -> None:
        """Test create_app uses matching default model and persists app config."""
        # Arrange
        app_instance = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        app_model_config = SimpleNamespace(id="cfg-1")
        model_instance = SimpleNamespace(
            model_name="model-a",
            provider="provider-a",
            model_type_instance=MagicMock(),
            credentials={"k": "v"},
        )

        with (
            patch("services.app_service.default_app_templates", app_template),
            patch("services.app_service.App", return_value=app_instance),
            patch("services.app_service.AppModelConfig", return_value=app_model_config),
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.app_was_created") as mock_event,
            patch("services.app_service.FeatureService.get_system_features") as mock_features,
            patch("services.app_service.BillingService") as mock_billing,
            patch("services.app_service.dify_config") as mock_config,
        ):
            manager = mock_model_manager.return_value
            manager.get_default_model_instance.return_value = model_instance
            mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
            mock_config.BILLING_ENABLED = True

            # Act
            result = service.create_app("tenant-1", default_args, account)

            # Assert
            assert result is app_instance
            assert app_instance.app_model_config_id == "cfg-1"
            mock_db.session.add.assert_any_call(app_instance)
            mock_db.session.add.assert_any_call(app_model_config)
            assert mock_db.session.flush.call_count == 2
            mock_db.session.commit.assert_called_once()
            mock_event.send.assert_called_once_with(app_instance, account=account)
            mock_billing.clean_billing_info_cache.assert_called_once_with("tenant-1")

    def test_create_app_should_raise_when_model_schema_missing(
        self,
        service: AppService,
        account: Account,
        default_args: dict,
        app_template: dict,
    ) -> None:
        """Test create_app raises ValueError when non-matching model has no schema."""
        # Arrange
        app_instance = SimpleNamespace(id="app-1")
        model_instance = SimpleNamespace(
            model_name="model-b",
            provider="provider-b",
            model_type_instance=MagicMock(),
            credentials={"k": "v"},
        )
        model_instance.model_type_instance.get_model_schema.return_value = None

        with (
            patch("services.app_service.default_app_templates", app_template),
            patch("services.app_service.App", return_value=app_instance),
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.app_service.db") as mock_db,
        ):
            manager = mock_model_manager.return_value
            manager.get_default_model_instance.return_value = model_instance

            # Act & Assert
            with pytest.raises(ValueError, match="model schema not found"):
                service.create_app("tenant-1", default_args, account)
            mock_db.session.commit.assert_not_called()

    def test_create_app_should_fallback_to_default_provider_when_model_missing(
        self,
        service: AppService,
        account: Account,
        default_args: dict,
        app_template: dict,
    ) -> None:
        """Test create_app falls back to provider/model name when no default model instance is available."""
        # Arrange
        app_instance = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        app_model_config = SimpleNamespace(id="cfg-1")

        with (
            patch("services.app_service.default_app_templates", app_template),
            patch("services.app_service.App", return_value=app_instance),
            patch("services.app_service.AppModelConfig", return_value=app_model_config),
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.app_was_created") as mock_event,
            patch("services.app_service.FeatureService.get_system_features") as mock_features,
            patch("services.app_service.EnterpriseService") as mock_enterprise,
            patch("services.app_service.dify_config") as mock_config,
        ):
            manager = mock_model_manager.return_value
            manager.get_default_model_instance.side_effect = ProviderTokenNotInitError("not ready")
            manager.get_default_provider_model_name.return_value = ("fallback-provider", "fallback-model")
            mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True))
            mock_config.BILLING_ENABLED = False

            # Act
            result = service.create_app("tenant-1", default_args, account)

            # Assert
            assert result is app_instance
            mock_event.send.assert_called_once_with(app_instance, account=account)
            mock_db.session.commit.assert_called_once()
            mock_enterprise.WebAppAuth.update_app_access_mode.assert_called_once_with("app-1", "private")

    def test_create_app_should_log_and_fallback_on_unexpected_model_error(
        self,
        service: AppService,
        account: Account,
        default_args: dict,
        app_template: dict,
    ) -> None:
        """Test unexpected model manager errors are logged and fallback provider is used."""
        # Arrange
        app_instance = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        app_model_config = SimpleNamespace(id="cfg-1")

        with (
            patch("services.app_service.default_app_templates", app_template),
            patch("services.app_service.App", return_value=app_instance),
            patch("services.app_service.AppModelConfig", return_value=app_model_config),
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.app_service.db"),
            patch("services.app_service.app_was_created"),
            patch(
                "services.app_service.FeatureService.get_system_features",
                return_value=SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            ),
            patch("services.app_service.dify_config", new=SimpleNamespace(BILLING_ENABLED=False)),
            patch("services.app_service.logger") as mock_logger,
        ):
            manager = mock_model_manager.return_value
            manager.get_default_model_instance.side_effect = RuntimeError("boom")
            manager.get_default_provider_model_name.return_value = ("fallback-provider", "fallback-model")

            # Act
            result = service.create_app("tenant-1", default_args, account)

            # Assert
            assert result is app_instance
            mock_logger.exception.assert_called_once()


class TestAppServiceGetAndUpdate:
    """Test suite for app retrieval and update methods."""

    def test_get_app_should_return_original_when_not_agent_app(self, service: AppService) -> None:
        """Test get_app returns original app for non-agent modes."""
        # Arrange
        app = MagicMock()
        app.mode = AppMode.CHAT
        app.is_agent = False

        with patch("services.app_service.current_user", _make_current_user()):
            # Act
            result = service.get_app(app)

            # Assert
            assert result is app

    def test_get_app_should_return_original_when_model_config_missing(self, service: AppService) -> None:
        """Test get_app returns app when agent mode has no model config."""
        # Arrange
        app = MagicMock()
        app.id = "app-1"
        app.mode = AppMode.AGENT_CHAT
        app.is_agent = False
        app.app_model_config = None

        with patch("services.app_service.current_user", _make_current_user()):
            # Act
            result = service.get_app(app)

            # Assert
            assert result is app

    def test_get_app_should_mask_tool_parameters_for_agent_tools(self, service: AppService) -> None:
        """Test get_app decrypts and masks secret tool parameters."""
        # Arrange
        tool = {
            "provider_type": "builtin",
            "provider_id": "provider-1",
            "tool_name": "tool-a",
            "tool_parameters": {"secret": "encrypted"},
            "extra": True,
        }
        model_config = MagicMock()
        model_config.agent_mode_dict = {"tools": [tool, {"skip": True}]}

        app = MagicMock()
        app.id = "app-1"
        app.mode = AppMode.AGENT_CHAT
        app.is_agent = False
        app.app_model_config = model_config

        manager = MagicMock()
        manager.decrypt_tool_parameters.return_value = {"secret": "decrypted"}
        manager.mask_tool_parameters.return_value = {"secret": "***"}

        with (
            patch("services.app_service.current_user", _make_current_user()),
            patch("services.app_service.ToolManager.get_agent_tool_runtime", return_value=MagicMock()),
            patch("services.app_service.ToolParameterConfigurationManager", return_value=manager),
        ):
            # Act
            result = service.get_app(app)

            # Assert
            assert result.app_model_config is model_config
            assert tool["tool_parameters"] == {"secret": "***"}
            assert json.loads(model_config.agent_mode)["tools"][0]["tool_parameters"] == {"secret": "***"}

    def test_get_app_should_continue_when_tool_parameter_masking_fails(self, service: AppService) -> None:
        """Test get_app logs and continues when masking fails."""
        # Arrange
        tool = {
            "provider_type": "builtin",
            "provider_id": "provider-1",
            "tool_name": "tool-a",
            "tool_parameters": {"secret": "encrypted"},
            "extra": True,
        }
        model_config = MagicMock()
        model_config.agent_mode_dict = {"tools": [tool]}

        app = MagicMock()
        app.id = "app-1"
        app.mode = AppMode.AGENT_CHAT
        app.is_agent = False
        app.app_model_config = model_config

        with (
            patch("services.app_service.current_user", _make_current_user()),
            patch("services.app_service.ToolManager.get_agent_tool_runtime", side_effect=RuntimeError("mask-failed")),
            patch("services.app_service.logger") as mock_logger,
        ):
            # Act
            result = service.get_app(app)

            # Assert
            assert result.app_model_config is model_config
            mock_logger.exception.assert_called_once()

    def test_update_methods_should_mutate_app_and_commit(self, service: AppService) -> None:
        """Test update methods set fields and commit changes."""
        # Arrange
        app = cast(
            App,
            SimpleNamespace(
                name="old",
                description="old",
                icon_type="emoji",
                icon="a",
                icon_background="#111",
                enable_site=True,
                enable_api=True,
            ),
        )
        args = {
            "name": "new",
            "description": "new-desc",
            "icon_type": "image",
            "icon": "new-icon",
            "icon_background": "#222",
            "use_icon_as_answer_icon": True,
            "max_active_requests": 5,
        }
        user = SimpleNamespace(id="user-1")

        with (
            patch("services.app_service.current_user", user),
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.naive_utc_now", return_value="now"),
        ):
            # Act
            updated = service.update_app(app, args)
            renamed = service.update_app_name(app, "rename")
            iconed = service.update_app_icon(app, "icon-2", "#333")
            site_same = service.update_app_site_status(app, app.enable_site)
            api_same = service.update_app_api_status(app, app.enable_api)
            site_changed = service.update_app_site_status(app, False)
            api_changed = service.update_app_api_status(app, False)

            # Assert
            assert updated is app
            assert renamed is app
            assert iconed is app
            assert site_same is app
            assert api_same is app
            assert site_changed is app
            assert api_changed is app
            assert mock_db.session.commit.call_count >= 5


class TestAppServiceDeleteAndMeta:
    """Test suite for delete and metadata methods."""

    def test_delete_app_should_cleanup_and_enqueue_task(self, service: AppService) -> None:
        """Test delete_app removes app, runs cleanup, and triggers async deletion task."""
        # Arrange
        app = cast(App, SimpleNamespace(id="app-1", tenant_id="tenant-1"))

        with (
            patch("services.app_service.db") as mock_db,
            patch(
                "services.app_service.FeatureService.get_system_features",
                return_value=SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True)),
            ),
            patch("services.app_service.EnterpriseService") as mock_enterprise,
            patch(
                "services.app_service.dify_config",
                new=SimpleNamespace(BILLING_ENABLED=True, CONSOLE_API_URL="https://console.example"),
            ),
            patch("services.app_service.BillingService") as mock_billing,
            patch("services.app_service.remove_app_and_related_data_task") as mock_task,
        ):
            # Act
            service.delete_app(app)

            # Assert
            mock_db.session.delete.assert_called_once_with(app)
            mock_db.session.commit.assert_called_once()
            mock_enterprise.WebAppAuth.cleanup_webapp.assert_called_once_with("app-1")
            mock_billing.clean_billing_info_cache.assert_called_once_with("tenant-1")
            mock_task.delay.assert_called_once_with(tenant_id="tenant-1", app_id="app-1")

    def test_get_app_meta_should_handle_workflow_and_tool_provider_icons(self, service: AppService) -> None:
        """Test get_app_meta extracts builtin and API tool icons from workflow graph."""
        # Arrange
        workflow = SimpleNamespace(
            graph_dict={
                "nodes": [
                    {
                        "data": {
                            "type": "tool",
                            "provider_type": "builtin",
                            "provider_id": "builtin-provider",
                            "tool_name": "tool_builtin",
                        }
                    },
                    {
                        "data": {
                            "type": "tool",
                            "provider_type": "api",
                            "provider_id": "api-provider-id",
                            "tool_name": "tool_api",
                        }
                    },
                ]
            }
        )
        app = cast(
            App,
            SimpleNamespace(
                mode=AppMode.WORKFLOW.value,
                workflow=workflow,
                app_model_config=None,
                tenant_id="tenant-1",
                icon_type="emoji",
                icon_background="#fff",
            ),
        )

        provider = SimpleNamespace(icon=json.dumps({"background": "#000", "content": "A"}))

        with (
            patch("services.app_service.dify_config", new=SimpleNamespace(CONSOLE_API_URL="https://console.example")),
            patch("services.app_service.db") as mock_db,
        ):
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = provider
            mock_db.session.query.return_value = query

            # Act
            meta = service.get_app_meta(app)

            # Assert
            assert meta["tool_icons"]["tool_builtin"].endswith("/builtin-provider/icon")
            assert meta["tool_icons"]["tool_api"] == {"background": "#000", "content": "A"}

    def test_get_app_meta_should_use_default_api_icon_on_lookup_error(self, service: AppService) -> None:
        """Test get_app_meta falls back to default icon when API provider lookup fails."""
        # Arrange
        app_model_config = SimpleNamespace(
            agent_mode_dict={
                "tools": [{"provider_type": "api", "provider_id": "x", "tool_name": "t", "tool_parameters": {}}]
            }
        )
        app = cast(App, SimpleNamespace(mode=AppMode.CHAT.value, app_model_config=app_model_config, workflow=None))

        with (
            patch("services.app_service.dify_config", new=SimpleNamespace(CONSOLE_API_URL="https://console.example")),
            patch("services.app_service.db") as mock_db,
        ):
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act
            meta = service.get_app_meta(app)

            # Assert
            assert meta["tool_icons"]["t"] == {"background": "#252525", "content": "\ud83d\ude01"}

    def test_get_app_meta_should_return_empty_when_required_data_missing(self, service: AppService) -> None:
        """Test get_app_meta returns empty metadata when workflow/model config is absent."""
        # Arrange
        workflow_app = cast(App, SimpleNamespace(mode=AppMode.WORKFLOW.value, workflow=None))
        chat_app = cast(App, SimpleNamespace(mode=AppMode.CHAT.value, app_model_config=None))

        # Act
        workflow_meta = service.get_app_meta(workflow_app)
        chat_meta = service.get_app_meta(chat_app)

        # Assert
        assert workflow_meta == {"tool_icons": {}}
        assert chat_meta == {"tool_icons": {}}


class TestAppServiceCodeLookup:
    """Test suite for app code lookup methods."""

    def test_get_app_code_by_id_should_raise_when_site_missing(self) -> None:
        """Test get_app_code_by_id raises when site is missing."""
        # Arrange
        with patch("services.app_service.db") as mock_db:
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act & Assert
            with pytest.raises(ValueError, match="not found"):
                AppService.get_app_code_by_id("app-1")

    def test_get_app_code_by_id_should_return_code(self) -> None:
        """Test get_app_code_by_id returns site code."""
        # Arrange
        site = SimpleNamespace(code="code-1")
        with patch("services.app_service.db") as mock_db:
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = site
            mock_db.session.query.return_value = query

            # Act
            result = AppService.get_app_code_by_id("app-1")

            # Assert
            assert result == "code-1"

    def test_get_app_id_by_code_should_raise_when_site_missing(self) -> None:
        """Test get_app_id_by_code raises when code does not exist."""
        # Arrange
        with patch("services.app_service.db") as mock_db:
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = None
            mock_db.session.query.return_value = query

            # Act & Assert
            with pytest.raises(ValueError, match="not found"):
                AppService.get_app_id_by_code("missing")

    def test_get_app_id_by_code_should_return_app_id(self) -> None:
        """Test get_app_id_by_code returns linked app id."""
        # Arrange
        site = SimpleNamespace(app_id="app-1")
        with patch("services.app_service.db") as mock_db:
            query = MagicMock()
            query.where.return_value = query
            query.first.return_value = site
            mock_db.session.query.return_value = query

            # Act
            result = AppService.get_app_id_by_code("code-1")

            # Assert
            assert result == "app-1"

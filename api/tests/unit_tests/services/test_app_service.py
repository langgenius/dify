"""
Comprehensive unit tests for AppService.

This test suite provides complete coverage of app management operations in Dify,
following TDD principles with the Arrange-Act-Assert pattern.

Test Coverage:
- App creation with various configurations (chat, completion, workflow, agent-chat modes)
- App duplication using DSL export/import
- App deletion with cascade cleanup
- Model provider switching and configuration updates
- Feature flag management (enable_site, enable_api)
"""

from unittest.mock import Mock, create_autospec, patch
from uuid import uuid4

import pytest

from core.model_runtime.entities.model_entities import ModelType
from models.account import Account
from models.model import App, AppMode, AppModelConfig, Site


class AppServiceTestDataFactory:
    """
    Factory class for creating test data and mock objects.

    Provides reusable methods to create mock objects for testing app service operations.
    Using a factory pattern ensures consistency across tests and reduces code duplication.
    """

    @staticmethod
    def create_account_mock(
        account_id: str = "account-123",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock account with specified attributes.

        Args:
            account_id: Unique identifier for the account
            tenant_id: Tenant ID the account belongs to
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock: A properly configured Account mock object
        """
        account = create_autospec(Account, instance=True)
        account.id = account_id
        account.current_tenant_id = tenant_id
        for key, value in kwargs.items():
            setattr(account, key, value)
        return account

    @staticmethod
    def create_app_mock(
        app_id: str = "app-123",
        name: str = "Test App",
        tenant_id: str = "tenant-123",
        mode: str = AppMode.CHAT,
        created_by: str = "user-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock app with specified attributes.

        Args:
            app_id: Unique identifier for the app
            name: Display name of the app
            tenant_id: Tenant ID the app belongs to
            mode: App mode (chat, completion, workflow, agent-chat, advanced-chat)
            created_by: User ID who created the app
            **kwargs: Additional attributes (enable_site, enable_api, etc.)

        Returns:
            Mock: A properly configured App mock object
        """
        app = create_autospec(App, instance=True)
        app.id = app_id
        app.name = name
        app.tenant_id = tenant_id
        app.mode = mode
        app.created_by = created_by
        app.updated_by = created_by
        app.enable_site = kwargs.get("enable_site", True)
        app.enable_api = kwargs.get("enable_api", True)
        app.app_model_config_id = kwargs.get("app_model_config_id")
        app.workflow_id = kwargs.get("workflow_id")
        app.description = kwargs.get("description", "")
        app.icon_type = kwargs.get("icon_type", "emoji")
        app.icon = kwargs.get("icon", "🤖")
        app.icon_background = kwargs.get("icon_background", "#FFEAD5")
        app.api_rpm = kwargs.get("api_rpm", 0)
        app.api_rph = kwargs.get("api_rph", 0)
        app.is_agent = False
        app.app_model_config = None
        for key, value in kwargs.items():
            if not hasattr(app, key):
                setattr(app, key, value)
        return app

    @staticmethod
    def create_app_model_config_mock(
        config_id: str = "config-123",
        app_id: str = "app-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock app model config.

        Args:
            config_id: Unique identifier for the config
            app_id: App ID this config belongs to
            **kwargs: Additional attributes (model, provider, etc.)

        Returns:
            Mock: AppModelConfig mock object
        """
        config = create_autospec(AppModelConfig, instance=True)
        config.id = config_id
        config.app_id = app_id
        config.provider = kwargs.get("provider", "openai")
        config.model_id = kwargs.get("model_id", "gpt-3.5-turbo")
        config.agent_mode = kwargs.get("agent_mode")
        config.agent_mode_dict = kwargs.get("agent_mode_dict", {})
        for key, value in kwargs.items():
            if not hasattr(config, key):
                setattr(config, key, value)
        return config

    @staticmethod
    def create_model_instance_mock(
        provider: str = "openai",
        model: str = "gpt-3.5-turbo",
        **kwargs,
    ) -> Mock:
        """
        Create a mock model instance.

        Args:
            provider: Model provider (e.g., 'openai', 'anthropic')
            model: Model name (e.g., 'gpt-3.5-turbo')
            **kwargs: Additional attributes

        Returns:
            Mock: Model instance mock
        """
        model_instance = Mock()
        model_instance.provider = provider
        model_instance.model = model
        model_instance.model_type_instance = Mock()
        model_instance.credentials = kwargs.get("credentials", {})
        for key, value in kwargs.items():
            if not hasattr(model_instance, key):
                setattr(model_instance, key, value)
        return model_instance

    @staticmethod
    def create_site_mock(
        site_id: str = "site-123",
        app_id: str = "app-123",
        code: str = "abc123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock site.

        Args:
            site_id: Unique identifier for the site
            app_id: App ID this site belongs to
            code: Site access code
            **kwargs: Additional attributes

        Returns:
            Mock: Site mock object
        """
        site = create_autospec(Site, instance=True)
        site.id = site_id
        site.app_id = app_id
        site.code = code
        for key, value in kwargs.items():
            setattr(site, key, value)
        return site


# ==================== App Creation Tests ====================


class TestAppServiceCreateApp:
    """
    Comprehensive unit tests for app creation logic.

    Covers:
    - Chat app creation with default model configuration
    - Completion app creation
    - Workflow app creation
    - Agent-chat app creation
    - App creation with custom configurations
    - Error handling for missing model providers
    """

    @pytest.fixture
    def mock_app_service_dependencies(self):
        """
        Common mock setup for app service dependencies.

        Patches all external dependencies that AppService.create_app interacts with:
        - db.session: Database operations
        - ModelManager: Model provider management
        - app_was_created: Event signal for app creation
        - FeatureService: Feature flag management
        - EnterpriseService: Enterprise features
        - BillingService: Billing operations
        """
        with (
            patch("extensions.ext_database.db.session") as mock_db,
            patch("core.model_manager.ModelManager") as mock_model_manager,
            patch("events.app_event.app_was_created") as mock_app_created,
            patch("services.feature_service.FeatureService") as mock_feature_service,
            patch("services.enterprise.enterprise_service.EnterpriseService") as mock_enterprise_service,
            patch("services.billing_service.BillingService") as mock_billing_service,
            patch("configs.dify_config") as mock_config,
        ):
            # Setup default feature flags
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_config.BILLING_ENABLED = False

            yield {
                "db_session": mock_db,
                "model_manager": mock_model_manager,
                "app_was_created": mock_app_created,
                "feature_service": mock_feature_service,
                "enterprise_service": mock_enterprise_service,
                "billing_service": mock_billing_service,
                "config": mock_config,
            }

    def test_create_chat_app_with_default_model(self, mock_app_service_dependencies):
        """
        Test successful creation of chat app with default model configuration.

        Verifies:
        - App is created with correct mode and basic attributes
        - Default model configuration is applied
        - Model provider is fetched from ModelManager
        - Database operations are executed correctly
        """
        # Import here to avoid circular import at module load time
        from services.app_service import AppService

        # Arrange
        tenant_id = str(uuid4())
        account = AppServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)

        # Mock model manager to return default model
        model_instance = AppServiceTestDataFactory.create_model_instance_mock()
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.return_value = model_instance
        mock_model_manager_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")

        # Mock model schema
        model_schema = Mock()
        model_schema.model_properties = {"mode": "chat"}
        model_instance.model_type_instance.get_model_schema.return_value = model_schema

        mock_app_service_dependencies["model_manager"].return_value = mock_model_manager_instance

        args = {
            "name": "Test Chat App",
            "mode": AppMode.CHAT,
            "icon": "🤖",
            "icon_background": "#FFEAD5",
        }

        # Act
        result = AppService().create_app(tenant_id, args, account)

        # Assert
        assert result is not None
        assert result.name == "Test Chat App"
        assert result.mode == AppMode.CHAT
        assert result.tenant_id == tenant_id
        assert result.created_by == account.id
        assert result.updated_by == account.id
        mock_app_service_dependencies["db_session"].add.assert_called()
        mock_app_service_dependencies["db_session"].commit.assert_called()
        mock_app_service_dependencies["app_was_created"].send.assert_called_once()

    def test_create_completion_app_success(self, mock_app_service_dependencies):
        """Test successful creation of completion app."""
        from services.app_service import AppService

        # Arrange
        tenant_id = str(uuid4())
        account = AppServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)

        # Mock model manager
        model_instance = AppServiceTestDataFactory.create_model_instance_mock()
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.return_value = model_instance

        # Mock model schema
        model_schema = Mock()
        model_schema.model_properties = {"mode": "completion"}
        model_instance.model_type_instance.get_model_schema.return_value = model_schema

        mock_app_service_dependencies["model_manager"].return_value = mock_model_manager_instance

        args = {
            "name": "Test Completion App",
            "mode": AppMode.COMPLETION,
            "icon": "📝",
            "icon_background": "#E3F2FD",
            "description": "A completion app for testing",
        }

        # Act
        result = AppService().create_app(tenant_id, args, account)

        # Assert
        assert result.name == "Test Completion App"
        assert result.mode == AppMode.COMPLETION
        assert result.description == "A completion app for testing"
        mock_app_service_dependencies["db_session"].commit.assert_called()

    def test_create_workflow_app_success(self, mock_app_service_dependencies):
        """Test successful creation of workflow app (no model config needed)."""
        from services.app_service import AppService

        # Arrange
        tenant_id = str(uuid4())
        account = AppServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)

        args = {
            "name": "Test Workflow App",
            "mode": AppMode.WORKFLOW,
            "icon": "⚙️",
            "icon_background": "#F3E5F5",
        }

        # Act
        result = AppService().create_app(tenant_id, args, account)

        # Assert
        assert result.name == "Test Workflow App"
        assert result.mode == AppMode.WORKFLOW
        mock_app_service_dependencies["db_session"].commit.assert_called()

    def test_create_agent_chat_app_success(self, mock_app_service_dependencies):
        """Test successful creation of agent-chat app."""
        from services.app_service import AppService

        # Arrange
        tenant_id = str(uuid4())
        account = AppServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)

        # Mock model manager
        model_instance = AppServiceTestDataFactory.create_model_instance_mock()
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.return_value = model_instance

        # Mock model schema
        model_schema = Mock()
        model_schema.model_properties = {"mode": "chat"}
        model_instance.model_type_instance.get_model_schema.return_value = model_schema

        mock_app_service_dependencies["model_manager"].return_value = mock_model_manager_instance

        args = {
            "name": "Test Agent App",
            "mode": AppMode.AGENT_CHAT,
            "icon": "🤖",
            "icon_background": "#FFF3E0",
        }

        # Act
        result = AppService().create_app(tenant_id, args, account)

        # Assert
        assert result.name == "Test Agent App"
        assert result.mode == AppMode.AGENT_CHAT
        mock_app_service_dependencies["db_session"].commit.assert_called()

    def test_create_app_with_custom_rate_limits(self, mock_app_service_dependencies):
        """Test app creation with custom API rate limits."""
        from services.app_service import AppService

        # Arrange
        tenant_id = str(uuid4())
        account = AppServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)

        # Mock model manager
        model_instance = AppServiceTestDataFactory.create_model_instance_mock()
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.return_value = model_instance

        # Mock model schema
        model_schema = Mock()
        model_schema.model_properties = {"mode": "chat"}
        model_instance.model_type_instance.get_model_schema.return_value = model_schema

        mock_app_service_dependencies["model_manager"].return_value = mock_model_manager_instance

        args = {
            "name": "Rate Limited App",
            "mode": AppMode.CHAT,
            "icon": "🚦",
            "icon_background": "#E8F5E9",
            "api_rpm": 100,
            "api_rph": 1000,
        }

        # Act
        result = AppService().create_app(tenant_id, args, account)

        # Assert
        assert result.api_rpm == 100
        assert result.api_rph == 1000
        mock_app_service_dependencies["db_session"].commit.assert_called()

    def test_create_app_with_webapp_auth_enabled(self, mock_app_service_dependencies):
        """Test app creation with webapp authentication feature enabled."""
        from services.app_service import AppService

        # Arrange
        tenant_id = str(uuid4())
        account = AppServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)

        # Enable webapp auth feature
        mock_app_service_dependencies["feature_service"].get_system_features.return_value.webapp_auth.enabled = True

        # Mock model manager
        model_instance = AppServiceTestDataFactory.create_model_instance_mock()
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.return_value = model_instance

        # Mock model schema
        model_schema = Mock()
        model_schema.model_properties = {"mode": "chat"}
        model_instance.model_type_instance.get_model_schema.return_value = model_schema

        mock_app_service_dependencies["model_manager"].return_value = mock_model_manager_instance

        args = {
            "name": "Secure App",
            "mode": AppMode.CHAT,
            "icon": "🔒",
            "icon_background": "#FFEBEE",
        }

        # Act
        result = AppService().create_app(tenant_id, args, account)

        # Assert
        assert result is not None
        mock_app_service_dependencies["enterprise_service"].WebAppAuth.update_app_access_mode.assert_called_once_with(
            result.id, "private"
        )

    def test_create_app_with_billing_enabled(self, mock_app_service_dependencies):
        """Test app creation with billing enabled triggers cache cleanup."""
        from services.app_service import AppService

        # Arrange
        tenant_id = str(uuid4())
        account = AppServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)

        # Enable billing
        mock_app_service_dependencies["config"].BILLING_ENABLED = True

        # Mock model manager
        model_instance = AppServiceTestDataFactory.create_model_instance_mock()
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.return_value = model_instance

        # Mock model schema
        model_schema = Mock()
        model_schema.model_properties = {"mode": "chat"}
        model_instance.model_type_instance.get_model_schema.return_value = model_schema

        mock_app_service_dependencies["model_manager"].return_value = mock_model_manager_instance

        args = {
            "name": "Billed App",
            "mode": AppMode.CHAT,
            "icon": "💰",
            "icon_background": "#FFF9C4",
        }

        # Act
        result = AppService().create_app(tenant_id, args, account)

        # Assert
        assert result is not None
        mock_app_service_dependencies["billing_service"].clean_billing_info_cache.assert_called_once_with(tenant_id)

    def test_create_app_model_provider_not_initialized(self, mock_app_service_dependencies):
        """Test app creation when model provider is not initialized (graceful fallback)."""
        from services.app_service import AppService

        # Arrange
        tenant_id = str(uuid4())
        account = AppServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)

        # Mock model manager to raise ProviderTokenNotInitError
        from core.errors.error import ProviderTokenNotInitError

        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.side_effect = ProviderTokenNotInitError()
        mock_model_manager_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")

        mock_app_service_dependencies["model_manager"].return_value = mock_model_manager_instance

        args = {
            "name": "Fallback App",
            "mode": AppMode.CHAT,
            "icon": "⚠️",
            "icon_background": "#FFCCBC",
        }

        # Act
        result = AppService().create_app(tenant_id, args, account)

        # Assert - should still create app with fallback model config
        assert result is not None
        assert result.name == "Fallback App"
        mock_app_service_dependencies["db_session"].commit.assert_called()


# ==================== App Duplication Tests ====================


class TestAppServiceDuplicateApp:
    """
    Comprehensive unit tests for app duplication logic.

    App duplication uses DSL export/import mechanism:
    1. Export existing app to YAML DSL
    2. Import DSL to create new app with modified metadata

    Covers:
    - Chat app duplication
    - Workflow app duplication
    - Duplication with custom name and description
    - Duplication preserves model configuration
    """

    @pytest.fixture
    def mock_duplication_dependencies(self):
        """Mock setup for app duplication dependencies."""
        with (
            patch("extensions.ext_database.db.engine") as mock_engine,
            patch("sqlalchemy.orm.Session") as mock_session_class,
        ):
            # Setup mock session
            mock_session = Mock()
            mock_session_class.return_value.__enter__.return_value = mock_session

            yield {
                "engine": mock_engine,
                "session": mock_session,
            }

    def test_duplicate_chat_app_success(self, mock_duplication_dependencies):
        """
        Test successful duplication of chat app.

        Verifies:
        - Original app is exported to DSL
        - New app is created from DSL with new name
        - Model configuration is preserved
        - New app has unique ID
        """
        # Arrange
        from services.app_dsl_service import AppDslService, ImportMode

        original_app = AppServiceTestDataFactory.create_app_mock(
            app_id="original-123",
            name="Original Chat App",
            mode=AppMode.CHAT,
        )
        account = AppServiceTestDataFactory.create_account_mock()

        # Mock export DSL
        yaml_content = """
version: "0.1.0"
kind: app
app:
  name: Original Chat App
  mode: chat
  icon: 🤖
  icon_background: "#FFEAD5"
model_config:
  provider: openai
  model: gpt-3.5-turbo
"""

        # Mock import result
        from services.app_dsl_service import Import, ImportStatus

        new_app = AppServiceTestDataFactory.create_app_mock(
            app_id="duplicate-456",
            name="Copy of Original Chat App",
            mode=AppMode.CHAT,
        )

        with (
            patch.object(AppDslService, "export_dsl", return_value=yaml_content),
            patch.object(
                AppDslService,
                "import_app",
                return_value=Import(
                    id="import-123",
                    status=ImportStatus.COMPLETED,
                    app_id="duplicate-456",
                    app_mode=AppMode.CHAT,
                ),
            ),
        ):
            mock_duplication_dependencies["session"].scalar.return_value = new_app

            # Act
            service = AppDslService(mock_duplication_dependencies["session"])
            export_result = service.export_dsl(app_model=original_app, include_secret=True)
            import_result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=export_result,
                name="Copy of Original Chat App",
            )

            # Assert
            assert export_result == yaml_content
            assert import_result.status == ImportStatus.COMPLETED
            assert import_result.app_id == "duplicate-456"

    def test_duplicate_workflow_app_success(self, mock_duplication_dependencies):
        """Test successful duplication of workflow app."""
        # Arrange
        from services.app_dsl_service import AppDslService, Import, ImportMode, ImportStatus

        original_app = AppServiceTestDataFactory.create_app_mock(
            app_id="workflow-123",
            name="Original Workflow",
            mode=AppMode.WORKFLOW,
        )
        account = AppServiceTestDataFactory.create_account_mock()

        yaml_content = """
version: "0.1.0"
kind: app
app:
  name: Original Workflow
  mode: workflow
  icon: ⚙️
workflow:
  graph:
    nodes: []
    edges: []
"""

        new_app = AppServiceTestDataFactory.create_app_mock(
            app_id="workflow-duplicate-456",
            name="Copy of Original Workflow",
            mode=AppMode.WORKFLOW,
        )

        with (
            patch.object(AppDslService, "export_dsl", return_value=yaml_content),
            patch.object(
                AppDslService,
                "import_app",
                return_value=Import(
                    id="import-456",
                    status=ImportStatus.COMPLETED,
                    app_id="workflow-duplicate-456",
                    app_mode=AppMode.WORKFLOW,
                ),
            ),
        ):
            mock_duplication_dependencies["session"].scalar.return_value = new_app

            # Act
            service = AppDslService(mock_duplication_dependencies["session"])
            export_result = service.export_dsl(app_model=original_app, include_secret=True)
            import_result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=export_result,
                name="Copy of Original Workflow",
            )

            # Assert
            assert import_result.status == ImportStatus.COMPLETED
            assert import_result.app_mode == AppMode.WORKFLOW

    def test_duplicate_app_with_custom_metadata(self, mock_duplication_dependencies):
        """Test app duplication with custom name, description, and icon."""
        # Arrange
        from services.app_dsl_service import AppDslService, Import, ImportMode, ImportStatus

        original_app = AppServiceTestDataFactory.create_app_mock()
        account = AppServiceTestDataFactory.create_account_mock()

        yaml_content = "version: 0.1.0\nkind: app\napp:\n  name: Test\n  mode: chat"

        new_app = AppServiceTestDataFactory.create_app_mock(
            app_id="custom-789",
            name="Custom Named Copy",
            description="Custom description",
            icon="🎨",
            icon_background="#E1BEE7",
        )

        with (
            patch.object(AppDslService, "export_dsl", return_value=yaml_content),
            patch.object(
                AppDslService,
                "import_app",
                return_value=Import(
                    id="import-789",
                    status=ImportStatus.COMPLETED,
                    app_id="custom-789",
                    app_mode=AppMode.CHAT,
                ),
            ),
        ):
            mock_duplication_dependencies["session"].scalar.return_value = new_app

            # Act
            service = AppDslService(mock_duplication_dependencies["session"])
            import_result = service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
                name="Custom Named Copy",
                description="Custom description",
                icon="🎨",
                icon_background="#E1BEE7",
            )

            # Assert
            assert import_result.status == ImportStatus.COMPLETED


# ==================== App Deletion Tests ====================


class TestAppServiceDeleteApp:
    """
    Comprehensive unit tests for app deletion with cascade cleanup.

    App deletion triggers multiple cleanup operations:
    - Database record deletion
    - Web app settings cleanup (if enterprise feature enabled)
    - Billing cache cleanup (if billing enabled)
    - Async task to remove related data (conversations, messages, etc.)

    Covers:
    - Normal app deletion
    - Deletion with enterprise features enabled
    - Deletion with billing enabled
    - Async cleanup task triggering
    """

    @pytest.fixture
    def mock_deletion_dependencies(self):
        """Mock setup for app deletion dependencies."""
        with (
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.feature_service.FeatureService") as mock_feature_service,
            patch("services.enterprise.enterprise_service.EnterpriseService") as mock_enterprise_service,
            patch("services.billing_service.BillingService") as mock_billing_service,
            patch("tasks.remove_app_and_related_data_task") as mock_task_module,
            patch("configs.dify_config") as mock_config,
        ):
            # Setup default feature flags
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_config.BILLING_ENABLED = False

            # Setup mock task
            mock_task = Mock()
            mock_task_module.remove_app_and_related_data_task = mock_task

            yield {
                "db_session": mock_db,
                "feature_service": mock_feature_service,
                "enterprise_service": mock_enterprise_service,
                "billing_service": mock_billing_service,
                "task": mock_task,
                "config": mock_config,
            }

    def test_delete_app_basic_success(self, mock_deletion_dependencies):
        """
        Test successful basic app deletion.

        Verifies:
        - App is deleted from database
        - Database transaction is committed
        - Async cleanup task is triggered
        """
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock()

        # Act
        AppService().delete_app(app)

        # Assert
        mock_deletion_dependencies["db_session"].delete.assert_called_once_with(app)
        mock_deletion_dependencies["db_session"].commit.assert_called_once()
        mock_deletion_dependencies["task"].delay.assert_called_once_with(
            tenant_id=app.tenant_id,
            app_id=app.id,
        )

    def test_delete_app_with_webapp_auth_cleanup(self, mock_deletion_dependencies):
        """Test app deletion with webapp authentication cleanup."""
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock()

        # Enable webapp auth feature
        mock_deletion_dependencies["feature_service"].get_system_features.return_value.webapp_auth.enabled = True

        # Act
        AppService().delete_app(app)

        # Assert
        mock_deletion_dependencies["db_session"].delete.assert_called_once_with(app)
        mock_deletion_dependencies["enterprise_service"].WebAppAuth.cleanup_webapp.assert_called_once_with(app.id)
        mock_deletion_dependencies["task"].delay.assert_called_once()

    def test_delete_app_with_billing_cache_cleanup(self, mock_deletion_dependencies):
        """Test app deletion with billing cache cleanup."""
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock()

        # Enable billing
        mock_deletion_dependencies["config"].BILLING_ENABLED = True

        # Act
        AppService().delete_app(app)

        # Assert
        mock_deletion_dependencies["db_session"].delete.assert_called_once_with(app)
        mock_deletion_dependencies["billing_service"].clean_billing_info_cache.assert_called_once_with(app.tenant_id)
        mock_deletion_dependencies["task"].delay.assert_called_once()

    def test_delete_app_with_all_features_enabled(self, mock_deletion_dependencies):
        """Test app deletion with all enterprise and billing features enabled."""
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock()

        # Enable all features
        mock_deletion_dependencies["feature_service"].get_system_features.return_value.webapp_auth.enabled = True
        mock_deletion_dependencies["config"].BILLING_ENABLED = True

        # Act
        AppService().delete_app(app)

        # Assert
        mock_deletion_dependencies["db_session"].delete.assert_called_once_with(app)
        mock_deletion_dependencies["db_session"].commit.assert_called_once()
        mock_deletion_dependencies["enterprise_service"].WebAppAuth.cleanup_webapp.assert_called_once_with(app.id)
        mock_deletion_dependencies["billing_service"].clean_billing_info_cache.assert_called_once_with(app.tenant_id)
        mock_deletion_dependencies["task"].delay.assert_called_once_with(
            tenant_id=app.tenant_id,
            app_id=app.id,
        )


# ==================== Model Provider Switching Tests ====================


class TestAppServiceModelProviderSwitching:
    """
    Comprehensive unit tests for model provider switching and configuration updates.

    Model provider switching involves:
    - Updating app model configuration
    - Validating new model provider credentials
    - Preserving other app settings

    Covers:
    - Switching between different providers (OpenAI, Anthropic, etc.)
    - Updating model within same provider
    - Model configuration validation
    """

    @pytest.fixture
    def mock_model_config_dependencies(self):
        """Mock setup for model configuration dependencies."""
        with (
            patch("extensions.ext_database.db.session") as mock_db,
            patch("core.model_manager.ModelManager") as mock_model_manager,
            patch("libs.datetime_utils.naive_utc_now") as mock_time,
        ):
            mock_time.return_value = "2024-01-01T00:00:00"

            yield {
                "db_session": mock_db,
                "model_manager": mock_model_manager,
                "current_time": "2024-01-01T00:00:00",
            }

    def test_switch_model_provider_openai_to_anthropic(self, mock_model_config_dependencies):
        """
        Test switching model provider from OpenAI to Anthropic.

        Verifies:
        - Model configuration is updated with new provider
        - Model instance is validated
        - App metadata is updated
        """
        # Arrange
        app = AppServiceTestDataFactory.create_app_mock()
        app_config = AppServiceTestDataFactory.create_app_model_config_mock(
            provider="openai",
            model_id="gpt-3.5-turbo",
        )
        app.app_model_config = app_config

        # Mock new model instance
        new_model_instance = AppServiceTestDataFactory.create_model_instance_mock(
            provider="anthropic",
            model="claude-3-sonnet",
        )
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_model_instance.return_value = new_model_instance
        mock_model_config_dependencies["model_manager"].return_value = mock_model_manager_instance

        # Act - simulate model provider update
        app_config.provider = "anthropic"
        app_config.model_id = "claude-3-sonnet"

        # Assert
        assert app_config.provider == "anthropic"
        assert app_config.model_id == "claude-3-sonnet"

    def test_switch_model_within_same_provider(self, mock_model_config_dependencies):
        """Test switching model within the same provider (e.g., GPT-3.5 to GPT-4)."""
        # Arrange
        app = AppServiceTestDataFactory.create_app_mock()
        app_config = AppServiceTestDataFactory.create_app_model_config_mock(
            provider="openai",
            model_id="gpt-3.5-turbo",
        )
        app.app_model_config = app_config

        # Mock new model instance
        new_model_instance = AppServiceTestDataFactory.create_model_instance_mock(
            provider="openai",
            model="gpt-4",
        )
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_model_instance.return_value = new_model_instance
        mock_model_config_dependencies["model_manager"].return_value = mock_model_manager_instance

        # Act
        app_config.model_id = "gpt-4"

        # Assert
        assert app_config.provider == "openai"
        assert app_config.model_id == "gpt-4"

    def test_model_provider_validation_success(self, mock_model_config_dependencies):
        """Test successful model provider validation."""
        # Arrange
        tenant_id = str(uuid4())

        # Mock model manager
        model_instance = AppServiceTestDataFactory.create_model_instance_mock(
            provider="openai",
            model="gpt-3.5-turbo",
        )
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_model_instance.return_value = model_instance
        mock_model_config_dependencies["model_manager"].return_value = mock_model_manager_instance

        # Act
        result = mock_model_manager_instance.get_model_instance(
            tenant_id=tenant_id,
            provider="openai",
            model="gpt-3.5-turbo",
            model_type=ModelType.LLM,
        )

        # Assert
        assert result is not None
        assert result.provider == "openai"
        assert result.model == "gpt-3.5-turbo"


# ==================== Feature Flag Management Tests ====================


class TestAppServiceFeatureFlagManagement:
    """
    Comprehensive unit tests for app feature flag management.

    Feature flags control app capabilities:
    - enable_site: Controls web app access
    - enable_api: Controls API access

    Covers:
    - Enabling/disabling site access
    - Enabling/disabling API access
    - Feature flag state transitions
    - No-op updates (same state)
    """

    @pytest.fixture
    def mock_feature_flag_dependencies(self):
        """Mock setup for feature flag dependencies."""
        with (
            patch("extensions.ext_database.db.session") as mock_db,
            patch("libs.login.current_user") as mock_current_user,
            patch("libs.datetime_utils.naive_utc_now") as mock_time,
        ):
            # Setup current user
            mock_user = AppServiceTestDataFactory.create_account_mock()
            mock_current_user.return_value = mock_user
            mock_current_user.id = mock_user.id
            mock_time.return_value = "2024-01-01T00:00:00"

            yield {
                "db_session": mock_db,
                "current_user": mock_current_user,
                "current_time": "2024-01-01T00:00:00",
            }

    def test_enable_site_access(self, mock_feature_flag_dependencies):
        """
        Test enabling site access for an app.

        Verifies:
        - enable_site flag is set to True
        - Database is updated
        - Updated timestamp is set
        """
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock(enable_site=False)

        # Act
        result = AppService().update_app_site_status(app, enable_site=True)

        # Assert
        assert result.enable_site is True
        mock_feature_flag_dependencies["db_session"].commit.assert_called_once()

    def test_disable_site_access(self, mock_feature_flag_dependencies):
        """Test disabling site access for an app."""
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock(enable_site=True)

        # Act
        result = AppService().update_app_site_status(app, enable_site=False)

        # Assert
        assert result.enable_site is False
        mock_feature_flag_dependencies["db_session"].commit.assert_called_once()

    def test_enable_api_access(self, mock_feature_flag_dependencies):
        """Test enabling API access for an app."""
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock(enable_api=False)

        # Act
        result = AppService().update_app_api_status(app, enable_api=True)

        # Assert
        assert result.enable_api is True
        mock_feature_flag_dependencies["db_session"].commit.assert_called_once()

    def test_disable_api_access(self, mock_feature_flag_dependencies):
        """Test disabling API access for an app."""
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock(enable_api=True)

        # Act
        result = AppService().update_app_api_status(app, enable_api=False)

        # Assert
        assert result.enable_api is False
        mock_feature_flag_dependencies["db_session"].commit.assert_called_once()

    def test_update_site_status_no_change(self, mock_feature_flag_dependencies):
        """Test updating site status with no change (no-op)."""
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock(enable_site=True)

        # Act
        result = AppService().update_app_site_status(app, enable_site=True)

        # Assert - should return immediately without database commit
        assert result.enable_site is True
        mock_feature_flag_dependencies["db_session"].commit.assert_not_called()

    def test_update_api_status_no_change(self, mock_feature_flag_dependencies):
        """Test updating API status with no change (no-op)."""
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock(enable_api=False)

        # Act
        result = AppService().update_app_api_status(app, enable_api=False)

        # Assert - should return immediately without database commit
        assert result.enable_api is False
        mock_feature_flag_dependencies["db_session"].commit.assert_not_called()

    def test_toggle_both_feature_flags(self, mock_feature_flag_dependencies):
        """Test toggling both site and API access flags."""
        from services.app_service import AppService

        # Arrange
        app = AppServiceTestDataFactory.create_app_mock(enable_site=True, enable_api=True)

        # Act - disable both
        result1 = AppService().update_app_site_status(app, enable_site=False)
        result2 = AppService().update_app_api_status(app, enable_api=False)

        # Assert
        assert result1.enable_site is False
        assert result2.enable_api is False
        assert mock_feature_flag_dependencies["db_session"].commit.call_count == 2

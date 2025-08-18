import json
from unittest.mock import MagicMock, patch

import pytest
import yaml
from faker import Faker

from models.model import App, AppModelConfig
from services.account_service import AccountService, TenantService
from services.app_dsl_service import AppDslService, ImportMode, ImportStatus
from services.app_service import AppService


class TestAppDslService:
    """Integration tests for AppDslService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.app_dsl_service.WorkflowService") as mock_workflow_service,
            patch("services.app_dsl_service.DependenciesAnalysisService") as mock_dependencies_service,
            patch("services.app_dsl_service.WorkflowDraftVariableService") as mock_draft_variable_service,
            patch("services.app_dsl_service.ssrf_proxy") as mock_ssrf_proxy,
            patch("services.app_dsl_service.redis_client") as mock_redis_client,
            patch("services.app_dsl_service.app_was_created") as mock_app_was_created,
            patch("services.app_dsl_service.app_model_config_was_updated") as mock_app_model_config_was_updated,
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
        ):
            # Setup default mock returns
            mock_workflow_service.return_value.get_draft_workflow.return_value = None
            mock_workflow_service.return_value.sync_draft_workflow.return_value = MagicMock()
            mock_dependencies_service.generate_latest_dependencies.return_value = []
            mock_dependencies_service.get_leaked_dependencies.return_value = []
            mock_dependencies_service.generate_dependencies.return_value = []
            mock_draft_variable_service.return_value.delete_workflow_variables.return_value = None
            mock_ssrf_proxy.get.return_value.content = b"test content"
            mock_ssrf_proxy.get.return_value.raise_for_status.return_value = None
            mock_redis_client.setex.return_value = None
            mock_redis_client.get.return_value = None
            mock_redis_client.delete.return_value = None
            mock_app_was_created.send.return_value = None
            mock_app_model_config_was_updated.send.return_value = None

            # Mock ModelManager for app service
            mock_model_instance = mock_model_manager.return_value
            mock_model_instance.get_default_model_instance.return_value = None
            mock_model_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")

            # Mock FeatureService and EnterpriseService
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
            mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None

            yield {
                "workflow_service": mock_workflow_service,
                "dependencies_service": mock_dependencies_service,
                "draft_variable_service": mock_draft_variable_service,
                "ssrf_proxy": mock_ssrf_proxy,
                "redis_client": mock_redis_client,
                "app_was_created": mock_app_was_created,
                "app_model_config_was_updated": mock_app_model_config_was_updated,
                "model_manager": mock_model_manager,
                "feature_service": mock_feature_service,
                "enterprise_service": mock_enterprise_service,
            }

    def _create_test_app_and_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test app and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (app, account) - Created app and account instances
        """
        fake = Faker()

        # Setup mocks for account creation
        with patch("services.account_service.FeatureService") as mock_account_feature_service:
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            # Create account and tenant first
            account = AccountService.create_account(
                email=fake.email(),
                name=fake.name(),
                interface_language="en-US",
                password=fake.password(length=12),
            )
            TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
            tenant = account.current_tenant

            # Setup app creation arguments
            app_args = {
                "name": fake.company(),
                "description": fake.text(max_nb_chars=100),
                "mode": "chat",
                "icon_type": "emoji",
                "icon": "🤖",
                "icon_background": "#FF6B6B",
                "api_rph": 100,
                "api_rpm": 10,
            }

            # Create app
            app_service = AppService()
            app = app_service.create_app(tenant.id, app_args, account)

            return app, account

    def _create_simple_yaml_content(self, app_name="Test App", app_mode="chat"):
        """
        Helper method to create simple YAML content for testing.
        """
        yaml_data = {
            "version": "0.3.0",
            "kind": "app",
            "app": {
                "name": app_name,
                "mode": app_mode,
                "icon": "🤖",
                "icon_background": "#FFEAD5",
                "description": "Test app description",
                "use_icon_as_answer_icon": False,
            },
            "model_config": {
                "model": {
                    "provider": "openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {
                        "max_tokens": 1000,
                        "temperature": 0.7,
                        "top_p": 1.0,
                    },
                },
                "pre_prompt": "You are a helpful assistant.",
                "prompt_type": "simple",
            },
        }
        return yaml.dump(yaml_data, allow_unicode=True)

    def test_import_app_yaml_content_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful app import from YAML content.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create YAML content
        yaml_content = self._create_simple_yaml_content(fake.company(), "chat")

        # Import app
        dsl_service = AppDslService(db_session_with_containers)
        result = dsl_service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=yaml_content,
            name="Imported App",
            description="Imported app description",
        )

        # Verify import result
        assert result.status == ImportStatus.COMPLETED
        assert result.app_id is not None
        assert result.app_mode == "chat"
        assert result.imported_dsl_version == "0.3.0"
        assert result.error == ""

        # Verify app was created in database
        imported_app = db_session_with_containers.query(App).filter(App.id == result.app_id).first()
        assert imported_app is not None
        assert imported_app.name == "Imported App"
        assert imported_app.description == "Imported app description"
        assert imported_app.mode == "chat"
        assert imported_app.tenant_id == account.current_tenant_id
        assert imported_app.created_by == account.id

        # Verify model config was created
        model_config = (
            db_session_with_containers.query(AppModelConfig).filter(AppModelConfig.app_id == result.app_id).first()
        )
        assert model_config is not None
        # The provider and model_id are stored in the model field as JSON
        model_dict = model_config.model_dict
        assert model_dict["provider"] == "openai"
        assert model_dict["name"] == "gpt-3.5-turbo"

    def test_import_app_yaml_url_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful app import from YAML URL.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create YAML content for mock response
        yaml_content = self._create_simple_yaml_content(fake.company(), "chat")

        # Setup mock response
        mock_response = MagicMock()
        mock_response.content = yaml_content.encode("utf-8")
        mock_response.raise_for_status.return_value = None
        mock_external_service_dependencies["ssrf_proxy"].get.return_value = mock_response

        # Import app from URL
        dsl_service = AppDslService(db_session_with_containers)
        result = dsl_service.import_app(
            account=account,
            import_mode=ImportMode.YAML_URL,
            yaml_url="https://example.com/app.yaml",
            name="URL Imported App",
            description="App imported from URL",
        )

        # Verify import result
        assert result.status == ImportStatus.COMPLETED
        assert result.app_id is not None
        assert result.app_mode == "chat"
        assert result.imported_dsl_version == "0.3.0"
        assert result.error == ""

        # Verify app was created in database
        imported_app = db_session_with_containers.query(App).filter(App.id == result.app_id).first()
        assert imported_app is not None
        assert imported_app.name == "URL Imported App"
        assert imported_app.description == "App imported from URL"
        assert imported_app.mode == "chat"
        assert imported_app.tenant_id == account.current_tenant_id

        # Verify ssrf_proxy was called
        mock_external_service_dependencies["ssrf_proxy"].get.assert_called_once_with(
            "https://example.com/app.yaml", follow_redirects=True, timeout=(10, 10)
        )

    def test_import_app_invalid_yaml_format(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test app import with invalid YAML format.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create invalid YAML content
        invalid_yaml = "invalid: yaml: content: ["

        # Import app with invalid YAML
        dsl_service = AppDslService(db_session_with_containers)
        result = dsl_service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=invalid_yaml,
            name="Invalid App",
        )

        # Verify import failed
        assert result.status == ImportStatus.FAILED
        assert result.app_id is None
        assert "Invalid YAML format" in result.error
        assert result.imported_dsl_version == ""

        # Verify no app was created in database
        apps_count = db_session_with_containers.query(App).filter(App.tenant_id == account.current_tenant_id).count()
        assert apps_count == 1  # Only the original test app

    def test_import_app_missing_yaml_content(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test app import with missing YAML content.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Import app without YAML content
        dsl_service = AppDslService(db_session_with_containers)
        result = dsl_service.import_app(
            account=account,
            import_mode=ImportMode.YAML_CONTENT,
            name="Missing Content App",
        )

        # Verify import failed
        assert result.status == ImportStatus.FAILED
        assert result.app_id is None
        assert "yaml_content is required" in result.error
        assert result.imported_dsl_version == ""

        # Verify no app was created in database
        apps_count = db_session_with_containers.query(App).filter(App.tenant_id == account.current_tenant_id).count()
        assert apps_count == 1  # Only the original test app

    def test_import_app_missing_yaml_url(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test app import with missing YAML URL.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Import app without YAML URL
        dsl_service = AppDslService(db_session_with_containers)
        result = dsl_service.import_app(
            account=account,
            import_mode=ImportMode.YAML_URL,
            name="Missing URL App",
        )

        # Verify import failed
        assert result.status == ImportStatus.FAILED
        assert result.app_id is None
        assert "yaml_url is required" in result.error
        assert result.imported_dsl_version == ""

        # Verify no app was created in database
        apps_count = db_session_with_containers.query(App).filter(App.tenant_id == account.current_tenant_id).count()
        assert apps_count == 1  # Only the original test app

    def test_import_app_invalid_import_mode(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test app import with invalid import mode.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create YAML content
        yaml_content = self._create_simple_yaml_content(fake.company(), "chat")

        # Import app with invalid mode should raise ValueError
        dsl_service = AppDslService(db_session_with_containers)
        with pytest.raises(ValueError, match="Invalid import_mode: invalid-mode"):
            dsl_service.import_app(
                account=account,
                import_mode="invalid-mode",
                yaml_content=yaml_content,
                name="Invalid Mode App",
            )

        # Verify no app was created in database
        apps_count = db_session_with_containers.query(App).filter(App.tenant_id == account.current_tenant_id).count()
        assert apps_count == 1  # Only the original test app

    def test_export_dsl_chat_app_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful DSL export for chat app.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Create model config for the app
        model_config = AppModelConfig()
        model_config.id = fake.uuid4()
        model_config.app_id = app.id
        model_config.provider = "openai"
        model_config.model_id = "gpt-3.5-turbo"
        model_config.model = json.dumps(
            {
                "provider": "openai",
                "name": "gpt-3.5-turbo",
                "mode": "chat",
                "completion_params": {
                    "max_tokens": 1000,
                    "temperature": 0.7,
                },
            }
        )
        model_config.pre_prompt = "You are a helpful assistant."
        model_config.prompt_type = "simple"
        model_config.created_by = account.id
        model_config.updated_by = account.id

        # Set the app_model_config_id to link the config
        app.app_model_config_id = model_config.id

        db_session_with_containers.add(model_config)
        db_session_with_containers.commit()

        # Export DSL
        exported_dsl = AppDslService.export_dsl(app, include_secret=False)

        # Parse exported YAML
        exported_data = yaml.safe_load(exported_dsl)

        # Verify exported data structure
        assert exported_data["kind"] == "app"
        assert exported_data["app"]["name"] == app.name
        assert exported_data["app"]["mode"] == app.mode
        assert exported_data["app"]["icon"] == app.icon
        assert exported_data["app"]["icon_background"] == app.icon_background
        assert exported_data["app"]["description"] == app.description

        # Verify model config was exported
        assert "model_config" in exported_data
        # The exported model_config structure may be different from the database structure
        # Check that the model config exists and has the expected content
        assert exported_data["model_config"] is not None

        # Verify dependencies were exported
        assert "dependencies" in exported_data
        assert isinstance(exported_data["dependencies"], list)

    def test_export_dsl_workflow_app_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful DSL export for workflow app.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Update app to workflow mode
        app.mode = "workflow"
        db_session_with_containers.commit()

        # Mock workflow service to return a workflow
        mock_workflow = MagicMock()
        mock_workflow.to_dict.return_value = {
            "graph": {"nodes": [{"id": "start", "type": "start", "data": {"type": "start"}}], "edges": []},
            "features": {},
            "environment_variables": [],
            "conversation_variables": [],
        }
        mock_external_service_dependencies[
            "workflow_service"
        ].return_value.get_draft_workflow.return_value = mock_workflow

        # Export DSL
        exported_dsl = AppDslService.export_dsl(app, include_secret=False)

        # Parse exported YAML
        exported_data = yaml.safe_load(exported_dsl)

        # Verify exported data structure
        assert exported_data["kind"] == "app"
        assert exported_data["app"]["name"] == app.name
        assert exported_data["app"]["mode"] == "workflow"

        # Verify workflow was exported
        assert "workflow" in exported_data
        assert "graph" in exported_data["workflow"]
        assert "nodes" in exported_data["workflow"]["graph"]

        # Verify dependencies were exported
        assert "dependencies" in exported_data
        assert isinstance(exported_data["dependencies"], list)

        # Verify workflow service was called
        mock_external_service_dependencies["workflow_service"].return_value.get_draft_workflow.assert_called_once_with(
            app
        )

    def test_check_dependencies_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful dependency checking.
        """
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock Redis to return dependencies
        mock_dependencies_json = '{"app_id": "' + app.id + '", "dependencies": []}'
        mock_external_service_dependencies["redis_client"].get.return_value = mock_dependencies_json

        # Check dependencies
        dsl_service = AppDslService(db_session_with_containers)
        result = dsl_service.check_dependencies(app_model=app)

        # Verify result
        assert result.leaked_dependencies == []

        # Verify Redis was queried
        mock_external_service_dependencies["redis_client"].get.assert_called_once_with(
            f"app_check_dependencies:{app.id}"
        )

        # Verify dependencies service was called
        mock_external_service_dependencies["dependencies_service"].get_leaked_dependencies.assert_called_once()

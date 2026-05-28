from unittest.mock import create_autospec, patch

import pytest
from faker import Faker
from pydantic import ValidationError
from sqlalchemy.orm import Session

from constants.model_template import default_app_templates
from models import Account
from models.enums import AppStatus, CustomizeTokenStrategy
from models.model import App, IconType, Site
from services.account_service import AccountService, TenantService
from tests.test_containers_integration_tests.helpers import generate_valid_password

# Delay import of AppService to avoid circular dependency
# from services.app_service import AppService, AppListParams, CreateAppParams


class TestAppService:
    """Integration tests for AppService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
            patch("services.app_service.ModelManager.for_tenant") as mock_model_manager,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
            # Setup default mock returns for app service
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
            mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None

            # Setup default mock returns for account service
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            # Mock ModelManager for model configuration
            mock_model_instance = mock_model_manager.return_value
            mock_model_instance.get_default_model_instance.return_value = None
            mock_model_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")

            yield {
                "feature_service": mock_feature_service,
                "enterprise_service": mock_enterprise_service,
                "model_manager": mock_model_manager,
                "account_feature_service": mock_account_feature_service,
            }

    def test_create_app_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful app creation with basic parameters.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Setup app creation arguments
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_params = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🤖",
            icon_background="#FF6B6B",
            api_rph=100,
            api_rpm=10,
        )

        # Create app
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_params, account)

        # Verify app was created correctly
        assert app.name == app_params.name
        assert app.description == app_params.description
        assert app.mode == app_params.mode
        assert app.icon_type == app_params.icon_type
        assert app.icon == app_params.icon
        assert app.icon_background == app_params.icon_background
        assert app.tenant_id == tenant.id
        assert app.api_rph == app_params.api_rph
        assert app.api_rpm == app_params.api_rpm
        assert app.created_by == account.id
        assert app.updated_by == account.id
        assert app.status == "normal"
        assert app.enable_site is True
        assert app.enable_api is True
        assert app.is_demo is False
        assert app.is_public is False
        assert app.is_universal is False

    def test_create_app_with_different_modes(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test app creation with different app modes.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_service = AppService()

        # Test different app modes
        # from AppMode enum in default_app_model_template
        app_modes = [v.value for v in default_app_templates]

        for mode in app_modes:
            app_params = CreateAppParams(
                name=f"{fake.company()} {mode}",
                description=f"Test app for {mode} mode",
                mode=mode,
                icon_type="emoji",
                icon="🚀",
                icon_background="#4ECDC4",
            )

            app = app_service.create_app(tenant.id, app_params, account)

            # Verify app mode was set correctly
            assert app.mode == mode
            assert app.name == app_params.name
            assert app.tenant_id == tenant.id
            assert app.created_by == account.id

    def test_get_app_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful app retrieval.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_params = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🎯",
            icon_background="#45B7D1",
        )

        app_service = AppService()
        created_app = app_service.create_app(tenant.id, app_params, account)

        # Get app using the service - needs current_user mock
        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.id = account.id
        mock_current_user.current_tenant_id = account.current_tenant_id

        with patch("services.app_service.current_user", mock_current_user):
            retrieved_app = app_service.get_app(created_app)

        # Verify retrieved app matches created app
        assert retrieved_app.id == created_app.id
        assert retrieved_app.name == created_app.name
        assert retrieved_app.description == created_app.description
        assert retrieved_app.mode == created_app.mode
        assert retrieved_app.tenant_id == created_app.tenant_id
        assert retrieved_app.created_by == created_app.created_by

    def test_get_paginate_apps_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful paginated app list retrieval.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Import here to avoid circular dependency
        from services.app_service import AppListParams, AppService, CreateAppParams

        app_service = AppService()

        # Create multiple apps
        app_names = [fake.company() for _ in range(5)]
        for name in app_names:
            app_params = CreateAppParams(
                name=name,
                description=fake.text(max_nb_chars=100),
                mode="chat",
                icon_type="emoji",
                icon="📱",
                icon_background="#96CEB4",
            )
            app_service.create_app(tenant.id, app_params, account)

        # Get paginated apps
        params = AppListParams(page=1, limit=10, mode="chat")

        paginated_apps = app_service.get_paginate_apps(account.id, tenant.id, params)

        # Verify pagination results
        assert paginated_apps is not None
        assert len(paginated_apps.items) >= 5  # Should have at least 5 apps
        assert paginated_apps.page == 1
        assert paginated_apps.per_page == 10

        # Verify all apps belong to the correct tenant
        for app in paginated_apps.items:
            assert app.tenant_id == tenant.id
            assert app.mode == "chat"

    def test_get_paginate_apps_with_filters(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test paginated app list with various filters.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Import here to avoid circular dependency
        from services.app_service import AppListParams, AppService, CreateAppParams

        app_service = AppService()

        # Create apps with different modes
        chat_app_params = CreateAppParams(
            name="Chat App",
            description="A chat application",
            mode="chat",
            icon_type="emoji",
            icon="💬",
            icon_background="#FF6B6B",
        )
        completion_app_params = CreateAppParams(
            name="Completion App",
            description="A completion application",
            mode="completion",
            icon_type="emoji",
            icon="✍️",
            icon_background="#4ECDC4",
        )

        chat_app = app_service.create_app(tenant.id, chat_app_params, account)
        completion_app = app_service.create_app(tenant.id, completion_app_params, account)

        # Test filter by mode
        chat_apps = app_service.get_paginate_apps(account.id, tenant.id, AppListParams(page=1, limit=10, mode="chat"))
        assert len(chat_apps.items) == 1
        assert chat_apps.items[0].mode == "chat"

        # Test filter by name
        filtered_apps = app_service.get_paginate_apps(
            account.id, tenant.id, AppListParams(page=1, limit=10, mode="chat", name="Chat")
        )
        assert len(filtered_apps.items) == 1
        assert "Chat" in filtered_apps.items[0].name

        # Test filter by created_by_me
        my_apps = app_service.get_paginate_apps(
            account.id, tenant.id, AppListParams(page=1, limit=10, mode="completion", is_created_by_me=True)
        )
        assert len(my_apps.items) == 1

    def test_get_paginate_apps_with_tag_filters(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test paginated app list with tag filters.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Import here to avoid circular dependency
        from services.app_service import AppListParams, AppService, CreateAppParams

        app_service = AppService()

        # Create an app
        app_params = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🏷️",
            icon_background="#FFEAA7",
        )
        app = app_service.create_app(tenant.id, app_params, account)

        # Mock TagService to return the app ID for tag filtering
        with patch("services.app_service.TagService.get_target_ids_by_tag_ids") as mock_tag_service:
            mock_tag_service.return_value = [app.id]

            # Test with tag filter
            params = AppListParams(page=1, limit=10, mode="chat", tag_ids=["tag1", "tag2"])

            paginated_apps = app_service.get_paginate_apps(account.id, tenant.id, params)

            # Verify tag service was called
            mock_tag_service.assert_called_once_with("app", tenant.id, ["tag1", "tag2"])

            # Verify results
            assert paginated_apps is not None
            assert len(paginated_apps.items) == 1
            assert paginated_apps.items[0].id == app.id

        # Test with tag filter that returns no results
        with patch("services.app_service.TagService.get_target_ids_by_tag_ids") as mock_tag_service:
            mock_tag_service.return_value = []

            params = AppListParams(page=1, limit=10, mode="chat", tag_ids=["nonexistent_tag"])

            paginated_apps = app_service.get_paginate_apps(account.id, tenant.id, params)

            # Should return None when no apps match tag filter
            assert paginated_apps is None

    def test_update_app_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful app update with all fields.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_params = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🎯",
            icon_background="#45B7D1",
        )

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_params, account)

        # Store original values
        original_name = app.name
        original_description = app.description
        original_icon = app.icon
        original_icon_background = app.icon_background
        original_use_icon_as_answer_icon = app.use_icon_as_answer_icon

        # Update app
        update_args = {
            "name": "Updated App Name",
            "description": "Updated app description",
            "icon_type": "emoji",
            "icon": "🔄",
            "icon_background": "#FF8C42",
            "use_icon_as_answer_icon": True,
        }

        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.id = account.id
        mock_current_user.current_tenant_id = account.current_tenant_id

        with patch("services.app_service.current_user", mock_current_user):
            updated_app = app_service.update_app(app, update_args)

        # Verify updated fields
        assert updated_app.name == update_args["name"]
        assert updated_app.description == update_args["description"]
        assert updated_app.icon == update_args["icon"]
        assert updated_app.icon_background == update_args["icon_background"]
        assert updated_app.use_icon_as_answer_icon is True
        assert updated_app.updated_by == account.id

        # Verify other fields remain unchanged
        assert updated_app.mode == app.mode
        assert updated_app.tenant_id == app.tenant_id
        assert updated_app.created_by == app.created_by

    def test_update_app_should_preserve_icon_type_when_omitted(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test update_app keeps the persisted icon_type when the update payload omits it.
        """
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        from services.app_service import AppService, CreateAppParams

        app_service = AppService()
        app = app_service.create_app(
            tenant.id,
            CreateAppParams(
                name=fake.company(),
                description=fake.text(max_nb_chars=100),
                mode="chat",
                icon_type="emoji",
                icon="🎯",
                icon_background="#45B7D1",
            ),
            account,
        )

        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.id = account.id
        mock_current_user.current_tenant_id = account.current_tenant_id

        with patch("services.app_service.current_user", mock_current_user):
            updated_app = app_service.update_app(
                app,
                {
                    "name": "Updated App Name",
                    "description": "Updated app description",
                    "icon_type": None,
                    "icon": "🔄",
                    "icon_background": "#FF8C42",
                    "use_icon_as_answer_icon": True,
                },
            )

        assert updated_app.icon_type == IconType.EMOJI

    def test_update_app_should_reject_empty_icon_type(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test update_app rejects an explicit empty icon_type.
        """
        fake = Faker()

        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        from services.app_service import AppService, CreateAppParams

        app_service = AppService()
        app = app_service.create_app(
            tenant.id,
            CreateAppParams(
                name=fake.company(),
                description=fake.text(max_nb_chars=100),
                mode="chat",
                icon_type="emoji",
                icon="🎯",
                icon_background="#45B7D1",
            ),
            account,
        )

        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.id = account.id
        mock_current_user.current_tenant_id = account.current_tenant_id

        with patch("services.app_service.current_user", mock_current_user):
            with pytest.raises(ValueError):
                app_service.update_app(
                    app,
                    {
                        "name": "Updated App Name",
                        "description": "Updated app description",
                        "icon_type": "",
                        "icon": "🔄",
                        "icon_background": "#FF8C42",
                        "use_icon_as_answer_icon": True,
                    },
                )

    def test_update_app_name_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful app name update.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_params = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🎯",
            icon_background="#45B7D1",
        )

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_params, account)

        # Store original name
        original_name = app.name

        # Update app name
        new_name = "New App Name"
        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.id = account.id
        mock_current_user.current_tenant_id = account.current_tenant_id

        with patch("services.app_service.current_user", mock_current_user):
            updated_app = app_service.update_app_name(app, new_name)

        assert updated_app.name == new_name
        assert updated_app.updated_by == account.id

        # Verify other fields remain unchanged
        assert updated_app.description == app.description
        assert updated_app.mode == app.mode
        assert updated_app.tenant_id == app.tenant_id
        assert updated_app.created_by == app.created_by

    def test_update_app_icon_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful app icon update.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_params = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🎯",
            icon_background="#45B7D1",
        )

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_params, account)

        # Store original values
        original_icon = app.icon
        original_icon_background = app.icon_background

        # Update app icon
        new_icon = "🌟"
        new_icon_background = "#FFD93D"
        new_icon_type = "image"
        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.id = account.id
        mock_current_user.current_tenant_id = account.current_tenant_id

        with patch("services.app_service.current_user", mock_current_user):
            updated_app = app_service.update_app_icon(app, new_icon, new_icon_background, new_icon_type)

        assert updated_app.icon == new_icon
        assert updated_app.icon_background == new_icon_background
        assert str(updated_app.icon_type).lower() == new_icon_type
        assert updated_app.updated_by == account.id

        # Verify other fields remain unchanged
        assert updated_app.name == app.name
        assert updated_app.description == app.description
        assert updated_app.mode == app.mode
        assert updated_app.tenant_id == app.tenant_id
        assert updated_app.created_by == app.created_by

    def test_update_app_site_status_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful app site status update.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🌐",
            icon_background="#74B9FF",
        )
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Store original site status
        original_site_status = app.enable_site

        # Update site status to disabled
        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.id = account.id
        mock_current_user.current_tenant_id = account.current_tenant_id

        with patch("services.app_service.current_user", mock_current_user):
            updated_app = app_service.update_app_site_status(app, False)
        assert updated_app.enable_site is False
        assert updated_app.updated_by == account.id

        # Update site status back to enabled
        with patch("services.app_service.current_user", mock_current_user):
            updated_app = app_service.update_app_site_status(updated_app, True)
        assert updated_app.enable_site is True
        assert updated_app.updated_by == account.id

        # Verify other fields remain unchanged
        assert updated_app.name == app.name
        assert updated_app.description == app.description
        assert updated_app.mode == app.mode
        assert updated_app.tenant_id == app.tenant_id
        assert updated_app.created_by == app.created_by

    def test_update_app_api_status_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test successful app API status update.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🔌",
            icon_background="#A29BFE",
        )
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Store original API status
        original_api_status = app.enable_api

        # Update API status to disabled
        mock_current_user = create_autospec(Account, instance=True)
        mock_current_user.id = account.id
        mock_current_user.current_tenant_id = account.current_tenant_id

        with patch("services.app_service.current_user", mock_current_user):
            updated_app = app_service.update_app_api_status(app, False)
        assert updated_app.enable_api is False
        assert updated_app.updated_by == account.id

        # Update API status back to enabled
        with patch("services.app_service.current_user", mock_current_user):
            updated_app = app_service.update_app_api_status(updated_app, True)
        assert updated_app.enable_api is True
        assert updated_app.updated_by == account.id

        # Verify other fields remain unchanged
        assert updated_app.name == app.name
        assert updated_app.description == app.description
        assert updated_app.mode == app.mode
        assert updated_app.tenant_id == app.tenant_id
        assert updated_app.created_by == app.created_by

    def test_update_app_site_status_no_change(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test app site status update when status doesn't change.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🔄",
            icon_background="#FD79A8",
        )
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Store original values
        original_site_status = app.enable_site
        original_updated_at = app.updated_at

        # Update site status to the same value (no change)
        updated_app = app_service.update_app_site_status(app, original_site_status)

        # Verify app is returned unchanged
        assert updated_app.id == app.id
        assert updated_app.enable_site == original_site_status
        assert updated_app.updated_at == original_updated_at

        # Verify other fields remain unchanged
        assert updated_app.name == app.name
        assert updated_app.description == app.description
        assert updated_app.mode == app.mode
        assert updated_app.tenant_id == app.tenant_id
        assert updated_app.created_by == app.created_by

    def test_delete_app_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful app deletion.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🗑️",
            icon_background="#E17055",
        )
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Store app ID for verification
        app_id = app.id

        # Mock the async deletion task
        with patch("services.app_service.remove_app_and_related_data_task") as mock_delete_task:
            mock_delete_task.delay.return_value = None

            # Delete app
            app_service.delete_app(app)

            # Verify async deletion task was called
            mock_delete_task.delay.assert_called_once_with(tenant_id=tenant.id, app_id=app_id)

        # Verify app was deleted from database

        deleted_app = db_session_with_containers.query(App).filter_by(id=app_id).first()
        assert deleted_app is None

    def test_delete_app_with_related_data(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """
        Test app deletion with related data cleanup.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🧹",
            icon_background="#00B894",
        )
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Store app ID for verification
        app_id = app.id

        # Mock webapp auth cleanup
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.webapp_auth.enabled = True

        # Mock the async deletion task
        with patch("services.app_service.remove_app_and_related_data_task") as mock_delete_task:
            mock_delete_task.delay.return_value = None

            # Delete app
            app_service.delete_app(app)

            # Verify webapp auth cleanup was called
            mock_external_service_dependencies["enterprise_service"].WebAppAuth.cleanup_webapp.assert_called_once_with(
                app_id
            )

            # Verify async deletion task was called
            mock_delete_task.delay.assert_called_once_with(tenant_id=tenant.id, app_id=app_id)

        # Verify app was deleted from database

        deleted_app = db_session_with_containers.query(App).filter_by(id=app_id).first()
        assert deleted_app is None

    def test_get_app_meta_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful app metadata retrieval.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="📊",
            icon_background="#6C5CE7",
        )
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Get app metadata
        app_meta = app_service.get_app_meta(app)

        # Verify metadata contains expected fields
        assert "tool_icons" in app_meta
        # Note: get_app_meta currently only returns tool_icons

    def test_get_app_code_by_id_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful app code retrieval by app ID.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🔗",
            icon_background="#FDCB6E",
        )
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Get app code by ID
        app_code = AppService.get_app_code_by_id(app.id)

        # Verify app code was retrieved correctly
        # Note: Site would be created when App is created, site.code is auto-generated
        assert app_code is not None
        assert len(app_code) > 0

    def test_get_app_id_by_code_success(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test successful app ID retrieval by app code.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app first
        # Import here to avoid circular dependency
        from services.app_service import AppService, CreateAppParams

        app_args = CreateAppParams(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            mode="chat",
            icon_type="emoji",
            icon="🆔",
            icon_background="#E84393",
        )
        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        # Create a site for the app
        site = Site()
        site.app_id = app.id
        site.code = fake.postalcode()
        site.title = fake.company()
        site.status = AppStatus.NORMAL
        site.default_language = "en-US"
        site.customize_token_strategy = CustomizeTokenStrategy.UUID

        db_session_with_containers.add(site)
        db_session_with_containers.commit()

        # Get app ID by code
        app_id = AppService.get_app_id_by_code(site.code)

        # Verify app ID was retrieved correctly
        assert app_id == app.id

    def test_create_app_invalid_mode(self, db_session_with_containers: Session, mock_external_service_dependencies):
        """
        Test app creation with invalid mode.
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())

        # Import here to avoid circular dependency
        from services.app_service import CreateAppParams

        # Attempt to create app with invalid mode - Pydantic will reject invalid literal
        with pytest.raises(ValidationError):
            CreateAppParams(
                name=fake.company(),
                description=fake.text(max_nb_chars=100),
                mode="invalid_mode",  # type: ignore[arg-type]
                icon_type="emoji",
                icon="❌",
                icon_background="#D63031",
            )

    def test_get_apps_with_special_characters_in_name(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        r"""
        Test app retrieval with special characters in name search to verify SQL injection prevention.

        This test verifies:
        - Special characters (%, _, \) in name search are properly escaped
        - Search treats special characters as literal characters, not wildcards
        - SQL injection via LIKE wildcards is prevented
        """
        fake = Faker()

        # Create account and tenant first
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Import here to avoid circular dependency
        from services.app_service import AppListParams, AppService, CreateAppParams

        app_service = AppService()

        # Create apps with special characters in names
        app_with_percent = app_service.create_app(
            tenant.id,
            CreateAppParams(
                name="App with 50% discount",
                description=fake.text(max_nb_chars=100),
                mode="chat",
                icon_type="emoji",
                icon="🤖",
                icon_background="#FF6B6B",
                api_rph=100,
                api_rpm=10,
            ),
            account,
        )

        app_with_underscore = app_service.create_app(
            tenant.id,
            CreateAppParams(
                name="test_data_app",
                description=fake.text(max_nb_chars=100),
                mode="chat",
                icon_type="emoji",
                icon="🤖",
                icon_background="#FF6B6B",
                api_rph=100,
                api_rpm=10,
            ),
            account,
        )

        app_with_backslash = app_service.create_app(
            tenant.id,
            CreateAppParams(
                name="path\\to\\app",
                description=fake.text(max_nb_chars=100),
                mode="chat",
                icon_type="emoji",
                icon="🤖",
                icon_background="#FF6B6B",
                api_rph=100,
                api_rpm=10,
            ),
            account,
        )

        # Create app that should NOT match
        app_no_match = app_service.create_app(
            tenant.id,
            CreateAppParams(
                name="100% different",
                description=fake.text(max_nb_chars=100),
                mode="chat",
                icon_type="emoji",
                icon="🤖",
                icon_background="#FF6B6B",
                api_rph=100,
                api_rpm=10,
            ),
            account,
        )

        # Test 1: Search with % character
        paginated_apps = app_service.get_paginate_apps(
            account.id, tenant.id, AppListParams(name="50%", mode="chat", page=1, limit=10)
        )
        assert paginated_apps is not None
        assert paginated_apps.total == 1
        assert len(paginated_apps.items) == 1
        assert paginated_apps.items[0].name == "App with 50% discount"

        # Test 2: Search with _ character
        paginated_apps = app_service.get_paginate_apps(
            account.id, tenant.id, AppListParams(name="test_data", mode="chat", page=1, limit=10)
        )
        assert paginated_apps is not None
        assert paginated_apps.total == 1
        assert len(paginated_apps.items) == 1
        assert paginated_apps.items[0].name == "test_data_app"

        # Test 3: Search with \ character
        paginated_apps = app_service.get_paginate_apps(
            account.id, tenant.id, AppListParams(name="path\\to\\app", mode="chat", page=1, limit=10)
        )
        assert paginated_apps is not None
        assert paginated_apps.total == 1
        assert len(paginated_apps.items) == 1
        assert paginated_apps.items[0].name == "path\\to\\app"

        # Test 4: Search with % should NOT match 100% (verifies escaping works)
        paginated_apps = app_service.get_paginate_apps(
            account.id, tenant.id, AppListParams(name="50%", mode="chat", page=1, limit=10)
        )
        assert paginated_apps is not None
        assert paginated_apps.total == 1
        assert all("50%" in app.name for app in paginated_apps.items)

    def test_get_app_code_by_id_not_found(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """Test get_app_code_by_id raises ValueError when site is missing."""
        from uuid import uuid4

        from services.app_service import AppService

        with pytest.raises(ValueError, match="not found"):
            AppService.get_app_code_by_id(str(uuid4()))

    def test_get_app_id_by_code_not_found(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """Test get_app_id_by_code raises ValueError when code does not exist."""
        from services.app_service import AppService

        with pytest.raises(ValueError, match="not found"):
            AppService.get_app_id_by_code("nonexistent-code")

    def test_get_app_meta_returns_empty_when_workflow_missing(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """Test get_app_meta returns empty tool_icons when workflow is None."""
        from types import SimpleNamespace

        from services.app_service import AppService

        app_service = AppService()
        workflow_app = SimpleNamespace(mode="workflow", workflow=None)

        meta = app_service.get_app_meta(workflow_app)
        assert meta == {"tool_icons": {}}

    def test_get_app_meta_returns_empty_when_model_config_missing(
        self, db_session_with_containers: Session, mock_external_service_dependencies
    ):
        """Test get_app_meta returns empty tool_icons when app_model_config is None."""
        from types import SimpleNamespace

        from services.app_service import AppService

        app_service = AppService()
        chat_app = SimpleNamespace(mode="chat", app_model_config=None)

        meta = app_service.get_app_meta(chat_app)
        assert meta == {"tool_icons": {}}

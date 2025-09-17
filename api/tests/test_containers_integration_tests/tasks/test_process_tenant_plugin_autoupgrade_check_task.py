from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.helper.marketplace import MarketplacePluginDeclaration
from core.plugin.entities.plugin import PluginInstallationSource
from core.tools.entities.common_entities import I18nObject
from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantPluginAutoUpgradeStrategy
from tasks.process_tenant_plugin_autoupgrade_check_task import process_tenant_plugin_autoupgrade_check_task


class TestProcessTenantPluginAutoupgradeCheckTask:
    """Integration tests for process_tenant_plugin_autoupgrade_check_task using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.process_tenant_plugin_autoupgrade_check_task.PluginInstaller") as mock_plugin_installer,
            patch("tasks.process_tenant_plugin_autoupgrade_check_task.marketplace") as mock_marketplace,
            patch("tasks.process_tenant_plugin_autoupgrade_check_task.click") as mock_click,
        ):
            # Setup mock plugin installer
            mock_installer_instance = MagicMock()
            mock_plugin_installer.return_value = mock_installer_instance

            # Setup mock marketplace
            mock_marketplace.batch_fetch_plugin_manifests_ignore_deserialization_error.return_value = []
            mock_marketplace.record_install_plugin_event.return_value = None

            # Setup mock click.style to return the input string
            mock_click.style.return_value = "mocked_style"

            # Clear the global cache before each test
            from tasks.process_tenant_plugin_autoupgrade_check_task import cached_plugin_manifests

            cached_plugin_manifests.clear()

            yield {
                "plugin_installer": mock_plugin_installer,
                "installer_instance": mock_installer_instance,
                "marketplace": mock_marketplace,
                "click": mock_click,
            }

    def _create_test_tenant_and_account(self, db_session_with_containers):
        """
        Helper method to create a test tenant and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            tuple: (tenant, account) - Created tenant and account instances
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db.session.add(account)
        db.session.commit()

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER.value,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        return tenant, account

    def _create_test_plugin_auto_upgrade_strategy(
        self, db_session_with_containers, tenant_id: str, **kwargs
    ) -> TenantPluginAutoUpgradeStrategy:
        """
        Helper method to create a test plugin auto upgrade strategy.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            tenant_id: Tenant ID to associate with the strategy
            **kwargs: Additional strategy parameters

        Returns:
            TenantPluginAutoUpgradeStrategy: Created strategy instance
        """
        strategy = TenantPluginAutoUpgradeStrategy(
            tenant_id=tenant_id,
            strategy_setting=kwargs.get("strategy_setting", TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY),
            upgrade_time_of_day=kwargs.get("upgrade_time_of_day", 0),
            upgrade_mode=kwargs.get("upgrade_mode", TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL),
            exclude_plugins=kwargs.get("exclude_plugins", []),
            include_plugins=kwargs.get("include_plugins", []),
        )
        db.session.add(strategy)
        db.session.commit()
        return strategy

    def _create_mock_plugin_entity(self, plugin_id: str, version: str, unique_identifier: str):
        """
        Helper method to create a mock plugin entity.

        Args:
            plugin_id: Plugin ID
            version: Plugin version
            unique_identifier: Plugin unique identifier

        Returns:
            Mock plugin entity
        """
        mock_plugin = MagicMock()
        mock_plugin.plugin_id = plugin_id
        mock_plugin.version = version
        mock_plugin.plugin_unique_identifier = unique_identifier
        mock_plugin.source = PluginInstallationSource.Marketplace
        return mock_plugin

    def _create_mock_marketplace_manifest(self, plugin_id: str, latest_version: str, package_identifier: str):
        """
        Helper method to create a mock marketplace plugin manifest.

        Args:
            plugin_id: Plugin ID
            latest_version: Latest version available
            package_identifier: Latest package identifier

        Returns:
            MarketplacePluginDeclaration: Mock manifest
        """
        return MarketplacePluginDeclaration(
            name=f"test_plugin_{plugin_id}",
            org="test_org",
            plugin_id=plugin_id,
            icon="https://example.com/icon.png",
            label=I18nObject(en_US=f"Test Plugin {plugin_id}"),
            brief=I18nObject(en_US=f"Test plugin {plugin_id} description"),
            resource={"memory": 128, "cpu": 1},
            latest_version=latest_version,
            latest_package_identifier=package_identifier,
            status="active",
            deprecated_reason="",
            alternative_plugin_id="",
        )

    def test_process_tenant_plugin_autoupgrade_check_task_disabled_strategy(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test that task returns early when strategy is disabled."""
        # Arrange: Create test data with disabled strategy
        tenant, account = self._create_test_tenant_and_account(db_session_with_containers)
        strategy = self._create_test_plugin_auto_upgrade_strategy(
            db_session_with_containers,
            tenant.id,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.DISABLED,
        )

        # Act: Execute the task
        process_tenant_plugin_autoupgrade_check_task(
            tenant.id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

        # Assert: Verify early return behavior
        mock_external_service_dependencies["installer_instance"].list_plugins.assert_not_called()
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.assert_not_called()
        mock_external_service_dependencies["click"].echo.assert_called()

    def test_process_tenant_plugin_autoupgrade_check_task_all_mode_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test successful plugin upgrade with ALL mode."""
        # Arrange: Create test data
        tenant, account = self._create_test_tenant_and_account(db_session_with_containers)
        strategy = self._create_test_plugin_auto_upgrade_strategy(
            db_session_with_containers,
            tenant.id,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
        )

        # Create mock plugins
        plugin1 = self._create_mock_plugin_entity("plugin1", "1.0.0", "unique_id_1")
        plugin2 = self._create_mock_plugin_entity("plugin2", "1.1.0", "unique_id_2")
        mock_plugins = [plugin1, plugin2]

        # Setup mock installer to return plugins
        mock_external_service_dependencies["installer_instance"].list_plugins.return_value = mock_plugins

        # Create mock marketplace manifests
        manifest1 = self._create_mock_marketplace_manifest("plugin1", "1.0.1", "new_unique_id_1")
        manifest2 = self._create_mock_marketplace_manifest("plugin2", "1.1.0", "unique_id_2")
        mock_manifests = [manifest1, manifest2]

        # Setup marketplace mock
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.return_value = mock_manifests

        # Act: Execute the task
        process_tenant_plugin_autoupgrade_check_task(
            tenant.id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

        # Assert: Verify expected behavior
        mock_external_service_dependencies["installer_instance"].list_plugins.assert_called_once_with(tenant.id)
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.assert_called_once_with(["plugin1", "plugin2"])

        # Verify plugin upgrade was called for plugin1 (version difference)
        mock_external_service_dependencies["installer_instance"].upgrade_plugin.assert_called_once_with(
            tenant.id,
            "unique_id_1",
            "new_unique_id_1",
            PluginInstallationSource.Marketplace,
            {"plugin_unique_identifier": "new_unique_id_1"},
        )

        # Verify marketplace event was recorded
        mock_external_service_dependencies["marketplace"].record_install_plugin_event.assert_called_once_with(
            "new_unique_id_1"
        )

    def test_process_tenant_plugin_autoupgrade_check_task_partial_mode_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test successful plugin upgrade with PARTIAL mode."""
        # Arrange: Create test data with partial mode
        tenant, account = self._create_test_tenant_and_account(db_session_with_containers)
        strategy = self._create_test_plugin_auto_upgrade_strategy(
            db_session_with_containers,
            tenant.id,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL,
            include_plugins=["plugin1", "plugin3"],
        )

        # Create mock plugins
        plugin1 = self._create_mock_plugin_entity("plugin1", "1.0.0", "unique_id_1")
        plugin2 = self._create_mock_plugin_entity("plugin2", "1.1.0", "unique_id_2")  # Not in include list
        plugin3 = self._create_mock_plugin_entity("plugin3", "2.0.0", "unique_id_3")
        mock_plugins = [plugin1, plugin2, plugin3]

        # Setup mock installer
        mock_external_service_dependencies["installer_instance"].list_plugins.return_value = mock_plugins

        # Create mock marketplace manifests
        manifest1 = self._create_mock_marketplace_manifest("plugin1", "1.0.1", "new_unique_id_1")
        manifest3 = self._create_mock_marketplace_manifest("plugin3", "2.0.1", "new_unique_id_3")
        mock_manifests = [manifest1, manifest3]

        # Setup marketplace mock
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.return_value = mock_manifests

        # Act: Execute the task
        process_tenant_plugin_autoupgrade_check_task(
            tenant.id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

        # Assert: Verify only included plugins were processed
        mock_external_service_dependencies["installer_instance"].list_plugins.assert_called_once_with(tenant.id)
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.assert_called_once_with(["plugin1", "plugin3"])

        # Verify both included plugins were upgraded (both have version differences)
        assert mock_external_service_dependencies["installer_instance"].upgrade_plugin.call_count == 2

    def test_process_tenant_plugin_autoupgrade_check_task_exclude_mode_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test successful plugin upgrade with EXCLUDE mode."""
        # Arrange: Create test data with exclude mode
        tenant, account = self._create_test_tenant_and_account(db_session_with_containers)
        strategy = self._create_test_plugin_auto_upgrade_strategy(
            db_session_with_containers,
            tenant.id,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            exclude_plugins=["plugin2"],
        )

        # Create mock plugins
        plugin1 = self._create_mock_plugin_entity("plugin1", "1.0.0", "unique_id_1")
        plugin2 = self._create_mock_plugin_entity("plugin2", "1.1.0", "unique_id_2")  # Excluded
        plugin3 = self._create_mock_plugin_entity("plugin3", "2.0.0", "unique_id_3")
        mock_plugins = [plugin1, plugin2, plugin3]

        # Setup mock installer
        mock_external_service_dependencies["installer_instance"].list_plugins.return_value = mock_plugins

        # Create mock marketplace manifests
        manifest1 = self._create_mock_marketplace_manifest("plugin1", "1.0.1", "new_unique_id_1")
        manifest3 = self._create_mock_marketplace_manifest("plugin3", "2.0.1", "new_unique_id_3")
        mock_manifests = [manifest1, manifest3]

        # Setup marketplace mock
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.return_value = mock_manifests

        # Act: Execute the task
        process_tenant_plugin_autoupgrade_check_task(
            tenant.id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

        # Assert: Verify excluded plugins were not processed
        mock_external_service_dependencies["installer_instance"].list_plugins.assert_called_once_with(tenant.id)
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.assert_called_once_with(["plugin1", "plugin3"])

        # Verify both non-excluded plugins were upgraded
        assert mock_external_service_dependencies["installer_instance"].upgrade_plugin.call_count == 2

    def test_process_tenant_plugin_autoupgrade_check_task_fix_only_strategy(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test plugin upgrade with FIX_ONLY strategy."""
        # Arrange: Create test data with fix_only strategy
        tenant, account = self._create_test_tenant_and_account(db_session_with_containers)
        strategy = self._create_test_plugin_auto_upgrade_strategy(
            db_session_with_containers,
            tenant.id,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
        )

        # Create mock plugins with different version scenarios
        plugin1 = self._create_mock_plugin_entity("plugin1", "1.0.0", "unique_id_1")  # Patch upgrade
        plugin2 = self._create_mock_plugin_entity("plugin2", "1.0.0", "unique_id_2")  # Minor upgrade
        plugin3 = self._create_mock_plugin_entity("plugin3", "1.0.0", "unique_id_3")  # Major upgrade
        mock_plugins = [plugin1, plugin2, plugin3]

        # Setup mock installer
        mock_external_service_dependencies["installer_instance"].list_plugins.return_value = mock_plugins

        # Create mock marketplace manifests
        manifest1 = self._create_mock_marketplace_manifest("plugin1", "1.0.1", "new_unique_id_1")  # Patch
        manifest2 = self._create_mock_marketplace_manifest("plugin2", "1.1.0", "new_unique_id_2")  # Minor
        manifest3 = self._create_mock_marketplace_manifest("plugin3", "2.0.0", "new_unique_id_3")  # Major
        mock_manifests = [manifest1, manifest2, manifest3]

        # Setup marketplace mock
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.return_value = mock_manifests

        # Act: Execute the task
        process_tenant_plugin_autoupgrade_check_task(
            tenant.id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

        # Assert: Verify only patch version upgrade was processed
        mock_external_service_dependencies["installer_instance"].upgrade_plugin.assert_called_once_with(
            tenant.id,
            "unique_id_1",
            "new_unique_id_1",
            PluginInstallationSource.Marketplace,
            {"plugin_unique_identifier": "new_unique_id_1"},
        )

    def test_process_tenant_plugin_autoupgrade_check_task_no_plugins_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test task behavior when no plugins are found."""
        # Arrange: Create test data
        tenant, account = self._create_test_tenant_and_account(db_session_with_containers)
        strategy = self._create_test_plugin_auto_upgrade_strategy(
            db_session_with_containers,
            tenant.id,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
        )

        # Setup mock installer to return empty list
        mock_external_service_dependencies["installer_instance"].list_plugins.return_value = []

        # Act: Execute the task
        process_tenant_plugin_autoupgrade_check_task(
            tenant.id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

        # Assert: Verify no marketplace calls were made
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.assert_not_called()
        mock_external_service_dependencies["installer_instance"].upgrade_plugin.assert_not_called()

    def test_process_tenant_plugin_autoupgrade_check_task_no_manifests_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test task behavior when no manifests are found in marketplace."""
        # Arrange: Create test data
        tenant, account = self._create_test_tenant_and_account(db_session_with_containers)
        strategy = self._create_test_plugin_auto_upgrade_strategy(
            db_session_with_containers,
            tenant.id,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
        )

        # Create mock plugins
        plugin1 = self._create_mock_plugin_entity("plugin1", "1.0.0", "unique_id_1")
        mock_plugins = [plugin1]

        # Setup mock installer
        mock_external_service_dependencies["installer_instance"].list_plugins.return_value = mock_plugins

        # Setup marketplace mock to return empty list
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.return_value = []

        # Act: Execute the task
        process_tenant_plugin_autoupgrade_check_task(
            tenant.id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

        # Assert: Verify no upgrade attempts were made
        mock_external_service_dependencies["installer_instance"].upgrade_plugin.assert_not_called()

    def test_process_tenant_plugin_autoupgrade_check_task_plugin_upgrade_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test task behavior when plugin upgrade fails."""
        # Arrange: Create test data
        tenant, account = self._create_test_tenant_and_account(db_session_with_containers)
        strategy = self._create_test_plugin_auto_upgrade_strategy(
            db_session_with_containers,
            tenant.id,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
        )

        # Create mock plugins
        plugin1 = self._create_mock_plugin_entity("plugin1", "1.0.0", "unique_id_1")
        plugin2 = self._create_mock_plugin_entity("plugin2", "1.0.0", "unique_id_2")
        mock_plugins = [plugin1, plugin2]

        # Setup mock installer
        mock_external_service_dependencies["installer_instance"].list_plugins.return_value = mock_plugins

        # Create mock marketplace manifests
        manifest1 = self._create_mock_marketplace_manifest("plugin1", "1.0.1", "new_unique_id_1")
        manifest2 = self._create_mock_marketplace_manifest("plugin2", "1.0.1", "new_unique_id_2")
        mock_manifests = [manifest1, manifest2]

        # Setup marketplace mock
        mock_external_service_dependencies[
            "marketplace"
        ].batch_fetch_plugin_manifests_ignore_deserialization_error.return_value = mock_manifests

        # Setup installer to raise exception for first plugin
        mock_external_service_dependencies["installer_instance"].upgrade_plugin.side_effect = [
            Exception("Plugin upgrade failed"),
            None,  # Second plugin succeeds
        ]

        # Act: Execute the task
        process_tenant_plugin_autoupgrade_check_task(
            tenant.id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

        # Assert: Verify both plugins were attempted
        assert mock_external_service_dependencies["installer_instance"].upgrade_plugin.call_count == 2

        # Verify error logging occurred
        # Check if click.echo was called (should be called multiple times for different messages)
        echo_calls = mock_external_service_dependencies["click"].echo.call_args_list
        assert len(echo_calls) >= 1  # At least one call should be made

    def test_process_tenant_plugin_autoupgrade_check_task_general_exception_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test task behavior when general exceptions occur."""
        # Arrange: Create test data
        tenant, account = self._create_test_tenant_and_account(db_session_with_containers)
        strategy = self._create_test_plugin_auto_upgrade_strategy(
            db_session_with_containers,
            tenant.id,
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
        )

        # Setup mock installer to raise exception
        mock_external_service_dependencies["installer_instance"].list_plugins.side_effect = Exception(
            "Database connection failed"
        )

        # Act: Execute the task
        process_tenant_plugin_autoupgrade_check_task(
            tenant.id,
            strategy.strategy_setting,
            strategy.upgrade_time_of_day,
            strategy.upgrade_mode,
            strategy.exclude_plugins,
            strategy.include_plugins,
        )

        # Assert: Verify error logging occurred
        # Check if click.echo was called (should be called multiple times for different messages)
        echo_calls = mock_external_service_dependencies["click"].echo.call_args_list
        assert len(echo_calls) >= 1  # At least one call should be made

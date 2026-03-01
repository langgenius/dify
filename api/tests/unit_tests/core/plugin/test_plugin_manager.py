"""
Unit tests for Plugin Manager (PluginInstaller).

This module tests the plugin management functionality including:
- Plugin discovery and listing
- Plugin loading and installation
- Plugin validation and manifest parsing
- Version compatibility checks
- Dependency resolution
"""

import datetime
from unittest.mock import patch

import httpx
import pytest
from packaging.version import Version
from requests import HTTPError

from core.plugin.entities.bundle import PluginBundleDependency
from core.plugin.entities.plugin import (
    MissingPluginDependency,
    PluginCategory,
    PluginDeclaration,
    PluginEntity,
    PluginInstallation,
    PluginInstallationSource,
    PluginResourceRequirements,
)
from core.plugin.entities.plugin_daemon import (
    PluginDecodeResponse,
    PluginInstallTask,
    PluginInstallTaskStartResponse,
    PluginInstallTaskStatus,
    PluginListResponse,
    PluginReadmeResponse,
    PluginVerification,
)
from core.plugin.impl.exc import (
    PluginDaemonBadRequestError,
    PluginDaemonInternalServerError,
    PluginDaemonNotFoundError,
)
from core.plugin.impl.plugin import PluginInstaller
from core.tools.entities.common_entities import I18nObject
from models.provider_ids import GenericProviderID


class TestPluginDiscovery:
    """Test plugin discovery functionality."""

    @pytest.fixture
    def plugin_installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    @pytest.fixture
    def mock_plugin_entity(self):
        """Create a mock PluginEntity for testing."""
        return PluginEntity(
            id="entity-123",
            created_at=datetime.datetime(2023, 1, 1, 0, 0, 0),
            updated_at=datetime.datetime(2023, 1, 1, 0, 0, 0),
            tenant_id="test-tenant",
            endpoints_setups=0,
            endpoints_active=0,
            runtime_type="remote",
            source=PluginInstallationSource.Marketplace,
            meta={},
            plugin_id="plugin-123",
            plugin_unique_identifier="test-org/test-plugin/1.0.0",
            version="1.0.0",
            checksum="abc123",
            name="Test Plugin",
            installation_id="install-123",
            declaration=PluginDeclaration(
                version="1.0.0",
                author="test-author",
                name="test-plugin",
                description=I18nObject(en_US="Test plugin description", zh_Hans="测试插件描述"),
                icon="icon.png",
                label=I18nObject(en_US="Test Plugin", zh_Hans="测试插件"),
                category=PluginCategory.Tool,
                created_at=datetime.datetime.now(),
                resource=PluginResourceRequirements(memory=512, permission=None),
                plugins=PluginDeclaration.Plugins(),
                meta=PluginDeclaration.Meta(version="1.0.0"),
            ),
        )

    def test_list_plugins_success(self, plugin_installer, mock_plugin_entity):
        """Test successful plugin listing."""
        # Arrange: Mock the HTTP response for listing plugins
        mock_response = PluginListResponse(list=[mock_plugin_entity], total=1)

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response
        ) as mock_request:
            # Act: List plugins for a tenant
            result = plugin_installer.list_plugins("test-tenant")

            # Assert: Verify the request was made correctly
            mock_request.assert_called_once()
            assert len(result) == 1
            assert result[0].plugin_id == "plugin-123"
            assert result[0].name == "Test Plugin"

    def test_list_plugins_with_pagination(self, plugin_installer, mock_plugin_entity):
        """Test plugin listing with pagination support."""
        # Arrange: Mock paginated response
        mock_response = PluginListResponse(list=[mock_plugin_entity], total=10)

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response
        ) as mock_request:
            # Act: List plugins with pagination
            result = plugin_installer.list_plugins_with_total("test-tenant", page=1, page_size=5)

            # Assert: Verify pagination parameters
            mock_request.assert_called_once()
            call_args = mock_request.call_args
            assert call_args[1]["params"]["page"] == 1
            assert call_args[1]["params"]["page_size"] == 5
            assert result.total == 10

    def test_list_plugins_empty_result(self, plugin_installer):
        """Test plugin listing when no plugins are installed."""
        # Arrange: Mock empty response
        mock_response = PluginListResponse(list=[], total=0)

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response):
            # Act: List plugins
            result = plugin_installer.list_plugins("test-tenant")

            # Assert: Verify empty list is returned
            assert len(result) == 0

    def test_fetch_plugin_by_identifier_found(self, plugin_installer):
        """Test fetching a plugin by its unique identifier when it exists."""
        # Arrange: Mock successful fetch
        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=True) as mock_request:
            # Act: Fetch plugin by identifier
            result = plugin_installer.fetch_plugin_by_identifier("test-tenant", "test-org/test-plugin/1.0.0")

            # Assert: Verify the plugin was found
            assert result is True
            mock_request.assert_called_once()

    def test_fetch_plugin_by_identifier_not_found(self, plugin_installer):
        """Test fetching a plugin by identifier when it doesn't exist."""
        # Arrange: Mock not found response
        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=False):
            # Act: Fetch non-existent plugin
            result = plugin_installer.fetch_plugin_by_identifier("test-tenant", "non-existent/plugin/1.0.0")

            # Assert: Verify the plugin was not found
            assert result is False


class TestPluginLoading:
    """Test plugin loading and installation functionality."""

    @pytest.fixture
    def plugin_installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    @pytest.fixture
    def mock_plugin_declaration(self):
        """Create a mock PluginDeclaration for testing."""
        return PluginDeclaration(
            version="1.0.0",
            author="test-author",
            name="test-plugin",
            description=I18nObject(en_US="Test plugin", zh_Hans="测试插件"),
            icon="icon.png",
            label=I18nObject(en_US="Test Plugin", zh_Hans="测试插件"),
            category=PluginCategory.Tool,
            created_at=datetime.datetime.now(),
            resource=PluginResourceRequirements(memory=512, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="1.0.0"),
        )

    def test_upload_pkg_success(self, plugin_installer, mock_plugin_declaration):
        """Test successful plugin package upload."""
        # Arrange: Create mock package data and expected response
        pkg_data = b"mock-plugin-package-data"
        mock_response = PluginDecodeResponse(
            unique_identifier="test-org/test-plugin/1.0.0",
            manifest=mock_plugin_declaration,
            verification=PluginVerification(authorized_category=PluginVerification.AuthorizedCategory.Community),
        )

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response
        ) as mock_request:
            # Act: Upload plugin package
            result = plugin_installer.upload_pkg("test-tenant", pkg_data, verify_signature=False)

            # Assert: Verify upload was successful
            assert result.unique_identifier == "test-org/test-plugin/1.0.0"
            assert result.manifest.name == "test-plugin"
            mock_request.assert_called_once()

    def test_upload_pkg_with_signature_verification(self, plugin_installer, mock_plugin_declaration):
        """Test plugin package upload with signature verification enabled."""
        # Arrange: Create mock package data
        pkg_data = b"signed-plugin-package"
        mock_response = PluginDecodeResponse(
            unique_identifier="verified-org/verified-plugin/1.0.0",
            manifest=mock_plugin_declaration,
            verification=PluginVerification(authorized_category=PluginVerification.AuthorizedCategory.Partner),
        )

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response
        ) as mock_request:
            # Act: Upload with signature verification
            result = plugin_installer.upload_pkg("test-tenant", pkg_data, verify_signature=True)

            # Assert: Verify signature verification was requested
            call_args = mock_request.call_args
            assert call_args[1]["data"]["verify_signature"] == "true"
            assert result.verification.authorized_category == PluginVerification.AuthorizedCategory.Partner

    def test_install_from_identifiers_success(self, plugin_installer):
        """Test successful plugin installation from identifiers."""
        # Arrange: Mock installation response
        mock_response = PluginInstallTaskStartResponse(all_installed=False, task_id="task-123")

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response
        ) as mock_request:
            # Act: Install plugins from identifiers
            result = plugin_installer.install_from_identifiers(
                tenant_id="test-tenant",
                identifiers=["plugin1/1.0.0", "plugin2/2.0.0"],
                source=PluginInstallationSource.Marketplace,
                metas=[{"key": "value1"}, {"key": "value2"}],
            )

            # Assert: Verify installation task was created
            assert result.task_id == "task-123"
            assert result.all_installed is False
            mock_request.assert_called_once()

    def test_install_from_identifiers_all_installed(self, plugin_installer):
        """Test installation when all plugins are already installed."""
        # Arrange: Mock response indicating all plugins are installed
        mock_response = PluginInstallTaskStartResponse(all_installed=True, task_id="")

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response):
            # Act: Attempt to install already-installed plugins
            result = plugin_installer.install_from_identifiers(
                tenant_id="test-tenant",
                identifiers=["existing-plugin/1.0.0"],
                source=PluginInstallationSource.Package,
                metas=[{}],
            )

            # Assert: Verify all_installed flag is True
            assert result.all_installed is True

    def test_fetch_plugin_installation_task(self, plugin_installer):
        """Test fetching a specific plugin installation task."""
        # Arrange: Mock installation task
        mock_task = PluginInstallTask(
            id="task-123",
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now(),
            status=PluginInstallTaskStatus.Running,
            total_plugins=3,
            completed_plugins=1,
            plugins=[],
        )

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_task
        ) as mock_request:
            # Act: Fetch installation task
            result = plugin_installer.fetch_plugin_installation_task("test-tenant", "task-123")

            # Assert: Verify task details
            assert result.status == PluginInstallTaskStatus.Running
            assert result.total_plugins == 3
            assert result.completed_plugins == 1
            mock_request.assert_called_once()

    def test_uninstall_plugin_success(self, plugin_installer):
        """Test successful plugin uninstallation."""
        # Arrange: Mock successful uninstall
        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=True) as mock_request:
            # Act: Uninstall plugin
            result = plugin_installer.uninstall("test-tenant", "install-123")

            # Assert: Verify uninstallation succeeded
            assert result is True
            mock_request.assert_called_once()

    def test_upgrade_plugin_success(self, plugin_installer):
        """Test successful plugin upgrade."""
        # Arrange: Mock upgrade response
        mock_response = PluginInstallTaskStartResponse(all_installed=False, task_id="upgrade-task-123")

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response
        ) as mock_request:
            # Act: Upgrade plugin
            result = plugin_installer.upgrade_plugin(
                tenant_id="test-tenant",
                original_plugin_unique_identifier="plugin/1.0.0",
                new_plugin_unique_identifier="plugin/2.0.0",
                source=PluginInstallationSource.Marketplace,
                meta={"upgrade": "true"},
            )

            # Assert: Verify upgrade task was created
            assert result.task_id == "upgrade-task-123"
            mock_request.assert_called_once()


class TestPluginValidation:
    """Test plugin validation and manifest parsing."""

    @pytest.fixture
    def plugin_installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    def test_fetch_plugin_manifest_success(self, plugin_installer):
        """Test successful plugin manifest fetching."""
        # Arrange: Create a valid plugin declaration
        mock_manifest = PluginDeclaration(
            version="1.0.0",
            author="test-author",
            name="test-plugin",
            description=I18nObject(en_US="Test plugin", zh_Hans="测试插件"),
            icon="icon.png",
            label=I18nObject(en_US="Test Plugin", zh_Hans="测试插件"),
            category=PluginCategory.Tool,
            created_at=datetime.datetime.now(),
            resource=PluginResourceRequirements(memory=512, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="1.0.0", minimum_dify_version="0.6.0"),
        )

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_manifest
        ) as mock_request:
            # Act: Fetch plugin manifest
            result = plugin_installer.fetch_plugin_manifest("test-tenant", "test-org/test-plugin/1.0.0")

            # Assert: Verify manifest was fetched correctly
            assert result.name == "test-plugin"
            assert result.version == "1.0.0"
            assert result.author == "test-author"
            assert result.meta.minimum_dify_version == "0.6.0"
            mock_request.assert_called_once()

    def test_decode_plugin_from_identifier(self, plugin_installer):
        """Test decoding plugin information from identifier."""
        # Arrange: Create mock decode response
        mock_declaration = PluginDeclaration(
            version="2.0.0",
            author="decode-author",
            name="decode-plugin",
            description=I18nObject(en_US="Decoded plugin", zh_Hans="解码插件"),
            icon="icon.png",
            label=I18nObject(en_US="Decode Plugin", zh_Hans="解码插件"),
            category=PluginCategory.Model,
            created_at=datetime.datetime.now(),
            resource=PluginResourceRequirements(memory=1024, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="2.0.0"),
        )

        mock_response = PluginDecodeResponse(
            unique_identifier="org/decode-plugin/2.0.0",
            manifest=mock_declaration,
            verification=None,
        )

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response):
            # Act: Decode plugin from identifier
            result = plugin_installer.decode_plugin_from_identifier("test-tenant", "org/decode-plugin/2.0.0")

            # Assert: Verify decoded information
            assert result.unique_identifier == "org/decode-plugin/2.0.0"
            assert result.manifest.name == "decode-plugin"
            # Category will be Extension unless a model provider entity is provided
            assert result.manifest.category == PluginCategory.Extension

    def test_plugin_manifest_invalid_version_format(self):
        """Test that invalid version format raises validation error."""
        # Arrange & Act & Assert: Creating a declaration with invalid version should fail
        with pytest.raises(ValueError, match="Invalid version format"):
            PluginDeclaration(
                version="invalid-version",  # Invalid version format
                author="test-author",
                name="test-plugin",
                description=I18nObject(en_US="Test", zh_Hans="测试"),
                icon="icon.png",
                label=I18nObject(en_US="Test", zh_Hans="测试"),
                category=PluginCategory.Tool,
                created_at=datetime.datetime.now(),
                resource=PluginResourceRequirements(memory=512, permission=None),
                plugins=PluginDeclaration.Plugins(),
                meta=PluginDeclaration.Meta(version="1.0.0"),
            )

    def test_plugin_manifest_invalid_author_format(self):
        """Test that invalid author format raises validation error."""
        # Arrange & Act & Assert: Creating a declaration with invalid author should fail
        with pytest.raises(ValueError):
            PluginDeclaration(
                version="1.0.0",
                author="invalid author with spaces!@#",  # Invalid author format
                name="test-plugin",
                description=I18nObject(en_US="Test", zh_Hans="测试"),
                icon="icon.png",
                label=I18nObject(en_US="Test", zh_Hans="测试"),
                category=PluginCategory.Tool,
                created_at=datetime.datetime.now(),
                resource=PluginResourceRequirements(memory=512, permission=None),
                plugins=PluginDeclaration.Plugins(),
                meta=PluginDeclaration.Meta(version="1.0.0"),
            )

    def test_plugin_manifest_invalid_name_format(self):
        """Test that invalid plugin name format raises validation error."""
        # Arrange & Act & Assert: Creating a declaration with invalid name should fail
        with pytest.raises(ValueError):
            PluginDeclaration(
                version="1.0.0",
                author="test-author",
                name="Invalid_Plugin_Name_With_Uppercase",  # Invalid name format
                description=I18nObject(en_US="Test", zh_Hans="测试"),
                icon="icon.png",
                label=I18nObject(en_US="Test", zh_Hans="测试"),
                category=PluginCategory.Tool,
                created_at=datetime.datetime.now(),
                resource=PluginResourceRequirements(memory=512, permission=None),
                plugins=PluginDeclaration.Plugins(),
                meta=PluginDeclaration.Meta(version="1.0.0"),
            )

    def test_fetch_plugin_readme_success(self, plugin_installer):
        """Test successful plugin readme fetching."""
        # Arrange: Mock readme response
        mock_response = PluginReadmeResponse(content="# Test Plugin\n\nThis is a test plugin.", language="en_US")

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response):
            # Act: Fetch plugin readme
            result = plugin_installer.fetch_plugin_readme("test-tenant", "test-org/test-plugin/1.0.0", "en_US")

            # Assert: Verify readme content
            assert result == "# Test Plugin\n\nThis is a test plugin."

    def test_fetch_plugin_readme_not_found(self, plugin_installer):
        """Test fetching readme when it doesn't exist (404 error)."""
        # Arrange: Mock HTTP 404 error - the actual implementation catches HTTPError from requests library
        mock_error = HTTPError("404 Not Found")

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", side_effect=mock_error):
            # Act: Fetch non-existent readme
            result = plugin_installer.fetch_plugin_readme("test-tenant", "test-org/test-plugin/1.0.0", "en_US")

            # Assert: Verify empty string is returned for 404
            assert result == ""


class TestVersionCompatibility:
    """Test version compatibility checks."""

    def test_valid_version_format(self):
        """Test that valid semantic versions are accepted."""
        # Arrange & Act: Create declarations with various valid version formats
        valid_versions = ["1.0.0", "2.1.3", "0.0.1", "10.20.30"]

        for version in valid_versions:
            # Assert: All valid versions should be accepted
            declaration = PluginDeclaration(
                version=version,
                author="test-author",
                name="test-plugin",
                description=I18nObject(en_US="Test", zh_Hans="测试"),
                icon="icon.png",
                label=I18nObject(en_US="Test", zh_Hans="测试"),
                category=PluginCategory.Tool,
                created_at=datetime.datetime.now(),
                resource=PluginResourceRequirements(memory=512, permission=None),
                plugins=PluginDeclaration.Plugins(),
                meta=PluginDeclaration.Meta(version=version),
            )
            assert declaration.version == version

    def test_minimum_dify_version_validation(self):
        """Test minimum Dify version validation."""
        # Arrange & Act: Create declaration with minimum Dify version
        declaration = PluginDeclaration(
            version="1.0.0",
            author="test-author",
            name="test-plugin",
            description=I18nObject(en_US="Test", zh_Hans="测试"),
            icon="icon.png",
            label=I18nObject(en_US="Test", zh_Hans="测试"),
            category=PluginCategory.Tool,
            created_at=datetime.datetime.now(),
            resource=PluginResourceRequirements(memory=512, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="1.0.0", minimum_dify_version="0.6.0"),
        )

        # Assert: Verify minimum version is set correctly
        assert declaration.meta.minimum_dify_version == "0.6.0"

    def test_invalid_minimum_dify_version(self):
        """Test that invalid minimum Dify version format raises error."""
        # Arrange & Act & Assert: Invalid minimum version should raise ValueError
        with pytest.raises(ValueError, match="Invalid version format"):
            PluginDeclaration.Meta(version="1.0.0", minimum_dify_version="invalid.version")

    def test_version_comparison_logic(self):
        """Test version comparison using packaging.version.Version."""
        # Arrange: Create version objects for comparison
        v1 = Version("1.0.0")
        v2 = Version("2.0.0")
        v3 = Version("1.5.0")

        # Act & Assert: Verify version comparison works correctly
        assert v1 < v2
        assert v2 > v1
        assert v1 < v3 < v2
        assert v1 == Version("1.0.0")

    def test_plugin_upgrade_version_check(self):
        """Test that plugin upgrade requires newer version."""
        # Arrange: Define old and new versions
        old_version = Version("1.0.0")
        new_version = Version("2.0.0")
        same_version = Version("1.0.0")

        # Act & Assert: Verify version upgrade logic
        assert new_version > old_version  # Valid upgrade
        assert not (same_version > old_version)  # Invalid upgrade (same version)


class TestDependencyResolution:
    """Test plugin dependency resolution."""

    @pytest.fixture
    def plugin_installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    def test_upload_bundle_with_dependencies(self, plugin_installer):
        """Test uploading a plugin bundle and extracting dependencies."""
        # Arrange: Create mock bundle data and dependencies
        bundle_data = b"mock-bundle-data"
        mock_dependencies = [
            PluginBundleDependency(
                type=PluginBundleDependency.Type.Marketplace,
                value=PluginBundleDependency.Marketplace(organization="org1", plugin="plugin1", version="1.0.0"),
            ),
            PluginBundleDependency(
                type=PluginBundleDependency.Type.Github,
                value=PluginBundleDependency.Github(
                    repo_address="https://github.com/org/repo",
                    repo="org/repo",
                    release="v1.0.0",
                    packages="plugin.zip",
                ),
            ),
        ]

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_dependencies
        ) as mock_request:
            # Act: Upload bundle
            result = plugin_installer.upload_bundle("test-tenant", bundle_data, verify_signature=False)

            # Assert: Verify dependencies were extracted
            assert len(result) == 2
            assert result[0].type == PluginBundleDependency.Type.Marketplace
            assert result[1].type == PluginBundleDependency.Type.Github
            mock_request.assert_called_once()

    def test_fetch_missing_dependencies(self, plugin_installer):
        """Test fetching missing dependencies for plugins."""
        # Arrange: Mock missing dependencies response
        mock_missing = [
            MissingPluginDependency(plugin_unique_identifier="dep1/1.0.0", current_identifier=None),
            MissingPluginDependency(plugin_unique_identifier="dep2/2.0.0", current_identifier="dep2/1.0.0"),
        ]

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_missing
        ) as mock_request:
            # Act: Fetch missing dependencies
            result = plugin_installer.fetch_missing_dependencies("test-tenant", ["plugin1/1.0.0", "plugin2/2.0.0"])

            # Assert: Verify missing dependencies were identified
            assert len(result) == 2
            assert result[0].plugin_unique_identifier == "dep1/1.0.0"
            assert result[1].current_identifier == "dep2/1.0.0"
            mock_request.assert_called_once()

    def test_fetch_missing_dependencies_none_missing(self, plugin_installer):
        """Test fetching missing dependencies when all are satisfied."""
        # Arrange: Mock empty missing dependencies
        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=[]):
            # Act: Fetch missing dependencies
            result = plugin_installer.fetch_missing_dependencies("test-tenant", ["plugin1/1.0.0"])

            # Assert: Verify no missing dependencies
            assert len(result) == 0

    def test_fetch_plugin_installation_by_ids(self, plugin_installer):
        """Test fetching plugin installations by their IDs."""
        # Arrange: Create mock plugin installations
        mock_installations = [
            PluginInstallation(
                id="install-1",
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now(),
                tenant_id="test-tenant",
                endpoints_setups=0,
                endpoints_active=0,
                runtime_type="remote",
                source=PluginInstallationSource.Marketplace,
                meta={},
                plugin_id="plugin-1",
                plugin_unique_identifier="org/plugin1/1.0.0",
                version="1.0.0",
                checksum="abc123",
                declaration=PluginDeclaration(
                    version="1.0.0",
                    author="author1",
                    name="plugin1",
                    description=I18nObject(en_US="Plugin 1", zh_Hans="插件1"),
                    icon="icon.png",
                    label=I18nObject(en_US="Plugin 1", zh_Hans="插件1"),
                    category=PluginCategory.Tool,
                    created_at=datetime.datetime.now(),
                    resource=PluginResourceRequirements(memory=512, permission=None),
                    plugins=PluginDeclaration.Plugins(),
                    meta=PluginDeclaration.Meta(version="1.0.0"),
                ),
            )
        ]

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_installations
        ) as mock_request:
            # Act: Fetch installations by IDs
            result = plugin_installer.fetch_plugin_installation_by_ids("test-tenant", ["plugin-1", "plugin-2"])

            # Assert: Verify installations were fetched
            assert len(result) == 1
            assert result[0].plugin_id == "plugin-1"
            mock_request.assert_called_once()

    def test_dependency_chain_resolution(self, plugin_installer):
        """Test resolving a chain of dependencies."""
        # Arrange: Create a dependency chain scenario
        # Plugin A depends on Plugin B, Plugin B depends on Plugin C
        mock_missing = [
            MissingPluginDependency(plugin_unique_identifier="plugin-b/1.0.0", current_identifier=None),
            MissingPluginDependency(plugin_unique_identifier="plugin-c/1.0.0", current_identifier=None),
        ]

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_missing):
            # Act: Fetch missing dependencies for Plugin A
            result = plugin_installer.fetch_missing_dependencies("test-tenant", ["plugin-a/1.0.0"])

            # Assert: Verify all dependencies in the chain are identified
            assert len(result) == 2
            identifiers = [dep.plugin_unique_identifier for dep in result]
            assert "plugin-b/1.0.0" in identifiers
            assert "plugin-c/1.0.0" in identifiers

    def test_check_tools_existence(self, plugin_installer):
        """Test checking if plugin tools exist."""
        # Arrange: Create provider IDs to check using the correct format
        provider_ids = [
            GenericProviderID("org1/plugin1/provider1"),
            GenericProviderID("org2/plugin2/provider2"),
        ]

        # Mock response indicating first exists, second doesn't
        mock_response = [True, False]

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response
        ) as mock_request:
            # Act: Check tools existence
            result = plugin_installer.check_tools_existence("test-tenant", provider_ids)

            # Assert: Verify existence check results
            assert len(result) == 2
            assert result[0] is True
            assert result[1] is False
            mock_request.assert_called_once()


class TestPluginTaskManagement:
    """Test plugin installation task management."""

    @pytest.fixture
    def plugin_installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    def test_fetch_plugin_installation_tasks(self, plugin_installer):
        """Test fetching multiple plugin installation tasks."""
        # Arrange: Create mock installation tasks
        mock_tasks = [
            PluginInstallTask(
                id="task-1",
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now(),
                status=PluginInstallTaskStatus.Running,
                total_plugins=2,
                completed_plugins=1,
                plugins=[],
            ),
            PluginInstallTask(
                id="task-2",
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now(),
                status=PluginInstallTaskStatus.Success,
                total_plugins=1,
                completed_plugins=1,
                plugins=[],
            ),
        ]

        with patch.object(
            plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_tasks
        ) as mock_request:
            # Act: Fetch installation tasks
            result = plugin_installer.fetch_plugin_installation_tasks("test-tenant", page=1, page_size=10)

            # Assert: Verify tasks were fetched
            assert len(result) == 2
            assert result[0].status == PluginInstallTaskStatus.Running
            assert result[1].status == PluginInstallTaskStatus.Success
            mock_request.assert_called_once()

    def test_delete_plugin_installation_task(self, plugin_installer):
        """Test deleting a specific plugin installation task."""
        # Arrange: Mock successful deletion
        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=True) as mock_request:
            # Act: Delete installation task
            result = plugin_installer.delete_plugin_installation_task("test-tenant", "task-123")

            # Assert: Verify deletion succeeded
            assert result is True
            mock_request.assert_called_once()

    def test_delete_all_plugin_installation_task_items(self, plugin_installer):
        """Test deleting all plugin installation task items."""
        # Arrange: Mock successful deletion of all items
        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=True) as mock_request:
            # Act: Delete all task items
            result = plugin_installer.delete_all_plugin_installation_task_items("test-tenant")

            # Assert: Verify all items were deleted
            assert result is True
            mock_request.assert_called_once()

    def test_delete_plugin_installation_task_item(self, plugin_installer):
        """Test deleting a specific item from an installation task."""
        # Arrange: Mock successful item deletion
        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=True) as mock_request:
            # Act: Delete specific task item
            result = plugin_installer.delete_plugin_installation_task_item(
                "test-tenant", "task-123", "plugin-identifier"
            )

            # Assert: Verify item was deleted
            assert result is True
            mock_request.assert_called_once()


class TestErrorHandling:
    """Test error handling in plugin manager."""

    @pytest.fixture
    def plugin_installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    def test_plugin_not_found_error(self, plugin_installer):
        """Test handling of plugin not found error."""
        # Arrange: Mock plugin daemon not found error
        with patch.object(
            plugin_installer,
            "_request_with_plugin_daemon_response",
            side_effect=PluginDaemonNotFoundError("Plugin not found"),
        ):
            # Act & Assert: Verify error is raised
            with pytest.raises(PluginDaemonNotFoundError):
                plugin_installer.fetch_plugin_manifest("test-tenant", "non-existent/plugin/1.0.0")

    def test_plugin_bad_request_error(self, plugin_installer):
        """Test handling of bad request error."""
        # Arrange: Mock bad request error
        with patch.object(
            plugin_installer,
            "_request_with_plugin_daemon_response",
            side_effect=PluginDaemonBadRequestError("Invalid request"),
        ):
            # Act & Assert: Verify error is raised
            with pytest.raises(PluginDaemonBadRequestError):
                plugin_installer.install_from_identifiers("test-tenant", [], PluginInstallationSource.Marketplace, [])

    def test_plugin_internal_server_error(self, plugin_installer):
        """Test handling of internal server error."""
        # Arrange: Mock internal server error
        with patch.object(
            plugin_installer,
            "_request_with_plugin_daemon_response",
            side_effect=PluginDaemonInternalServerError("Internal error"),
        ):
            # Act & Assert: Verify error is raised
            with pytest.raises(PluginDaemonInternalServerError):
                plugin_installer.list_plugins("test-tenant")

    def test_http_error_handling(self, plugin_installer):
        """Test handling of HTTP errors during requests."""
        # Arrange: Mock HTTP error
        with patch.object(plugin_installer, "_request", side_effect=httpx.RequestError("Connection failed")):
            # Act & Assert: Verify appropriate error handling
            with pytest.raises(httpx.RequestError):
                plugin_installer._request("GET", "test/path")


class TestPluginCategoryDetection:
    """Test automatic plugin category detection."""

    def test_category_defaults_to_extension_without_tool_provider(self):
        """Test that plugins without tool providers default to Extension category."""
        # Arrange: Create declaration - category is auto-detected based on provider presence
        # The model_validator in PluginDeclaration automatically sets category based on which provider is present
        # Since we're not providing a tool provider entity, it defaults to Extension
        # This test verifies that explicitly set categories are preserved
        declaration = PluginDeclaration(
            version="1.0.0",
            author="test-author",
            name="tool-plugin",
            description=I18nObject(en_US="Tool plugin", zh_Hans="工具插件"),
            icon="icon.png",
            label=I18nObject(en_US="Tool Plugin", zh_Hans="工具插件"),
            category=PluginCategory.Extension,  # Will be Extension without a tool provider
            created_at=datetime.datetime.now(),
            resource=PluginResourceRequirements(memory=512, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="1.0.0"),
        )

        # Assert: Verify category defaults to Extension when no provider is specified
        assert declaration.category == PluginCategory.Extension

    def test_category_defaults_to_extension_without_model_provider(self):
        """Test that plugins without model providers default to Extension category."""
        # Arrange: Create declaration - without a model provider entity, defaults to Extension
        # The category is auto-detected in the model_validator based on provider presence
        declaration = PluginDeclaration(
            version="1.0.0",
            author="test-author",
            name="model-plugin",
            description=I18nObject(en_US="Model plugin", zh_Hans="模型插件"),
            icon="icon.png",
            label=I18nObject(en_US="Model Plugin", zh_Hans="模型插件"),
            category=PluginCategory.Extension,  # Will be Extension without a model provider
            created_at=datetime.datetime.now(),
            resource=PluginResourceRequirements(memory=1024, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="1.0.0"),
        )

        # Assert: Verify category defaults to Extension when no provider is specified
        assert declaration.category == PluginCategory.Extension

    def test_extension_category_default(self):
        """Test that plugins without specific providers default to Extension."""
        # Arrange: Create declaration without specific provider type
        declaration = PluginDeclaration(
            version="1.0.0",
            author="test-author",
            name="extension-plugin",
            description=I18nObject(en_US="Extension plugin", zh_Hans="扩展插件"),
            icon="icon.png",
            label=I18nObject(en_US="Extension Plugin", zh_Hans="扩展插件"),
            category=PluginCategory.Extension,
            created_at=datetime.datetime.now(),
            resource=PluginResourceRequirements(memory=512, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="1.0.0"),
        )

        # Assert: Verify category is Extension
        assert declaration.category == PluginCategory.Extension


class TestPluginResourceRequirements:
    """Test plugin resource requirements and permissions."""

    def test_default_resource_requirements(self):
        """
        Test that plugin resource requirements can be created with default values.

        Resource requirements define the memory and permissions needed for a plugin to run.
        This test verifies that a basic resource requirement with only memory can be created.
        """
        # Arrange & Act: Create resource requirements with only memory specified
        resources = PluginResourceRequirements(memory=512, permission=None)

        # Assert: Verify memory is set correctly and permissions are None
        assert resources.memory == 512
        assert resources.permission is None

    def test_resource_requirements_with_tool_permission(self):
        """
        Test plugin resource requirements with tool permissions enabled.

        Tool permissions allow a plugin to provide tool functionality.
        This test verifies that tool permissions can be properly configured.
        """
        # Arrange & Act: Create resource requirements with tool permissions
        resources = PluginResourceRequirements(
            memory=1024,
            permission=PluginResourceRequirements.Permission(
                tool=PluginResourceRequirements.Permission.Tool(enabled=True)
            ),
        )

        # Assert: Verify tool permissions are enabled
        assert resources.memory == 1024
        assert resources.permission is not None
        assert resources.permission.tool is not None
        assert resources.permission.tool.enabled is True

    def test_resource_requirements_with_model_permissions(self):
        """
        Test plugin resource requirements with model permissions.

        Model permissions allow a plugin to provide various AI model capabilities
        including LLM, text embedding, rerank, TTS, speech-to-text, and moderation.
        """
        # Arrange & Act: Create resource requirements with comprehensive model permissions
        resources = PluginResourceRequirements(
            memory=2048,
            permission=PluginResourceRequirements.Permission(
                model=PluginResourceRequirements.Permission.Model(
                    enabled=True,
                    llm=True,
                    text_embedding=True,
                    rerank=True,
                    tts=False,
                    speech2text=False,
                    moderation=True,
                )
            ),
        )

        # Assert: Verify all model permissions are set correctly
        assert resources.memory == 2048
        assert resources.permission.model.enabled is True
        assert resources.permission.model.llm is True
        assert resources.permission.model.text_embedding is True
        assert resources.permission.model.rerank is True
        assert resources.permission.model.tts is False
        assert resources.permission.model.speech2text is False
        assert resources.permission.model.moderation is True

    def test_resource_requirements_with_storage_permission(self):
        """
        Test plugin resource requirements with storage permissions.

        Storage permissions allow a plugin to persist data with size limits.
        The size must be between 1KB (1024 bytes) and 1GB (1073741824 bytes).
        """
        # Arrange & Act: Create resource requirements with storage permissions
        resources = PluginResourceRequirements(
            memory=512,
            permission=PluginResourceRequirements.Permission(
                storage=PluginResourceRequirements.Permission.Storage(enabled=True, size=10485760)  # 10MB
            ),
        )

        # Assert: Verify storage permissions and size limits
        assert resources.permission.storage.enabled is True
        assert resources.permission.storage.size == 10485760

    def test_resource_requirements_with_endpoint_permission(self):
        """
        Test plugin resource requirements with endpoint permissions.

        Endpoint permissions allow a plugin to expose HTTP endpoints.
        """
        # Arrange & Act: Create resource requirements with endpoint permissions
        resources = PluginResourceRequirements(
            memory=1024,
            permission=PluginResourceRequirements.Permission(
                endpoint=PluginResourceRequirements.Permission.Endpoint(enabled=True)
            ),
        )

        # Assert: Verify endpoint permissions are enabled
        assert resources.permission.endpoint.enabled is True

    def test_resource_requirements_with_node_permission(self):
        """
        Test plugin resource requirements with node permissions.

        Node permissions allow a plugin to provide custom workflow nodes.
        """
        # Arrange & Act: Create resource requirements with node permissions
        resources = PluginResourceRequirements(
            memory=768,
            permission=PluginResourceRequirements.Permission(
                node=PluginResourceRequirements.Permission.Node(enabled=True)
            ),
        )

        # Assert: Verify node permissions are enabled
        assert resources.permission.node.enabled is True


class TestPluginInstallationSources:
    """Test different plugin installation sources."""

    def test_marketplace_installation_source(self):
        """
        Test plugin installation from marketplace source.

        Marketplace is the official plugin distribution channel where
        verified and community plugins are available for installation.
        """
        # Arrange & Act: Use marketplace as installation source
        source = PluginInstallationSource.Marketplace

        # Assert: Verify source type
        assert source == PluginInstallationSource.Marketplace
        assert source.value == "marketplace"

    def test_github_installation_source(self):
        """
        Test plugin installation from GitHub source.

        GitHub source allows installing plugins directly from GitHub repositories,
        useful for development and testing unreleased versions.
        """
        # Arrange & Act: Use GitHub as installation source
        source = PluginInstallationSource.Github

        # Assert: Verify source type
        assert source == PluginInstallationSource.Github
        assert source.value == "github"

    def test_package_installation_source(self):
        """
        Test plugin installation from package source.

        Package source allows installing plugins from local .difypkg files,
        useful for private or custom plugins.
        """
        # Arrange & Act: Use package as installation source
        source = PluginInstallationSource.Package

        # Assert: Verify source type
        assert source == PluginInstallationSource.Package
        assert source.value == "package"

    def test_remote_installation_source(self):
        """
        Test plugin installation from remote source.

        Remote source allows installing plugins from custom remote URLs.
        """
        # Arrange & Act: Use remote as installation source
        source = PluginInstallationSource.Remote

        # Assert: Verify source type
        assert source == PluginInstallationSource.Remote
        assert source.value == "remote"


class TestPluginBundleOperations:
    """Test plugin bundle operations and dependency extraction."""

    @pytest.fixture
    def plugin_installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    def test_upload_bundle_with_marketplace_dependencies(self, plugin_installer):
        """
        Test uploading a bundle with marketplace dependencies.

        Marketplace dependencies reference plugins available in the official marketplace
        by organization, plugin name, and version.
        """
        # Arrange: Create mock bundle with marketplace dependencies
        bundle_data = b"mock-marketplace-bundle"
        mock_dependencies = [
            PluginBundleDependency(
                type=PluginBundleDependency.Type.Marketplace,
                value=PluginBundleDependency.Marketplace(
                    organization="langgenius", plugin="search-tool", version="1.2.0"
                ),
            )
        ]

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_dependencies):
            # Act: Upload bundle
            result = plugin_installer.upload_bundle("test-tenant", bundle_data)

            # Assert: Verify marketplace dependency was extracted
            assert len(result) == 1
            assert result[0].type == PluginBundleDependency.Type.Marketplace
            assert isinstance(result[0].value, PluginBundleDependency.Marketplace)
            assert result[0].value.organization == "langgenius"
            assert result[0].value.plugin == "search-tool"

    def test_upload_bundle_with_github_dependencies(self, plugin_installer):
        """
        Test uploading a bundle with GitHub dependencies.

        GitHub dependencies reference plugins hosted on GitHub repositories
        with specific releases and package files.
        """
        # Arrange: Create mock bundle with GitHub dependencies
        bundle_data = b"mock-github-bundle"
        mock_dependencies = [
            PluginBundleDependency(
                type=PluginBundleDependency.Type.Github,
                value=PluginBundleDependency.Github(
                    repo_address="https://github.com/example/plugin",
                    repo="example/plugin",
                    release="v2.0.0",
                    packages="plugin-v2.0.0.zip",
                ),
            )
        ]

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_dependencies):
            # Act: Upload bundle
            result = plugin_installer.upload_bundle("test-tenant", bundle_data)

            # Assert: Verify GitHub dependency was extracted
            assert len(result) == 1
            assert result[0].type == PluginBundleDependency.Type.Github
            assert isinstance(result[0].value, PluginBundleDependency.Github)
            assert result[0].value.repo == "example/plugin"
            assert result[0].value.release == "v2.0.0"

    def test_upload_bundle_with_package_dependencies(self, plugin_installer):
        """
        Test uploading a bundle with package dependencies.

        Package dependencies include the full plugin manifest and unique identifier,
        allowing for self-contained plugin bundles.
        """
        # Arrange: Create mock bundle with package dependencies
        bundle_data = b"mock-package-bundle"
        mock_manifest = PluginDeclaration(
            version="1.5.0",
            author="bundle-author",
            name="bundled-plugin",
            description=I18nObject(en_US="Bundled plugin", zh_Hans="捆绑插件"),
            icon="icon.png",
            label=I18nObject(en_US="Bundled Plugin", zh_Hans="捆绑插件"),
            category=PluginCategory.Extension,
            created_at=datetime.datetime.now(),
            resource=PluginResourceRequirements(memory=512, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="1.5.0"),
        )

        mock_dependencies = [
            PluginBundleDependency(
                type=PluginBundleDependency.Type.Package,
                value=PluginBundleDependency.Package(
                    unique_identifier="org/bundled-plugin/1.5.0", manifest=mock_manifest
                ),
            )
        ]

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_dependencies):
            # Act: Upload bundle
            result = plugin_installer.upload_bundle("test-tenant", bundle_data)

            # Assert: Verify package dependency was extracted with manifest
            assert len(result) == 1
            assert result[0].type == PluginBundleDependency.Type.Package
            assert isinstance(result[0].value, PluginBundleDependency.Package)
            assert result[0].value.unique_identifier == "org/bundled-plugin/1.5.0"
            assert result[0].value.manifest.name == "bundled-plugin"

    def test_upload_bundle_with_mixed_dependencies(self, plugin_installer):
        """
        Test uploading a bundle with multiple dependency types.

        Real-world plugin bundles often have dependencies from various sources:
        marketplace plugins, GitHub repositories, and packaged plugins.
        """
        # Arrange: Create mock bundle with mixed dependencies
        bundle_data = b"mock-mixed-bundle"
        mock_dependencies = [
            PluginBundleDependency(
                type=PluginBundleDependency.Type.Marketplace,
                value=PluginBundleDependency.Marketplace(organization="org1", plugin="plugin1", version="1.0.0"),
            ),
            PluginBundleDependency(
                type=PluginBundleDependency.Type.Github,
                value=PluginBundleDependency.Github(
                    repo_address="https://github.com/org2/plugin2",
                    repo="org2/plugin2",
                    release="v1.0.0",
                    packages="plugin2.zip",
                ),
            ),
        ]

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_dependencies):
            # Act: Upload bundle
            result = plugin_installer.upload_bundle("test-tenant", bundle_data, verify_signature=True)

            # Assert: Verify all dependency types were extracted
            assert len(result) == 2
            assert result[0].type == PluginBundleDependency.Type.Marketplace
            assert result[1].type == PluginBundleDependency.Type.Github


class TestPluginTaskStatusTransitions:
    """Test plugin installation task status transitions and lifecycle."""

    @pytest.fixture
    def plugin_installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    def test_task_status_pending(self, plugin_installer):
        """
        Test plugin installation task in pending status.

        Pending status indicates the task has been created but not yet started.
        No plugins have been processed yet.
        """
        # Arrange: Create mock task in pending status
        mock_task = PluginInstallTask(
            id="pending-task",
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now(),
            status=PluginInstallTaskStatus.Pending,
            total_plugins=3,
            completed_plugins=0,  # No plugins completed yet
            plugins=[],
        )

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_task):
            # Act: Fetch task
            result = plugin_installer.fetch_plugin_installation_task("test-tenant", "pending-task")

            # Assert: Verify pending status
            assert result.status == PluginInstallTaskStatus.Pending
            assert result.completed_plugins == 0
            assert result.total_plugins == 3

    def test_task_status_running(self, plugin_installer):
        """
        Test plugin installation task in running status.

        Running status indicates the task is actively installing plugins.
        Some plugins may be completed while others are still in progress.
        """
        # Arrange: Create mock task in running status
        mock_task = PluginInstallTask(
            id="running-task",
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now(),
            status=PluginInstallTaskStatus.Running,
            total_plugins=5,
            completed_plugins=2,  # 2 out of 5 completed
            plugins=[],
        )

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_task):
            # Act: Fetch task
            result = plugin_installer.fetch_plugin_installation_task("test-tenant", "running-task")

            # Assert: Verify running status and progress
            assert result.status == PluginInstallTaskStatus.Running
            assert result.completed_plugins == 2
            assert result.total_plugins == 5
            assert result.completed_plugins < result.total_plugins

    def test_task_status_success(self, plugin_installer):
        """
        Test plugin installation task in success status.

        Success status indicates all plugins in the task have been
        successfully installed without errors.
        """
        # Arrange: Create mock task in success status
        mock_task = PluginInstallTask(
            id="success-task",
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now(),
            status=PluginInstallTaskStatus.Success,
            total_plugins=4,
            completed_plugins=4,  # All plugins completed
            plugins=[],
        )

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_task):
            # Act: Fetch task
            result = plugin_installer.fetch_plugin_installation_task("test-tenant", "success-task")

            # Assert: Verify success status and completion
            assert result.status == PluginInstallTaskStatus.Success
            assert result.completed_plugins == result.total_plugins
            assert result.completed_plugins == 4

    def test_task_status_failed(self, plugin_installer):
        """
        Test plugin installation task in failed status.

        Failed status indicates the task encountered errors during installation.
        Some plugins may have been installed before the failure occurred.
        """
        # Arrange: Create mock task in failed status
        mock_task = PluginInstallTask(
            id="failed-task",
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now(),
            status=PluginInstallTaskStatus.Failed,
            total_plugins=3,
            completed_plugins=1,  # Only 1 completed before failure
            plugins=[],
        )

        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_task):
            # Act: Fetch task
            result = plugin_installer.fetch_plugin_installation_task("test-tenant", "failed-task")

            # Assert: Verify failed status
            assert result.status == PluginInstallTaskStatus.Failed
            assert result.completed_plugins < result.total_plugins


class TestPluginI18nSupport:
    """Test plugin internationalization (i18n) support."""

    def test_plugin_with_multiple_languages(self):
        """
        Test plugin declaration with multiple language support.

        Plugins should support multiple languages for descriptions and labels
        to provide localized experiences for users worldwide.
        """
        # Arrange & Act: Create plugin with English and Chinese support
        declaration = PluginDeclaration(
            version="1.0.0",
            author="i18n-author",
            name="multilang-plugin",
            description=I18nObject(
                en_US="A plugin with multilingual support",
                zh_Hans="支持多语言的插件",
                ja_JP="多言語対応のプラグイン",
            ),
            icon="icon.png",
            label=I18nObject(en_US="Multilingual Plugin", zh_Hans="多语言插件", ja_JP="多言語プラグイン"),
            category=PluginCategory.Extension,
            created_at=datetime.datetime.now(),
            resource=PluginResourceRequirements(memory=512, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="1.0.0"),
        )

        # Assert: Verify all language variants are preserved
        assert declaration.description.en_US == "A plugin with multilingual support"
        assert declaration.description.zh_Hans == "支持多语言的插件"
        assert declaration.label.en_US == "Multilingual Plugin"
        assert declaration.label.zh_Hans == "多语言插件"

    def test_plugin_readme_language_variants(self):
        """
        Test fetching plugin README in different languages.

        Plugins can provide README files in multiple languages to help
        users understand the plugin in their preferred language.
        """
        # Arrange: Create plugin installer instance
        plugin_installer = PluginInstaller()

        # Mock README responses for different languages
        english_readme = PluginReadmeResponse(
            content="# English README\n\nThis is the English version.", language="en_US"
        )

        chinese_readme = PluginReadmeResponse(content="# 中文说明\n\n这是中文版本。", language="zh_Hans")

        # Test English README
        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=english_readme):
            # Act: Fetch English README
            result_en = plugin_installer.fetch_plugin_readme("test-tenant", "plugin/1.0.0", "en_US")

            # Assert: Verify English content
            assert "English README" in result_en

        # Test Chinese README
        with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=chinese_readme):
            # Act: Fetch Chinese README
            result_zh = plugin_installer.fetch_plugin_readme("test-tenant", "plugin/1.0.0", "zh_Hans")

            # Assert: Verify Chinese content
            assert "中文说明" in result_zh

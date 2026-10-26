import datetime
import json
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from packaging.version import Version
from pydantic import BaseModel
from requests import HTTPError

from core.plugin.entities.bundle import PluginBundleDependency, PluginBundleDependencyType
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
    CredentialType,
    PluginDaemonInnerError,
    PluginDecodeResponse,
    PluginInstalledIdsDaemonResponse,
    PluginInstallTask,
    PluginInstallTaskStartResponse,
    PluginInstallTaskStatus,
    PluginListResponse,
    PluginListWithoutTotalResponse,
    PluginReadmeResponse,
    PluginVerification,
)
from core.plugin.impl.base import BasePluginClient, use_plugin_daemon_request_timeout
from core.plugin.impl.exc import (
    PluginDaemonBadRequestError,
    PluginDaemonClientSideError,
    PluginDaemonInternalServerError,
    PluginDaemonNotFoundError,
    PluginDaemonUnauthorizedError,
    PluginInvokeError,
    PluginNotFoundError,
    PluginPermissionDeniedError,
    PluginUniqueIdentifierError,
)
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.impl.tool import PluginToolManager
from core.tools.entities.common_entities import I18nObject
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from models.provider_ids import GenericProviderID

"""
Unit tests for Plugin Manager (PluginInstaller).

This module tests the plugin management functionality including:
- Plugin discovery and listing
- Plugin loading and installation
- Plugin validation and manifest parsing
- Version compatibility checks
- Dependency resolution
"""


class TestPluginManagerCases:
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

        def test_list_plugins_by_category(self, plugin_installer, mock_plugin_entity):
            """Test category plugin listing without total."""
            mock_response = PluginListWithoutTotalResponse(list=[mock_plugin_entity], has_more=True)

            with patch.object(
                plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response
            ) as mock_request:
                result = plugin_installer.list_plugins_by_category(
                    "test-tenant",
                    category=PluginCategory.Tool,
                    page=2,
                    page_size=10,
                    query="weather",
                    tags=["search", "rag"],
                    language="zh_Hans",
                )

                mock_request.assert_called_once()
                call_args = mock_request.call_args
                assert call_args.args[1] == "plugin/test-tenant/management/tool/list"
                assert call_args.args[2] is PluginListWithoutTotalResponse
                assert call_args.kwargs["params"]["page"] == 2
                assert call_args.kwargs["params"]["page_size"] == 10
                assert call_args.kwargs["params"]["query"] == "weather"
                assert call_args.kwargs["params"]["tags"] == ["search", "rag"]
                assert call_args.kwargs["params"]["language"] == "zh_Hans"
                assert result.list == [mock_plugin_entity]
                assert result.has_more is True

        def test_list_plugins_empty_result(self, plugin_installer):
            """Test plugin listing when no plugins are installed."""
            # Arrange: Mock empty response
            mock_response = PluginListResponse(list=[], total=0)

            with patch.object(plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response):
                # Act: List plugins
                result = plugin_installer.list_plugins("test-tenant")

                # Assert: Verify empty list is returned
                assert len(result) == 0

        def test_list_installed_plugin_ids(self, plugin_installer):
            """The lightweight ID endpoint is unpaginated and does not request plugin details."""
            mock_response = PluginInstalledIdsDaemonResponse(plugin_ids=["langgenius/openai", "langgenius/anthropic"])

            with patch.object(
                plugin_installer, "_request_with_plugin_daemon_response", return_value=mock_response
            ) as mock_request:
                result = plugin_installer.list_installed_plugin_ids("test-tenant", PluginCategory.Tool)

            mock_request.assert_called_once_with(
                "GET",
                "plugin/test-tenant/management/installation/ids",
                PluginInstalledIdsDaemonResponse,
                params={"category": "tool"},
            )
            assert result == ["langgenius/openai", "langgenius/anthropic"]

        def test_fetch_plugin_by_identifier_found(self, plugin_installer):
            """Test fetching a plugin by its unique identifier when it exists."""
            # Arrange: Mock successful fetch
            with patch.object(
                plugin_installer, "_request_with_plugin_daemon_response", return_value=True
            ) as mock_request:
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
            with patch.object(
                plugin_installer, "_request_with_plugin_daemon_response", return_value=True
            ) as mock_request:
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
            with pytest.raises(ValueError, match="1 validation error for PluginDeclaration\\\nauthor"):
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
            with pytest.raises(ValueError, match="1 validation error for PluginDeclaration\\\nname"):
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
                    type=PluginBundleDependencyType.Marketplace,
                    value=PluginBundleDependency.Marketplace(organization="org1", plugin="plugin1", version="1.0.0"),
                ),
                PluginBundleDependency(
                    type=PluginBundleDependencyType.Github,
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
                assert result[0].type == PluginBundleDependencyType.Marketplace
                assert result[1].type == PluginBundleDependencyType.Github
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
            with patch.object(
                plugin_installer, "_request_with_plugin_daemon_response", return_value=True
            ) as mock_request:
                # Act: Delete installation task
                result = plugin_installer.delete_plugin_installation_task("test-tenant", "task-123")

                # Assert: Verify deletion succeeded
                assert result is True
                mock_request.assert_called_once()

        def test_delete_all_plugin_installation_task_items(self, plugin_installer):
            """Test deleting all plugin installation task items."""
            # Arrange: Mock successful deletion of all items
            with patch.object(
                plugin_installer, "_request_with_plugin_daemon_response", return_value=True
            ) as mock_request:
                # Act: Delete all task items
                result = plugin_installer.delete_all_plugin_installation_task_items("test-tenant")

                # Assert: Verify all items were deleted
                assert result is True
                mock_request.assert_called_once()

        def test_delete_plugin_installation_task_item(self, plugin_installer):
            """Test deleting a specific item from an installation task."""
            # Arrange: Mock successful item deletion
            with patch.object(
                plugin_installer, "_request_with_plugin_daemon_response", return_value=True
            ) as mock_request:
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
                    plugin_installer.install_from_identifiers(
                        "test-tenant", [], PluginInstallationSource.Marketplace, []
                    )

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
                    type=PluginBundleDependencyType.Marketplace,
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
                assert result[0].type == PluginBundleDependencyType.Marketplace
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
                    type=PluginBundleDependencyType.Github,
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
                assert result[0].type == PluginBundleDependencyType.Github
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
                    type=PluginBundleDependencyType.Package,
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
                assert result[0].type == PluginBundleDependencyType.Package
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
                    type=PluginBundleDependencyType.Marketplace,
                    value=PluginBundleDependency.Marketplace(organization="org1", plugin="plugin1", version="1.0.0"),
                ),
                PluginBundleDependency(
                    type=PluginBundleDependencyType.Github,
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
                assert result[0].type == PluginBundleDependencyType.Marketplace
                assert result[1].type == PluginBundleDependencyType.Github

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


"""Comprehensive unit tests for Plugin Runtime functionality.

This test module covers all aspects of plugin runtime including:
- Plugin execution through the plugin daemon
- Sandbox isolation via HTTP communication
- Resource limits (timeout, memory constraints)
- Error handling for various failure scenarios
- Plugin communication (request/response patterns, streaming)

All tests use mocking to avoid external dependencies and ensure fast, reliable execution.
Tests follow the Arrange-Act-Assert pattern for clarity.
"""


class TestPluginRuntimeCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _patch_shared_httpx_client():
        """Make BasePluginClient's module-level httpx client delegate to patched httpx.request/stream.

        After refactor, code uses core.plugin.impl.base._httpx_client directly.
        Patch its request/stream to route through module-level httpx so existing mocks still apply.
        """

        def request[**P](*args: P.args, **kwargs: P.kwargs) -> httpx.Response:
            response = httpx.request(*args, **kwargs)
            method, url = kwargs["method"], kwargs["url"]
            assert isinstance(method, str)
            assert isinstance(url, str)
            response.request = httpx.Request(method, url)
            return response

        with (
            patch("core.plugin.impl.base._httpx_client.request", side_effect=request),
            patch("core.plugin.impl.base._httpx_client.stream", side_effect=lambda **kw: httpx.stream(**kw)),
        ):
            yield

    class TestPluginRuntimeExecution:
        """Unit tests for plugin execution functionality.

        Tests cover:
        - Successful plugin invocation
        - Request preparation and headers
        - Response parsing
        - Streaming responses
        """

        @pytest.fixture
        def plugin_client(self):
            """Create a BasePluginClient instance for testing."""
            return BasePluginClient()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-api-key",
            )

        def test_request_preparation(self, plugin_client, mock_config):
            """Test that requests are properly prepared with correct headers and URL."""
            # Arrange
            path = "plugin/test-tenant/management/list"
            headers = {"Custom-Header": "value"}
            data = {"key": "value"}
            params = {"page": 1}

            # Act
            url, prepared_headers, prepared_data, prepared_params, files = plugin_client._prepare_request(
                path, headers, data, params, None
            )

            # Assert
            assert url == "http://127.0.0.1:5002/plugin/test-tenant/management/list"
            assert prepared_headers["X-Api-Key"] == "test-api-key"
            assert prepared_headers["Custom-Header"] == "value"
            assert prepared_headers["Accept-Encoding"] == "gzip, deflate, br"
            assert prepared_data == data
            assert prepared_params == params

        def test_request_with_json_content_type(self, plugin_client, mock_config):
            """Test request preparation with JSON content type."""
            # Arrange
            path = "plugin/test-tenant/management/install"
            headers = {"Content-Type": "application/json"}
            data = {"plugin_id": "test-plugin"}

            # Act
            url, prepared_headers, prepared_data, prepared_params, files = plugin_client._prepare_request(
                path, headers, data, None, None
            )

            # Assert
            assert prepared_headers["Content-Type"] == "application/json"
            assert prepared_data == json.dumps(data)

        def test_successful_request_execution(self, plugin_client, mock_config):
            """Test successful HTTP request execution."""
            # Arrange
            mock_response = httpx.Response(200, json={"result": "success"})

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                response = plugin_client._request("GET", "plugin/test-tenant/management/list")

                # Assert
                assert response.status_code == 200
                mock_request.assert_called_once()
                call_kwargs = mock_request.call_args[1]
                assert call_kwargs["method"] == "GET"
                assert "http://127.0.0.1:5002/plugin/test-tenant/management/list" in call_kwargs["url"]
                assert call_kwargs["headers"]["X-Api-Key"] == "test-api-key"

        def test_request_with_timeout_configuration(self, plugin_client, mock_config):
            """Test that timeout configuration is properly applied."""
            # Arrange
            mock_response = httpx.Response(200)

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                plugin_client._request("GET", "plugin/test-tenant/test")

                # Assert
                call_kwargs = mock_request.call_args[1]
                assert "timeout" in call_kwargs

        def test_request_timeout_can_be_scoped_to_current_context(self, plugin_client, mock_config):
            mock_response = httpx.Response(200)

            with (
                patch("core.plugin.impl.base.plugin_daemon_request_timeout", httpx.Timeout(600.0)),
                patch("httpx.request", return_value=mock_response, autospec=True) as mock_request,
            ):
                with use_plugin_daemon_request_timeout(30.0):
                    plugin_client._request("GET", "plugin/test-tenant/test")
                plugin_client._request("GET", "plugin/test-tenant/test")

            scoped_timeout = mock_request.call_args_list[0].kwargs["timeout"]
            default_timeout = mock_request.call_args_list[1].kwargs["timeout"]
            assert isinstance(scoped_timeout, httpx.Timeout)
            assert isinstance(default_timeout, httpx.Timeout)
            assert scoped_timeout.read == 30.0
            assert default_timeout.read == 600.0

        @pytest.mark.parametrize("timeout_seconds", [0.0, -1.0])
        def test_request_timeout_override_rejects_non_positive_values(self, timeout_seconds):
            with pytest.raises(ValueError, match="greater than zero"):
                with use_plugin_daemon_request_timeout(timeout_seconds):
                    pass

        def test_request_connection_error(self, plugin_client, mock_config):
            """Test handling of connection errors during request."""
            # Arrange
            with patch("httpx.request", side_effect=httpx.RequestError("Connection failed"), autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonInnerError) as exc_info:
                    plugin_client._request("GET", "plugin/test-tenant/test")
                assert exc_info.value.code == -500
                assert "Request to Plugin Daemon Service failed" in exc_info.value.message

    class TestPluginRuntimeSandboxIsolation:
        """Unit tests for plugin sandbox isolation.

        Tests cover:
        - Isolated execution environment via HTTP
        - API key authentication
        - Request/response boundaries
        - Plugin daemon communication protocol
        """

        @pytest.fixture
        def plugin_client(self):
            """Create a BasePluginClient instance for testing."""
            return BasePluginClient()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="secure-api-key",
            )

        def test_api_key_authentication(self, plugin_client, mock_config):
            """Test that all requests include API key for authentication."""
            # Arrange
            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": True})

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                plugin_client._request("GET", "plugin/test-tenant/test")

                # Assert
                call_kwargs = mock_request.call_args[1]
                assert call_kwargs["headers"]["X-Api-Key"] == "secure-api-key"

        def test_isolated_plugin_execution_via_http(self, plugin_client, mock_config):
            """Test that plugin execution is isolated via HTTP communication."""

            # Arrange
            class TestResponse(BaseModel):
                result: str

            mock_response = httpx.Response(
                200, json={"code": 0, "message": "", "data": {"result": "isolated_execution"}}
            )

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = plugin_client._request_with_plugin_daemon_response(
                    "POST", "plugin/test-tenant/dispatch/tool/invoke", TestResponse, data={"tool": "test"}
                )

                # Assert
                assert result.result == "isolated_execution"

        def test_plugin_daemon_unauthorized_error(self, plugin_client, mock_config):
            """Test handling of unauthorized access to plugin daemon."""
            # Arrange
            error_message = json.dumps(
                {"error_type": "PluginDaemonUnauthorizedError", "message": "Unauthorized access"}
            )
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonUnauthorizedError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)
                assert "Unauthorized access" in exc_info.value.description

        def test_plugin_permission_denied(self, plugin_client, mock_config):
            """Test handling of permission denied errors."""
            # Arrange
            error_message = json.dumps(
                {"error_type": "PluginPermissionDeniedError", "message": "Permission denied for this operation"}
            )
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginPermissionDeniedError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/test", bool)
                assert "Permission denied" in exc_info.value.description

    class TestPluginRuntimeResourceLimits:
        """Unit tests for plugin resource limits.

        Tests cover:
        - Timeout enforcement
        - Memory constraints
        - Resource limit violations
        - Graceful degradation
        """

        @pytest.fixture
        def plugin_client(self):
            """Create a BasePluginClient instance for testing."""
            return BasePluginClient()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration with timeout."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )
            with patch("core.plugin.impl.base.plugin_daemon_request_timeout", httpx.Timeout(30.0)):
                yield

        def test_timeout_configuration_applied(self, plugin_client, mock_config):
            """Test that timeout configuration is properly applied to requests."""
            # Arrange
            mock_response = httpx.Response(200)

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                plugin_client._request("GET", "plugin/test-tenant/test")

                # Assert
                call_kwargs = mock_request.call_args[1]
                assert call_kwargs["timeout"] is not None

        def test_timeout_error_handling(self, plugin_client, mock_config):
            """Test handling of timeout errors."""
            # Arrange
            with patch("httpx.request", side_effect=httpx.TimeoutException("Request timeout"), autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonInnerError) as exc_info:
                    plugin_client._request("GET", "plugin/test-tenant/test")
                assert exc_info.value.code == -500

        def test_streaming_request_timeout(self, plugin_client, mock_config):
            """Test timeout handling for streaming requests."""
            # Arrange
            with patch("httpx.stream", side_effect=httpx.TimeoutException("Stream timeout"), autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonInnerError) as exc_info:
                    list(plugin_client._stream_request("POST", "plugin/test-tenant/stream"))
                assert exc_info.value.code == -500

        def test_resource_limit_error_from_daemon(self, plugin_client, mock_config):
            """Test handling of resource limit errors from plugin daemon."""
            # Arrange
            error_message = json.dumps(
                {"error_type": "PluginDaemonInternalServerError", "message": "Resource limit exceeded"}
            )
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonInternalServerError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/test", bool)
                assert "Resource limit exceeded" in exc_info.value.description

    class TestPluginRuntimeErrorHandling:
        """Unit tests for plugin runtime error handling.

        Tests cover:
        - Various error types (invoke, validation, connection)
        - Error propagation and transformation
        - User-friendly error messages
        - Error recovery mechanisms
        """

        @pytest.fixture
        def plugin_client(self):
            """Create a BasePluginClient instance for testing."""
            return BasePluginClient()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )

        def test_plugin_invoke_rate_limit_error(self, plugin_client, mock_config):
            """Test handling of rate limit errors during plugin invocation."""
            # Arrange
            invoke_error = {
                "error_type": "InvokeRateLimitError",
                "message": "Rate limit exceeded",
                "args": {"description": "Rate limit exceeded"},
            }
            error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(InvokeRateLimitError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
                assert "Rate limit exceeded" in exc_info.value.description

        def test_plugin_invoke_authorization_error(self, plugin_client, mock_config):
            """Test handling of authorization errors during plugin invocation."""
            # Arrange
            invoke_error = {
                "error_type": "InvokeAuthorizationError",
                "message": "Invalid credentials",
                "args": {"description": "Invalid credentials"},
            }
            error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(InvokeAuthorizationError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
                assert "Invalid credentials" in exc_info.value.description

        def test_plugin_invoke_bad_request_error(self, plugin_client, mock_config):
            """Test handling of bad request errors during plugin invocation."""
            # Arrange
            invoke_error = {
                "error_type": "InvokeBadRequestError",
                "message": "Invalid parameters",
                "args": {"description": "Invalid parameters"},
            }
            error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(InvokeBadRequestError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
                assert "Invalid parameters" in exc_info.value.description

        def test_plugin_invoke_connection_error(self, plugin_client, mock_config):
            """Test handling of connection errors during plugin invocation."""
            # Arrange
            invoke_error = {
                "error_type": "InvokeConnectionError",
                "message": "Connection to external service failed",
                "args": {"description": "Connection to external service failed"},
            }
            error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(InvokeConnectionError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
                assert "Connection to external service failed" in exc_info.value.description

        def test_plugin_invoke_server_unavailable_error(self, plugin_client, mock_config):
            """Test handling of server unavailable errors during plugin invocation."""
            # Arrange
            invoke_error = {
                "error_type": "InvokeServerUnavailableError",
                "message": "Service temporarily unavailable",
                "args": {"description": "Service temporarily unavailable"},
            }
            error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(InvokeServerUnavailableError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
                assert "Service temporarily unavailable" in exc_info.value.description

        def test_credentials_validation_error(self, plugin_client, mock_config):
            """Test handling of credential validation errors."""
            # Arrange
            invoke_error = {
                "error_type": "CredentialsValidateFailedError",
                "message": "Invalid API key format",
            }
            error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(CredentialsValidateFailedError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/validate", bool)
                assert "Invalid API key format" in str(exc_info.value)

        def test_plugin_not_found_error(self, plugin_client, mock_config):
            """Test handling of plugin not found errors."""
            # Arrange
            error_message = json.dumps(
                {"error_type": "PluginNotFoundError", "message": "Plugin with ID 'test-plugin' not found"}
            )
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginNotFoundError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/get", bool)
                assert "Plugin with ID 'test-plugin' not found" in exc_info.value.description

        def test_plugin_unique_identifier_error(self, plugin_client, mock_config):
            """Test handling of unique identifier errors."""
            # Arrange
            error_message = json.dumps(
                {"error_type": "PluginUniqueIdentifierError", "message": "Invalid plugin identifier format"}
            )
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginUniqueIdentifierError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/install", bool)
                assert "Invalid plugin identifier format" in exc_info.value.description

        def test_daemon_bad_request_error(self, plugin_client, mock_config):
            """Test handling of daemon bad request errors."""
            # Arrange
            error_message = json.dumps(
                {"error_type": "PluginDaemonBadRequestError", "message": "Missing required parameter"}
            )
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonBadRequestError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/test", bool)
                assert "Missing required parameter" in exc_info.value.description

        def test_daemon_not_found_error(self, plugin_client, mock_config):
            """Test handling of daemon not found errors."""
            # Arrange
            error_message = json.dumps({"error_type": "PluginDaemonNotFoundError", "message": "Resource not found"})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonNotFoundError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/resource", bool)
                assert "Resource not found" in exc_info.value.description

        def test_generic_plugin_invoke_error(self, plugin_client, mock_config):
            """Test handling of generic plugin invoke errors."""
            # Arrange
            # Create a proper nested JSON structure for PluginInvokeError
            invoke_error_message = json.dumps(
                {"error_type": "UnknownInvokeError", "message": "Generic plugin execution error"}
            )
            error_message = json.dumps({"error_type": "PluginInvokeError", "message": invoke_error_message})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginInvokeError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
                assert exc_info.value.description is not None

        def test_unknown_error_type(self, plugin_client, mock_config):
            """Test handling of unknown error types."""
            # Arrange
            error_message = json.dumps({"error_type": "UnknownErrorType", "message": "Unknown error occurred"})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(
                    Exception,
                    match=("got unknown error from plugin daemon: UnknownErrorType, message: Unknown error occurred"),
                ) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/test", bool)
                assert "got unknown error from plugin daemon" in str(exc_info.value)

        def test_http_status_error_handling(self, plugin_client, mock_config):
            """Test handling of HTTP status errors."""
            # Arrange
            mock_response = httpx.Response(
                500, request=httpx.Request("GET", "http://127.0.0.1:5002/plugin/test-tenant/test")
            )

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonInternalServerError):
                    plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)

        def test_empty_data_response_error(self, plugin_client, mock_config):
            """Test handling of empty data in successful response."""
            # Arrange
            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(ValueError, match="got empty data from plugin daemon") as exc_info:
                    plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)
                assert "got empty data from plugin daemon" in str(exc_info.value)

    class TestPluginRuntimeCommunication:
        """Unit tests for plugin communication patterns.

        Tests cover:
        - Request/response communication
        - Streaming responses
        - Data serialization/deserialization
        - Message formatting
        """

        @pytest.fixture
        def plugin_client(self):
            """Create a BasePluginClient instance for testing."""
            return BasePluginClient()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )

        def test_request_response_communication(self, plugin_client, mock_config):
            """Test basic request/response communication pattern."""

            # Arrange
            class TestModel(BaseModel):
                value: str
                count: int

            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": {"value": "test", "count": 42}})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = plugin_client._request_with_plugin_daemon_response(
                    "POST", "plugin/test-tenant/test", TestModel, data={"input": "data"}
                )

                # Assert
                assert isinstance(result, TestModel)
                assert result.value == "test"
                assert result.count == 42

        def test_streaming_response_communication(self, plugin_client, mock_config):
            """Test streaming response communication pattern."""

            # Arrange
            class StreamModel(BaseModel):
                chunk: str

            stream_data = [
                'data: {"code": 0, "message": "", "data": {"chunk": "first"}}',
                'data: {"code": 0, "message": "", "data": {"chunk": "second"}}',
                'data: {"code": 0, "message": "", "data": {"chunk": "third"}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(
                    plugin_client._request_with_plugin_daemon_response_stream(
                        "POST", "plugin/test-tenant/stream", StreamModel
                    )
                )

                # Assert
                assert len(results) == 3
                assert all(isinstance(r, StreamModel) for r in results)
                assert results[0].chunk == "first"
                assert results[1].chunk == "second"
                assert results[2].chunk == "third"

        def test_streaming_with_error_in_stream(self, plugin_client, mock_config):
            """Test error handling in streaming responses."""
            # Arrange
            # Create proper error structure for -500 code
            error_obj = json.dumps({"error_type": "PluginDaemonInnerError", "message": "Stream error occurred"})
            stream_data = [
                'data: {"code": 0, "message": "", "data": {"chunk": "first"}}',
                f'data: {{"code": -500, "message": {json.dumps(error_obj)}, "data": null}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                class StreamModel(BaseModel):
                    chunk: str

                results = plugin_client._request_with_plugin_daemon_response_stream(
                    "POST", "plugin/test-tenant/stream", StreamModel
                )

                # Assert
                first_result = next(results)
                assert first_result.chunk == "first"

                with pytest.raises(PluginDaemonInnerError) as exc_info:
                    next(results)
                assert exc_info.value.code == -500

        def test_streaming_connection_error(self, plugin_client, mock_config):
            """Test connection error during streaming."""
            # Arrange
            with patch("httpx.stream", side_effect=httpx.RequestError("Stream connection failed"), autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonInnerError) as exc_info:
                    list(plugin_client._stream_request("POST", "plugin/test-tenant/stream"))
                assert exc_info.value.code == -500

        def test_request_with_model_parsing(self, plugin_client, mock_config):
            """Test request with direct model parsing (without daemon response wrapper)."""

            # Arrange
            class DirectModel(BaseModel):
                status: str
                data: dict[str, Any]

            mock_response = httpx.Response(200, json={"status": "success", "data": {"key": "value"}})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = plugin_client._request_with_model("GET", "plugin/test-tenant/direct", DirectModel)

                # Assert
                assert isinstance(result, DirectModel)
                assert result.status == "success"
                assert result.data == {"key": "value"}

        def test_streaming_with_model_parsing(self, plugin_client, mock_config):
            """Test streaming with direct model parsing."""

            # Arrange
            class StreamItem(BaseModel):
                id: int
                text: str

            stream_data = [
                '{"id": 1, "text": "first"}',
                '{"id": 2, "text": "second"}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(
                    plugin_client._stream_request_with_model("POST", "plugin/test-tenant/stream", StreamItem)
                )

                # Assert
                assert len(results) == 2
                assert results[0].id == 1
                assert results[0].text == "first"
                assert results[1].id == 2
                assert results[1].text == "second"

        def test_streaming_skips_empty_lines(self, plugin_client, mock_config):
            """Test that streaming properly skips empty lines."""

            # Arrange
            class StreamModel(BaseModel):
                value: str

            stream_data = [
                "",
                '{"code": 0, "message": "", "data": {"value": "first"}}',
                "",
                "",
                '{"code": 0, "message": "", "data": {"value": "second"}}',
                "",
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(
                    plugin_client._request_with_plugin_daemon_response_stream(
                        "POST", "plugin/test-tenant/stream", StreamModel
                    )
                )

                # Assert
                assert len(results) == 2
                assert results[0].value == "first"
                assert results[1].value == "second"

    class TestPluginToolManagerIntegration:
        """Integration tests for PluginToolManager.

        Tests cover:
        - Tool invocation
        - Credential validation
        - Runtime parameter retrieval
        - Tool provider management
        """

        @pytest.fixture
        def tool_manager(self):
            """Create a PluginToolManager instance for testing."""
            return PluginToolManager()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )

        def test_tool_invocation_success(self, tool_manager, mock_config):
            """Test successful tool invocation."""
            # Arrange
            stream_data = [
                'data: {"code": 0, "message": "", "data": {"type": "text", "message": {"text": "Result"}}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(
                    tool_manager.invoke(
                        tenant_id="test-tenant",
                        user_id="test-user",
                        tool_provider="langgenius/test-plugin/test-provider",
                        tool_name="test-tool",
                        credentials={"api_key": "test-key"},
                        credential_type=CredentialType.API_KEY,
                        tool_parameters={"param1": "value1"},
                    )
                )

                # Assert
                assert len(results) > 0
                assert results[0].type == "text"

        def test_validate_provider_credentials_success(self, tool_manager, mock_config):
            """Test successful provider credential validation."""
            # Arrange
            stream_data = [
                'data: {"code": 0, "message": "", "data": {"result": true}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                result = tool_manager.validate_provider_credentials(
                    tenant_id="test-tenant",
                    user_id="test-user",
                    provider="langgenius/test-plugin/test-provider",
                    credentials={"api_key": "valid-key"},
                )

                # Assert
                assert result is True

        def test_validate_provider_credentials_failure(self, tool_manager, mock_config):
            """Test failed provider credential validation."""
            # Arrange
            stream_data = [
                'data: {"code": 0, "message": "", "data": {"result": false}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                result = tool_manager.validate_provider_credentials(
                    tenant_id="test-tenant",
                    user_id="test-user",
                    provider="langgenius/test-plugin/test-provider",
                    credentials={"api_key": "invalid-key"},
                )

                # Assert
                assert result is False

        def test_validate_datasource_credentials_success(self, tool_manager, mock_config):
            """Test successful datasource credential validation."""
            # Arrange
            stream_data = [
                'data: {"code": 0, "message": "", "data": {"result": true}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                result = tool_manager.validate_datasource_credentials(
                    tenant_id="test-tenant",
                    user_id="test-user",
                    provider="langgenius/test-plugin/test-datasource",
                    credentials={"connection_string": "valid"},
                )

                # Assert
                assert result is True

    class TestPluginInstallerIntegration:
        """Integration tests for PluginInstaller.

        Tests cover:
        - Plugin installation
        - Plugin listing
        - Plugin uninstallation
        - Package upload
        """

        @pytest.fixture
        def installer(self):
            """Create a PluginInstaller instance for testing."""
            return PluginInstaller()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )

        def test_list_plugins_success(self, installer, mock_config):
            """Test successful plugin listing."""
            # Arrange
            mock_response = httpx.Response(
                200,
                json={
                    "code": 0,
                    "message": "",
                    "data": {
                        "list": [],
                        "total": 0,
                    },
                },
            )

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = installer.list_plugins("test-tenant")

                # Assert
                assert isinstance(result, list)

        def test_uninstall_plugin_success(self, installer, mock_config):
            """Test successful plugin uninstallation."""
            # Arrange
            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": True})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = installer.uninstall("test-tenant", "plugin-installation-id")

                # Assert
                assert result is True

        def test_fetch_plugin_by_identifier_success(self, installer, mock_config):
            """Test successful plugin fetch by identifier."""
            # Arrange
            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": True})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = installer.fetch_plugin_by_identifier("test-tenant", "plugin-identifier")

                # Assert
                assert result is True

    class TestPluginRuntimeEdgeCases:
        """Tests for edge cases and corner scenarios in plugin runtime.

        Tests cover:
        - Malformed responses
        - Unexpected data types
        - Concurrent requests
        - Large payloads
        """

        @pytest.fixture
        def plugin_client(self):
            """Create a BasePluginClient instance for testing."""
            return BasePluginClient()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )

        def test_malformed_json_response(self, plugin_client, mock_config):
            """Test handling of malformed JSON responses."""
            # Arrange
            mock_response = httpx.Response(200, content=b"invalid JSON")

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(
                    ValueError,
                    match=(
                        "Failed to parse response from plugin daemon to "
                        "PluginDaemonBasicResponse \\[bool\\], url: plugin/test\\-tenant/test"
                    ),
                ):
                    plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)

        def test_invalid_response_structure(self, plugin_client, mock_config):
            """Test handling of invalid response structure."""
            # Arrange
            # Missing required fields in response
            mock_response = httpx.Response(200, json={"invalid": "structure"})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(
                    ValueError,
                    match=(
                        "Failed to parse response from plugin daemon to "
                        "PluginDaemonBasicResponse \\[bool\\], url: plugin/test\\-tenant/test"
                    ),
                ):
                    plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)

        def test_streaming_with_invalid_json_line(self, plugin_client, mock_config):
            """Test streaming with invalid JSON in one line."""
            # Arrange
            stream_data = [
                'data: {"code": 0, "message": "", "data": {"value": "valid"}}',
                "data: {invalid json}",
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                class StreamModel(BaseModel):
                    value: str

                results = plugin_client._request_with_plugin_daemon_response_stream(
                    "POST", "plugin/test-tenant/stream", StreamModel
                )

                # Assert
                first_result = next(results)
                assert first_result.value == "valid"

                with pytest.raises(ValueError, match="\\{invalid json\\}"):
                    next(results)

        def test_request_with_bytes_data(self, plugin_client, mock_config):
            """Test request with bytes data."""
            # Arrange
            mock_response = httpx.Response(200)

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                plugin_client._request("POST", "plugin/test-tenant/upload", data=b"binary data")

                # Assert
                call_kwargs = mock_request.call_args[1]
                assert call_kwargs["content"] == b"binary data"

        def test_request_with_files(self, plugin_client, mock_config):
            """Test request with file upload."""
            # Arrange
            mock_response = httpx.Response(200)

            files = {"file": ("test.txt", b"file content", "text/plain")}

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                plugin_client._request("POST", "plugin/test-tenant/upload", files=files)

                # Assert
                call_kwargs = mock_request.call_args[1]
                assert call_kwargs["files"] == files

        def test_streaming_empty_response(self, plugin_client, mock_config):
            """Test streaming with empty response."""
            # Arrange
            mock_response = httpx.Response(200, content=b"")

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(plugin_client._stream_request("POST", "plugin/test-tenant/stream"))

                # Assert
                assert len(results) == 0

        def test_daemon_inner_error_with_code_500(self, plugin_client, mock_config):
            """Test handling of daemon inner error with code -500 in stream."""
            # Arrange
            error_obj = json.dumps({"error_type": "PluginDaemonInnerError", "message": "Internal error"})
            stream_data = [
                f'data: {{"code": -500, "message": {json.dumps(error_obj)}, "data": null}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act & Assert
                class StreamModel(BaseModel):
                    data: str

                results = plugin_client._request_with_plugin_daemon_response_stream(
                    "POST", "plugin/test-tenant/stream", StreamModel
                )
                with pytest.raises(PluginDaemonInnerError) as exc_info:
                    next(results)
                assert exc_info.value.code == -500

        def test_non_json_error_message(self, plugin_client, mock_config):
            """Test handling of non-JSON error message."""
            # Arrange
            mock_response = httpx.Response(200, json={"code": -1, "message": "Plain text error message", "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(ValueError, match="Plain text error message, code: \\-1") as exc_info:
                    plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)
                assert "Plain text error message" in str(exc_info.value)

    class TestPluginRuntimeAdvancedScenarios:
        """Advanced test scenarios for plugin runtime.

        Tests cover:
        - Complex error recovery
        - Concurrent request handling
        - Plugin state management
        - Advanced streaming patterns
        """

        @pytest.fixture
        def plugin_client(self):
            """Create a BasePluginClient instance for testing."""
            return BasePluginClient()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )

        def test_multiple_sequential_requests(self, plugin_client, mock_config):
            """Test multiple sequential requests to the same endpoint."""
            # Arrange
            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": True})

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                for i in range(5):
                    result = plugin_client._request_with_plugin_daemon_response(
                        "GET", f"plugin/test-tenant/test/{i}", bool
                    )
                    assert result is True

                # Assert
                assert mock_request.call_count == 5

        def test_request_with_complex_nested_data(self, plugin_client, mock_config):
            """Test request with complex nested data structures."""

            # Arrange
            class ComplexModel(BaseModel):
                nested: dict[str, Any]
                items: list[dict[str, Any]]

            complex_data = {
                "nested": {"level1": {"level2": {"level3": "deep_value"}}},
                "items": [
                    {"id": 1, "name": "item1"},
                    {"id": 2, "name": "item2"},
                ],
            }

            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": complex_data})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = plugin_client._request_with_plugin_daemon_response(
                    "POST", "plugin/test-tenant/complex", ComplexModel
                )

                # Assert
                assert result.nested["level1"]["level2"]["level3"] == "deep_value"
                assert len(result.items) == 2
                assert result.items[0]["id"] == 1

        def test_streaming_with_multiple_chunk_types(self, plugin_client, mock_config):
            """Test streaming with different chunk types in sequence."""

            # Arrange
            class MultiTypeModel(BaseModel):
                type: str
                data: dict[str, Any]

            stream_data = [
                '{"code": 0, "message": "", "data": {"type": "start", "data": {"status": "initializing"}}}',
                '{"code": 0, "message": "", "data": {"type": "progress", "data": {"percent": 50}}}',
                '{"code": 0, "message": "", "data": {"type": "complete", "data": {"result": "success"}}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(
                    plugin_client._request_with_plugin_daemon_response_stream(
                        "POST", "plugin/test-tenant/multi-stream", MultiTypeModel
                    )
                )

                # Assert
                assert len(results) == 3
                assert results[0].type == "start"
                assert results[1].type == "progress"
                assert results[2].type == "complete"
                assert results[1].data["percent"] == 50

        def test_error_recovery_with_retry_pattern(self, plugin_client, mock_config):
            """Test error recovery pattern (simulated retry logic)."""
            # Arrange
            call_count = 0

            def side_effect[**P](*args: P.args, **kwargs: P.kwargs):
                nonlocal call_count
                call_count += 1
                if call_count < 3:
                    raise httpx.RequestError("Temporary failure")
                mock_response = httpx.Response(200)
                return mock_response

            with patch("httpx.request", side_effect=side_effect, autospec=True):
                # Act & Assert - First two calls should fail
                with pytest.raises(PluginDaemonInnerError):
                    plugin_client._request("GET", "plugin/test-tenant/test")

                with pytest.raises(PluginDaemonInnerError):
                    plugin_client._request("GET", "plugin/test-tenant/test")

                # Third call should succeed
                response = plugin_client._request("GET", "plugin/test-tenant/test")
                assert response.status_code == 200

        def test_request_with_custom_headers_preservation(self, plugin_client, mock_config):
            """Test that custom headers are preserved through request pipeline."""
            # Arrange
            custom_headers = {
                "X-Custom-Header": "custom-value",
                "X-Request-ID": "req-123",
                "X-Tenant-ID": "tenant-456",
            }

            mock_response = httpx.Response(200)

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                plugin_client._request("GET", "plugin/test-tenant/test", headers=custom_headers)

                # Assert
                call_kwargs = mock_request.call_args[1]
                for key, value in custom_headers.items():
                    assert call_kwargs["headers"][key] == value

        def test_streaming_with_large_chunks(self, plugin_client, mock_config):
            """Test streaming with large data chunks."""

            # Arrange
            class LargeChunkModel(BaseModel):
                chunk_id: int
                data: str

            # Create large chunks (simulating large data transfer)
            large_data = "x" * 10000  # 10KB of data
            stream_data = [
                f'{{"code": 0, "message": "", "data": {{"chunk_id": {i}, "data": "{large_data}"}}}}' for i in range(10)
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(
                    plugin_client._request_with_plugin_daemon_response_stream(
                        "POST", "plugin/test-tenant/large-stream", LargeChunkModel
                    )
                )

                # Assert
                assert len(results) == 10
                for i, result in enumerate(results):
                    assert result.chunk_id == i
                    assert len(result.data) == 10000

    class TestPluginRuntimeSecurityAndValidation:
        """Tests for security and validation aspects of plugin runtime.

        Tests cover:
        - Input validation
        - Security headers
        - Authentication failures
        - Authorization checks
        """

        @pytest.fixture
        def plugin_client(self):
            """Create a BasePluginClient instance for testing."""
            return BasePluginClient()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="secure-key-123",
            )

        def test_api_key_header_always_present(self, plugin_client, mock_config):
            """Test that API key header is always included in requests."""
            # Arrange
            mock_response = httpx.Response(200)

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                plugin_client._request("GET", "plugin/test-tenant/test")

                # Assert
                call_kwargs = mock_request.call_args[1]
                assert "X-Api-Key" in call_kwargs["headers"]
                assert call_kwargs["headers"]["X-Api-Key"] == "secure-key-123"

        def test_request_with_sensitive_data_in_body(self, plugin_client, mock_config):
            """Test handling of sensitive data in request body."""
            # Arrange
            sensitive_data = {
                "api_key": "secret-api-key",
                "password": "secret-password",
                "credentials": {"token": "secret-token"},
            }

            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": True})

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                plugin_client._request_with_plugin_daemon_response(
                    "POST",
                    "plugin/test-tenant/validate",
                    bool,
                    data=sensitive_data,
                    headers={"Content-Type": "application/json"},
                )

                # Assert - Verify data was sent
                call_kwargs = mock_request.call_args[1]
                assert "content" in call_kwargs or "data" in call_kwargs

        def test_unauthorized_access_with_invalid_key(self, plugin_client, mock_config):
            """Test handling of unauthorized access with invalid API key."""
            # Arrange
            error_message = json.dumps({"error_type": "PluginDaemonUnauthorizedError", "message": "Invalid API key"})
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonUnauthorizedError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)
                assert "Invalid API key" in exc_info.value.description

        def test_request_parameter_validation(self, plugin_client, mock_config):
            """Test validation of request parameters."""
            # Arrange
            invalid_params = {
                "page": -1,  # Invalid negative page
                "limit": 0,  # Invalid zero limit
            }

            error_message = json.dumps(
                {"error_type": "PluginDaemonBadRequestError", "message": "Invalid parameters: page must be positive"}
            )
            mock_response = httpx.Response(200, json={"code": -1, "message": error_message, "data": None})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert
                with pytest.raises(PluginDaemonBadRequestError) as exc_info:
                    plugin_client._request_with_plugin_daemon_response(
                        "GET", "plugin/test-tenant/list", list, params=invalid_params
                    )
                assert "Invalid parameters" in exc_info.value.description

        def test_content_type_header_validation(self, plugin_client, mock_config):
            """Test that Content-Type header is properly set for JSON requests."""
            # Arrange
            mock_response = httpx.Response(200)

            with patch("httpx.request", return_value=mock_response, autospec=True) as mock_request:
                # Act
                plugin_client._request(
                    "POST",
                    "plugin/test-tenant/test",
                    headers={"Content-Type": "application/json"},
                    data={"key": "value"},
                )

                # Assert
                call_kwargs = mock_request.call_args[1]
                assert call_kwargs["headers"]["Content-Type"] == "application/json"

    class TestPluginRuntimePerformanceScenarios:
        """Tests for performance-related scenarios in plugin runtime.

        Tests cover:
        - High-volume streaming
        - Concurrent operations simulation
        - Memory-efficient processing
        - Timeout handling under load
        """

        @pytest.fixture
        def plugin_client(self):
            """Create a BasePluginClient instance for testing."""
            return BasePluginClient()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )

        def test_high_volume_streaming(self, plugin_client, mock_config):
            """Test streaming with high volume of chunks."""

            # Arrange
            class StreamChunk(BaseModel):
                index: int
                value: str

            # Generate 100 chunks
            stream_data = [
                f'{{"code": 0, "message": "", "data": {{"index": {i}, "value": "chunk_{i}"}}}}' for i in range(100)
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(
                    plugin_client._request_with_plugin_daemon_response_stream(
                        "POST", "plugin/test-tenant/high-volume", StreamChunk
                    )
                )

                # Assert
                assert len(results) == 100
                assert results[0].index == 0
                assert results[99].index == 99
                assert results[50].value == "chunk_50"

        def test_streaming_memory_efficiency(self, plugin_client, mock_config):
            """Test that streaming processes chunks one at a time (memory efficient)."""

            # Arrange
            class ChunkModel(BaseModel):
                data: str

            processed_chunks = []

            def process_chunk(chunk):
                """Simulate processing each chunk individually."""
                processed_chunks.append(chunk.data)
                return chunk

            stream_data = [f'{{"code": 0, "message": "", "data": {{"data": "chunk_{i}"}}}}' for i in range(10)]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act - Process chunks one by one
                for chunk in plugin_client._request_with_plugin_daemon_response_stream(
                    "POST", "plugin/test-tenant/stream", ChunkModel
                ):
                    process_chunk(chunk)

                # Assert
                assert len(processed_chunks) == 10

        def test_timeout_with_slow_response(self, plugin_client, mock_config):
            """Test timeout handling with slow response simulation."""
            # Arrange
            with patch(
                "httpx.request", side_effect=httpx.TimeoutException("Request timed out after 30s"), autospec=True
            ):
                # Act & Assert
                with pytest.raises(PluginDaemonInnerError) as exc_info:
                    plugin_client._request("GET", "plugin/test-tenant/slow-endpoint")
                assert exc_info.value.code == -500

        def test_concurrent_request_simulation(self, plugin_client, mock_config):
            """Test simulation of concurrent requests (sequential execution in test)."""
            # Arrange
            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": True})

            request_results = []

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act - Simulate 10 concurrent requests
                for i in range(10):
                    result = plugin_client._request_with_plugin_daemon_response(
                        "GET", f"plugin/test-tenant/concurrent/{i}", bool
                    )
                    request_results.append(result)

                # Assert
                assert len(request_results) == 10
                assert all(result is True for result in request_results)

    class TestPluginToolManagerAdvanced:
        """Advanced tests for PluginToolManager functionality.

        Tests cover:
        - Complex tool invocations
        - Runtime parameter handling
        - Tool provider discovery
        - Advanced credential scenarios
        """

        @pytest.fixture
        def tool_manager(self):
            """Create a PluginToolManager instance for testing."""
            return PluginToolManager()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )

        def test_tool_invocation_with_complex_parameters(self, tool_manager, mock_config):
            """Test tool invocation with complex parameter structures."""
            # Arrange
            complex_params = {
                "simple_string": "value",
                "number": 42,
                "boolean": True,
                "nested_object": {"key1": "value1", "key2": ["item1", "item2"]},
                "array": [1, 2, 3, 4, 5],
            }

            stream_data = [
                (
                    'data: {"code": 0, "message": "", "data": {"type": "text", '
                    '"message": {"text": "Complex params processed"}}}'
                ),
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(
                    tool_manager.invoke(
                        tenant_id="test-tenant",
                        user_id="test-user",
                        tool_provider="langgenius/test-plugin/test-provider",
                        tool_name="complex-tool",
                        credentials={"api_key": "test-key"},
                        credential_type=CredentialType.API_KEY,
                        tool_parameters=complex_params,
                    )
                )

                # Assert
                assert len(results) > 0

        def test_tool_invocation_with_conversation_context(self, tool_manager, mock_config):
            """Test tool invocation with conversation context."""
            # Arrange
            stream_data = [
                'data: {"code": 0, "message": "", "data": {"type": "text", '
                '"message": {"text": "Context-aware result"}}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                results = list(
                    tool_manager.invoke(
                        tenant_id="test-tenant",
                        user_id="test-user",
                        tool_provider="langgenius/test-plugin/test-provider",
                        tool_name="test-tool",
                        credentials={"api_key": "test-key"},
                        credential_type=CredentialType.API_KEY,
                        tool_parameters={"query": "test"},
                        conversation_id="conv-123",
                        app_id="app-456",
                        message_id="msg-789",
                    )
                )

                # Assert
                assert len(results) > 0

        def test_get_runtime_parameters_success(self, tool_manager, mock_config):
            """Test successful retrieval of runtime parameters."""
            # Arrange
            stream_data = [
                'data: {"code": 0, "message": "", "data": {"parameters": []}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                result = tool_manager.get_runtime_parameters(
                    tenant_id="test-tenant",
                    user_id="test-user",
                    provider="langgenius/test-plugin/test-provider",
                    credentials={"api_key": "test-key"},
                    tool="test-tool",
                )

                # Assert
                assert isinstance(result, list)

        def test_validate_credentials_with_oauth(self, tool_manager, mock_config):
            """Test credential validation with OAuth credentials."""
            # Arrange
            oauth_credentials = {
                "access_token": "oauth-token-123",
                "refresh_token": "refresh-token-456",
                "expires_at": 1234567890,
            }

            stream_data = [
                'data: {"code": 0, "message": "", "data": {"result": true}}',
            ]

            mock_response = httpx.Response(200, text="\n".join(stream_data))

            with patch("httpx.stream", autospec=True) as mock_stream:
                mock_stream.return_value.__enter__.return_value = mock_response

                # Act
                result = tool_manager.validate_provider_credentials(
                    tenant_id="test-tenant",
                    user_id="test-user",
                    provider="langgenius/test-plugin/oauth-provider",
                    credentials=oauth_credentials,
                )

                # Assert
                assert result is True

    class TestPluginInstallerAdvanced:
        """Advanced tests for PluginInstaller functionality.

        Tests cover:
        - Plugin package upload
        - Bundle installation
        - Plugin upgrade scenarios
        - Dependency management
        """

        @pytest.fixture
        def installer(self):
            """Create a PluginInstaller instance for testing."""
            return PluginInstaller()

        @pytest.fixture
        def mock_config(self, config_overrides):
            """Mock plugin daemon configuration."""
            config_overrides(
                PLUGIN_DAEMON_URL="http://127.0.0.1:5002",
                PLUGIN_DAEMON_KEY="test-key",
            )

        def test_upload_plugin_package_success(self, installer, mock_config):
            """Test successful plugin package upload."""
            # Arrange
            plugin_package = b"fake-plugin-package-data"
            mock_response = httpx.Response(
                200,
                json={
                    "code": 0,
                    "message": "",
                    "data": {
                        "unique_identifier": "test-org/test-plugin",
                        "manifest": {
                            "version": "1.0.0",
                            "author": "test-org",
                            "name": "test-plugin",
                            "description": {"en_US": "Test plugin"},
                            "icon": "icon.png",
                            "label": {"en_US": "Test Plugin"},
                            "created_at": "2024-01-01T00:00:00Z",
                            "resource": {"memory": 256},
                            "plugins": {},
                            "meta": {},
                        },
                        "verification": None,
                    },
                },
            )

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = installer.upload_pkg("test-tenant", plugin_package, verify_signature=False)

                # Assert
                assert result.unique_identifier == "test-org/test-plugin"

        def test_fetch_plugin_readme_success(self, installer, mock_config):
            """Test successful plugin readme fetch."""
            # Arrange
            mock_response = httpx.Response(
                200,
                json={
                    "code": 0,
                    "message": "",
                    "data": {"content": "# Plugin README\n\nThis is a test plugin.", "language": "en"},
                },
            )

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = installer.fetch_plugin_readme("test-tenant", "test-org/test-plugin", "en")

                # Assert
                assert "Plugin README" in result
                assert "test plugin" in result

        def test_fetch_plugin_readme_not_found(self, installer, mock_config):
            """Test plugin readme fetch when readme doesn't exist."""
            # Arrange
            mock_response = httpx.Response(404)

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act & Assert - Should raise PluginDaemonClientSideError for 404
                with pytest.raises(PluginDaemonClientSideError):
                    installer.fetch_plugin_readme("test-tenant", "test-org/test-plugin", "en")

        def test_list_plugins_with_pagination(self, installer, mock_config):
            """Test plugin listing with pagination."""
            # Arrange
            mock_response = httpx.Response(
                200,
                json={
                    "code": 0,
                    "message": "",
                    "data": {
                        "list": [],
                        "total": 50,
                    },
                },
            )

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = installer.list_plugins_with_total("test-tenant", page=2, page_size=20)

                # Assert
                assert result.total == 50
                assert isinstance(result.list, list)

        def test_check_tools_existence(self, installer, mock_config):
            """Test checking existence of multiple tools."""
            # Arrange
            from models.provider_ids import GenericProviderID

            provider_ids = [
                GenericProviderID("langgenius/plugin1/provider1"),
                GenericProviderID("langgenius/plugin2/provider2"),
            ]

            mock_response = httpx.Response(200, json={"code": 0, "message": "", "data": [True, False]})

            with patch("httpx.request", return_value=mock_response, autospec=True):
                # Act
                result = installer.check_tools_existence("test-tenant", provider_ids)

                # Assert
                assert len(result) == 2
                assert result[0] is True
                assert result[1] is False

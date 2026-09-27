"""Tests for services.plugin.dependencies_analysis.DependenciesAnalysisService.

Covers: provider ID resolution, leaked dependency detection with version
extraction, dependency generation from multiple sources, and latest
dependencies via marketplace.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from core.plugin.entities.plugin import PluginDependency, PluginDependencyType, PluginInstallationSource
from services.plugin.dependencies_analysis import DependenciesAnalysisService


class TestAnalyzeToolDependency:
    def test_valid_three_part_id(self):
        result = DependenciesAnalysisService.analyze_tool_dependency("langgenius/google/google")
        assert result == "langgenius/google"

    def test_single_part_expands_to_langgenius(self):
        result = DependenciesAnalysisService.analyze_tool_dependency("websearch")
        assert result == "langgenius/websearch"

    def test_invalid_format_raises(self):
        with pytest.raises(ValueError):
            DependenciesAnalysisService.analyze_tool_dependency("bad/format")

    def test_plugin_id_reference_is_preserved(self):
        assert DependenciesAnalysisService.analyze_tool_provider_reference("acme/search") == "acme/search"


class TestAnalyzeModelProviderDependency:
    def test_valid_three_part_id(self):
        result = DependenciesAnalysisService.analyze_model_provider_dependency("langgenius/openai/openai")
        assert result == "langgenius/openai"

    def test_google_maps_to_gemini(self):
        result = DependenciesAnalysisService.analyze_model_provider_dependency("langgenius/google/google")
        assert result == "langgenius/gemini"

    def test_single_part_expands(self):
        result = DependenciesAnalysisService.analyze_model_provider_dependency("anthropic")
        assert result == "langgenius/anthropic"


class TestExtractExternalNodeDependencies:
    def test_legacy_agent_includes_strategy_and_plugin_tools(self):
        node_data = {
            "type": "agent",
            "agent_strategy_provider_name": "langgenius/agent/agent",
            "agent_parameters": {
                "tools": {
                    "value": [
                        {"type": "builtin", "provider_name": "langgenius/search/search"},
                        {"provider_type": "plugin", "plugin_id": "acme/custom"},
                        {"type": "api", "provider_name": "custom-api"},
                        {"type": "builtin", "provider_name": "bad/provider/format/extra"},
                    ]
                }
            },
        }

        assert DependenciesAnalysisService.extract_external_node_dependencies(node_data) == [
            "langgenius/agent",
            "langgenius/search",
            "acme/custom",
        ]

    def test_legacy_agent_accepts_plugin_id_strategy_and_legacy_tool_provider(self):
        node_data = {
            "type": "agent",
            "agent_strategy_provider_name": "acme/strategy",
            "agent_parameters": {
                "tools": {
                    "value": [
                        {"provider_type": "builtin", "provider": "acme/legacy"},
                        {"type": "builtin", "provider_name": "search"},
                    ]
                },
                "unrelated": {"value": "text"},
            },
        }

        assert DependenciesAnalysisService.extract_external_node_dependencies(node_data) == [
            "acme/strategy",
            "acme/legacy",
            "langgenius/search",
        ]

    def test_legacy_agent_skips_invalid_strategy_and_non_tool_parameters(self):
        node_data = {
            "type": "agent",
            "agent_strategy_provider_name": "invalid/provider/with/extra",
            "agent_parameters": {"choices": {"value": ["plain text", {"type": "api", "provider_id": "custom-api"}]}},
        }

        assert DependenciesAnalysisService.extract_external_node_dependencies(node_data) == []

    @pytest.mark.parametrize(
        ("node_data", "expected"),
        [
            ({"type": "trigger-plugin", "plugin_id": "acme/trigger"}, ["acme/trigger"]),
            ({"type": "datasource", "provider_type": "online_document", "plugin_id": "acme/drive"}, ["acme/drive"]),
            ({"type": "datasource", "provider_type": "local_file", "plugin_id": "langgenius/file"}, []),
            ({"type": "agent", "agent_node_kind": "dify_agent"}, []),
            ({"type": "agent", "agent_parameters": "invalid"}, []),
        ],
    )
    def test_direct_plugin_references(self, node_data, expected):
        assert DependenciesAnalysisService.extract_external_node_dependencies(node_data) == expected


class TestGetLeakedDependencies:
    def _make_dependency(self, identifier: str, dep_type=PluginDependencyType.Marketplace):
        return PluginDependency(
            type=dep_type,
            value=PluginDependency.Marketplace(marketplace_plugin_unique_identifier=identifier),
        )

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_returns_empty_when_all_present(self, mock_installer_cls):
        mock_installer_cls.return_value.fetch_missing_dependencies.return_value = []
        deps = [self._make_dependency("org/plugin:1.0.0@hash")]

        result = DependenciesAnalysisService.get_leaked_dependencies("t1", deps)

        assert result == []

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_returns_missing_with_version_extracted(self, mock_installer_cls):
        missing = MagicMock()
        missing.plugin_unique_identifier = "org/plugin:1.2.3@hash"
        missing.current_identifier = "org/plugin:1.0.0@oldhash"
        mock_installer_cls.return_value.fetch_missing_dependencies.return_value = [missing]

        deps = [self._make_dependency("org/plugin:1.2.3@hash")]

        result = DependenciesAnalysisService.get_leaked_dependencies("t1", deps)

        assert len(result) == 1
        assert result[0].value.version == "1.2.3"

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_skips_present_dependencies(self, mock_installer_cls):
        missing = MagicMock()
        missing.plugin_unique_identifier = "org/missing:1.0.0@hash"
        missing.current_identifier = None
        mock_installer_cls.return_value.fetch_missing_dependencies.return_value = [missing]

        deps = [
            self._make_dependency("org/present:1.0.0@hash"),
            self._make_dependency("org/missing:1.0.0@hash"),
        ]

        result = DependenciesAnalysisService.get_leaked_dependencies("t1", deps)

        assert len(result) == 1


class TestGenerateDependencies:
    def _make_installation(self, source, identifier, meta=None):
        install = MagicMock()
        install.source = source
        install.plugin_unique_identifier = identifier
        install.meta = meta or {}
        return install

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_github_source(self, mock_installer_cls):
        install = self._make_installation(
            PluginInstallationSource.Github,
            "org/plugin:1.0.0@hash",
            {"repo": "org/repo", "version": "v1.0", "package": "plugin.difypkg"},
        )
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        result = DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

        assert len(result) == 1
        assert result[0].type == PluginDependencyType.Github
        assert result[0].value.repo == "org/repo"

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_marketplace_source(self, mock_installer_cls):
        install = self._make_installation(PluginInstallationSource.Marketplace, "org/plugin:1.0.0@hash")
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        result = DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

        assert result[0].type == PluginDependencyType.Marketplace

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_package_source(self, mock_installer_cls):
        install = self._make_installation(PluginInstallationSource.Package, "org/plugin:1.0.0@hash")
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        result = DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

        assert result[0].type == PluginDependencyType.Package

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_remote_source_raises(self, mock_installer_cls):
        install = self._make_installation(PluginInstallationSource.Remote, "org/plugin:1.0.0@hash")
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        with pytest.raises(ValueError, match="remote plugin"):
            DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_deduplicates_input_ids(self, mock_installer_cls):
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = []

        DependenciesAnalysisService.generate_dependencies("t1", ["p1", "p1", "p2"])

        call_args = mock_installer_cls.return_value.fetch_plugin_installation_by_ids.call_args[0]
        assert len(call_args[1]) == 2  # deduplicated


class TestGenerateLatestDependencies:
    def test_returns_empty_when_marketplace_disabled(self, config_overrides):
        config_overrides(MARKETPLACE_ENABLED=False)

        result = DependenciesAnalysisService.generate_latest_dependencies(["p1"])

        assert result == []

    @patch("services.plugin.dependencies_analysis.marketplace")
    def test_returns_marketplace_deps_when_enabled(self, mock_marketplace, config_overrides):
        config_overrides(MARKETPLACE_ENABLED=True)
        manifest = MagicMock()
        manifest.latest_package_identifier = "org/plugin:2.0.0@newhash"
        mock_marketplace.batch_fetch_plugin_manifests.return_value = [manifest]

        result = DependenciesAnalysisService.generate_latest_dependencies(["p1"])

        assert len(result) == 1
        assert result[0].type == PluginDependencyType.Marketplace

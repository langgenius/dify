"""Tests for services.plugin.dependencies_analysis.DependenciesAnalysisService.

Covers: provider ID resolution, leaked dependency detection with version
extraction, dependency generation from multiple sources, and latest
dependencies via marketplace.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from core.plugin.entities.plugin import PluginDependency, PluginInstallationSource
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


class TestGetLeakedDependencies:
    def _make_dependency(self, identifier: str, dep_type=PluginDependency.Type.Marketplace):
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
        assert result[0].type == PluginDependency.Type.Github
        assert result[0].value.repo == "org/repo"

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_marketplace_source(self, mock_installer_cls):
        install = self._make_installation(PluginInstallationSource.Marketplace, "org/plugin:1.0.0@hash")
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        result = DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

        assert result[0].type == PluginDependency.Type.Marketplace

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_package_source(self, mock_installer_cls):
        install = self._make_installation(PluginInstallationSource.Package, "org/plugin:1.0.0@hash")
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        result = DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

        assert result[0].type == PluginDependency.Type.Package

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
    @patch("services.plugin.dependencies_analysis.dify_config")
    def test_returns_empty_when_marketplace_disabled(self, mock_config):
        mock_config.MARKETPLACE_ENABLED = False

        result = DependenciesAnalysisService.generate_latest_dependencies(["p1"])

        assert result == []

    @patch("services.plugin.dependencies_analysis.marketplace")
    @patch("services.plugin.dependencies_analysis.dify_config")
    def test_returns_marketplace_deps_when_enabled(self, mock_config, mock_marketplace):
        mock_config.MARKETPLACE_ENABLED = True
        manifest = MagicMock()
        manifest.latest_package_identifier = "org/plugin:2.0.0@newhash"
        mock_marketplace.batch_fetch_plugin_manifests.return_value = [manifest]

        result = DependenciesAnalysisService.generate_latest_dependencies(["p1"])

        assert len(result) == 1
        assert result[0].type == PluginDependency.Type.Marketplace

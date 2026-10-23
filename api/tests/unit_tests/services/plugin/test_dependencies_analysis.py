"""Tests for services.plugin.dependencies_analysis.DependenciesAnalysisService.

Covers: provider ID resolution, leaked dependency detection with version
extraction, dependency generation from multiple sources, and latest
dependencies via marketplace.
"""

from __future__ import annotations

import datetime
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest

from core.plugin.entities.marketplace import MarketplacePluginDeclaration
from core.plugin.entities.plugin import (
    PluginCategory,
    PluginDeclaration,
    PluginDependency,
    PluginDependencyType,
    PluginInstallation,
    PluginInstallationSource,
    PluginResourceRequirements,
)
from core.plugin.impl.plugin import PluginInstaller
from core.tools.entities.common_entities import I18nObject
from core.tools.tool_manager import ToolManager
from services.entities.dsl_entities import DraftDependencyCheck
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from tests.unit_tests.config_override import apply_config_overrides

_TENANT_ID = "22222222-2222-4222-8222-222222222222"


class TestAnalyzeToolDependency:
    def test_valid_three_part_id(self) -> None:
        result = DependenciesAnalysisService.analyze_tool_dependency("langgenius/google/google")
        assert result == "langgenius/google"

    def test_single_part_expands_to_langgenius(self) -> None:
        result = DependenciesAnalysisService.analyze_tool_dependency("websearch")
        assert result == "langgenius/websearch"

    def test_invalid_format_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid plugin id bad/format"):
            DependenciesAnalysisService.analyze_tool_dependency("bad/format")

    def test_plugin_id_reference_is_preserved(self) -> None:
        assert DependenciesAnalysisService.analyze_tool_provider_reference("acme/search") == "acme/search"


class TestAnalyzeModelProviderDependency:
    def test_valid_three_part_id(self) -> None:
        result = DependenciesAnalysisService.analyze_model_provider_dependency("langgenius/openai/openai")
        assert result == "langgenius/openai"

    def test_google_maps_to_gemini(self) -> None:
        result = DependenciesAnalysisService.analyze_model_provider_dependency("langgenius/google/google")
        assert result == "langgenius/gemini"

    def test_single_part_expands(self) -> None:
        result = DependenciesAnalysisService.analyze_model_provider_dependency("anthropic")
        assert result == "langgenius/anthropic"


class TestExtractExternalNodeDependencies:
    def test_legacy_agent_includes_strategy_and_plugin_tools(self) -> None:
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

    def test_legacy_agent_accepts_plugin_id_strategy_and_legacy_tool_provider(self) -> None:
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

    def test_legacy_agent_skips_invalid_strategy_and_non_tool_parameters(self) -> None:
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
    def test_direct_plugin_references(self, node_data: dict[str, object], expected: list[str]) -> None:
        assert DependenciesAnalysisService.extract_external_node_dependencies(node_data) == expected


class TestGetLeakedDependencies:
    def _make_dependency(
        self, identifier: str, dep_type: PluginDependencyType = PluginDependencyType.Marketplace
    ) -> PluginDependency:
        return PluginDependency(
            type=dep_type,
            value=PluginDependency.Marketplace(marketplace_plugin_unique_identifier=identifier),
        )

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_returns_empty_when_all_present(self, mock_installer_cls: MagicMock) -> None:
        mock_installer_cls.return_value.fetch_missing_dependencies.return_value = list[object]()
        deps = [self._make_dependency("org/plugin:1.0.0@hash")]

        result = DependenciesAnalysisService.get_leaked_dependencies("t1", deps)

        assert result == []

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_returns_missing_with_version_extracted(self, mock_installer_cls: MagicMock) -> None:
        missing = MagicMock()
        missing.plugin_unique_identifier = "org/plugin:1.2.3@hash"
        missing.current_identifier = "org/plugin:1.0.0@oldhash"
        mock_installer_cls.return_value.fetch_missing_dependencies.return_value = [missing]

        deps = [self._make_dependency("org/plugin:1.2.3@hash")]

        result = DependenciesAnalysisService.get_leaked_dependencies("t1", deps)

        assert len(result) == 1
        assert result[0].value.version == "1.2.3"

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_skips_present_dependencies(self, mock_installer_cls: MagicMock) -> None:
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
    def _make_installation(
        self, source: PluginInstallationSource, identifier: str, meta: dict[str, object] | None = None
    ) -> MagicMock:
        install = MagicMock()
        install.source = source
        install.plugin_unique_identifier = identifier
        install.meta = meta or {}
        return install

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_github_source(self, mock_installer_cls: MagicMock) -> None:
        install = self._make_installation(
            PluginInstallationSource.Github,
            "org/plugin:1.0.0@hash",
            {"repo": "org/repo", "version": "v1.0", "package": "plugin.difypkg"},
        )
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        result = DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

        assert len(result) == 1
        assert result[0].type == PluginDependencyType.Github
        assert isinstance(result[0].value, PluginDependency.Github)
        assert result[0].value.repo == "org/repo"

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_marketplace_source(self, mock_installer_cls: MagicMock) -> None:
        install = self._make_installation(PluginInstallationSource.Marketplace, "org/plugin:1.0.0@hash")
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        result = DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

        assert result[0].type == PluginDependencyType.Marketplace

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_package_source(self, mock_installer_cls: MagicMock) -> None:
        install = self._make_installation(PluginInstallationSource.Package, "org/plugin:1.0.0@hash")
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        result = DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

        assert result[0].type == PluginDependencyType.Package

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_remote_source_raises(self, mock_installer_cls: MagicMock) -> None:
        install = self._make_installation(PluginInstallationSource.Remote, "org/plugin:1.0.0@hash")
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = [install]

        with pytest.raises(ValueError, match="remote plugin"):
            DependenciesAnalysisService.generate_dependencies("t1", ["p1"])

    @patch("services.plugin.dependencies_analysis.PluginInstaller")
    def test_deduplicates_input_ids(self, mock_installer_cls: MagicMock) -> None:
        mock_installer_cls.return_value.fetch_plugin_installation_by_ids.return_value = list[object]()

        DependenciesAnalysisService.generate_dependencies("t1", ["p1", "p1", "p2"])

        call_args = mock_installer_cls.return_value.fetch_plugin_installation_by_ids.call_args[0]
        assert len(call_args[1]) == 2  # deduplicated


class TestGenerateLatestDependencies:
    def test_returns_empty_when_marketplace_disabled(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(MARKETPLACE_ENABLED=False)

        result = DependenciesAnalysisService.generate_latest_dependencies(["p1"])

        assert result == []

    @patch("services.plugin.dependencies_analysis.marketplace")
    def test_returns_marketplace_deps_when_enabled(
        self, mock_marketplace: MagicMock, config_overrides: Callable[..., None]
    ) -> None:
        config_overrides(MARKETPLACE_ENABLED=True)
        manifest = MagicMock()
        manifest.latest_package_identifier = "org/plugin:2.0.0@newhash"
        mock_marketplace.batch_fetch_plugin_manifests.return_value = [manifest]

        result = DependenciesAnalysisService.generate_latest_dependencies(["p1"])

        assert len(result) == 1
        assert result[0].type == PluginDependencyType.Marketplace


def _installation(plugin_id: str) -> PluginInstallation:
    now = datetime.datetime.now()
    label = I18nObject(en_US=plugin_id)
    return PluginInstallation(
        id=f"install-{plugin_id}",
        created_at=now,
        updated_at=now,
        tenant_id=_TENANT_ID,
        endpoints_setups=0,
        endpoints_active=0,
        runtime_type="remote",
        source=PluginInstallationSource.Marketplace,
        meta={},
        plugin_id=plugin_id,
        plugin_unique_identifier=f"{plugin_id}:1.0.0@hash",
        version="1.0.0",
        checksum="abc",
        declaration=PluginDeclaration(
            version="1.0.0",
            author="author",
            name=plugin_id.split("/")[-1],
            description=label,
            icon="icon.png",
            label=label,
            category=PluginCategory.Tool,
            created_at=now,
            resource=PluginResourceRequirements(memory=512, permission=None),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="1.0.0"),
        ),
    )


def _manifest(plugin_id: str, version: str) -> MarketplacePluginDeclaration:
    label = I18nObject(en_US=plugin_id)
    return MarketplacePluginDeclaration(
        name=plugin_id.split("/")[-1],
        org=plugin_id.split("/")[0],
        plugin_id=plugin_id,
        icon="icon.png",
        label=label,
        brief=label,
        resource=PluginResourceRequirements(memory=512, permission=None),
        latest_version=version,
        latest_package_identifier=f"{plugin_id}:{version}@abc",
        status="active",
        deprecated_reason="",
        alternative_plugin_id="",
    )


@dataclass
class _Identity:
    name: str


@dataclass
class _ProviderEntity:
    identity: _Identity


@dataclass
class _HardcodedProvider:
    entity: _ProviderEntity


def _patch_plugin_world(
    monkeypatch: pytest.MonkeyPatch,
    *,
    installed: Sequence[str] = (),
    marketplace_ids: Sequence[str] = (),
    marketplace_enabled: bool = True,
    hardcoded: Sequence[str] = (),
) -> None:
    monkeypatch.setattr(
        PluginInstaller,
        "fetch_plugin_installation_by_ids",
        lambda _self, _tenant_id, ids: [_installation(i) for i in ids if i in installed],
    )
    monkeypatch.setattr(
        "services.plugin.dependencies_analysis.marketplace.batch_fetch_plugin_manifests",
        lambda ids: [_manifest(i, "1.2.0") for i in ids if i in marketplace_ids],
    )
    monkeypatch.setattr(
        ToolManager,
        "list_hardcoded_providers",
        classmethod(lambda _cls: iter(_HardcodedProvider(_ProviderEntity(_Identity(n))) for n in hardcoded)),
    )
    apply_config_overrides(monkeypatch, MARKETPLACE_ENABLED=marketplace_enabled)


def test_only_uninstalled_plugins_are_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_plugin_world(monkeypatch, installed=["langgenius/openai"], marketplace_ids=["acme/search"])
    result = DependenciesAnalysisService.find_missing_dependencies(
        tenant_id=_TENANT_ID, plugin_ids=["langgenius/openai", "acme/search"]
    )
    assert [d.value.plugin_unique_identifier for d in result.leaked_dependencies] == ["acme/search:1.2.0@abc"]
    assert result.leaked_dependencies[0].type == PluginDependencyType.Marketplace
    assert isinstance(result.leaked_dependencies[0].value, PluginDependency.Marketplace)
    assert result.leaked_dependencies[0].value.version == "1.2.0"
    assert result.unresolved_plugin_ids == []


def test_missing_plugins_without_a_marketplace_match_are_unresolved(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_plugin_world(monkeypatch, marketplace_ids=["acme/a"])
    result = DependenciesAnalysisService.find_missing_dependencies(
        tenant_id=_TENANT_ID, plugin_ids=["acme/a", "corp/private"]
    )
    assert [d.value.plugin_unique_identifier for d in result.leaked_dependencies] == ["acme/a:1.2.0@abc"]
    assert result.unresolved_plugin_ids == ["corp/private"]


def test_marketplace_disabled_reports_every_missing_plugin_unresolved(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_plugin_world(monkeypatch, marketplace_enabled=False)

    def _fail(_ids: object) -> None:
        pytest.fail("marketplace must not be queried when disabled")

    monkeypatch.setattr("services.plugin.dependencies_analysis.marketplace.batch_fetch_plugin_manifests", _fail)
    result = DependenciesAnalysisService.find_missing_dependencies(
        tenant_id=_TENANT_ID, plugin_ids=["acme/a", "corp/private"]
    )
    assert result.leaked_dependencies == []
    assert result.unresolved_plugin_ids == ["acme/a", "corp/private"]


def test_hardcoded_builtin_tools_are_never_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_plugin_world(monkeypatch, hardcoded=["time", "code"])
    result = DependenciesAnalysisService.find_missing_dependencies(
        tenant_id=_TENANT_ID, plugin_ids=["langgenius/time", "langgenius/code"]
    )
    assert result.leaked_dependencies == []
    assert result.unresolved_plugin_ids == []


def test_duplicates_collapse_and_order_is_sorted(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_plugin_world(monkeypatch)
    result = DependenciesAnalysisService.find_missing_dependencies(
        tenant_id=_TENANT_ID, plugin_ids=["b/x", "a/y", "b/x"]
    )
    assert result.unresolved_plugin_ids == ["a/y", "b/x"]


def test_no_plugin_ids_makes_no_daemon_call(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fail(_self: PluginInstaller, _tenant_id: str, _ids: Sequence[str]) -> None:
        pytest.fail("daemon must not be called")

    monkeypatch.setattr(PluginInstaller, "fetch_plugin_installation_by_ids", _fail)
    assert (
        DependenciesAnalysisService.find_missing_dependencies(tenant_id=_TENANT_ID, plugin_ids=[])
        == DraftDependencyCheck()
    )


def test_daemon_failure_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(_self: PluginInstaller, _tenant_id: str, _ids: Sequence[str]) -> None:
        raise RuntimeError("daemon down")

    monkeypatch.setattr(PluginInstaller, "fetch_plugin_installation_by_ids", _boom)
    with pytest.raises(RuntimeError, match="daemon down"):
        DependenciesAnalysisService.find_missing_dependencies(tenant_id=_TENANT_ID, plugin_ids=["acme/a"])

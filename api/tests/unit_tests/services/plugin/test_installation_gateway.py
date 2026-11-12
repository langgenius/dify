"""Preserved legacy download, verification and invalidation tests at their new owner."""

from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.plugin.entities.plugin import (
    PluginCategory,
    PluginDeclaration,
    PluginInstallationSource,
    PluginResourceRequirements,
)
from core.plugin.entities.plugin_daemon import (
    PluginDecodeResponse,
    PluginInstallTask,
    PluginInstallTaskStartResponse,
    PluginInstallTaskStatus,
    PluginVerification,
)
from core.tools.entities.common_entities import I18nObject
from enums import DeploymentEdition
from services.entities.feature_entities import PluginInstallationPermissionModel, PluginInstallationScope
from services.errors.plugin import PluginInstallationForbiddenError
from services.plugin.installation_gateway import LegacyPluginInstallationGateway
from tests.unit_tests.services.errors.test_plugin import _make_permission

MODULE = "core.plugin.plugin_service"


def test_actual_daemon_task_dto_preserves_wire_fields_and_utc_timestamps() -> None:
    from datetime import UTC, datetime

    from core.plugin.entities.plugin_daemon import PluginInstallTask, PluginInstallTaskStatus
    from graphon.model_runtime.utils.encoders import jsonable_encoder
    from services.plugin.installation_gateway import _result

    stamp = datetime(2026, 11, 2, tzinfo=UTC)
    task = PluginInstallTask(
        id="owned-task",
        created_at=stamp,
        updated_at=stamp,
        status=PluginInstallTaskStatus.Success,
        total_plugins=1,
        completed_plugins=1,
        plugins=[],
    )
    response = PluginInstallTaskStartResponse(all_installed=False, task_id="owned-task", task=task)
    assert jsonable_encoder(response) == jsonable_encoder(_result(response))


@pytest.fixture(autouse=True)
def _plugin_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(MARKETPLACE_ENABLED=True, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)


class TestGatewayCacheInvalidation:
    def test_upgrade_plugin_with_marketplace_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Marketplace upgrades invalidate only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.SystemFeatureService") as feature_service,
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch("services.plugin.installation_gateway.marketplace") as marketplace,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            feature_service.get_plugin_installation_permission.return_value = PluginInstallationPermissionModel(
                restrict_to_marketplace_only=False,
                plugin_installation_scope=PluginInstallationScope.ALL,
            )
            installer = installer_cls.return_value
            installer.fetch_plugin_manifest.return_value = MagicMock()
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.upgrade_plugin.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("tenant-1", "old-uid", "new-uid")

        assert result.task_id == "task-id"
        marketplace.record_install_plugin_event.assert_called_once_with("new-uid")
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_install_from_local_pkg_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Starting a plugin install invalidates only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginService._check_marketplace_only_permission"),
            patch(f"{MODULE}.PluginService._check_plugin_installation_scope"),
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.install_from_local_pkg(
                "tenant-1",
                [
                    "langgenius/openai:1.0.0",
                    "langgenius/tavily:1.0.0",
                ],
            )

        assert result.task_id == "task-id"
        installer.install_from_identifiers.assert_called_once_with(
            "tenant-1",
            [
                "langgenius/openai:1.0.0",
                "langgenius/tavily:1.0.0",
            ],
            PluginInstallationSource.Package,
            [
                {"plugin_unique_identifier": "langgenius/openai:1.0.0"},
                {"plugin_unique_identifier": "langgenius/tavily:1.0.0"},
            ],
        )
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_upgrade_plugin_with_github_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Starting a plugin upgrade invalidates only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginService._check_marketplace_only_permission"),
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            installer.upgrade_plugin.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.upgrade_plugin_with_github(
                "tenant-1", "old-uid", "new-uid", "langgenius/openai", "1.0.0", "openai.difypkg"
            )

        assert result.task_id == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_install_from_github_invalidates_model_provider_cache_for_tenant(self) -> None:
        """GitHub installs invalidate only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginService._check_marketplace_only_permission"),
            patch(f"{MODULE}.PluginService._check_plugin_installation_scope"),
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.install_from_github(
                "tenant-1", "langgenius/openai:1.0.0", "langgenius/openai", "1.0.0", "openai.difypkg"
            )

        assert result.task_id == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_install_from_marketplace_pkg_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Marketplace package installs invalidate only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.SystemFeatureService") as feature_service,
            patch(f"{MODULE}.PluginService._check_plugin_installation_scope"),
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            feature_service.get_plugin_installation_permission.return_value = PluginInstallationPermissionModel(
                plugin_installation_scope=PluginInstallationScope.ALL, restrict_to_marketplace_only=False
            )
            installer = installer_cls.return_value
            installer.fetch_plugin_manifest.return_value = MagicMock()
            decode_response = MagicMock()
            decode_response.verification = None
            decode_response.unique_identifier = "langgenius/openai:1.0.0"
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.install_from_marketplace_pkg(
                "tenant-1", ["langgenius/openai:1.0.0"]
            )

        assert result.task_id == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")


class TestUpgradePluginWithMarketplace:
    def test_raises_when_marketplace_disabled(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(MARKETPLACE_ENABLED=False)

        with pytest.raises(ValueError, match="marketplace is not enabled"):
            LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

    def test_raises_when_same_identifier(self) -> None:
        with pytest.raises(ValueError, match="same plugin"):
            LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "same-uid", "same-uid")

    @patch("services.plugin.installation_gateway.marketplace")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_skips_download_when_already_installed(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_marketplace: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        installer.upgrade_plugin.return_value = MagicMock()

        LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        mock_marketplace.record_install_plugin_event.assert_called_once_with("new-uid")
        installer.upgrade_plugin.assert_called_once()

    @patch("services.plugin.installation_gateway.download_plugin_pkg")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_downloads_when_not_installed(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_download: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.side_effect = RuntimeError("not found")
        mock_download.return_value = b"pkg-bytes"
        upload_resp = MagicMock()
        upload_resp.verification = None
        installer.upload_pkg.return_value = upload_resp
        installer.upgrade_plugin.return_value = MagicMock()

        LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        mock_download.assert_called_once_with("new-uid")
        installer.upload_pkg.assert_called_once()

    @pytest.mark.parametrize(
        "scope",
        [PluginInstallationScope.OFFICIAL_ONLY, PluginInstallationScope.OFFICIAL_AND_SPECIFIC_PARTNERS],
    )
    @patch("services.plugin.installation_gateway.download_plugin_pkg")
    @patch("services.plugin.installation_gateway.marketplace")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_rejects_cached_pkg_outside_scope(
        self,
        mock_mutation_installer_cls: MagicMock,
        mock_fs: MagicMock,
        mock_marketplace: MagicMock,
        mock_download: MagicMock,
        scope: PluginInstallationScope,
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission(scope=scope)
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        decode_resp = MagicMock()
        decode_resp.verification.authorized_category = PluginVerification.AuthorizedCategory.Community
        installer.decode_plugin_from_identifier.return_value = decode_resp

        with pytest.raises(PluginInstallationForbiddenError):
            LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        installer.upgrade_plugin.assert_not_called()
        mock_marketplace.record_install_plugin_event.assert_not_called()
        # the rejection must not fall through to the download branch and cache the pkg again
        mock_download.assert_not_called()
        installer.upload_pkg.assert_not_called()

    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_rejects_before_touching_daemon_when_scope_is_none(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission(scope=PluginInstallationScope.NONE)
        installer = mock_mutation_installer_cls.return_value

        with pytest.raises(PluginInstallationForbiddenError):
            LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        installer.fetch_plugin_manifest.assert_not_called()
        installer.upgrade_plugin.assert_not_called()

    @patch("services.plugin.installation_gateway.marketplace")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_allows_cached_official_pkg_under_official_only(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_marketplace: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission(
            scope=PluginInstallationScope.OFFICIAL_ONLY
        )
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        decode_resp = MagicMock()
        decode_resp.verification.authorized_category = PluginVerification.AuthorizedCategory.Langgenius
        installer.decode_plugin_from_identifier.return_value = decode_resp

        LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        mock_marketplace.record_install_plugin_event.assert_called_once_with("new-uid")
        installer.upgrade_plugin.assert_called_once()


class TestUpgradePluginWithGithub:
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_checks_marketplace_permission_and_delegates(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.upgrade_plugin.return_value = MagicMock()

        LegacyPluginInstallationGateway.upgrade_plugin_with_github(
            "t1", "old-uid", "new-uid", "org/repo", "v1", "pkg.difypkg"
        )

        installer.upgrade_plugin.assert_called_once()
        call_args = installer.upgrade_plugin.call_args
        assert call_args[0][3] == PluginInstallationSource.Github


class TestInstallFromMarketplacePkg:
    def test_raises_when_marketplace_disabled(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(MARKETPLACE_ENABLED=False)

        with pytest.raises(ValueError, match="marketplace is not enabled"):
            LegacyPluginInstallationGateway.install_from_marketplace_pkg("t1", ["uid-1"])

    @patch("services.plugin.installation_gateway.download_plugin_pkg")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_downloads_when_not_cached(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_download: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.side_effect = RuntimeError("not found")
        mock_download.return_value = b"pkg"
        upload_resp = MagicMock()
        upload_resp.verification = None
        upload_resp.unique_identifier = "uid-1"
        installer.upload_pkg.return_value = upload_resp
        installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
            all_installed=False, task_id="task-id"
        )

        result = LegacyPluginInstallationGateway.install_from_marketplace_pkg("t1", ["uid-1"])

        assert result.task_id == "task-id"
        installer.install_from_identifiers.assert_called_once()
        call_args = installer.install_from_identifiers.call_args[0]
        assert call_args[1] == ["uid-1"]

    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_uses_cached_when_already_downloaded(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        decode_resp = MagicMock()
        decode_resp.verification = None
        decode_resp.unique_identifier = "uid-1"
        installer.decode_plugin_from_identifier.return_value = decode_resp
        installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
            all_installed=False, task_id="task-id"
        )

        LegacyPluginInstallationGateway.install_from_marketplace_pkg("t1", ["uid-1"])

        installer.install_from_identifiers.assert_called_once()
        call_args = installer.install_from_identifiers.call_args[0]
        assert call_args[1] == ["uid-1"]

    @patch("services.plugin.installation_gateway.download_plugin_pkg")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_rejects_cached_pkg_outside_scope(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_download: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission(
            scope=PluginInstallationScope.OFFICIAL_ONLY
        )
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        decode_resp = MagicMock()
        decode_resp.verification.authorized_category = PluginVerification.AuthorizedCategory.Community
        installer.decode_plugin_from_identifier.return_value = decode_resp

        with pytest.raises(PluginInstallationForbiddenError):
            LegacyPluginInstallationGateway.install_from_marketplace_pkg("t1", ["uid-1"])

        installer.install_from_identifiers.assert_not_called()
        # the rejection must not fall through to the download branch and cache the pkg again
        mock_download.assert_not_called()
        installer.upload_pkg.assert_not_called()


_EXACT_UID = "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340"
_OTHER_UID = "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c"
_UID_MISMATCH = "Marketplace package identifier does not match the requested identifier."


def _marketplace_decode(uid: str) -> PluginDecodeResponse:
    return PluginDecodeResponse(
        unique_identifier=uid,
        manifest=PluginDeclaration(
            version="1.1.0",
            author="langgenius",
            name="openai",
            description=I18nObject(en_US="Synthetic package declaration"),
            icon="icon.svg",
            label=I18nObject(en_US="Synthetic package"),
            category=PluginCategory.Extension,
            created_at=datetime(2026, 11, 12, tzinfo=UTC),
            resource=PluginResourceRequirements(memory=1024),
            plugins=PluginDeclaration.Plugins(),
            meta=PluginDeclaration.Meta(version="0.0.1"),
            verified=True,
        ),
        verification=PluginVerification(authorized_category=PluginVerification.AuthorizedCategory.Langgenius),
    )


class _MarketplaceDaemon:
    """Only the external daemon boundary is replaced; scope/UID guards are real."""

    def __init__(self, *, cached: bool, responses: dict[str, PluginDecodeResponse]) -> None:
        self.cached = cached
        self.responses = responses
        self.calls: list[tuple[str, str]] = []
        self.installs: list[tuple[str, list[str], PluginInstallationSource, list[dict[str, str]]]] = []
        self.invalid_cached_dto = False
        stamp = datetime(2026, 11, 12, tzinfo=UTC)
        self.task = PluginInstallTaskStartResponse(
            all_installed=False,
            task_id="synthetic-exact-task",
            task=PluginInstallTask(
                id="synthetic-exact-task",
                created_at=stamp,
                updated_at=stamp,
                status=PluginInstallTaskStatus.Pending,
                total_plugins=1,
                completed_plugins=0,
                plugins=[],
            ),
        )

    def fetch_plugin_manifest(self, tenant_id: str, uid: str) -> PluginDeclaration:
        assert tenant_id == "exact-tenant"
        self.calls.append(("fetch", uid))
        if not self.cached:
            raise RuntimeError("synthetic cache miss")
        return self.responses[uid].manifest

    def decode_plugin_from_identifier(self, tenant_id: str, uid: str) -> PluginDecodeResponse:
        assert tenant_id == "exact-tenant"
        self.calls.append(("decode", uid))
        if self.invalid_cached_dto:
            return PluginDecodeResponse.model_validate({"unique_identifier": uid})
        return self.responses[uid]

    def upload_pkg(self, tenant_id: str, pkg: bytes, verify_signature: bool) -> PluginDecodeResponse:
        assert tenant_id == "exact-tenant"
        assert verify_signature is False  # Real Community permission is retained.
        uid = pkg.decode()
        self.calls.append(("upload", uid))
        return self.responses[uid]

    def install_from_identifiers(
        self,
        tenant_id: str,
        identifiers: Sequence[str],
        source: PluginInstallationSource,
        metas: list[dict[str, str]],
    ) -> PluginInstallTaskStartResponse:
        self.installs.append((tenant_id, list(identifiers), source, metas))
        return self.task


class _ProviderCacheTerminal:
    """Record real invalidation commands without connecting to Redis."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def pipeline(self, transaction: bool) -> "_ProviderCacheTerminal":
        self.calls.append(("pipeline", transaction))
        return self

    def delete(self, key: str) -> None:
        self.calls.append(("delete", key))

    def incr(self, key: str) -> None:
        self.calls.append(("incr", key))

    def execute(self) -> list[object]:
        self.calls.append(("execute", None))
        return []


def _marketplace_terminals(
    monkeypatch: pytest.MonkeyPatch,
    *,
    cached: bool,
    responses: dict[str, PluginDecodeResponse],
) -> tuple[_MarketplaceDaemon, list[str], _ProviderCacheTerminal]:
    daemon = _MarketplaceDaemon(cached=cached, responses=responses)
    downloads: list[str] = []
    cache = _ProviderCacheTerminal()

    def download(uid: str) -> bytes:
        downloads.append(uid)
        return uid.encode()

    monkeypatch.setattr("services.plugin.installation_gateway.PluginInstaller", lambda: daemon)
    monkeypatch.setattr("services.plugin.installation_gateway.download_plugin_pkg", download)
    monkeypatch.setattr("core.plugin.plugin_service.redis_client", cache)
    return daemon, downloads, cache


@pytest.mark.parametrize("cached", [False, True])
def test_marketplace_exact_typed_package_installs_only_requested_identity(
    monkeypatch: pytest.MonkeyPatch,
    cached: bool,
) -> None:
    daemon, downloads, cache = _marketplace_terminals(
        monkeypatch,
        cached=cached,
        responses={_EXACT_UID: _marketplace_decode(_EXACT_UID)},
    )
    result = LegacyPluginInstallationGateway.install_from_marketplace_pkg("exact-tenant", [_EXACT_UID])
    assert daemon.installs == [
        (
            "exact-tenant",
            [_EXACT_UID],
            PluginInstallationSource.Marketplace,
            [{"plugin_unique_identifier": _EXACT_UID}],
        ),
    ]
    assert result.task_id == daemon.task.task_id
    assert daemon.task.task is not None
    assert result.task == daemon.task.task.model_dump(mode="json")
    assert downloads == ([] if cached else [_EXACT_UID])
    assert cache.calls[0] == ("pipeline", False)
    assert cache.calls[-1] == ("execute", None)


@pytest.mark.parametrize("cached", [False, True])
def test_marketplace_other_valid_immutable_uid_fails_without_install_or_invalidation(
    monkeypatch: pytest.MonkeyPatch,
    cached: bool,
) -> None:
    daemon, downloads, cache = _marketplace_terminals(
        monkeypatch,
        cached=cached,
        responses={_EXACT_UID: _marketplace_decode(_OTHER_UID)},
    )
    with pytest.raises(ValueError, match="requested identifier") as error:
        LegacyPluginInstallationGateway.install_from_marketplace_pkg("exact-tenant", [_EXACT_UID])
    assert str(error.value) == _UID_MISMATCH
    assert _EXACT_UID not in str(error.value)
    assert _OTHER_UID not in str(error.value)
    assert daemon.installs == []
    assert cache.calls == []
    assert downloads == ([] if cached else [_EXACT_UID])
    assert [kind for kind, _ in daemon.calls] == (["fetch", "decode"] if cached else ["fetch", "upload"])


@pytest.mark.parametrize("cached", [False, True])
def test_marketplace_late_batch_identity_mismatch_never_installs_any_item(
    monkeypatch: pytest.MonkeyPatch,
    cached: bool,
) -> None:
    daemon, _, cache = _marketplace_terminals(
        monkeypatch,
        cached=cached,
        responses={_EXACT_UID: _marketplace_decode(_EXACT_UID), _OTHER_UID: _marketplace_decode(_EXACT_UID)},
    )
    with pytest.raises(ValueError, match="requested identifier"):
        LegacyPluginInstallationGateway.install_from_marketplace_pkg("exact-tenant", [_EXACT_UID, _OTHER_UID])
    assert len(daemon.calls) == 4
    assert daemon.installs == []
    assert cache.calls == []


def test_marketplace_invalid_cached_dto_does_not_fall_back_to_package_download(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    daemon, downloads, cache = _marketplace_terminals(
        monkeypatch,
        cached=True,
        responses={_EXACT_UID: _marketplace_decode(_EXACT_UID)},
    )
    daemon.invalid_cached_dto = True
    with pytest.raises(ValidationError):
        LegacyPluginInstallationGateway.install_from_marketplace_pkg("exact-tenant", [_EXACT_UID])
    assert downloads == []
    assert daemon.installs == []
    assert cache.calls == []
    assert [kind for kind, _ in daemon.calls] == ["fetch", "decode"]

from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Never
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Retry
from redis import RedisError

from core.plugin.entities.marketplace import MarketplacePluginSnapshot
from core.plugin.entities.plugin import PluginCategory, PluginInstallationSource
from models.account import (
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategySetting,
)
from tasks import process_tenant_plugin_autoupgrade_check_task as upgrade_module
from tasks.plugin_autoupgrade_coordination import (
    CHECK_SLOT_LEASE_SECONDS,
    CHECK_TASK_TIME_LIMIT,
    AcquireResult,
    CheckReservation,
)

MODULE = "tasks.process_tenant_plugin_autoupgrade_check_task"


def _make_plugin(
    plugin_id: str,
    version: str,
    source: PluginInstallationSource = PluginInstallationSource.Marketplace,
    category: PluginCategory = PluginCategory.Tool,
) -> SimpleNamespace:
    """Build a minimal stand-in for a PluginInstallation entry returned by manager.list_plugins."""
    return SimpleNamespace(
        plugin_id=plugin_id,
        version=version,
        plugin_unique_identifier=f"{plugin_id}:{version}@deadbeef",
        source=source,
        declaration=SimpleNamespace(category=category),
    )


def _make_manifest(plugin_id: str, latest_version: str) -> MarketplacePluginSnapshot:
    org, name = plugin_id.split("/", 1)
    return MarketplacePluginSnapshot(
        org=org,
        name=name,
        latest_version=latest_version,
        latest_package_identifier=f"{plugin_id}:{latest_version}@cafe1234",
        latest_package_url=f"https://marketplace.example/{plugin_id}/{latest_version}.difypkg",
    )


def _run_task(
    *,
    plugins: list[SimpleNamespace],
    manifests: list[MarketplacePluginSnapshot],
    strategy_setting: TenantPluginAutoUpgradeStrategySetting = TenantPluginAutoUpgradeStrategySetting.LATEST,
    upgrade_mode: TenantPluginAutoUpgradeMode = TenantPluginAutoUpgradeMode.ALL,
    exclude_plugins: list[str] | None = None,
    include_plugins: list[str] | None = None,
    category: PluginCategory | str | None = None,
) -> tuple[MagicMock, list[tuple[str, str, str]]]:
    """
    Execute the celery task synchronously with mocks for the plugin manager,
    the marketplace cache and PluginService.upgrade_plugin_with_marketplace.
    Returns the upgrade-call recorder so each test can assert on it.
    """
    fake_manager = MagicMock()
    fake_manager.list_plugins.return_value = plugins

    upgrade_calls: list[tuple[str, str, str]] = []

    def _record_upgrade(tenant_id: str, original: str, new: str) -> None:
        upgrade_calls.append((tenant_id, original, new))

    with (
        patch(f"{MODULE}.PluginInstaller", return_value=fake_manager),
        patch(f"{MODULE}.marketplace_batch_fetch_plugin_manifests", return_value=manifests),
        patch(
            f"{MODULE}.PluginService.upgrade_plugin_with_marketplace",
            side_effect=_record_upgrade,
        ) as upgrade_mock,
    ):
        from tasks.process_tenant_plugin_autoupgrade_check_task import (
            _process_tenant_plugin_autoupgrade_check,
        )

        _process_tenant_plugin_autoupgrade_check(
            "tenant-1",
            strategy_setting,
            0,
            upgrade_mode,
            exclude_plugins or [],
            include_plugins or [],
            category,
        )

    return upgrade_mock, upgrade_calls


class TestUpgradeCallsMarketplaceService:
    """
    Regression test for the bug where the auto-upgrade task called
    manager.upgrade_plugin directly, which skipped downloading the new package
    from marketplace and uploading it to the daemon. The daemon then failed with
    "package file not found" and the upgrade silently never completed.
    """

    def test_upgrade_routes_through_plugin_service(self) -> None:
        plugin = _make_plugin("acme/foo", "1.0.0")
        manifest = _make_manifest("acme/foo", "1.0.1")

        upgrade_mock, calls = _run_task(plugins=[plugin], manifests=[manifest])

        upgrade_mock.assert_called_once()
        assert calls == [("tenant-1", plugin.plugin_unique_identifier, manifest.latest_package_identifier)]

    def test_does_not_call_manager_upgrade_plugin_directly(self) -> None:
        """Locks in that we never go back to the broken path that bypassed download/upload."""
        plugin = _make_plugin("acme/foo", "1.0.0")
        manifest = _make_manifest("acme/foo", "1.0.1")

        fake_manager = MagicMock()
        fake_manager.list_plugins.return_value = [plugin]

        with (
            patch(f"{MODULE}.PluginInstaller", return_value=fake_manager),
            patch(f"{MODULE}.marketplace_batch_fetch_plugin_manifests", return_value=[manifest]),
            patch(f"{MODULE}.PluginService.upgrade_plugin_with_marketplace"),
        ):
            from tasks.process_tenant_plugin_autoupgrade_check_task import (
                _process_tenant_plugin_autoupgrade_check,
            )

            _process_tenant_plugin_autoupgrade_check(
                "tenant-1",
                TenantPluginAutoUpgradeStrategySetting.LATEST,
                0,
                TenantPluginAutoUpgradeMode.ALL,
                [],
                [],
            )

        fake_manager.upgrade_plugin.assert_not_called()


class TestStrategySetting:
    def test_disabled_strategy_skips_everything(self) -> None:
        upgrade_mock, _ = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "1.0.1")],
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.DISABLED,
        )
        upgrade_mock.assert_not_called()

    def test_fix_only_upgrades_patch_version(self) -> None:
        upgrade_mock, calls = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "1.0.5")],
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
        )
        upgrade_mock.assert_called_once()
        assert calls[0][2].endswith(":1.0.5@cafe1234")

    def test_fix_only_skips_minor_bump(self) -> None:
        upgrade_mock, _ = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "1.1.0")],
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
        )
        upgrade_mock.assert_not_called()

    def test_fix_only_skips_major_bump(self) -> None:
        upgrade_mock, _ = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "2.0.0")],
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.FIX_ONLY,
        )
        upgrade_mock.assert_not_called()

    def test_latest_strategy_skips_when_versions_equal(self) -> None:
        upgrade_mock, _ = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "1.0.0")],
            strategy_setting=TenantPluginAutoUpgradeStrategySetting.LATEST,
        )
        upgrade_mock.assert_not_called()


class TestUpgradeMode:
    def test_mode_all_upgrades_every_marketplace_plugin(self) -> None:
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0"),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]

        upgrade_mock, calls = _run_task(
            plugins=plugins,
            manifests=manifests,
            upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
        )

        assert upgrade_mock.call_count == 2
        upgraded_ids = sorted(c[1] for c in calls)
        assert upgraded_ids == sorted(p.plugin_unique_identifier for p in plugins)

    def test_mode_all_skips_non_marketplace_sources(self) -> None:
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0", source=PluginInstallationSource.Github),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]

        upgrade_mock, calls = _run_task(
            plugins=plugins,
            manifests=manifests,
            upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
        )

        assert upgrade_mock.call_count == 1
        assert calls[0][1] == plugins[0].plugin_unique_identifier

    def test_mode_partial_only_upgrades_included_plugins(self) -> None:
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0"),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]

        upgrade_mock, calls = _run_task(
            plugins=plugins,
            manifests=manifests,
            upgrade_mode=TenantPluginAutoUpgradeMode.PARTIAL,
            include_plugins=["acme/foo"],
        )

        assert upgrade_mock.call_count == 1
        assert calls[0][1] == plugins[0].plugin_unique_identifier

    def test_mode_exclude_skips_excluded_plugins(self) -> None:
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0"),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]

        upgrade_mock, calls = _run_task(
            plugins=plugins,
            manifests=manifests,
            upgrade_mode=TenantPluginAutoUpgradeMode.EXCLUDE,
            exclude_plugins=["acme/bar"],
        )

        assert upgrade_mock.call_count == 1
        assert calls[0][1] == plugins[0].plugin_unique_identifier

    def test_category_strategy_only_upgrades_matching_category(self) -> None:
        plugins = [
            _make_plugin("acme/model-provider", "1.0.0", category=PluginCategory.Model),
            _make_plugin("acme/tool-provider", "1.0.0", category=PluginCategory.Tool),
        ]
        manifests = [
            _make_manifest("acme/model-provider", "1.0.1"),
            _make_manifest("acme/tool-provider", "1.0.1"),
        ]

        upgrade_mock, calls = _run_task(
            plugins=plugins,
            manifests=manifests,
            upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
            category=TenantPluginAutoUpgradeCategory.MODEL,
        )

        upgrade_mock.assert_called_once()
        assert calls[0][1] == plugins[0].plugin_unique_identifier


class TestErrorIsolation:
    def test_one_plugin_failure_does_not_block_others(self) -> None:
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0"),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]
        fake_manager = MagicMock()
        fake_manager.list_plugins.return_value = plugins

        seen: list[str] = []

        def _upgrade(tenant_id: str, original: str, new: str) -> None:
            seen.append(original)
            if "foo" in original:
                raise RuntimeError("boom")

        with (
            patch(f"{MODULE}.PluginInstaller", return_value=fake_manager),
            patch(f"{MODULE}.marketplace_batch_fetch_plugin_manifests", return_value=manifests),
            patch(f"{MODULE}.PluginService.upgrade_plugin_with_marketplace", side_effect=_upgrade),
        ):
            from tasks.process_tenant_plugin_autoupgrade_check_task import (
                _process_tenant_plugin_autoupgrade_check,
            )

            _process_tenant_plugin_autoupgrade_check(
                "tenant-1",
                TenantPluginAutoUpgradeStrategySetting.LATEST,
                0,
                TenantPluginAutoUpgradeMode.ALL,
                [],
                [],
            )

        assert any("foo" in s for s in seen)
        assert any("bar" in s for s in seen)


def _make_declaration(plugin_id: str, latest_version: str) -> SimpleNamespace:
    """Minimal stand-in for a MarketplacePluginDeclaration returned by the batch API."""
    org, name = plugin_id.split("/", 1)
    return SimpleNamespace(
        plugin_id=plugin_id,
        org=org,
        name=name,
        latest_version=latest_version,
        latest_package_identifier=f"{plugin_id}:{latest_version}@cafe1234",
    )


class TestManifestCacheFallback:
    """
    The global snapshot is a best-effort optimisation. When it does not cover a plugin,
    the check must fall back to the batch API instead of silently skipping the upgrade.
    """

    def _fetch(
        self,
        plugin_ids: list[str],
        *,
        cached: dict[str, str],
        declarations: list[SimpleNamespace] | None = None,
        batch_error: Exception | None = None,
    ) -> tuple[list[MarketplacePluginSnapshot], MagicMock, MagicMock]:
        from tasks.process_tenant_plugin_autoupgrade_check_task import (
            marketplace_batch_fetch_plugin_manifests,
        )

        redis_mock = MagicMock()
        redis_mock.get.side_effect = lambda key: cached.get(key)

        batch_mock = MagicMock()
        if batch_error is not None:
            batch_mock.side_effect = batch_error
        else:
            batch_mock.return_value = declarations or []

        with (
            patch(f"{MODULE}.redis_client", redis_mock),
            patch(f"{MODULE}.batch_fetch_plugin_manifests", batch_mock),
        ):
            result = marketplace_batch_fetch_plugin_manifests(plugin_ids)

        return result, batch_mock, redis_mock

    def test_cache_hits_do_not_touch_the_marketplace(self) -> None:
        """The whole point of the snapshot: a warm cache must not generate any request."""
        key = "plugin_autoupgrade_check_task:cached_plugin_snapshot:langgenius/foo"
        cached = {key: _make_manifest("langgenius/foo", "1.1.0").model_dump_json()}

        result, batch_mock, _ = self._fetch(["langgenius/foo"], cached=cached)

        assert [r.latest_version for r in result] == ["1.1.0"]
        batch_mock.assert_not_called()

    def test_empty_snapshot_falls_back_to_batch_api(self) -> None:
        """Regression: an empty global snapshot used to skip every plugin silently."""
        result, batch_mock, _ = self._fetch(
            ["langgenius/foo"],
            cached={},
            declarations=[_make_declaration("langgenius/foo", "1.2.0")],
        )

        batch_mock.assert_called_once_with(["langgenius/foo"])
        assert [r.plugin_id for r in result] == ["langgenius/foo"]

        assert [r.latest_version for r in result] == ["1.2.0"]

    def test_fallback_results_are_cached(self) -> None:
        _, _, redis_mock = self._fetch(
            ["langgenius/foo"],
            cached={},
            declarations=[_make_declaration("langgenius/foo", "1.2.0")],
        )

        cached_keys = [call.args[0] for call in redis_mock.setex.call_args_list]
        assert "plugin_autoupgrade_check_task:cached_plugin_snapshot:langgenius/foo" in cached_keys

    def test_plugins_unknown_to_the_marketplace_are_negatively_cached(self) -> None:
        """Avoid re-asking about a plugin the marketplace does not serve on every cycle."""
        _, _, redis_mock = self._fetch(["langgenius/ghost"], cached={}, declarations=[])

        redis_mock.setex.assert_called_once()
        key, _ttl, value = redis_mock.setex.call_args.args
        assert key == "plugin_autoupgrade_check_task:cached_plugin_snapshot:langgenius/ghost"
        assert value == "null"

    def test_negatively_cached_plugins_are_not_refetched(self) -> None:
        key = "plugin_autoupgrade_check_task:cached_plugin_snapshot:langgenius/ghost"

        result, batch_mock, _ = self._fetch(["langgenius/ghost"], cached={key: "null"})

        assert result == []
        batch_mock.assert_not_called()

    def test_marketplace_failure_keeps_cached_results(self) -> None:
        """A failing batch call must not lose the plugins the snapshot did cover."""
        key = "plugin_autoupgrade_check_task:cached_plugin_snapshot:langgenius/foo"
        cached = {key: _make_manifest("langgenius/foo", "1.1.0").model_dump_json()}

        result, _, _ = self._fetch(
            ["langgenius/foo", "langgenius/bar"],
            cached=cached,
            batch_error=RuntimeError("marketplace down"),
        )

        assert [r.plugin_id for r in result] == ["langgenius/foo"]


_ADMISSION_NOW = 1794814200.0


def _reservation(*, deadline: float = _ADMISSION_NOW + 86400) -> CheckReservation:
    """Build a valid immutable reservation whose deadline is controlled by each test."""
    return CheckReservation(
        tenant_id="tenant-1",
        category="tool",
        logical_day="2026-11-16",
        token="a" * 32,
        deadline=deadline,
    )


@dataclass
class _AdmissionClock:
    now: float

    def time(self) -> float:
        """Return the selected wall time without advancing it."""
        return self.now


@dataclass
class _AdmissionCoordinator:
    reservation: CheckReservation | None
    result: AcquireResult = AcquireResult.ACQUIRED
    acquisitions: list[tuple[CheckReservation, str]] = field(default_factory=list)
    finishes: list[tuple[CheckReservation, str]] = field(default_factory=list)
    legacy_calls: list[tuple[str, str | None, int, float, str | None]] = field(default_factory=list)
    acquire_error: RedisError | None = None
    reserve_error: RedisError | None = None
    finish_error: RedisError | None = None

    def reserve_legacy(
        self,
        tenant_id: str,
        category: str | None,
        upgrade_time_of_day: int,
        now: float,
        producer_id: str | None = None,
    ) -> CheckReservation | None:
        """Record old-message admission and return its configured reservation or failure."""
        self.legacy_calls.append((tenant_id, category, upgrade_time_of_day, now, producer_id))
        if self.reserve_error is not None:
            raise self.reserve_error
        return self.reservation

    def acquire(self, reservation: CheckReservation, execution_token: str) -> AcquireResult:
        """Record every admission attempt without performing plugin work."""
        self.acquisitions.append((reservation, execution_token))
        if self.acquire_error is not None:
            raise self.acquire_error
        return self.result

    def finish(self, reservation: CheckReservation, execution_token: str) -> None:
        """Record cleanup with the exact execution owner that acquired the slot."""
        self.finishes.append((reservation, execution_token))
        if self.finish_error is not None:
            raise self.finish_error


@dataclass
class _Processor:
    calls: list[tuple[object, ...]] = field(default_factory=list)
    failure: Exception | None = None

    def __call__(self, *args: object) -> None:
        """Record business work only after admission; optionally simulate a failure."""
        self.calls.append(args)
        if self.failure is not None:
            raise self.failure


@dataclass
class _AdmissionRetry:
    calls: list[dict[str, object]] = field(default_factory=list)

    def __call__(self, **kwargs: object) -> Never:
        """Record Celery retry arguments and raise the real retry control-flow exception."""
        self.calls.append(kwargs)
        raise Retry()


@dataclass
class _AdmissionHarness:
    coordinator: _AdmissionCoordinator
    processor: _Processor
    retry: _AdmissionRetry


def _setup_admission(
    monkeypatch: pytest.MonkeyPatch,
    *,
    reservation: CheckReservation | None = None,
    result: AcquireResult = AcquireResult.ACQUIRED,
    replace_retry: bool = True,
) -> _AdmissionHarness:
    """Leave the public task wrapper real and replace its I/O boundary with recorders."""
    coordinator = _AdmissionCoordinator(reservation=reservation, result=result)
    processor = _Processor()
    retry = _AdmissionRetry()
    monkeypatch.setattr(upgrade_module, "time", _AdmissionClock(_ADMISSION_NOW))
    monkeypatch.setattr(upgrade_module, "get_upgrade_check_coordinator", lambda: coordinator)
    monkeypatch.setattr(upgrade_module, "_process_tenant_plugin_autoupgrade_check", processor)
    if replace_retry:
        monkeypatch.setattr(upgrade_module.process_tenant_plugin_autoupgrade_check_task, "retry", retry)
    return _AdmissionHarness(coordinator, processor, retry)


def _run_admitted_task(
    coordination: dict[str, object] | None,
    *,
    strategy_setting: TenantPluginAutoUpgradeStrategySetting = TenantPluginAutoUpgradeStrategySetting.LATEST,
) -> None:
    """Execute one delivery with the same task arguments that the scheduler publishes."""
    task = upgrade_module.process_tenant_plugin_autoupgrade_check_task
    headers = (
        {}
        if coordination is None
        else {upgrade_module.COORDINATION_HEADER: CheckReservation.model_validate(coordination).model_dump_json()}
    )
    task.push_request(id="child-1", headers=headers)
    try:
        task.run(
            "tenant-1",
            strategy_setting,
            27000,
            TenantPluginAutoUpgradeMode.ALL,
            [],
            [],
            TenantPluginAutoUpgradeCategory.TOOL,
        )
    finally:
        task.pop_request()


def test_admitted_child_releases_its_exact_execution_slot(monkeypatch: pytest.MonkeyPatch) -> None:
    """A granted reservation runs the processor once and releases its execution owner."""
    reservation = _reservation()
    harness = _setup_admission(monkeypatch)

    _run_admitted_task(reservation.model_dump(mode="json"))

    assert len(harness.processor.calls) == 1
    assert harness.processor.calls[0][0] == "tenant-1"
    assert len(harness.coordinator.acquisitions) == 1
    assert harness.coordinator.finishes == harness.coordinator.acquisitions
    assert harness.retry.calls == []


def test_child_processor_failure_still_releases_execution_slot(monkeypatch: pytest.MonkeyPatch) -> None:
    """Even unexpected processor failures cannot leak a normally releasable slot."""
    harness = _setup_admission(monkeypatch)
    harness.processor.failure = RuntimeError("processor failed")

    with pytest.raises(RuntimeError, match="processor failed"):
        _run_admitted_task(_reservation().model_dump(mode="json"))

    assert harness.coordinator.finishes == harness.coordinator.acquisitions
    assert len(harness.coordinator.finishes) == 1


def test_busy_child_retries_before_business_work_and_keeps_reservation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Capacity exhaustion escapes as Celery Retry and does not bypass admission."""
    reservation = _reservation()
    harness = _setup_admission(monkeypatch, result=AcquireResult.BUSY)

    with pytest.raises(Retry):
        _run_admitted_task(reservation.model_dump(mode="json"))

    assert harness.processor.calls == []
    assert harness.coordinator.finishes == []
    assert len(harness.retry.calls) == 1
    retry = harness.retry.calls[0]
    assert retry["max_retries"] is None
    assert retry["headers"] == {upgrade_module.COORDINATION_HEADER: reservation.model_dump_json()}
    countdown = retry["countdown"]
    assert isinstance(countdown, int | float)
    assert 0 < countdown <= 60


def test_redis_admission_error_retries_without_business_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """Redis unavailability cannot turn an unadmitted delivery into plugin work."""
    reservation = _reservation()
    harness = _setup_admission(monkeypatch)
    harness.coordinator.acquire_error = RedisError("redis unavailable")

    with pytest.raises(Retry):
        _run_admitted_task(reservation.model_dump(mode="json"))

    assert harness.processor.calls == []
    assert harness.coordinator.finishes == []
    assert harness.retry.calls[0]["headers"] == {upgrade_module.COORDINATION_HEADER: reservation.model_dump_json()}


def test_expired_delivery_does_not_retry_after_redis_admission_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unavailable gate cannot extend expired work or authorize a fallback execution."""
    harness = _setup_admission(monkeypatch)
    harness.coordinator.acquire_error = RedisError("redis unavailable")

    _run_admitted_task(_reservation(deadline=_ADMISSION_NOW - 1).model_dump(mode="json"))

    assert len(harness.coordinator.acquisitions) == 1
    assert harness.retry.calls == []
    assert harness.processor.calls == []
    assert harness.coordinator.finishes == []


def test_busy_child_uses_real_celery_retry_beyond_the_default_three_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    """A deferred delivery preserves its public retry publication after the default retry limit."""
    reservation = _reservation()
    harness = _setup_admission(monkeypatch, result=AcquireResult.BUSY, replace_retry=False)
    task = upgrade_module.process_tenant_plugin_autoupgrade_check_task
    exclude_plugins: list[str] = []
    include_plugins: list[str] = []
    args = (
        "tenant-1",
        TenantPluginAutoUpgradeStrategySetting.LATEST,
        27000,
        TenantPluginAutoUpgradeMode.ALL,
        exclude_plugins,
        include_plugins,
        TenantPluginAutoUpgradeCategory.TOOL,
    )
    headers = {
        upgrade_module.COORDINATION_HEADER: reservation.model_dump_json(),
        "traceparent": "parent-trace",
    }
    publications: list[tuple[tuple[object, ...], dict[str, object], dict[str, object]]] = []

    def publish_retry(
        published_args: tuple[object, ...], published_kwargs: dict[str, object], **options: object
    ) -> None:
        """Record the real Celery retry's broker boundary without sending a message."""
        publications.append((published_args, published_kwargs, options))

    monkeypatch.setattr(task, "apply_async", publish_retry)
    task.push_request(args=args, kwargs={}, headers=headers, retries=4, is_eager=False, called_directly=False)
    try:
        with pytest.raises(Retry):
            task.run(*args)
    finally:
        task.pop_request()

    assert harness.processor.calls == []
    assert harness.coordinator.finishes == []
    assert harness.retry.calls == []
    assert len(publications) == 1
    published_args, published_kwargs, options = publications[0]
    assert published_args == args
    assert published_kwargs == {}
    assert options["headers"] == headers
    assert options["retries"] == 5


@pytest.mark.parametrize("result", [AcquireResult.DUPLICATE, AcquireResult.EXPIRED])
def test_stale_or_completed_deliveries_perform_no_work(result: AcquireResult, monkeypatch: pytest.MonkeyPatch) -> None:
    """A rejected delivery neither retries nor releases ownership held by another execution."""
    harness = _setup_admission(monkeypatch, result=result)

    _run_admitted_task(_reservation().model_dump(mode="json"))

    assert harness.processor.calls == []
    assert harness.coordinator.finishes == []
    assert harness.retry.calls == []


def test_busy_delivery_stops_retrying_after_its_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Expired pending work cannot requeue itself forever while capacity is occupied."""
    harness = _setup_admission(monkeypatch, result=AcquireResult.BUSY)

    _run_admitted_task(_reservation(deadline=_ADMISSION_NOW - 1).model_dump(mode="json"))

    assert harness.processor.calls == []
    assert harness.retry.calls == []


def test_admission_retry_does_not_outlive_remaining_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Backoff is shortened when only a fraction of a second remains in the work window."""
    harness = _setup_admission(monkeypatch, result=AcquireResult.BUSY)

    with pytest.raises(Retry):
        _run_admitted_task(_reservation(deadline=_ADMISSION_NOW + 0.5).model_dump(mode="json"))

    assert harness.retry.calls[0]["countdown"] == 0.5
    assert harness.processor.calls == []


def test_legacy_delivery_reserves_before_using_the_global_execution_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    """Messages queued before deployment receive a reservation and the same admission gate."""
    harness = _setup_admission(monkeypatch, reservation=_reservation())

    _run_admitted_task(None)

    assert harness.coordinator.legacy_calls == [("tenant-1", "tool", 27000, _ADMISSION_NOW, "legacy:child-1")]
    assert len(harness.processor.calls) == 1
    assert harness.coordinator.finishes == harness.coordinator.acquisitions


def test_duplicate_legacy_delivery_is_not_admitted(monkeypatch: pytest.MonkeyPatch) -> None:
    """A legacy message already covered by another check cannot skip daily deduplication."""
    harness = _setup_admission(monkeypatch)

    _run_admitted_task(None)

    assert harness.coordinator.acquisitions == []
    assert harness.processor.calls == []


def test_legacy_redis_failure_has_bounded_retries_before_a_deadline_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    """Old messages without reservations do not retry admission indefinitely on Redis failure."""
    harness = _setup_admission(monkeypatch)
    harness.coordinator.reserve_error = RedisError("redis unavailable")

    with pytest.raises(Retry):
        _run_admitted_task(None)

    assert harness.retry.calls[0]["countdown"] == 30
    assert harness.retry.calls[0]["max_retries"] == 3
    assert harness.processor.calls == []


@pytest.mark.parametrize("overrides", [{"tenant_id": "other-tenant"}, {"category": "model"}])
def test_reservation_cannot_select_another_tenant_or_category(
    overrides: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Queue payload mismatch is rejected before any execution slot or plugin access."""
    harness = _setup_admission(monkeypatch)
    payload = _reservation().model_dump(mode="json") | overrides

    with pytest.raises(ValueError, match="does not match"):
        _run_admitted_task(payload)

    assert harness.coordinator.acquisitions == []
    assert harness.processor.calls == []


def test_disabled_child_skips_reservation_and_execution(monkeypatch: pytest.MonkeyPatch) -> None:
    """A disabled strategy has no admission or plugin side effects."""
    harness = _setup_admission(monkeypatch)

    _run_admitted_task(None, strategy_setting=TenantPluginAutoUpgradeStrategySetting.DISABLED)

    assert harness.coordinator.legacy_calls == []
    assert harness.coordinator.acquisitions == []
    assert harness.processor.calls == []


def test_finish_redis_failure_does_not_repeat_successful_plugin_work(monkeypatch: pytest.MonkeyPatch) -> None:
    """A cleanup outage logs the retained lease rather than rerunning business effects."""
    harness = _setup_admission(monkeypatch)
    harness.coordinator.finish_error = RedisError("redis unavailable")

    _run_admitted_task(_reservation().model_dump(mode="json"))

    assert len(harness.processor.calls) == 1
    assert len(harness.coordinator.finishes) == 1
    assert harness.retry.calls == []


def test_task_hard_limit_precedes_lease_reuse() -> None:
    """On hard-limit-capable workers, including cooperative gevent, execution ends before lease reuse."""
    task = upgrade_module.process_tenant_plugin_autoupgrade_check_task
    assert task.time_limit == CHECK_TASK_TIME_LIMIT
    assert task.time_limit < CHECK_SLOT_LEASE_SECONDS
    assert task.acks_late is True
    assert task.reject_on_worker_lost is True

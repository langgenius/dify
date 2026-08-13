from __future__ import annotations

# pyright: reportPrivateUsage=false

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import threading
from typing import cast

from e2b import RateLimitException, Sandbox
from pydantic import SecretStr, ValidationError
import pytest

from benchmarks import staging_e2b_observer as observer_module
from benchmarks.staging_e2b_observer import (
    E2BMetadataInventoryCounter,
    E2BObserverSample,
    E2B_FREE_RUNNING_LIMIT,
    E2B_OBSERVER_MAX_DURATION_SECONDS,
    StagingE2BLocalObserver,
    StagingE2BLocalObserverOptions,
    observe_e2b_inventory,
    summarize_e2b_observation,
)


_STARTED_AT = datetime(2026, 8, 13, 7, 0, tzinfo=timezone.utc)
_API_KEY = "e2b_" + "a" * 40
_TENANT_ID = "benchmark-tenant-private"
_AGENT_ID = "benchmark-agent-private"


def _record(
    sandbox_id: str,
    state: str,
    *,
    tenant_id: str = _TENANT_ID,
    agent_id: str = _AGENT_ID,
    started_at: datetime = _STARTED_AT,
    binding_id: str | None = None,
    workspace_id: str | None = None,
) -> observer_module._InventoryRecord:
    metadata = {
        "dify.tenant_id": tenant_id,
        "dify.agent_id": agent_id,
        "dify.binding_id": binding_id or f"binding-{sandbox_id}",
        "dify.workspace_id": workspace_id or f"workspace-{sandbox_id}",
    }
    return observer_module._InventoryRecord(
        sandbox_id=sandbox_id,
        state=state,
        metadata=metadata,
        started_at=started_at,
    )


def _snapshot(
    running: int,
    paused: int,
    records: tuple[observer_module._InventoryRecord, ...] = (),
) -> observer_module._InventorySnapshot:
    return observer_module._InventorySnapshot(running=running, paused=paused, records=records)


@dataclass(slots=True)
class _SequenceCounter:
    values: Sequence[observer_module._InventorySnapshot | BaseException]
    index: int = 0

    def snapshot_inventory(self) -> observer_module._InventorySnapshot:
        item = self.values[min(self.index, len(self.values) - 1)]
        self.index += 1
        if isinstance(item, BaseException):
            raise item
        return item


@dataclass(slots=True)
class _Clock:
    elapsed_seconds: float = 0

    def monotonic(self) -> float:
        return self.elapsed_seconds

    def sleep(self, duration_seconds: float) -> None:
        self.elapsed_seconds += duration_seconds

    def utc_now(self) -> datetime:
        return _STARTED_AT + timedelta(seconds=self.elapsed_seconds)


@dataclass(frozen=True, slots=True)
class _SdkSandbox:
    sandbox_id: str
    state: str
    metadata: dict[str, str]
    started_at: datetime


@dataclass(slots=True)
class _SdkPaginator:
    pages: list[list[_SdkSandbox]]
    page_index: int = 0

    @property
    def has_next(self) -> bool:
        return self.page_index < len(self.pages)

    @property
    def next_token(self) -> str | None:
        return f"page-{self.page_index}" if self.has_next else None

    def next_items(self) -> list[_SdkSandbox]:
        page = self.pages[self.page_index]
        self.page_index += 1
        return page


@dataclass(slots=True)
class _TargetRegistry:
    seen_sandbox_ids: set[str]

    def write_new_records(
        self,
        observed_at: datetime,
        records: tuple[observer_module._InventoryRecord, ...],
    ) -> None:
        del observed_at
        self.seen_sandbox_ids.update(record.sandbox_id for record in records)


def _sample(
    running: int | None,
    paused: int | None,
    status: observer_module.E2BApiStatus,
    *,
    target_remaining: int | None = None,
) -> E2BObserverSample:
    return E2BObserverSample(
        timestamp=_STARTED_AT,
        running=running,
        paused=paused,
        target_remaining=0 if status == "ok" and target_remaining is None else target_remaining,
        api_status=status,
    )


def test_metadata_counter_filters_locally_and_never_serializes_private_identity() -> None:
    captured_filter: dict[str, str] = {}
    captured_key = ""
    records = [
        _record("running-match", "running"),
        _record("paused-match", "paused"),
        _record("other-tenant", "running", tenant_id="other"),
        _record("other-agent", "paused", agent_id="other"),
    ]

    def load_inventory(
        metadata_filter: Mapping[str, str],
        api_key: str,
        _request_timeout_seconds: float,
    ) -> Sequence[observer_module._InventoryRecord]:
        nonlocal captured_key
        captured_filter.update(metadata_filter)
        captured_key = api_key
        return records

    counter = E2BMetadataInventoryCounter(
        api_key=SecretStr(_API_KEY),
        tenant_id=SecretStr(_TENANT_ID),
        agent_id=SecretStr(_AGENT_ID),
        inventory_loader=load_inventory,
    )

    snapshot = counter.snapshot_inventory()

    assert (snapshot.running, snapshot.paused) == (1, 1)
    assert {record.sandbox_id for record in snapshot.records} == {"running-match", "paused-match"}
    assert captured_filter == {"dify.tenant_id": _TENANT_ID, "dify.agent_id": _AGENT_ID}
    assert captured_key == _API_KEY
    public_payload = E2BObserverSample(
        timestamp=_STARTED_AT,
        running=snapshot.running,
        paused=snapshot.paused,
        target_remaining=0,
        api_status="ok",
    ).model_dump_json()
    for private_value in (_API_KEY, _TENANT_ID, _AGENT_ID, "running-match", "binding-running-match"):
        assert private_value not in public_payload


def test_sdk_loader_uses_server_side_metadata_filter_and_bounded_page_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    sandbox = _SdkSandbox(
        sandbox_id="sandbox-private",
        state="running",
        metadata={"dify.tenant_id": _TENANT_ID, "dify.agent_id": _AGENT_ID},
        started_at=_STARTED_AT,
    )

    def fake_list(*, query: object, limit: int, **options: object) -> _SdkPaginator:
        captured.update(query=query, limit=limit, options=options)
        return _SdkPaginator(pages=[[sandbox], []])

    monkeypatch.setattr(Sandbox, "list", staticmethod(fake_list))

    records = list(
        observer_module._load_e2b_inventory(
            {"dify.tenant_id": _TENANT_ID, "dify.agent_id": _AGENT_ID},
            _API_KEY,
            0.8,
        )
    )

    query = captured["query"]
    assert getattr(query, "metadata") == {
        "dify.tenant_id": _TENANT_ID,
        "dify.agent_id": _AGENT_ID,
    }
    assert captured["limit"] == observer_module.E2B_LIST_PAGE_SIZE
    assert captured["options"] == {"api_key": _API_KEY, "request_timeout": 0.8}
    assert len(records) == 1
    assert records[0].sandbox_id == "sandbox-private"


def test_sdk_loader_fails_closed_when_inventory_exceeds_page_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paginator = _SdkPaginator(pages=[[] for _ in range(observer_module.E2B_LIST_MAX_PAGES + 1)])

    def fake_list(**_options: object) -> _SdkPaginator:
        return paginator

    monkeypatch.setattr(Sandbox, "list", staticmethod(fake_list))

    with pytest.raises(RuntimeError, match="bounded observer page limit"):
        _ = list(observer_module._load_e2b_inventory({}, _API_KEY, 0.8))


def test_observer_samples_on_one_second_schedule_and_detects_three_seconds_at_limit() -> None:
    clock = _Clock()
    samples: list[E2BObserverSample] = []
    counter = _SequenceCounter(
        [
            _snapshot(19, 4),
            _snapshot(20, 4),
            _snapshot(20, 4),
            _snapshot(20, 4),
        ]
    )

    run = observe_e2b_inventory(
        counter,
        duration_seconds=4,
        on_sample=samples.append,
        monotonic=clock.monotonic,
        utc_now=clock.utc_now,
        sleep=clock.sleep,
    )

    assert [sample.timestamp for sample in samples] == [
        _STARTED_AT + timedelta(seconds=offset) for offset in range(4)
    ]
    assert run.summary.running_max == E2B_FREE_RUNNING_LIMIT
    assert run.summary.paused_max == 4
    assert run.summary.running_limit_consecutive_seconds == 3
    assert run.summary.limit_reached is True
    assert run.summary.vendor_throttle_observed is False
    assert run.summary.observation_complete is True
    assert run.summary.observer_started_at == _STARTED_AT
    assert run.summary.observer_ended_at == _STARTED_AT + timedelta(seconds=3)


def test_target_remaining_and_final_zero_streak_use_private_discovered_ids_only() -> None:
    clock = _Clock()
    record_a = _record("sandbox-a", "paused", started_at=_STARTED_AT)
    record_b = _record("sandbox-b", "paused", started_at=_STARTED_AT + timedelta(seconds=1))
    counter = _SequenceCounter(
        [
            _snapshot(0, 1, (record_a,)),
            _snapshot(0, 2, (record_a, record_b)),
            _snapshot(0, 1, (record_b,)),
            _snapshot(0, 0, ()),
            _snapshot(0, 0, ()),
        ]
    )
    registry = _TargetRegistry(seen_sandbox_ids=set())
    run = observe_e2b_inventory(
        counter,
        duration_seconds=5,
        private_targets=registry,
        monotonic=clock.monotonic,
        utc_now=clock.utc_now,
        sleep=clock.sleep,
    )

    assert [sample.target_remaining for sample in run.samples] == [1, 2, 1, 0, 0]
    assert run.summary.target_count == 2
    assert run.summary.target_zero_consecutive_seconds == 2
    public_text = "\n".join(sample.model_dump_json() for sample in run.samples)
    assert "sandbox-a" not in public_text
    assert "sandbox-b" not in public_text


def test_target_zero_streak_counts_only_trailing_seconds_after_a_target_was_present() -> None:
    samples = [
        _sample(0, 0, "ok", target_remaining=0),
        _sample(0, 1, "ok", target_remaining=1),
        *[_sample(0, 0, "ok", target_remaining=0) for _ in range(10)],
    ]

    summary = summarize_e2b_observation(
        samples,
        expected_sample_count=len(samples),
        target_count=1,
    )

    assert summary.target_count == 1
    assert summary.target_zero_consecutive_seconds == 10


def test_explicit_stop_after_successful_samples_is_a_complete_bounded_observation() -> None:
    clock = _Clock()
    counter = _SequenceCounter([_snapshot(3, 5), _snapshot(4, 5), _snapshot(5, 5)])

    run = observe_e2b_inventory(
        counter,
        duration_seconds=100,
        stop_requested=lambda: counter.index >= 3,
        monotonic=clock.monotonic,
        utc_now=clock.utc_now,
        sleep=clock.sleep,
    )

    assert len(run.samples) == 3
    assert run.summary.sample_count == 3
    assert run.summary.successful_sample_count == 3
    assert run.summary.observation_complete is True
    assert run.summary.observer_started_at == _STARTED_AT
    assert run.summary.observer_ended_at == _STARTED_AT + timedelta(seconds=2)


def test_explicit_stop_does_not_hide_a_failed_sample() -> None:
    clock = _Clock()
    counter = _SequenceCounter([_snapshot(3, 5), RuntimeError("private failure")])

    run = observe_e2b_inventory(
        counter,
        duration_seconds=100,
        stop_requested=lambda: counter.index >= 2,
        monotonic=clock.monotonic,
        utc_now=clock.utc_now,
        sleep=clock.sleep,
    )

    assert len(run.samples) == 2
    assert run.summary.api_error_count == 1
    assert run.summary.observation_complete is False


def test_limit_detection_resets_after_failed_or_below_limit_sample() -> None:
    summary = summarize_e2b_observation(
        [
            _sample(20, 1, "ok"),
            _sample(20, 1, "ok"),
            _sample(None, None, "error"),
            _sample(20, 1, "ok"),
            _sample(19, 1, "ok"),
            _sample(20, 1, "ok"),
            _sample(20, 1, "ok"),
        ],
        expected_sample_count=7,
    )

    assert summary.running_limit_consecutive_seconds == 2
    assert summary.limit_reached is False
    assert summary.api_error_count == 1
    assert summary.observation_complete is False


def test_vendor_throttle_is_fixed_status_and_exception_details_are_never_serialized() -> None:
    clock = _Clock()
    secret_error = f"request included {_API_KEY} sandbox-private-id"
    run = observe_e2b_inventory(
        _SequenceCounter([RateLimitException(secret_error), RuntimeError(secret_error)]),
        duration_seconds=2,
        monotonic=clock.monotonic,
        utc_now=clock.utc_now,
        sleep=clock.sleep,
    )

    assert [sample.api_status for sample in run.samples] == ["throttled", "error"]
    assert run.summary.vendor_throttle_observed is True
    assert run.summary.throttled_sample_count == 1
    assert run.summary.api_error_count == 1
    serialized = "\n".join(sample.model_dump_json() for sample in run.samples)
    assert _API_KEY not in serialized
    assert "sandbox-private-id" not in serialized
    assert secret_error not in run.summary.model_dump_json()


def test_capacity_mapping_has_no_identity_and_preserves_count_only_signal() -> None:
    summary = summarize_e2b_observation(
        [
            _sample(20, 7, "ok"),
            _sample(20, 8, "ok"),
            _sample(20, 9, "ok"),
        ],
        expected_sample_count=3,
    )

    mapped = observer_module.to_capacity_e2b_observation(summary)

    assert mapped.model_dump() == {
        "running_max": 20,
        "paused_max": 9,
        "running_limit": 20,
        "running_limit_consecutive_seconds": 3,
        "limit_reached": True,
        "vendor_throttle_observed": False,
        "observation_complete": True,
        "sample_count": 3,
        "successful_sample_count": 3,
        "api_error_count": 0,
        "error": None,
    }
    serialized = mapped.model_dump_json()
    assert _API_KEY not in serialized
    assert _TENANT_ID not in serialized
    assert _AGENT_ID not in serialized


def test_capacity_window_mapping_excludes_setup_and_cleanup_samples() -> None:
    setup_throttle = _sample(None, None, "throttled").model_copy(
        update={"timestamp": _STARTED_AT - timedelta(seconds=1)}
    )
    measurement = [
        _sample(20, 5, "ok").model_copy(update={"timestamp": _STARTED_AT + timedelta(seconds=offset)})
        for offset in range(3)
    ]
    cleanup = _sample(0, 0, "ok").model_copy(
        update={"timestamp": _STARTED_AT + timedelta(seconds=3)}
    )

    mapped = observer_module.capacity_e2b_observation_for_window(
        [setup_throttle, *measurement, cleanup],
        measurement_started_at=_STARTED_AT,
        measurement_ended_at=_STARTED_AT + timedelta(seconds=3),
    )

    assert mapped.sample_count == 3
    assert mapped.successful_sample_count == 3
    assert mapped.vendor_throttle_observed is False
    assert mapped.running_max == 20
    assert mapped.running_limit_consecutive_seconds == 3
    assert mapped.limit_reached is True
    assert mapped.observation_complete is True


def test_capacity_window_mapping_marks_a_missing_one_second_sample_incomplete() -> None:
    samples = [
        _sample(10, 5, "ok").model_copy(update={"timestamp": _STARTED_AT}),
        _sample(10, 5, "ok").model_copy(update={"timestamp": _STARTED_AT + timedelta(seconds=2)}),
    ]

    mapped = observer_module.capacity_e2b_observation_for_window(
        samples,
        measurement_started_at=_STARTED_AT,
        measurement_ended_at=_STARTED_AT + timedelta(seconds=3),
    )

    assert mapped.sample_count == 2
    assert mapped.successful_sample_count == 2
    assert mapped.observation_complete is False
    assert mapped.error == "incomplete_samples"


def test_capacity_window_mapping_accepts_sixty_phase_offset_samples() -> None:
    measurement_started_at = _STARTED_AT + timedelta(milliseconds=200)
    measurement_ended_at = measurement_started_at + timedelta(seconds=60, microseconds=1)
    samples = [
        _sample(10, 5, "ok").model_copy(
            update={"timestamp": _STARTED_AT + timedelta(seconds=offset)}
        )
        for offset in range(1, 61)
    ]

    mapped = observer_module.capacity_e2b_observation_for_window(
        samples,
        measurement_started_at=measurement_started_at,
        measurement_ended_at=measurement_ended_at,
    )

    assert mapped.sample_count == 60
    assert mapped.successful_sample_count == 60
    assert mapped.observation_complete is True
    assert mapped.error is None


def test_sample_schema_rejects_counts_on_failure_and_missing_counts_on_success() -> None:
    with pytest.raises(ValidationError):
        _ = _sample(None, None, "ok")
    with pytest.raises(ValidationError):
        _ = _sample(1, 2, "error")


def test_private_manifest_is_mode_0600_outside_public_artifacts_and_records_new_targets_once(
    tmp_path: Path,
) -> None:
    public_dir = tmp_path / "public"
    private_dir = tmp_path / "private"
    public_dir.mkdir()
    private_dir.mkdir()
    manifest_path = private_dir / "cleanup-targets.jsonl"
    observer_started_at = _STARTED_AT
    new_record = _record("new-sandbox", "paused", started_at=_STARTED_AT)
    old_record = _record("old-sandbox", "paused", started_at=_STARTED_AT - timedelta(microseconds=1))

    observer_module._require_private_path_outside_public_artifacts(manifest_path, public_dir)
    with observer_module._PrivateManifestWriter.open(manifest_path, observer_started_at) as manifest:
        manifest.write_new_records(_STARTED_AT, (old_record, new_record))
        manifest.write_new_records(_STARTED_AT + timedelta(seconds=1), (new_record,))

    assert os.stat(manifest_path).st_mode & 0o777 == 0o600
    lines = manifest_path.read_text().splitlines()
    assert len(lines) == 1
    payload = cast(dict[str, object], json.loads(lines[0]))
    assert payload == {
        "binding_id": "binding-new-sandbox",
        "created_at": "2026-08-13T07:00:00+00:00",
        "first_observed_at": "2026-08-13T07:00:00+00:00",
        "sandbox_id": "new-sandbox",
        "state_when_first_observed": "paused",
        "workspace_id": "workspace-new-sandbox",
    }
    assert _API_KEY not in lines[0]
    assert _TENANT_ID not in lines[0]
    assert _AGENT_ID not in lines[0]
    assert not any(public_dir.iterdir())


def test_private_manifest_refuses_public_artifact_path(tmp_path: Path) -> None:
    public_dir = tmp_path / "public"
    public_dir.mkdir()

    with pytest.raises(ValueError, match="outside the public artifact"):
        observer_module._require_private_path_outside_public_artifacts(
            public_dir / "cleanup-targets.jsonl",
            public_dir,
        )


def test_private_manifest_fails_closed_without_cleanup_metadata(tmp_path: Path) -> None:
    private_dir = tmp_path / "private"
    private_dir.mkdir()
    record = observer_module._InventoryRecord(
        sandbox_id="new-sandbox",
        state="running",
        metadata={"dify.tenant_id": _TENANT_ID, "dify.agent_id": _AGENT_ID},
        started_at=_STARTED_AT,
    )

    with observer_module._PrivateManifestWriter.open(
        private_dir / "cleanup-targets.jsonl",
        _STARTED_AT,
    ) as manifest:
        with pytest.raises(RuntimeError, match="cleanup identity metadata"):
            manifest.write_new_records(_STARTED_AT, (record,))


def test_local_observer_subprocess_receives_only_e2b_identity_and_emits_count_only_evidence(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("BENCH_STAGING_API_KEY", "service-api-key-must-not-reach-observer")
    captured_environment: dict[str, str] = {}

    class Process:
        returncode: int | None = None

        def poll(self) -> int | None:
            return self.returncode

        def wait(self, *, timeout: float) -> int:
            assert timeout == 15
            self.returncode = 0
            return 0

        def terminate(self) -> None:
            self.returncode = -15

        def kill(self) -> None:
            self.returncode = -9

    def popen(command, *, cwd: str, env: dict[str, str], **_kwargs: object) -> Process:
        assert command == [observer_module.sys.executable, "-m", "benchmarks.staging_e2b_observer"]
        assert cwd.endswith("dify-agent")
        captured_environment.update(env)
        public_dir = Path(env[observer_module.E2B_OBSERVER_OUTPUT_DIR_ENV])
        public_dir.mkdir(parents=True)
        sample = E2BObserverSample(
            timestamp=_STARTED_AT,
            running=0,
            paused=0,
            target_remaining=0,
            api_status="ok",
        )
        (public_dir / observer_module.E2B_RUNNING_COUNTS_FILENAME).write_text(
            sample.model_dump_json() + "\n",
            encoding="utf-8",
        )
        summary = observer_module.E2BObserverSummary(
            observer_started_at=_STARTED_AT,
            observer_ended_at=_STARTED_AT,
            expected_sample_count=1,
            sample_count=1,
            successful_sample_count=1,
            throttled_sample_count=0,
            api_error_count=0,
            target_count=0,
            target_zero_consecutive_seconds=0,
            running_max=0,
            paused_max=0,
            running_limit_consecutive_seconds=0,
            limit_reached=False,
            vendor_throttle_observed=False,
            observation_complete=True,
        )
        (public_dir / observer_module.E2B_SUMMARY_FILENAME).write_text(
            summary.model_dump_json(),
            encoding="utf-8",
        )
        Path(env[observer_module.E2B_OBSERVER_PRIVATE_MANIFEST_ENV]).write_text("", encoding="utf-8")
        return Process()

    private_root = tmp_path / "private"
    private_root.mkdir(mode=0o700)
    local = StagingE2BLocalObserver(
        StagingE2BLocalObserverOptions(
            api_key=SecretStr(_API_KEY),
            tenant_id=SecretStr(_TENANT_ID),
            agent_id=SecretStr(_AGENT_ID),
            duration_seconds=60,
            runtime_dir=private_root / "runtime",
        ),
        popen=popen,
        sleep=lambda _seconds: None,
    )

    local.start()
    artifacts = local.stop_and_collect(
        public_output_dir=tmp_path / "public-evidence",
        private_manifest_path=private_root / "targets.jsonl",
    )

    assert captured_environment[observer_module.E2B_API_KEY_ENV] == _API_KEY
    assert captured_environment[observer_module.E2B_TENANT_ID_ENV] == _TENANT_ID
    assert captured_environment[observer_module.E2B_AGENT_ID_ENV] == _AGENT_ID
    assert "BENCH_STAGING_API_KEY" not in captured_environment
    assert "service-api-key-must-not-reach-observer" not in "\n".join(
        path.read_text() for path in artifacts.public_samples_path.parent.iterdir()
    )
    assert artifacts.private_manifest_path.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(
    "duration_seconds",
    [0, -1, float("nan"), float("inf"), E2B_OBSERVER_MAX_DURATION_SECONDS + 1],
)
def test_observer_rejects_unbounded_duration(duration_seconds: float) -> None:
    with pytest.raises(ValueError):
        _ = observe_e2b_inventory(_SequenceCounter([_snapshot(0, 0)]), duration_seconds=duration_seconds)


def test_cli_writes_only_sanitized_public_artifacts_without_network(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    public_dir = tmp_path / "public"
    private_dir = tmp_path / "private"
    private_dir.mkdir()
    private_manifest = private_dir / "cleanup-targets.jsonl"
    monkeypatch.setattr(
        observer_module,
        "_counter_from_environment",
        lambda: _SequenceCounter([_snapshot(0, 2)]),
    )

    exit_code = observer_module.main(
        [
            "--duration-seconds",
            "0.001",
            "--output-dir",
            str(public_dir),
            "--private-manifest",
            str(private_manifest),
        ]
    )

    assert exit_code == 0
    assert capsys.readouterr().out.strip() == str(public_dir)
    assert set(path.name for path in public_dir.iterdir()) == {
        "e2b-running-count.jsonl",
        "e2b-summary.json",
    }
    public_text = "\n".join(path.read_text() for path in public_dir.iterdir())
    for private_value in (_API_KEY, _TENANT_ID, _AGENT_ID, "sandbox_id", "metadata"):
        assert private_value not in public_text
    assert private_manifest.exists()
    assert private_manifest.read_text() == ""
    summary = cast(dict[str, object], json.loads((public_dir / "e2b-summary.json").read_text()))
    assert isinstance(summary["observer_started_at"], str)
    assert isinstance(summary["observer_ended_at"], str)


def test_stop_file_can_end_job_without_a_signal(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    stop_file = tmp_path / "stop"
    stop_file.touch()
    assert observer_module._stop_requested(threading.Event(), stop_file) is True

    monkeypatch.setenv(observer_module.E2B_OBSERVER_STOP_FILE_ENV, str(stop_file))
    parsed = observer_module._parse_args(
        ["--duration-seconds", "10", "--output-dir", str(tmp_path / "public")]
    )
    assert parsed.stop_file == stop_file


def test_cli_reports_missing_secret_environment_without_naming_values(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.delenv(observer_module.E2B_API_KEY_ENV, raising=False)
    monkeypatch.delenv(observer_module.E2B_TENANT_ID_ENV, raising=False)
    monkeypatch.delenv(observer_module.E2B_AGENT_ID_ENV, raising=False)

    exit_code = observer_module.main(
        ["--duration-seconds", "1", "--output-dir", str(tmp_path / "public")]
    )

    assert exit_code == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "E2B inventory observer failed; inspect sanitized artifacts\n"

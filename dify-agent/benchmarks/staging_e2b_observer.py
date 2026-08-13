"""Observe count-only E2B inventory from the local Staging Harness.

The observer runs beside local Locust as a bounded local subprocess. It reads
the E2B API key and dedicated Benchmark tenant/Agent identity only from its
environment, filters inventory by E2B metadata, and emits only timestamps,
state counts, and fixed API status values. Sandbox identifiers, metadata,
filter values, and exception text never cross the public artifact boundary.
"""

from __future__ import annotations

import argparse
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from types import FrameType, TracebackType
from typing import TYPE_CHECKING, ClassVar, Literal, Protocol, TextIO, cast

from e2b import RateLimitException, Sandbox, SandboxQuery
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

if TYPE_CHECKING:
    from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityE2BObservation


E2B_API_KEY_ENV = "BENCH_E2B_API_KEY"
E2B_TENANT_ID_ENV = "BENCH_E2B_TENANT_ID"
E2B_AGENT_ID_ENV = "BENCH_E2B_AGENT_ID"
E2B_OBSERVER_DURATION_ENV = "BENCH_E2B_OBSERVER_DURATION_SECONDS"
E2B_OBSERVER_OUTPUT_DIR_ENV = "BENCH_E2B_OBSERVER_OUTPUT_DIR"
E2B_OBSERVER_PRIVATE_MANIFEST_ENV = "BENCH_E2B_OBSERVER_PRIVATE_MANIFEST"
E2B_OBSERVER_STOP_FILE_ENV = "BENCH_E2B_OBSERVER_STOP_FILE"

E2B_FREE_RUNNING_LIMIT = 20
E2B_LIMIT_CONSECUTIVE_SECONDS = 3
E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS = 1
# The local observer polls a remote Vendor API synchronously. A capacity window
# remains useful when the remote list call occasionally spans more than one
# clock tick, but not when sampling becomes sparse or disappears for a long
# interval. Missing samples always break the three-consecutive-sample limit
# detector; these constants only decide whether count coverage is sufficient.
E2B_WINDOW_CADENCE_TOLERANCE_SECONDS = 0.25
E2B_WINDOW_MINIMUM_SECONDS_FOR_PARTIAL_COVERAGE = 60
E2B_WINDOW_MINIMUM_COVERAGE_RATIO = 0.90
E2B_WINDOW_MAX_CONSECUTIVE_MISSED_SAMPLES = 2
E2B_OBSERVER_MAX_DURATION_SECONDS = 6 * 60 * 60
E2B_LIST_REQUEST_TIMEOUT_SECONDS = 0.8
E2B_LIST_PAGE_SIZE = 100
E2B_LIST_MAX_PAGES = 10
E2B_LIST_MAX_ATTEMPTS = 2

E2B_RUNNING_COUNTS_FILENAME = "e2b-running-count.jsonl"
E2B_SUMMARY_FILENAME = "e2b-summary.json"

E2BApiStatus = Literal["ok", "throttled", "error"]


class E2BObserverSample(BaseModel):
    """One public, identifier-free E2B inventory sample."""

    timestamp: datetime
    running: int | None = Field(default=None, ge=0)
    paused: int | None = Field(default=None, ge=0)
    target_remaining: int | None = Field(default=None, ge=0)
    api_status: E2BApiStatus

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="after")
    def _counts_match_api_status(self) -> E2BObserverSample:
        if self.timestamp.tzinfo is None or self.timestamp.utcoffset() is None:
            raise ValueError("E2B sample timestamp must be timezone-aware")
        has_all_counts = self.running is not None and self.paused is not None and self.target_remaining is not None
        if self.api_status == "ok" and not has_all_counts:
            raise ValueError("successful E2B samples require running, paused, and target-remaining counts")
        if self.api_status != "ok" and any(
            value is not None for value in (self.running, self.paused, self.target_remaining)
        ):
            raise ValueError("failed E2B samples must not expose partial inventory counts")
        return self


class E2BObserverSummary(BaseModel):
    """Count-only summary consumed by the Staging capacity orchestrator."""

    observer_started_at: datetime
    observer_ended_at: datetime
    sample_interval_seconds: Literal[1] = E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS
    running_limit: Literal[20] = E2B_FREE_RUNNING_LIMIT
    limit_consecutive_seconds_required: Literal[3] = E2B_LIMIT_CONSECUTIVE_SECONDS
    expected_sample_count: int = Field(ge=0)
    sample_count: int = Field(ge=0)
    successful_sample_count: int = Field(ge=0)
    throttled_sample_count: int = Field(ge=0)
    api_error_count: int = Field(ge=0)
    target_count: int = Field(ge=0)
    target_zero_consecutive_seconds: int = Field(ge=0)
    running_max: int | None = Field(default=None, ge=0)
    paused_max: int | None = Field(default=None, ge=0)
    running_limit_consecutive_seconds: int = Field(ge=0)
    limit_reached: bool
    vendor_throttle_observed: bool
    observation_complete: bool

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="after")
    def _window_is_ordered(self) -> E2BObserverSummary:
        if self.observer_started_at.tzinfo is None or self.observer_started_at.utcoffset() is None:
            raise ValueError("observer_started_at must be timezone-aware")
        if self.observer_ended_at.tzinfo is None or self.observer_ended_at.utcoffset() is None:
            raise ValueError("observer_ended_at must be timezone-aware")
        if self.observer_ended_at < self.observer_started_at:
            raise ValueError("observer_ended_at cannot precede observer_started_at")
        if self.target_zero_consecutive_seconds > self.successful_sample_count:
            raise ValueError("target zero duration cannot exceed successful samples")
        if self.target_count == 0 and self.target_zero_consecutive_seconds:
            raise ValueError("target zero duration requires at least one discovered target")
        if self.successful_sample_count + self.throttled_sample_count + self.api_error_count != self.sample_count:
            raise ValueError("E2B API status counts must equal sample count")
        if self.vendor_throttle_observed != (self.throttled_sample_count > 0):
            raise ValueError("vendor throttle signal must match throttled samples")
        if self.limit_reached != (self.running_limit_consecutive_seconds >= self.limit_consecutive_seconds_required):
            raise ValueError("running limit signal must match consecutive seconds")
        expected_complete = (
            self.sample_count > 0
            and self.sample_count == self.expected_sample_count
            and self.successful_sample_count == self.sample_count
        )
        if self.observation_complete != expected_complete:
            raise ValueError("observation completeness must match uninterrupted successful sampling")
        return self


@dataclass(frozen=True, slots=True)
class _InventoryRecord:
    """Private SDK record projected to the fields needed for local filtering."""

    sandbox_id: str
    state: str
    metadata: Mapping[str, str]
    started_at: datetime


type _InventoryLoader = Callable[[Mapping[str, str], str, float], Iterable[_InventoryRecord]]


@dataclass(frozen=True, slots=True)
class _InventorySnapshot:
    running: int
    paused: int
    records: tuple[_InventoryRecord, ...]


class E2BInventoryCounter(Protocol):
    def snapshot_inventory(self) -> _InventorySnapshot:
        """Return counts and private records for the dedicated Benchmark identity."""

        ...


class E2BPrivateTargetRegistry(Protocol):
    @property
    def seen_sandbox_ids(self) -> set[str]: ...

    def write_new_records(self, observed_at: datetime, records: tuple[_InventoryRecord, ...]) -> None: ...


class _LocalObserverProcess(Protocol):
    """Small process contract so local tests need not fake ``Popen`` itself."""

    returncode: int | None

    def poll(self) -> int | None: ...

    def wait(self, *, timeout: float) -> int: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...


@dataclass(frozen=True, slots=True)
class E2BMetadataInventoryCounter:
    """Count E2B inventory selected by the Runtime backend's metadata keys."""

    api_key: SecretStr
    tenant_id: SecretStr
    agent_id: SecretStr
    request_timeout_seconds: float = E2B_LIST_REQUEST_TIMEOUT_SECONDS
    inventory_loader: _InventoryLoader | None = None

    def __post_init__(self) -> None:
        if not self.api_key.get_secret_value().strip():
            raise ValueError("E2B API key must not be empty")
        if not self.tenant_id.get_secret_value().strip():
            raise ValueError("E2B tenant filter must not be empty")
        if not self.agent_id.get_secret_value().strip():
            raise ValueError("E2B Agent filter must not be empty")
        if self.request_timeout_seconds <= 0:
            raise ValueError("E2B list request timeout must be positive")

    def snapshot_inventory(self) -> _InventorySnapshot:
        metadata_filter = {
            "dify.tenant_id": self.tenant_id.get_secret_value(),
            "dify.agent_id": self.agent_id.get_secret_value(),
        }
        running = 0
        paused = 0
        matching_records: list[_InventoryRecord] = []
        inventory_loader = self.inventory_loader or _load_e2b_inventory
        records: tuple[_InventoryRecord, ...] | None = None
        for attempt in range(E2B_LIST_MAX_ATTEMPTS):
            try:
                records = tuple(
                    inventory_loader(
                        metadata_filter,
                        self.api_key.get_secret_value(),
                        self.request_timeout_seconds,
                    )
                )
            except RateLimitException:
                # A Vendor throttle is capacity evidence, not a transient
                # transport failure. Preserve it without retrying.
                raise
            except Exception:
                if attempt + 1 >= E2B_LIST_MAX_ATTEMPTS:
                    raise
            else:
                break
        if records is None:  # pragma: no cover - the bounded loop either returns or raises
            raise RuntimeError("E2B inventory retry loop did not produce a result")
        for record in records:
            # E2B performs the server-side metadata filter. Verify it locally
            # as well so unrelated Team inventory can never affect counts.
            if any(record.metadata.get(key) != value for key, value in metadata_filter.items()):
                continue
            if record.state == "running":
                running += 1
            elif record.state == "paused":
                paused += 1
            else:
                raise RuntimeError("E2B inventory returned an unsupported state")
            matching_records.append(record)
        return _InventorySnapshot(
            running=running,
            paused=paused,
            records=tuple(matching_records),
        )


@dataclass(frozen=True, slots=True)
class E2BObserverRun:
    samples: tuple[E2BObserverSample, ...]
    summary: E2BObserverSummary


@dataclass(frozen=True, slots=True)
class StagingE2BLocalObserverOptions:
    """Secret-bearing local-only configuration for one count observer."""

    api_key: SecretStr
    tenant_id: SecretStr
    agent_id: SecretStr
    duration_seconds: float
    runtime_dir: Path

    def __post_init__(self) -> None:
        _validate_duration(self.duration_seconds)
        if not self.api_key.get_secret_value().strip():
            raise ValueError("E2B API key must not be empty")
        if not self.tenant_id.get_secret_value().strip():
            raise ValueError("E2B tenant filter must not be empty")
        if not self.agent_id.get_secret_value().strip():
            raise ValueError("E2B Agent filter must not be empty")


@dataclass(frozen=True, slots=True)
class StagingE2BLocalObserverArtifacts:
    """Public count-only artifacts and the caller-owned private target copy."""

    summary: E2BObserverSummary
    final_sample: E2BObserverSample
    public_samples_path: Path
    public_summary_path: Path
    private_manifest_path: Path


class StagingE2BLocalObserver:
    """Run the existing observer module locally without creating Kubernetes Jobs."""

    def __init__(
        self,
        options: StagingE2BLocalObserverOptions,
        *,
        popen: Callable[..., _LocalObserverProcess] = subprocess.Popen,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._options = options
        self._popen = popen
        self._sleep = sleep
        self._process: _LocalObserverProcess | None = None
        self._runtime_public_dir = options.runtime_dir / "public"
        self._runtime_private_manifest = options.runtime_dir / "targets.jsonl"
        self._stop_file = options.runtime_dir / "stop"

    def start(self) -> None:
        """Start the local process and wait until one count-only sample exists."""

        if self._process is not None:
            raise RuntimeError("local E2B observer was already started")
        if self._options.runtime_dir.exists():
            raise ValueError("local E2B observer runtime directory must not already exist")
        self._options.runtime_dir.mkdir(parents=True, mode=0o700)
        os.chmod(self._options.runtime_dir, 0o700)
        # The observer needs only its own E2B credential and stable process
        # prerequisites.  In particular, never forward the Service API key
        # or any other benchmark credentials from the parent process.
        environment = _local_observer_environment()
        environment.update(
            {
                E2B_API_KEY_ENV: self._options.api_key.get_secret_value(),
                E2B_TENANT_ID_ENV: self._options.tenant_id.get_secret_value(),
                E2B_AGENT_ID_ENV: self._options.agent_id.get_secret_value(),
                E2B_OBSERVER_DURATION_ENV: str(self._options.duration_seconds),
                E2B_OBSERVER_OUTPUT_DIR_ENV: str(self._runtime_public_dir),
                E2B_OBSERVER_PRIVATE_MANIFEST_ENV: str(self._runtime_private_manifest),
                E2B_OBSERVER_STOP_FILE_ENV: str(self._stop_file),
            }
        )
        self._process = self._popen(
            [sys.executable, "-m", "benchmarks.staging_e2b_observer"],
            cwd=str(Path(__file__).resolve().parent.parent),
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        try:
            for _ in range(10):
                if self._process.poll() is not None:
                    raise RuntimeError("local E2B observer exited before its first sample")
                try:
                    self.collect_latest_public_count_sample()
                except RuntimeError:
                    self._sleep(1)
                    continue
                return
            raise RuntimeError("local E2B observer did not produce an initial sample")
        except Exception:
            self.close()
            raise

    def collect_public_count_snapshot(self, *, destination: Path) -> E2BObserverSample:
        """Copy the latest public count into a caller-owned artifact path."""

        if destination.exists():
            raise ValueError("observer public count snapshot path must not already exist")
        sample = self.collect_latest_public_count_sample()
        destination.parent.mkdir(parents=True, exist_ok=True)
        _write_private_or_public_text(destination, sample.model_dump_json() + "\n", mode=0o644)
        return sample

    def collect_latest_public_count_sample(self) -> E2BObserverSample:
        """Read the latest local count-only sample without creating an artifact."""

        self._require_running()
        samples = _read_public_samples(self._runtime_public_dir / E2B_RUNNING_COUNTS_FILENAME)
        sample = samples[-1]
        if sample.api_status != "ok" or sample.target_remaining is None:
            raise RuntimeError("latest local E2B target count sample was unavailable")
        return sample

    def collect_snapshot(self, *, destination: Path) -> Path:
        """Copy the private target manifest while the local observer is running."""

        self._require_running()
        if destination.exists():
            raise ValueError("observer private snapshot path must not already exist")
        _copy_private_manifest(self._runtime_private_manifest, destination)
        return destination

    def stop_and_collect(
        self,
        *,
        public_output_dir: Path,
        private_manifest_path: Path,
    ) -> StagingE2BLocalObserverArtifacts:
        """Stop cleanly and copy sanitized public/private evidence to the caller."""

        if public_output_dir.exists() or private_manifest_path.exists():
            raise ValueError("local E2B observer output destination must not already exist")
        if public_output_dir.resolve() in private_manifest_path.resolve().parents:
            raise ValueError("local E2B observer private manifest must stay outside public artifacts")
        self._request_stop_and_wait()
        samples_path = self._runtime_public_dir / E2B_RUNNING_COUNTS_FILENAME
        summary_path = self._runtime_public_dir / E2B_SUMMARY_FILENAME
        samples = _read_public_samples(samples_path)
        try:
            summary = E2BObserverSummary.model_validate_json(summary_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError("local E2B observer did not produce a valid summary") from exc
        _validate_public_summary(summary, samples)
        if self._process is None or self._process.returncode not in (0, 1):
            raise RuntimeError("local E2B observer did not terminate cleanly")
        public_output_dir.mkdir(parents=True)
        _write_private_or_public_text(
            public_output_dir / E2B_RUNNING_COUNTS_FILENAME,
            samples_path.read_text(encoding="utf-8"),
            mode=0o644,
        )
        _write_private_or_public_text(
            public_output_dir / E2B_SUMMARY_FILENAME,
            summary_path.read_text(encoding="utf-8"),
            mode=0o644,
        )
        _copy_private_manifest(self._runtime_private_manifest, private_manifest_path)
        if _private_manifest_target_count(private_manifest_path) != summary.target_count:
            raise RuntimeError("local E2B observer private target count did not match its summary")
        return StagingE2BLocalObserverArtifacts(
            summary=summary,
            final_sample=samples[-1],
            public_samples_path=public_output_dir / E2B_RUNNING_COUNTS_FILENAME,
            public_summary_path=public_output_dir / E2B_SUMMARY_FILENAME,
            private_manifest_path=private_manifest_path,
        )

    def close(self) -> None:
        """Stop the local subprocess if it is still active; no Kubernetes object exists."""

        if self._process is None:
            return
        if self._process.poll() is None:
            self._request_stop_and_wait()

    def _require_running(self) -> None:
        if self._process is None:
            raise RuntimeError("local E2B observer was not started")
        if self._process.poll() is not None:
            raise RuntimeError("local E2B observer exited unexpectedly")

    def _request_stop_and_wait(self) -> None:
        if self._process is None:
            return
        if self._process.poll() is not None:
            return
        self._stop_file.touch(exist_ok=True)
        try:
            self._process.wait(timeout=15)
        except subprocess.TimeoutExpired as exc:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)
            raise RuntimeError("local E2B observer did not stop within its safety timeout") from exc


def _read_public_samples(path: Path) -> tuple[E2BObserverSample, ...]:
    try:
        samples = tuple(
            E2BObserverSample.model_validate_json(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    except (OSError, ValueError) as exc:
        raise RuntimeError("local E2B observer public count samples were invalid") from exc
    if not samples:
        raise RuntimeError("local E2B observer public count samples were empty")
    return samples


def _validate_public_summary(summary: E2BObserverSummary, samples: Sequence[E2BObserverSample]) -> None:
    if summary.sample_count != len(samples):
        raise RuntimeError("local E2B observer summary did not match its public samples")
    if summary.successful_sample_count != sum(sample.api_status == "ok" for sample in samples):
        raise RuntimeError("local E2B observer summary did not match successful samples")
    if summary.throttled_sample_count != sum(sample.api_status == "throttled" for sample in samples):
        raise RuntimeError("local E2B observer summary did not match throttled samples")
    if summary.api_error_count != sum(sample.api_status == "error" for sample in samples):
        raise RuntimeError("local E2B observer summary did not match failed samples")


def _write_private_or_public_text(path: Path, value: str, *, mode: int) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, mode)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        os.fchmod(stream.fileno(), mode)
        _ = stream.write(value)


def _local_observer_environment() -> dict[str, str]:
    """Return the minimal inherited environment for the local observer.

    ``sys.executable`` is absolute, so the child does not need the parent's
    complete environment.  Keeping this allow-list prevents unrelated
    credentials such as ``BENCH_STAGING_API_KEY`` from reaching the collector.
    """

    allowed = (
        "LANG",
        "LC_ALL",
        "PATH",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
        "VIRTUAL_ENV",
    )
    return {name: value for name in allowed if (value := os.environ.get(name))}


def _copy_private_manifest(source: Path, destination: Path) -> None:
    if not destination.parent.is_dir():
        raise ValueError("private E2B manifest parent directory does not exist")
    try:
        payload = source.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError("local E2B observer private target manifest was unavailable") from exc
    _validate_private_manifest(payload)
    _write_private_or_public_text(destination, payload, mode=0o600)


def _private_manifest_target_count(path: Path) -> int:
    try:
        return _validate_private_manifest(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise RuntimeError("local E2B observer private target manifest was unavailable") from exc


def _validate_private_manifest(payload: str) -> int:
    try:
        rows = [json.loads(line) for line in payload.splitlines() if line.strip()]
    except json.JSONDecodeError as exc:
        raise RuntimeError("local E2B observer private target manifest was invalid") from exc
    seen_sandboxes: set[str] = set()
    required = {
        "first_observed_at",
        "sandbox_id",
        "created_at",
        "state_when_first_observed",
        "workspace_id",
        "binding_id",
    }
    for row in rows:
        if not isinstance(row, dict) or set(row) != required:
            raise RuntimeError("local E2B observer private target manifest was invalid")
        if any(not isinstance(value, str) or not value for value in row.values()):
            raise RuntimeError("local E2B observer private target manifest was invalid")
        sandbox_id = row["sandbox_id"]
        assert isinstance(sandbox_id, str)
        if sandbox_id in seen_sandboxes:
            raise RuntimeError("local E2B observer private target manifest was invalid")
        seen_sandboxes.add(sandbox_id)
    return len(rows)


@dataclass(frozen=True, slots=True)
class _ObserverArgs:
    duration_seconds: float
    output_dir: Path
    private_manifest: Path | None
    stop_file: Path | None


def _load_e2b_inventory(
    metadata_filter: Mapping[str, str],
    api_key: str,
    request_timeout_seconds: float,
) -> Iterable[_InventoryRecord]:
    paginator = Sandbox.list(
        query=SandboxQuery(metadata=dict(metadata_filter)),
        limit=E2B_LIST_PAGE_SIZE,
        api_key=api_key,
        request_timeout=request_timeout_seconds,
    )
    records: list[_InventoryRecord] = []
    page_count = 0
    seen_next_tokens: set[str] = set()
    while paginator.has_next:
        page_count += 1
        if page_count > E2B_LIST_MAX_PAGES:
            raise RuntimeError("E2B inventory exceeded the bounded observer page limit")
        records.extend(
            _InventoryRecord(
                sandbox_id=item.sandbox_id,
                state=str(item.state),
                metadata=dict(item.metadata),
                started_at=item.started_at,
            )
            for item in paginator.next_items()
        )
        next_token = paginator.next_token
        if next_token is not None:
            if next_token in seen_next_tokens:
                raise RuntimeError("E2B inventory pagination did not advance")
            seen_next_tokens.add(next_token)
    return records


def observe_e2b_inventory(
    counter: E2BInventoryCounter,
    *,
    duration_seconds: float,
    on_sample: Callable[[E2BObserverSample], None] | None = None,
    private_targets: E2BPrivateTargetRegistry | None = None,
    stop_requested: Callable[[], bool] = lambda: False,
    monotonic: Callable[[], float] = time.monotonic,
    utc_now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    sleep: Callable[[float], None] = time.sleep,
) -> E2BObserverRun:
    """Sample at one-second scheduled intervals until a bounded deadline."""

    _validate_duration(duration_seconds)
    started_at_monotonic = monotonic()
    observer_started_at = _as_utc(utc_now(), field_name="observer start timestamp")
    deadline = started_at_monotonic + duration_seconds
    next_sample_at = started_at_monotonic
    expected_sample_count = math.ceil(duration_seconds / E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS)
    samples: list[E2BObserverSample] = []
    stopped_early = False

    while next_sample_at < deadline:
        if stop_requested():
            stopped_early = True
            break
        now = monotonic()
        if now < next_sample_at:
            sleep(next_sample_at - now)
            if stop_requested():
                stopped_early = True
                break

        timestamp = utc_now()
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise ValueError("observer wall clock must return a timezone-aware timestamp")
        try:
            snapshot = counter.snapshot_inventory()
        except RateLimitException:
            sample = E2BObserverSample(
                timestamp=timestamp.astimezone(timezone.utc),
                api_status="throttled",
            )
        except Exception:
            # Third-party exception messages may contain request context. Only
            # serialize a fixed status; diagnostics stay inside the Job.
            sample = E2BObserverSample(
                timestamp=timestamp.astimezone(timezone.utc),
                api_status="error",
            )
        else:
            if private_targets is not None:
                # Private manifest failures are fatal. Do not downgrade lost
                # cleanup evidence to a recoverable inventory API sample.
                private_targets.write_new_records(timestamp.astimezone(timezone.utc), snapshot.records)
            target_ids: set[str] = private_targets.seen_sandbox_ids if private_targets is not None else set()
            present_ids = {record.sandbox_id for record in snapshot.records}
            sample = E2BObserverSample(
                timestamp=timestamp.astimezone(timezone.utc),
                running=snapshot.running,
                paused=snapshot.paused,
                target_remaining=len(target_ids & present_ids),
                api_status="ok",
            )
        samples.append(sample)
        if on_sample is not None:
            on_sample(sample)

        next_sample_at += E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS
        now = monotonic()
        if next_sample_at < now:
            skipped_intervals = math.ceil(
                (now - next_sample_at) / E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS
            )
            next_sample_at += skipped_intervals * E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS

    observer_ended_at = _as_utc(utc_now(), field_name="observer end timestamp")
    summary = summarize_e2b_observation(
        samples,
        observer_started_at=observer_started_at,
        observer_ended_at=observer_ended_at,
        expected_sample_count=len(samples) if stopped_early else expected_sample_count,
        target_count=len(private_targets.seen_sandbox_ids) if private_targets is not None else 0,
    )
    return E2BObserverRun(samples=tuple(samples), summary=summary)


def summarize_e2b_observation(
    samples: Sequence[E2BObserverSample],
    *,
    observer_started_at: datetime | None = None,
    observer_ended_at: datetime | None = None,
    expected_sample_count: int | None = None,
    target_count: int | None = None,
) -> E2BObserverSummary:
    """Aggregate count-only evidence and detect three seconds at the Free limit."""

    if expected_sample_count is not None and expected_sample_count < 0:
        raise ValueError("expected sample count must not be negative")
    if target_count is not None and target_count < 0:
        raise ValueError("target count must not be negative")
    if observer_started_at is None:
        observer_started_at = samples[0].timestamp if samples else datetime.now(timezone.utc)
    if observer_ended_at is None:
        observer_ended_at = samples[-1].timestamp if samples else observer_started_at
    observer_started_at = _as_utc(observer_started_at, field_name="observer start timestamp")
    observer_ended_at = _as_utc(observer_ended_at, field_name="observer end timestamp")
    successful_samples = [sample for sample in samples if sample.api_status == "ok"]
    running_values = [sample.running for sample in successful_samples if sample.running is not None]
    paused_values = [sample.paused for sample in successful_samples if sample.paused is not None]
    target_remaining_values = [
        sample.target_remaining for sample in successful_samples if sample.target_remaining is not None
    ]

    current_limit_seconds = 0
    max_limit_seconds = 0
    for sample in samples:
        if sample.api_status == "ok" and sample.running == E2B_FREE_RUNNING_LIMIT:
            current_limit_seconds += E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS
            max_limit_seconds = max(max_limit_seconds, current_limit_seconds)
        else:
            current_limit_seconds = 0

    throttled_sample_count = sum(sample.api_status == "throttled" for sample in samples)
    api_error_count = sum(sample.api_status == "error" for sample in samples)
    resolved_target_count = max(target_remaining_values, default=0) if target_count is None else target_count
    current_target_zero_seconds = 0
    target_seen = False
    for sample in samples:
        if sample.api_status == "ok" and sample.target_remaining is not None and sample.target_remaining > 0:
            target_seen = True
            current_target_zero_seconds = 0
        elif target_seen and sample.api_status == "ok" and sample.target_remaining == 0:
            current_target_zero_seconds += E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS
        else:
            current_target_zero_seconds = 0
    expected = len(samples) if expected_sample_count is None else expected_sample_count
    observation_complete = (
        len(samples) == expected
        and len(successful_samples) == len(samples)
        and len(samples) > 0
    )
    return E2BObserverSummary(
        observer_started_at=observer_started_at,
        observer_ended_at=observer_ended_at,
        expected_sample_count=expected,
        sample_count=len(samples),
        successful_sample_count=len(successful_samples),
        throttled_sample_count=throttled_sample_count,
        api_error_count=api_error_count,
        target_count=resolved_target_count,
        target_zero_consecutive_seconds=current_target_zero_seconds if resolved_target_count else 0,
        running_max=max(running_values, default=None),
        paused_max=max(paused_values, default=None),
        running_limit_consecutive_seconds=max_limit_seconds,
        limit_reached=max_limit_seconds >= E2B_LIMIT_CONSECUTIVE_SECONDS,
        vendor_throttle_observed=throttled_sample_count > 0,
        observation_complete=observation_complete,
    )


def to_capacity_e2b_observation(summary: E2BObserverSummary) -> StagingPublicCapacityE2BObservation:
    """Map observer output to the Schema v6 count-only capacity evidence."""

    from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityE2BObservation

    error: Literal["incomplete_samples", "api_errors"] | None
    if summary.observation_complete:
        error = None
    elif summary.api_error_count:
        error = "api_errors"
    else:
        error = "incomplete_samples"
    return StagingPublicCapacityE2BObservation(
        running_max=summary.running_max or 0,
        paused_max=summary.paused_max or 0,
        running_limit=summary.running_limit,
        running_limit_consecutive_seconds=summary.running_limit_consecutive_seconds,
        limit_reached=summary.limit_reached,
        vendor_throttle_observed=summary.vendor_throttle_observed,
        observation_complete=summary.observation_complete,
        sample_count=summary.sample_count,
        successful_sample_count=summary.successful_sample_count,
        api_error_count=summary.api_error_count,
        error=error,
    )


def capacity_e2b_observation_for_window(
    samples: Sequence[E2BObserverSample],
    *,
    measurement_started_at: datetime,
    measurement_ended_at: datetime,
) -> StagingPublicCapacityE2BObservation:
    """Build capacity evidence from the measurement window, excluding setup and cleanup."""

    started_at = _as_utc(measurement_started_at, field_name="measurement start timestamp")
    ended_at = _as_utc(measurement_ended_at, field_name="measurement end timestamp")
    if ended_at <= started_at:
        raise ValueError("measurement end timestamp must follow its start timestamp")
    window_samples = [
        sample
        for sample in samples
        if started_at <= _as_utc(sample.timestamp, field_name="E2B sample timestamp") < ended_at
    ]
    # The observer has its own one-second clock phase. A valid 60-second load
    # window therefore normally contains 60 samples, even when its UTC bounds
    # span slightly more than 60.0 seconds due to scheduler latency. Requiring
    # ``ceil(window duration)`` would incorrectly demand a 61st sample. Instead,
    # require the sampled cadence to cover both edges and contain no missing or
    # reordered one-second interval.
    cadence_complete = _window_has_cadence_coverage(
        window_samples,
        started_at=started_at,
        ended_at=ended_at,
    )
    expected_sample_count = len(window_samples) if cadence_complete else len(window_samples) + 1
    summary = summarize_e2b_observation(
        window_samples,
        observer_started_at=started_at,
        observer_ended_at=ended_at,
        expected_sample_count=expected_sample_count,
        target_count=0,
    )
    return to_capacity_e2b_observation(summary)


def _window_has_cadence_coverage(
    samples: Sequence[E2BObserverSample],
    *,
    started_at: datetime,
    ended_at: datetime,
) -> bool:
    """Return whether one-second samples continuously cover a bounded window."""

    if not samples:
        return False
    cadence = timedelta(
        seconds=E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS + E2B_WINDOW_CADENCE_TOLERANCE_SECONDS
    )
    window_duration_seconds = (ended_at - started_at).total_seconds()
    nominal_sample_count = max(
        1,
        math.floor(window_duration_seconds / E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS),
    )
    long_window = window_duration_seconds >= E2B_WINDOW_MINIMUM_SECONDS_FOR_PARTIAL_COVERAGE
    minimum_sample_count = (
        math.ceil(nominal_sample_count * E2B_WINDOW_MINIMUM_COVERAGE_RATIO)
        if long_window
        else nominal_sample_count
    )
    if len(samples) < minimum_sample_count:
        return False
    timestamps = [
        _as_utc(sample.timestamp, field_name="E2B sample timestamp")
        for sample in samples
    ]
    if timestamps[0] - started_at > cadence or ended_at - timestamps[-1] > cadence:
        return False
    maximum_gap = cadence + timedelta(
        seconds=(
            E2B_WINDOW_MAX_CONSECUTIVE_MISSED_SAMPLES
            if long_window
            else 0
        )
        * E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS
    )
    return all(
        timedelta(0) < current - previous <= maximum_gap
        for previous, current in zip(timestamps, timestamps[1:], strict=False)
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Run as a bounded local Harness subprocess with environment-only secrets."""

    args = _parse_args(argv)
    stop_event = threading.Event()
    previous_handlers = _install_stop_handlers(stop_event)
    try:
        counter = _counter_from_environment()
        output_dir = args.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        samples_path = output_dir / E2B_RUNNING_COUNTS_FILENAME
        summary_path = output_dir / E2B_SUMMARY_FILENAME
        private_manifest_path = args.private_manifest
        if private_manifest_path is not None:
            _require_private_path_outside_public_artifacts(private_manifest_path, output_dir)
        observer_started_at = datetime.now(timezone.utc)

        def stop_requested() -> bool:
            return _stop_requested(stop_event, args.stop_file)

        with (
            samples_path.open("x", encoding="utf-8") as samples_file,
            _PrivateManifestWriter.open(private_manifest_path, observer_started_at) as private_manifest,
        ):

            def write_sample(sample: E2BObserverSample) -> None:
                _ = samples_file.write(sample.model_dump_json() + "\n")
                samples_file.flush()

            observation = observe_e2b_inventory(
                counter,
                duration_seconds=args.duration_seconds,
                on_sample=write_sample,
                private_targets=private_manifest,
                stop_requested=stop_requested,
            )
        _ = summary_path.write_text(observation.summary.model_dump_json(indent=2) + "\n", encoding="utf-8")
        print(output_dir)
        return 0 if observation.summary.observation_complete else 1
    except (OSError, RuntimeError, ValueError):
        # Keep stderr useful to Job controllers without reflecting SDK or
        # environment values into logs.
        print("E2B inventory observer failed; inspect sanitized artifacts", file=sys.stderr)
        return 2
    finally:
        _restore_stop_handlers(previous_handlers)


def _parse_args(argv: Sequence[str] | None) -> _ObserverArgs:
    parser = argparse.ArgumentParser(description=__doc__)
    duration_default = os.environ.get(E2B_OBSERVER_DURATION_ENV)
    output_default = os.environ.get(E2B_OBSERVER_OUTPUT_DIR_ENV)
    private_manifest_default = os.environ.get(E2B_OBSERVER_PRIVATE_MANIFEST_ENV)
    stop_file_default = os.environ.get(E2B_OBSERVER_STOP_FILE_ENV)
    _ = parser.add_argument(
        "--duration-seconds",
        type=float,
        default=float(duration_default) if duration_default else None,
        required=duration_default is None,
    )
    _ = parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(output_default) if output_default else None,
        required=output_default is None,
    )
    _ = parser.add_argument(
        "--private-manifest",
        type=Path,
        default=Path(private_manifest_default) if private_manifest_default else None,
    )
    _ = parser.add_argument(
        "--stop-file",
        type=Path,
        default=Path(stop_file_default) if stop_file_default else None,
    )
    namespace = parser.parse_args(argv)
    duration_seconds = cast(float, namespace.duration_seconds)
    output_dir = cast(Path, namespace.output_dir)
    private_manifest = cast(Path | None, namespace.private_manifest)
    stop_file = cast(Path | None, namespace.stop_file)
    _validate_duration(duration_seconds)
    return _ObserverArgs(
        duration_seconds=duration_seconds,
        output_dir=output_dir,
        private_manifest=private_manifest,
        stop_file=stop_file,
    )


def _counter_from_environment() -> E2BMetadataInventoryCounter:
    missing = [
        name
        for name in (E2B_API_KEY_ENV, E2B_TENANT_ID_ENV, E2B_AGENT_ID_ENV)
        if not os.environ.get(name)
    ]
    if missing:
        raise RuntimeError("required E2B observer Secret environment is incomplete")
    return E2BMetadataInventoryCounter(
        api_key=SecretStr(os.environ[E2B_API_KEY_ENV]),
        tenant_id=SecretStr(os.environ[E2B_TENANT_ID_ENV]),
        agent_id=SecretStr(os.environ[E2B_AGENT_ID_ENV]),
    )


def _stop_requested(stop_event: threading.Event, stop_file: Path | None) -> bool:
    return stop_event.is_set() or (stop_file is not None and stop_file.exists())


def _validate_duration(duration_seconds: float) -> None:
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError("observer duration must be a positive finite number")
    if duration_seconds > E2B_OBSERVER_MAX_DURATION_SECONDS:
        raise ValueError("observer duration exceeds the six-hour safety bound")


@dataclass(slots=True)
class _PrivateManifestWriter:
    """Write exact cleanup targets without crossing the public artifact boundary."""

    observer_started_at: datetime
    stream: TextIO | None
    seen_sandbox_ids: set[str]

    @classmethod
    def open(cls, path: Path | None, observer_started_at: datetime) -> _PrivateManifestWriter:
        if path is None:
            return cls(observer_started_at=observer_started_at, stream=None, seen_sandbox_ids=set())
        if not path.parent.is_dir():
            raise ValueError("private E2B manifest parent directory does not exist")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        file_descriptor = os.open(path, flags, 0o600)
        os.fchmod(file_descriptor, 0o600)
        return cls(
            observer_started_at=observer_started_at,
            stream=os.fdopen(file_descriptor, "w", encoding="utf-8"),
            seen_sandbox_ids=set(),
        )

    def __enter__(self) -> _PrivateManifestWriter:
        return self

    def __exit__(
        self,
        _exc_type: type[BaseException] | None,
        _exc_value: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        if self.stream is not None:
            self.stream.close()

    def write_new_records(self, observed_at: datetime, records: tuple[_InventoryRecord, ...]) -> None:
        for record in records:
            started_at = _as_utc(record.started_at, field_name="E2B Sandbox started_at")
            if started_at < self.observer_started_at or record.sandbox_id in self.seen_sandbox_ids:
                continue
            self.seen_sandbox_ids.add(record.sandbox_id)
            if self.stream is None:
                continue
            binding_id = record.metadata.get("dify.binding_id")
            workspace_id = record.metadata.get("dify.workspace_id")
            if not binding_id or not workspace_id:
                raise RuntimeError("new Benchmark Sandbox lacked cleanup identity metadata")
            payload = {
                "first_observed_at": _as_utc(observed_at, field_name="observer timestamp").isoformat(),
                "sandbox_id": record.sandbox_id,
                "created_at": started_at.isoformat(),
                "state_when_first_observed": record.state,
                "binding_id": binding_id,
                "workspace_id": workspace_id,
            }
            _ = self.stream.write(json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n")
            self.stream.flush()


def _as_utc(value: datetime, *, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _require_private_path_outside_public_artifacts(private_path: Path, output_dir: Path) -> None:
    public_root = output_dir.resolve()
    private_resolved = private_path.parent.resolve() / private_path.name
    if private_resolved == public_root or public_root in private_resolved.parents:
        raise ValueError("private E2B manifest must be outside the public artifact directory")


type _SignalHandler = int | Callable[[int, FrameType | None], object] | None


def _install_stop_handlers(stop_event: threading.Event) -> dict[signal.Signals, _SignalHandler]:
    previous: dict[signal.Signals, _SignalHandler] = {}
    if threading.current_thread() is not threading.main_thread():
        return previous

    def request_stop(_signum: int, _frame: FrameType | None) -> None:
        stop_event.set()

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous[signum] = signal.getsignal(signum)
        _ = signal.signal(signum, request_stop)
    return previous


def _restore_stop_handlers(previous: Mapping[signal.Signals, _SignalHandler]) -> None:
    for signum, handler in previous.items():
        _ = signal.signal(signum, handler)


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "E2BMetadataInventoryCounter",
    "E2BObserverRun",
    "E2BObserverSample",
    "E2BObserverSummary",
    "StagingE2BLocalObserver",
    "StagingE2BLocalObserverArtifacts",
    "StagingE2BLocalObserverOptions",
    "E2B_FREE_RUNNING_LIMIT",
    "E2B_OBSERVER_SAMPLE_INTERVAL_SECONDS",
    "main",
    "capacity_e2b_observation_for_window",
    "observe_e2b_inventory",
    "summarize_e2b_observation",
    "to_capacity_e2b_observation",
]

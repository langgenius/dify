"""Isolated Locust worker for one sustained public Staging capacity block."""

from __future__ import annotations

# Locust must be the first networking dependency imported in this interpreter.
from locust import User, constant, task
from locust.env import Environment
from locust.exception import StopUser

import argparse
from datetime import datetime, timezone
from importlib.metadata import version
import json
import logging
import os
from pathlib import Path
import time
from typing import ClassVar, Literal, Protocol, cast

from gevent import monkey
from gevent.event import Event
from gevent.lock import Semaphore
from pydantic import SecretStr

from benchmarks.capacity_protocol import RequestMetric
from benchmarks.staging_public_capacity_schemas import (
    StagingPublicCapacityExecution,
    StagingPublicCapacityLoadResult,
    StagingPublicCapacityObservation,
    StagingPublicCapacityPointRequest,
    StagingPublicCapacitySetupResult,
    staging_public_capacity_setup_sequence,
)
from benchmarks.staging_public_locust import bounded_end_user
from benchmarks.staging_public_protocol import StagingPublicProtocolSettings, StagingPublicServiceClient
from benchmarks.staging_public_schemas import StagingPublicRunSample, StagingPublicScenarioId


setattr(logging, "_lock", monkey.get_original("_thread", "RLock")())


_SETUP_SPAWN_RATE_USERS_PER_SECOND = 1.0


class _Observation(Protocol):
    sample: StagingPublicRunSample


class _PublicClient(Protocol):
    def run_once(
        self, *, benchmark_run_id: str, scenario_id: StagingPublicScenarioId, scenario_version: int
    ) -> _Observation: ...

    def close(self) -> None: ...


class _AllocationJournal:
    def __init__(self, path: Path) -> None:
        descriptor = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
        self._file = os.fdopen(descriptor, "a", encoding="utf-8")
        self._lock = Semaphore()

    def record(self, event: Literal["allocated", "deleted"], worker_index: int, conversation_id: str) -> None:
        value = json.dumps(
            {"event": event, "worker_index": worker_index, "conversation_id": conversation_id},
            separators=(",", ":"),
            sort_keys=True,
        )
        with self._lock:
            self._file.write(value + "\n")
            self._file.flush()
            os.fsync(self._file.fileno())

    def close(self) -> None:
        with self._lock:
            if not self._file.closed:
                self._file.close()


class _WorkerState:
    def __init__(
        self,
        request: StagingPublicCapacityPointRequest,
        settings: StagingPublicProtocolSettings,
        journal: _AllocationJournal,
    ) -> None:
        self.request = request
        self.settings = settings
        self.journal = journal
        self.setup_done = Event()
        self.warmup_gate = Event()
        self.warmup_done = Event()
        self.measurement_gate = Event()
        self.measurement_done = Event()
        self.cleanup_gate = Event()
        self.cleanup_done = Event()
        self.abort_admission = Event()
        self.spawned_users = 0
        self.setup_attempted = 0
        self.setup_ready = 0
        self.setup_finished = 0
        self.warmup_finished_users = 0
        self.measurement_finished_users = 0
        self.warmup_samples: list[StagingPublicRunSample] = []
        self.observations: list[StagingPublicCapacityObservation] = []
        self.closed_clients: set[int] = set()
        self.setup_errors: list[str] = []
        self.setup_e2b_inventory_limited = False
        self.fatal_errors: list[str] = []
        self.warmup_started = 0.0
        self.warmup_deadline = 0.0
        self.warmup_started_at: datetime | None = None
        self.warmup_ended_at: datetime | None = None
        self.measurement_started = 0.0
        self.measurement_deadline = 0.0
        self.measurement_started_at: datetime | None = None
        self.measurement_ended_at: datetime | None = None
        self.active = 0
        self.peak_active = 0
        self.active_integral_seconds = 0.0
        self._active_changed_at = 0.0
        self.consecutive_correctness_failures = 0
        self.consecutive_capacity_failures = 0
        self.warmup_peak_consecutive_capacity_failures = 0
        self._private_conversation_ids: set[str] = set()
        self._conversation_owner: dict[str, int] = {}
        self._worker_conversation: dict[int, str] = {}
        self._lock = Semaphore()

    def recorder(self, metric: RequestMetric, environment: Environment) -> None:
        environment.events.request.fire(
            request_type=metric.request_type,
            name=metric.name,
            response_time=metric.response_time_ms,
            response_length=metric.response_length,
            response=None,
            context={"mode": "staging-public-e2e-scaling", "scenario": self.request.scenario_id},
            exception=RuntimeError(metric.error) if metric.error else None,
            start_time=None,
            url=None,
        )

    def create_client(self, environment: Environment) -> tuple[int, _PublicClient]:
        with self._lock:
            worker_index = self.spawned_users
            self.spawned_users += 1
        if worker_index >= self.request.requested_concurrency:
            raise RuntimeError("Locust spawned more Users than requested")
        end_user = bounded_end_user(f"{self.request.invocation_id}.b{self.request.block_index}.w{worker_index}")
        client = StagingPublicServiceClient(
            settings=self.settings,
            end_user=end_user,
            recorder=lambda metric: self.recorder(metric, environment),
            conversation_lifecycle=lambda event, conversation_id: self.record_lifecycle(
                event, worker_index, conversation_id
            ),
        )
        return worker_index, client

    def record_lifecycle(self, event: Literal["allocated", "deleted"], worker_index: int, conversation_id: str) -> None:
        with self._lock:
            if event == "allocated":
                owner = self._conversation_owner.get(conversation_id)
                existing = self._worker_conversation.get(worker_index)
                if owner is not None and owner != worker_index:
                    raise RuntimeError("public capacity Users received a shared Conversation")
                if existing is not None and existing != conversation_id:
                    raise RuntimeError("public capacity User received more than one Conversation")
                self._conversation_owner[conversation_id] = worker_index
                self._worker_conversation[worker_index] = conversation_id
            self._private_conversation_ids.add(conversation_id)
        self.journal.record(event, worker_index, conversation_id)

    def redact(self, value: str) -> str:
        secret = self.settings.api_key.get_secret_value()
        redacted = value.replace(secret, "[REDACTED]") if secret else value
        with self._lock:
            identifiers = tuple(self._private_conversation_ids)
        for identifier in identifiers:
            redacted = redacted.replace(identifier, "[REDACTED]")
        return redacted

    def setup_user(self, worker_index: int, client: _PublicClient) -> bool:
        with self._lock:
            # A prior setup correctness/inventory failure closes admission for
            # the whole block. Locust may still finish spawning the requested
            # User objects so shutdown accounting remains deterministic, but
            # those later Users must not create additional Conversations.
            if self.abort_admission.is_set():
                self.setup_finished += 1
                if self.setup_finished == self.request.requested_concurrency:
                    self.setup_done.set()
                return False
            self.setup_attempted += 1
        setup = staging_public_capacity_setup_sequence(self.request.scenario_id)
        try:
            for sequence, scenario_id in enumerate(setup, start=1):
                observation = client.run_once(
                    benchmark_run_id=(
                        f"{self.request.invocation_id}.b{self.request.block_index}.w{worker_index}.setup{sequence}"
                    ),
                    scenario_id=scenario_id,
                    scenario_version=1,
                )
                if not observation.sample.succeeded:
                    with self._lock:
                        allocation_captured = worker_index in self._worker_conversation
                        if observation.sample.admitted and not allocation_captured:
                            self.fatal_errors.append(
                                f"worker {worker_index} setup admitted a request without a cleanup identity"
                            )
                    if observation.sample.error_type == "e2b_inventory_limited":
                        with self._lock:
                            self.setup_e2b_inventory_limited = True
                    raise RuntimeError(f"{scenario_id} setup transaction failed")
        except BaseException as exc:
            message = f"worker {worker_index} setup failed: {self.redact(f'{type(exc).__name__}: {exc}')}"
            with self._lock:
                self.setup_errors.append(message)
                self.abort_admission.set()
                self.setup_finished += 1
                if self.setup_finished == self.request.requested_concurrency:
                    self.setup_done.set()
            return False
        with self._lock:
            self.setup_ready += 1
            self.setup_finished += 1
            if self.setup_finished == self.request.requested_concurrency:
                self.setup_done.set()
        return True

    def begin_warmup(self) -> None:
        now = time.perf_counter()
        started_at = datetime.now(timezone.utc)
        with self._lock:
            self.warmup_started = now
            self.warmup_deadline = now + self.request.warmup_seconds
            self.warmup_started_at = started_at
        self.warmup_gate.set()

    def end_warmup(self) -> None:
        """Close the observer window after every warmup request has drained."""

        with self._lock:
            self.warmup_ended_at = datetime.now(timezone.utc)

    def begin_measurement(self) -> None:
        now = time.perf_counter()
        started_at = datetime.now(timezone.utc)
        with self._lock:
            self.measurement_started = now
            self.measurement_deadline = now + self.request.measurement_seconds
            self.measurement_started_at = started_at
            self._active_changed_at = now
        self.measurement_gate.set()

    def warmup_failed(self) -> bool:
        """Return whether any User lost its reusable Conversation in warmup."""

        with self._lock:
            return any(not sample.succeeded for sample in self.warmup_samples)

    def end_measurement_admission(self) -> None:
        """Capture the UTC end of the admission window for external observers."""

        with self._lock:
            self.measurement_ended_at = datetime.now(timezone.utc)

    def may_admit(self, phase: Literal["warmup", "measurement"]) -> bool:
        if self.abort_admission.is_set():
            return False
        deadline = self.warmup_deadline if phase == "warmup" else self.measurement_deadline
        return deadline > 0 and time.perf_counter() < deadline

    def execute(
        self,
        worker_index: int,
        client: _PublicClient,
        *,
        phase: Literal["warmup", "measurement"],
        turn_index: int,
    ) -> bool:
        admitted_perf = time.perf_counter()
        if phase == "measurement":
            self._change_active(1, admitted_perf)
        try:
            observation = client.run_once(
                benchmark_run_id=(
                    f"{self.request.invocation_id}.b{self.request.block_index}.w{worker_index}."
                    f"{'wu' if phase == 'warmup' else 'm'}{turn_index}"
                ),
                scenario_id=self.request.scenario_id,
                scenario_version=1,
            )
            sample = observation.sample.model_copy(deep=True)
            if sample.error:
                sample.error = self.redact(sample.error)
        except BaseException as exc:
            sample = StagingPublicRunSample(
                scenario_id=self.request.scenario_id,
                benchmark_run_id=(
                    f"{self.request.invocation_id}.b{self.request.block_index}.w{worker_index}."
                    f"{'wu' if phase == 'warmup' else 'm'}{turn_index}"
                ),
                error_type="worker_error",
                error=self.redact(f"{type(exc).__name__}: {exc}"),
            )
        completed_perf = time.perf_counter()
        if phase == "measurement":
            self._change_active(-1, completed_perf)
            with self._lock:
                start = self.measurement_started
                deadline = self.measurement_deadline
                self.observations.append(
                    StagingPublicCapacityObservation(
                        worker_index=worker_index,
                        turn_index=turn_index,
                        admitted_offset_seconds=max(0.0, admitted_perf - start),
                        terminal_offset_seconds=(
                            max(0.0, completed_perf - start) if sample.terminal_status != "not_terminal" else None
                        ),
                        completed_after_admission_window=completed_perf > deadline,
                        sample=sample,
                    )
                )
        else:
            with self._lock:
                self.warmup_samples.append(sample)
        self._record_outcome(sample, phase=phase)
        return sample.succeeded

    def _record_outcome(
        self,
        sample: StagingPublicRunSample,
        *,
        phase: Literal["warmup", "measurement"] = "measurement",
    ) -> None:
        correctness = sample.error_type in {"validation_error", "worker_error"}
        capacity_failure = sample.error_type in {
            "throttle",
            "timeout",
            "http_error",
            "sse_error",
            "e2b_inventory_limited",
        }
        with self._lock:
            self.consecutive_correctness_failures = self.consecutive_correctness_failures + 1 if correctness else 0
            self.consecutive_capacity_failures = self.consecutive_capacity_failures + 1 if capacity_failure else 0
            if phase == "warmup":
                self.warmup_peak_consecutive_capacity_failures = max(
                    self.warmup_peak_consecutive_capacity_failures,
                    self.consecutive_capacity_failures,
                )
            # Correctness evidence is a hard experiment invariant: once it is
            # broken, no later request can turn the point into valid capacity
            # evidence. Operational saturation still uses a three-failure
            # threshold so one transient timeout does not terminate the block.
            if self.consecutive_correctness_failures >= 1 or self.consecutive_capacity_failures >= 3:
                self.abort_admission.set()

    def _change_active(self, delta: int, now: float) -> None:
        with self._lock:
            window_end = min(now, self.measurement_deadline)
            if self._active_changed_at and window_end > self._active_changed_at:
                self.active_integral_seconds += self.active * (window_end - self._active_changed_at)
                self._active_changed_at = window_end
            self.active += delta
            if self.active < 0:
                raise RuntimeError("active public Run count became negative")
            self.peak_active = max(self.peak_active, self.active)

    def finish_phase(self, phase: Literal["warmup", "measurement"]) -> None:
        with self._lock:
            if phase == "warmup":
                self.warmup_finished_users += 1
                if self.warmup_finished_users == self.setup_ready:
                    self.warmup_done.set()
            else:
                self.measurement_finished_users += 1
                if self.measurement_finished_users == self.setup_ready:
                    self.measurement_done.set()

    def finalize_active_integral(self) -> None:
        with self._lock:
            now = min(time.perf_counter(), self.measurement_deadline)
            if self._active_changed_at and now > self._active_changed_at:
                self.active_integral_seconds += self.active * (now - self._active_changed_at)
                self._active_changed_at = now

    def close_user(self, worker_index: int, client: _PublicClient) -> None:
        """Close transport resources without deleting the private Conversation.

        The parent orchestrator owns physical cleanup after it has reconciled
        the private allocation manifest against the database and E2B inventory.
        """

        with self._lock:
            if worker_index in self.closed_clients:
                return
        try:
            client.close()
        except BaseException as exc:
            with self._lock:
                self.fatal_errors.append(
                    f"worker {worker_index} close failed: {self.redact(f'{type(exc).__name__}: {exc}')}"
                )
        with self._lock:
            self.closed_clients.add(worker_index)
            if len(self.closed_clients) == self.request.requested_concurrency:
                self.cleanup_done.set()


class _CapacityUser(User):
    abstract = True
    wait_time = constant(0)
    worker_state: ClassVar[_WorkerState]
    worker_index: int | None = None
    client: _PublicClient | None = None
    executed = False

    def on_start(self) -> None:
        try:
            self.worker_index, self.client = self.worker_state.create_client(self.environment)
        except BaseException as exc:
            with self.worker_state._lock:
                self.worker_state.fatal_errors.append(self.worker_state.redact(f"{type(exc).__name__}: {exc}"))
                self.worker_state.abort_admission.set()
                self.worker_state.setup_done.set()
            raise StopUser() from exc

    @task
    def execute_capacity(self) -> None:
        if self.executed:
            raise StopUser()
        self.executed = True
        assert self.worker_index is not None
        assert self.client is not None
        try:
            if not self.worker_state.setup_user(self.worker_index, self.client):
                self.worker_state.cleanup_gate.wait(
                    timeout=self.worker_state.request.setup_timeout_seconds
                    + self.worker_state.request.drain_timeout_seconds
                )
                return
            self.worker_state.warmup_gate.wait(timeout=self.worker_state.request.setup_timeout_seconds)
            warmup_turn = 0
            user_healthy = True
            while self.worker_state.may_admit("warmup"):
                if not self.worker_state.execute(
                    self.worker_index, self.client, phase="warmup", turn_index=warmup_turn
                ):
                    user_healthy = False
                    break
                warmup_turn += 1
            self.worker_state.finish_phase("warmup")
            self.worker_state.measurement_gate.wait(
                timeout=self.worker_state.request.drain_timeout_seconds + self.worker_state.request.warmup_seconds
            )
            measurement_turn = 0
            while user_healthy and self.worker_state.may_admit("measurement"):
                if not self.worker_state.execute(
                    self.worker_index, self.client, phase="measurement", turn_index=measurement_turn
                ):
                    user_healthy = False
                    break
                measurement_turn += 1
            self.worker_state.finish_phase("measurement")
            self.worker_state.cleanup_gate.wait(
                timeout=self.worker_state.request.drain_timeout_seconds + self.worker_state.request.measurement_seconds
            )
        finally:
            self.worker_state.close_user(self.worker_index, self.client)
        raise StopUser()

    def on_stop(self) -> None:
        if self.worker_index is not None and self.client is not None:
            self.worker_state.close_user(self.worker_index, self.client)


def run_worker(
    request: StagingPublicCapacityPointRequest, *, api_key: str, journal_path: Path
) -> StagingPublicCapacityExecution:
    settings = StagingPublicProtocolSettings(
        service_api_base_url=request.service_api_base_url,
        api_key=SecretStr(api_key),
        config_expected_sha256=request.config_expected_sha256,
    )
    journal = _AllocationJournal(journal_path)
    state = _WorkerState(request, settings, journal)

    class CapacityUser(_CapacityUser):
        abstract = False
        worker_state = state

    environment = Environment(user_classes=[CapacityUser], catch_exceptions=False)
    runner = environment.create_local_runner()
    setup_started = time.perf_counter()
    setup_duration = warmup_duration = measurement_duration = drain_duration = 0.0
    admission_duration = 0.0
    timed_out = False
    try:
        # Starting Locust Users is also the admission control for Conversation
        # setup.  Keep this at the E2B Free-plan creation rate so setup cannot
        # create more than one Sandbox-backed Conversation per second.
        runner.start(
            user_count=request.requested_concurrency,
            spawn_rate=_SETUP_SPAWN_RATE_USERS_PER_SECOND,
        )
        if not state.setup_done.wait(timeout=request.setup_timeout_seconds):
            timed_out = True
            state.abort_admission.set()
            state.fatal_errors.append("public capacity setup exceeded its timeout")
        setup_duration = time.perf_counter() - setup_started
        if state.setup_ready == request.requested_concurrency and not state.abort_admission.is_set():
            state.begin_warmup()
            state.abort_admission.wait(timeout=request.warmup_seconds)
            warmup_drain_started = time.perf_counter()
            if not state.warmup_done.wait(timeout=request.drain_timeout_seconds):
                timed_out = True
                state.abort_admission.set()
                state.fatal_errors.append("public capacity warmup drain exceeded its timeout")
                state.measurement_gate.set()
            state.end_warmup()
            warmup_duration = time.perf_counter() - state.warmup_started
            _ = warmup_drain_started
            environment.stats.reset_all()
        if (
            not timed_out
            and state.setup_ready == request.requested_concurrency
            and not state.abort_admission.is_set()
            and not state.warmup_failed()
        ):
            state.begin_measurement()
            state.abort_admission.wait(timeout=request.measurement_seconds)
            admission_duration = min(
                request.measurement_seconds,
                max(0.0, time.perf_counter() - state.measurement_started),
            )
            state.end_measurement_admission()
            drain_started = time.perf_counter()
            if not state.measurement_done.wait(timeout=request.drain_timeout_seconds):
                timed_out = True
                state.abort_admission.set()
                state.fatal_errors.append("public capacity measurement drain exceeded its timeout")
            drain_duration = time.perf_counter() - drain_started
            measurement_duration = request.measurement_seconds
            state.finalize_active_integral()
        # Release Users parked behind phases that were skipped after setup or
        # warmup failure before asking them to clean up.
        state.warmup_gate.set()
        state.measurement_gate.set()
        state.cleanup_gate.set()
        if not state.cleanup_done.wait(timeout=request.drain_timeout_seconds):
            timed_out = True
            state.fatal_errors.append("public capacity client shutdown exceeded its timeout")
        runner.quit()
        runner.greenlet.join(timeout=request.drain_timeout_seconds)
    finally:
        state.warmup_gate.set()
        state.measurement_gate.set()
        state.cleanup_gate.set()
        try:
            runner.quit()
        finally:
            journal.close()

    observations = sorted(
        state.observations,
        key=lambda item: (item.admitted_offset_seconds, item.worker_index, item.turn_index),
    )
    samples = [item.sample for item in observations]
    admitted = sum(sample.admitted for sample in samples)
    terminal = sum(sample.terminal_e2e_ms is not None for sample in samples)
    successful = sum(sample.succeeded for sample in samples)
    throttled = sum(sample.error_type == "throttle" or sample.http_status_code == 429 for sample in samples)
    timeouts = sum(sample.error_type == "timeout" for sample in samples)
    http_failures = sum(sample.error_type == "http_error" for sample in samples)
    sse_failures = sum(sample.error_type == "sse_error" for sample in samples)
    correctness = sum(sample.error_type in {"validation_error", "worker_error"} for sample in samples)
    warmup_operational = sum(
        sample.error_type in {"throttle", "timeout", "http_error", "sse_error", "e2b_inventory_limited"}
        for sample in state.warmup_samples
    )
    warmup_correctness = sum(
        sample.error_type in {"validation_error", "worker_error"} for sample in state.warmup_samples
    )
    warmup_e2b_limits = sum(sample.error_type == "e2b_inventory_limited" for sample in state.warmup_samples)
    setup = StagingPublicCapacitySetupResult(
        attempted_users=state.setup_attempted,
        allocated_users=len(state._worker_conversation),
        successful_users=state.setup_ready,
        complete=state.setup_ready == request.requested_concurrency and not state.setup_errors,
        e2b_inventory_limited=state.setup_e2b_inventory_limited,
        errors=list(dict.fromkeys(state.setup_errors)),
    )
    serialized_stats = cast(list[dict[str, object]], environment.stats.serialize_stats())
    load = StagingPublicCapacityLoadResult(
        requested_users=request.requested_concurrency,
        spawned_users=state.spawned_users,
        setup_ready_users=state.setup_ready,
        warmup_attempted=len(state.warmup_samples),
        warmup_completed=sum(sample.succeeded for sample in state.warmup_samples),
        warmup_operational_failures=warmup_operational,
        warmup_correctness_failures=warmup_correctness,
        warmup_e2b_limit_failures=warmup_e2b_limits,
        warmup_peak_consecutive_operational_failures=(state.warmup_peak_consecutive_capacity_failures),
        attempted=len(samples),
        admitted=admitted,
        terminal=terminal,
        successful=successful,
        observed_max_active=state.peak_active,
        active_integral_seconds=state.active_integral_seconds,
        active_mean=(state.active_integral_seconds / request.measurement_seconds if measurement_duration else 0),
        setup_duration_seconds=setup_duration,
        warmup_duration_seconds=warmup_duration,
        warmup_started_at=state.warmup_started_at,
        warmup_ended_at=state.warmup_ended_at,
        admission_duration_seconds=admission_duration,
        measurement_duration_seconds=measurement_duration,
        drain_duration_seconds=drain_duration,
        drained_runs=sum(item.completed_after_admission_window for item in observations),
        timed_out=timed_out,
        throttled_requests=throttled,
        timeout_requests=timeouts,
        http_failure_requests=http_failures,
        sse_failure_requests=sse_failures,
        correctness_failures=correctness,
        measurement_started_at=state.measurement_started_at,
        measurement_ended_at=state.measurement_ended_at,
        fatal_errors=list(dict.fromkeys(state.fatal_errors)),
        stats={
            "entries": serialized_stats,
            "errors": environment.stats.serialize_errors(),
            "total": environment.stats.total.serialize(),
            "locust_version": version("locust"),
        },
    )
    return StagingPublicCapacityExecution(
        scenario_id=request.scenario_id,
        requested_concurrency=request.requested_concurrency,
        block_index=request.block_index,
        phase=request.phase,
        setup=setup,
        warmup_samples=sorted(state.warmup_samples, key=lambda sample: sample.benchmark_run_id),
        observations=observations,
        cleanup=[],
        load=load,
    )


def main() -> int:
    args = _parse_args()
    api_key = os.environ.get("BENCH_STAGING_API_KEY", "")
    if not api_key:
        print("isolated public capacity worker requires BENCH_STAGING_API_KEY", flush=True)
        return 2
    try:
        request = StagingPublicCapacityPointRequest.model_validate_json(args.request.read_text(encoding="utf-8"))
        execution = run_worker(request, api_key=api_key, journal_path=args.journal)
        args.result.write_text(execution.model_dump_json(), encoding="utf-8")
        return 0 if execution.setup.complete and not execution.load.fatal_errors else 1
    except BaseException as exc:
        print(_redacted_error(SecretStr(api_key), exc), flush=True)
        return 2


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--journal", type=Path, required=True)
    return parser.parse_args()


def _redacted_error(api_key: SecretStr, exc: BaseException) -> str:
    value = f"{type(exc).__name__}: {exc}"
    secret = api_key.get_secret_value()
    return value.replace(secret, "[REDACTED]") if secret else value


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["main", "run_worker"]

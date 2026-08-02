"""Isolated Locust process for one benchmark warmup or measurement phase."""

from __future__ import annotations

from collections import deque
from collections.abc import Sequence
import argparse
from importlib.metadata import version
import json
import logging
from pathlib import Path
import time
from typing import ClassVar, TextIO, cast

from locust import User, constant, task
from locust.env import Environment
from locust.exception import StopUser

import gevent
from gevent import monkey
from gevent.event import Event
import httpx

from benchmarks.capacity_protocol import AgentRunClient, CapacityObservation, RequestMetric
from benchmarks.load_phase import CompositeRequestStats, LoadPhaseRequest, LoadPhaseResult, WorkerContext
from benchmarks.scenario import load_scenario_manifest


# Locust patches threading for cooperative I/O. Python 3.12's logging weakref
# finalizer can run after gevent's hub is gone, so retain a native lock for the
# logging registry while leaving the workload I/O fully monkey-patched.
setattr(logging, "_lock", monkey.get_original("_thread", "RLock")())


class _ActiveTracker:
    def __init__(self, checkpoint_path: Path) -> None:
        self._checkpoint_path = checkpoint_path
        self._active = 0
        self._unresolved_run_ids: set[str] = set()
        self.peak = 0
        self._checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        self._journal = self._checkpoint_path.open("w", encoding="utf-8", buffering=1)

    @property
    def active(self) -> int:
        return self._active

    @property
    def unresolved(self) -> int:
        return len(self._unresolved_run_ids)

    def admitted(self, run_id: str) -> None:
        if run_id in self._unresolved_run_ids:
            raise RuntimeError(f"Run {run_id} was admitted twice")
        self._active += 1
        self._unresolved_run_ids.add(run_id)
        self.peak = max(self.peak, self.active)
        self._append("admitted", run_id)

    def finished(self, run_id: str, *, terminal: bool) -> None:
        self._active -= 1
        if terminal:
            self._unresolved_run_ids.discard(run_id)
            self._append("terminal", run_id)

    def close(self) -> None:
        self._journal.close()

    def _append(self, state: str, run_id: str) -> None:
        self._journal.write(json.dumps({"run_id": run_id, "state": state}, sort_keys=True) + "\n")


class _PhaseState:
    def __init__(self, request: LoadPhaseRequest, contexts: Sequence[WorkerContext]) -> None:
        self.request = request
        self.requested_users = len(contexts)
        self.available_contexts = deque(sorted(contexts, key=lambda item: item.worker_index))
        self.claimed_worker_indices: set[int] = set()
        self.observations: list[CapacityObservation] = []
        self.fatal_errors: list[str] = []
        self.request.observations_path.parent.mkdir(parents=True, exist_ok=True)
        self._observations_output: TextIO = self.request.observations_path.open("w", encoding="utf-8", buffering=1)
        self.tracker = _ActiveTracker(request.active_runs_path)
        self.deadline: float | None = None
        self.start_gate = Event()
        self.finished_users = 0
        self.finished_gate = Event()
        self.finished_at_ns: int | None = None
        self.finished_perf: float | None = None

    def claim_context(self) -> WorkerContext:
        if not self.available_contexts:
            raise RuntimeError("Locust spawned more Users than worker contexts")
        context = self.available_contexts.popleft()
        if context.worker_index in self.claimed_worker_indices:
            raise RuntimeError(f"worker context {context.worker_index} was claimed twice")
        self.claimed_worker_indices.add(context.worker_index)
        return context

    def should_stop(self, iterations: int) -> bool:
        if self.request.iterations_per_user is not None:
            return iterations >= self.request.iterations_per_user
        assert self.deadline is not None
        return time.perf_counter() >= self.deadline

    def mark_user_finished(self) -> None:
        self.finished_users += 1
        if self.finished_users == self.requested_users:
            self.finished_at_ns = time.time_ns()
            self.finished_perf = time.perf_counter()
            self.finished_gate.set()

    def record_metric(self, metric: RequestMetric, environment: Environment) -> None:
        environment.events.request.fire(
            request_type=metric.request_type,
            name=metric.name,
            response_time=metric.response_time_ms,
            response_length=metric.response_length,
            response=None,
            context={"phase": self.request.phase, "scenario": self.request.scenario_id},
            exception=RuntimeError(metric.error) if metric.error else None,
            start_time=None,
            url=None,
        )

    def record_observation(self, observation: CapacityObservation) -> None:
        self.observations.append(observation)
        self._observations_output.write(observation.model_dump_json() + "\n")

    def close_persistence(self) -> None:
        self._observations_output.close()
        self.tracker.close()


class _PhaseUser(User):
    abstract = True
    wait_time = constant(0)
    phase_state: ClassVar[_PhaseState]
    worker_context: WorkerContext | None = None
    iterations: int = 0
    sequence: int = 0
    agent_client: httpx.Client | None = None
    fake_client: httpx.Client | None = None
    run_client: AgentRunClient | None = None
    phase_participation_finished: bool = False

    def on_start(self) -> None:
        self.phase_participation_finished = False
        self.worker_context = None
        self.agent_client = None
        self.fake_client = None
        self.run_client = None
        try:
            self.worker_context = self.phase_state.claim_context()
            self.iterations = 0
            self.sequence = self.worker_context.worker_index
            scenario = load_scenario_manifest().get(self.phase_state.request.scenario_id)
            timeout = httpx.Timeout(connect=10, read=180, write=180, pool=10)
            limits = httpx.Limits(max_connections=5, max_keepalive_connections=5)
            self.agent_client = httpx.Client(
                base_url=self.phase_state.request.agent_url,
                timeout=timeout,
                limits=limits,
            )
            self.fake_client = httpx.Client(
                base_url=self.phase_state.request.fake_deps_url,
                timeout=timeout,
                limits=limits,
            )
            self.run_client = AgentRunClient(
                mode=self.phase_state.request.mode,
                agent_client=self.agent_client,
                fake_client=self.fake_client,
                scenario=scenario,
                block_id=self.phase_state.request.block_id,
                recorder=lambda metric: self.phase_state.record_metric(metric, self.environment),
            )
            self.phase_state.start_gate.wait()
            gevent.sleep(self.worker_context.worker_index * 0.005)
        except Exception as exc:
            self._record_fatal(exc)
            self._finish_phase_participation()
            raise StopUser() from exc
    @task
    def run_agent(self) -> None:
        if self.phase_state.should_stop(self.iterations):
            self._finish_phase_participation()
            raise StopUser()
        assert self.run_client is not None
        assert self.worker_context is not None
        try:
            observation = self.run_client.run_once(
                sequence=self.sequence,
                worker_index=self.worker_context.worker_index,
                binding_ref=self.worker_context.binding_ref,
                session_snapshot=self.worker_context.session_snapshot,
                tracker=self.phase_state.tracker,
                suspend=self.phase_state.request.suspend,
            )
            self.phase_state.record_observation(observation)
            self.iterations += 1
            self.sequence += self.phase_state.request.sequence_stride
        except Exception as exc:
            self._record_fatal(exc)
            self._finish_phase_participation()
            raise StopUser() from exc
        if observation.sample.admitted and observation.sample.terminal_status == "not_terminal":
            self._finish_phase_participation()
            raise StopUser()

    def on_stop(self) -> None:
        if self.agent_client is not None:
            self.agent_client.close()
        if self.fake_client is not None:
            self.fake_client.close()

    def _finish_phase_participation(self) -> None:
        if self.phase_participation_finished:
            return
        self.phase_participation_finished = True
        self.phase_state.mark_user_finished()

    def _record_fatal(self, exc: Exception) -> None:
        worker = (
            f"worker {self.worker_context.worker_index}: " if self.worker_context is not None else "unassigned worker: "
        )
        self.phase_state.fatal_errors.append(f"{worker}{type(exc).__name__}: {exc}")


def run_load_phase(request: LoadPhaseRequest) -> LoadPhaseResult:
    contexts = _load_contexts(request.contexts_path)
    if not contexts:
        raise ValueError("load phase requires at least one worker context")
    worker_indices = [context.worker_index for context in contexts]
    if len(worker_indices) != len(set(worker_indices)):
        raise ValueError("worker contexts must have unique indices")
    state = _PhaseState(request, contexts)

    class PhaseUser(_PhaseUser):
        abstract = False
        phase_state = state

    environment = Environment(user_classes=[PhaseUser], catch_exceptions=False)
    runner = environment.create_local_runner()
    logging.getLogger("locust.runners").setLevel(logging.ERROR)
    runner.start(user_count=len(contexts), spawn_rate=request.spawn_rate)
    preparation_deadline = time.perf_counter() + 30
    while len(state.claimed_worker_indices) < len(contexts):
        spawning = runner.spawning_greenlet
        spawning_complete = spawning is not None and spawning.ready()
        if spawning_complete and runner.user_count <= len(state.claimed_worker_indices):
            break
        if time.perf_counter() >= preparation_deadline:
            break
        gevent.sleep(0.01)
    if len(state.claimed_worker_indices) != len(contexts):
        state.fatal_errors.append(
            f"Locust claimed {len(state.claimed_worker_indices)} of {len(contexts)} worker contexts"
        )
    environment.stats.reset_all()
    started_at_ns = time.time_ns()
    started_perf = time.perf_counter()
    if request.duration_seconds is not None:
        state.deadline = started_perf + request.duration_seconds
    state.start_gate.set()
    max_spawned = 0
    watchdog_deadline = started_perf + (request.duration_seconds or 0) + request.drain_timeout_seconds
    timed_out = False
    while True:
        max_spawned = max(max_spawned, runner.user_count, len(state.claimed_worker_indices))
        if state.finished_gate.is_set():
            break
        if time.perf_counter() >= watchdog_deadline:
            timed_out = True
            break
        gevent.sleep(0.01)
    ended_perf = state.finished_perf or time.perf_counter()
    ended_at_ns = state.finished_at_ns or time.time_ns()
    if ended_perf < started_perf:
        ended_perf = started_perf
        ended_at_ns = started_at_ns
    max_spawned = max(max_spawned, len(state.claimed_worker_indices))
    active_at_end = state.tracker.active
    unresolved_at_end = state.tracker.unresolved
    while runner.user_count > 0 and time.perf_counter() < watchdog_deadline:
        gevent.sleep(0.01)
    runner.quit()
    runner.greenlet.join(timeout=5)
    state.close_persistence()
    elapsed_seconds = max(0.000001, ended_perf - started_perf)
    drain_seconds = max(0, elapsed_seconds - (request.duration_seconds or elapsed_seconds))
    if timed_out:
        state.fatal_errors.append("Locust phase exceeded its drain timeout")
    if active_at_end != 0:
        state.fatal_errors.append(f"Locust phase ended with {active_at_end} active Runs")
    if unresolved_at_end != 0:
        state.fatal_errors.append(f"Locust phase ended with {unresolved_at_end} unresolved Runs")

    serialized_entries = cast(list[dict[str, object]], environment.stats.serialize_stats())
    stats = {
        "locust_version": version("locust"),
        "phase": request.phase,
        "entries": serialized_entries,
        "errors": environment.stats.serialize_errors(),
        "total": environment.stats.total.serialize(),
    }
    request.stats_path.write_text(json.dumps(stats, indent=2, sort_keys=True, default=str))
    result = LoadPhaseResult(
        phase=request.phase,
        started_at_ns=started_at_ns,
        ended_at_ns=ended_at_ns,
        elapsed_seconds=elapsed_seconds,
        drain_seconds=drain_seconds,
        requested_users=len(contexts),
        spawned_users=max_spawned,
        observed_max_active=state.tracker.peak,
        observation_count=len(state.observations),
        timed_out=timed_out,
        fatal_errors=list(dict.fromkeys(state.fatal_errors)),
        locust_version=version("locust"),
        composite_request=_composite_request_stats(serialized_entries, request.scenario_id),
    )
    request.result_path.write_text(result.model_dump_json(indent=2))
    return result


def _composite_request_stats(entries: Sequence[dict[str, object]], scenario_id: str) -> CompositeRequestStats | None:
    entry = next(
        (
            candidate
            for candidate in entries
            if candidate.get("method") == "AGENT_RUN" and candidate.get("name") == scenario_id
        ),
        None,
    )
    if entry is None:
        return None
    request_count = _required_int(entry, "num_requests")
    total_response_time_ms = _required_float(entry, "total_response_time")
    return CompositeRequestStats(
        request_count=request_count,
        failure_count=_required_int(entry, "num_failures"),
        total_response_time_ms=total_response_time_ms,
        min_response_time_ms=_optional_float(entry, "min_response_time"),
        max_response_time_ms=_required_float(entry, "max_response_time"),
        average_response_time_ms=total_response_time_ms / request_count if request_count else 0,
    )


def _required_int(payload: dict[str, object], key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int):
        raise TypeError(f"Locust stat {key} was not an integer")
    return value


def _required_float(payload: dict[str, object], key: str) -> float:
    value = payload.get(key)
    if not isinstance(value, (int, float)):
        raise TypeError(f"Locust stat {key} was not numeric")
    return float(value)


def _optional_float(payload: dict[str, object], key: str) -> float | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, (int, float)):
        raise TypeError(f"Locust stat {key} was not numeric")
    return float(value)


def _load_contexts(path: Path) -> list[WorkerContext]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, list):
        raise TypeError("worker contexts must be a JSON list")
    return [WorkerContext.model_validate(item) for item in payload]


def _parse_args() -> LoadPhaseRequest:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    args = parser.parse_args()
    return LoadPhaseRequest.model_validate_json(args.request.read_text())


def main() -> int:
    result = run_load_phase(_parse_args())
    return 1 if result.timed_out or result.fatal_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["LoadPhaseRequest", "LoadPhaseResult", "WorkerContext", "run_load_phase"]

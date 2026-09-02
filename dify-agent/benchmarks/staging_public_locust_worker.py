"""Isolated Locust process for the public Staging c1 smoke."""

from __future__ import annotations

# Locust must be the first networking dependency imported in this interpreter.
from locust import User, constant, task
from locust.env import Environment
from locust.exception import StopUser

import argparse
from importlib.metadata import version
import logging
import os
from pathlib import Path
import time
from typing import ClassVar, Protocol, cast

from gevent import monkey
from gevent.event import Event
from pydantic import SecretStr

from benchmarks.capacity_protocol import RequestMetric
from benchmarks.staging_public_locust import bounded_end_user
from benchmarks.staging_public_protocol import StagingPublicProtocolSettings, StagingPublicServiceClient
from benchmarks.staging_public_schemas import (
    STAGING_PUBLIC_SCENARIO_SEQUENCE,
    StagingPublicCleanupResult,
    StagingPublicLoadResult,
    StagingPublicRunSample,
    StagingPublicScenarioId,
    StagingPublicSmokeExecution,
    StagingPublicWorkerRequest,
)


setattr(logging, "_lock", monkey.get_original("_thread", "RLock")())


class _Observation(Protocol):
    sample: StagingPublicRunSample


class _PublicClient(Protocol):
    def run_once(
        self,
        *,
        benchmark_run_id: str,
        scenario_id: StagingPublicScenarioId,
        scenario_version: int,
    ) -> _Observation: ...

    def cleanup_conversation(self) -> StagingPublicCleanupResult: ...

    def close(self) -> None: ...


class _WorkerState:
    def __init__(self, request: StagingPublicWorkerRequest, settings: StagingPublicProtocolSettings) -> None:
        self.request = request
        self.settings = settings
        self.end_user = bounded_end_user(request.invocation_id)
        self.samples: list[StagingPublicRunSample] = []
        self.cleanup = StagingPublicCleanupResult(complete=True)
        self.fatal_errors: list[str] = []
        self.done = Event()
        self.spawned_users = 0
        self.active = 0
        self.peak_active = 0
        self.client: _PublicClient | None = None
        self._closed = False

    def recorder(self, metric: RequestMetric, environment: Environment) -> None:
        environment.events.request.fire(
            request_type=metric.request_type,
            name=metric.name,
            response_time=metric.response_time_ms,
            response_length=metric.response_length,
            response=None,
            context={"mode": "staging-public-e2e", "smoke_only": True},
            exception=RuntimeError(metric.error) if metric.error else None,
            start_time=None,
            url=None,
        )

    def create_client(self, environment: Environment) -> _PublicClient:
        self.spawned_users += 1
        if self.spawned_users != 1:
            raise RuntimeError("public Staging smoke must spawn exactly one Locust User")
        self.client = StagingPublicServiceClient(
            settings=self.settings,
            end_user=self.end_user,
            recorder=lambda metric: self.recorder(metric, environment),
        )
        return self.client

    def execute(self, client: _PublicClient) -> None:
        try:
            for sequence, scenario_id in enumerate(STAGING_PUBLIC_SCENARIO_SEQUENCE, start=1):
                self.active += 1
                self.peak_active = max(self.peak_active, self.active)
                try:
                    observation = client.run_once(
                        benchmark_run_id=f"{self.request.invocation_id}.w0.n{sequence}",
                        scenario_id=scenario_id,
                        scenario_version=1,
                    )
                finally:
                    self.active -= 1
                self.samples.append(observation.sample.model_copy(deep=True))
                if not observation.sample.succeeded:
                    self.fatal_errors.append(f"{scenario_id} public E2E correctness failed")
                    break
        except BaseException as exc:
            self.fatal_errors.append(_redacted_error(self.settings.api_key, exc))
        finally:
            self.close_client()
            self.done.set()

    def close_client(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self.client is None:
            self.cleanup = StagingPublicCleanupResult(complete=True)
            return
        try:
            self.cleanup = self.client.cleanup_conversation()
        except BaseException as exc:
            self.cleanup = StagingPublicCleanupResult(
                attempted=True,
                complete=False,
                error=_redacted_error(self.settings.api_key, exc),
            )
        finally:
            try:
                self.client.close()
            except BaseException as exc:
                self.fatal_errors.append(_redacted_error(self.settings.api_key, exc))


class _StagingPublicSmokeUser(User):
    abstract = True
    wait_time = constant(0)
    worker_state: ClassVar[_WorkerState]
    public_client: _PublicClient | None = None
    executed = False

    def on_start(self) -> None:
        try:
            self.public_client = self.worker_state.create_client(self.environment)
        except BaseException as exc:
            self.worker_state.fatal_errors.append(_redacted_error(self.worker_state.settings.api_key, exc))
            self.worker_state.close_client()
            self.worker_state.done.set()
            raise StopUser() from exc

    @task
    def execute_smoke(self) -> None:
        if self.executed:
            raise StopUser()
        self.executed = True
        assert self.public_client is not None
        self.worker_state.execute(self.public_client)
        raise StopUser()

    def on_stop(self) -> None:
        self.worker_state.close_client()


def run_worker(request: StagingPublicWorkerRequest, *, api_key: str) -> StagingPublicSmokeExecution:
    settings = StagingPublicProtocolSettings(
        service_api_base_url=request.service_api_base_url,
        api_key=SecretStr(api_key),
        config_expected_sha256=request.config_expected_sha256,
    )
    state = _WorkerState(request, settings)

    class StagingPublicSmokeUser(_StagingPublicSmokeUser):
        abstract = False
        worker_state = state

    environment = Environment(user_classes=[StagingPublicSmokeUser], catch_exceptions=False)
    runner = environment.create_local_runner()
    started_perf = time.perf_counter()
    runner.start(user_count=1, spawn_rate=1)
    completed = state.done.wait(timeout=request.timeout_seconds)
    timed_out = not completed
    if timed_out:
        state.fatal_errors.append("public Staging c1 smoke exceeded its terminal timeout")
    runner.quit()
    runner.greenlet.join(timeout=5)
    state.close_client()
    elapsed_seconds = max(0.0, time.perf_counter() - started_perf)
    serialized_entries = cast(list[dict[str, object]], environment.stats.serialize_stats())
    load = StagingPublicLoadResult(
        spawned_users=min(state.spawned_users, 1),
        observed_max_active=state.peak_active,
        elapsed_seconds=elapsed_seconds,
        timed_out=timed_out,
        fatal_errors=list(dict.fromkeys(state.fatal_errors)),
        locust_version=version("locust"),
        stats={
            "entries": serialized_entries,
            "errors": environment.stats.serialize_errors(),
            "total": environment.stats.total.serialize(),
        },
    )
    return StagingPublicSmokeExecution(
        samples=[sample.model_copy(deep=True) for sample in state.samples],
        cleanup=state.cleanup.model_copy(deep=True),
        load=load,
    )


def main() -> int:
    args = _parse_args()
    api_key = os.environ.get("BENCH_STAGING_API_KEY", "")
    if not api_key:
        print("isolated public Locust worker requires BENCH_STAGING_API_KEY", flush=True)
        return 2
    try:
        request = StagingPublicWorkerRequest.model_validate_json(args.request.read_text(encoding="utf-8"))
        execution = run_worker(request, api_key=api_key)
        args.result.write_text(execution.model_dump_json(), encoding="utf-8")
        return 0 if not execution.load.fatal_errors else 1
    except BaseException as exc:
        print(_redacted_error(SecretStr(api_key), exc), flush=True)
        return 2


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    return parser.parse_args()


def _redacted_error(api_key: SecretStr, exc: BaseException) -> str:
    value = f"{type(exc).__name__}: {exc}"
    secret = api_key.get_secret_value()
    return value.replace(secret, "[REDACTED]") if secret else value


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["main", "run_worker"]

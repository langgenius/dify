from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from dify_agent.adapters.shell.protocols import ShellCommandResult
from dify_agent.runtime_backend import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    RuntimeLayout,
    RuntimeLease,
)

from benchmarks.e2b_driver import E2BProbeSettings, ExecutionBindings, run_probe


class _FakeCommands:
    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
    ) -> ShellCommandResult:
        del script, cwd, env, timeout
        await asyncio.sleep(0)
        return ShellCommandResult(
            job_id="job",
            status="succeeded",
            done=True,
            exit_code=0,
            output="e2b-capacity\n",
            offset=13,
            truncated=False,
        )

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> None:
        del job_id, force, grace_seconds


@dataclass(slots=True)
class _FakeLease:
    commands: _FakeCommands
    layout: RuntimeLayout = RuntimeLayout(home_dir="/home/dify", workspace_dir="/home/dify/workspace")
    files: object = object()


class _FakeBindings:
    def __init__(self, *, acquire_error: str | None = None) -> None:
        self.acquire_error = acquire_error
        self.created: list[str] = []
        self.acquired: list[str] = []
        self.released = 0
        self.destroyed: list[str] = []

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        self.created.append(spec.binding_id)
        await asyncio.sleep(0)
        return ExecutionBindingAllocation(
            binding_ref=spec.binding_id,
            workspace_ref=spec.workspace_id,
        )

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        self.acquired.append(binding_ref)
        await asyncio.sleep(0.001)
        if self.acquire_error is not None:
            raise RuntimeError(self.acquire_error)
        return cast(RuntimeLease, cast(object, _FakeLease(commands=_FakeCommands())))

    async def release(self, lease: RuntimeLease) -> None:
        del lease
        self.released += 1

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        self.destroyed.append(spec.binding_ref)


def _settings(*, concurrency: int, waves: int = 2) -> E2BProbeSettings:
    return E2BProbeSettings(
        api_key="super-secret-key",
        template="benchmark-template",
        results_dir=Path("/tmp/results"),
        block_id="e2b-block",
        concurrency=concurrency,
        waves=waves,
    )


def test_probe_uses_one_unique_binding_per_worker_operation_and_cleans_all() -> None:
    bindings = _FakeBindings()

    samples, observed_max_active, _ = asyncio.run(
        run_probe(
            _settings(concurrency=2),
            bindings=cast(ExecutionBindings, bindings),
        )
    )

    assert len(samples) == 4
    assert all(sample.success for sample in samples)
    assert observed_max_active == 2
    assert len(set(bindings.created)) == 4
    assert len(bindings.acquired) == 4
    assert bindings.released == 4
    assert sorted(bindings.destroyed) == sorted(bindings.created)


def test_probe_redacts_secret_and_balances_active_count_when_acquire_fails() -> None:
    bindings = _FakeBindings(acquire_error="quota rejected super-secret-key")

    samples, observed_max_active, _ = asyncio.run(
        run_probe(
            _settings(concurrency=1),
            bindings=cast(ExecutionBindings, bindings),
        )
    )

    assert observed_max_active == 1
    assert all(not sample.success for sample in samples)
    assert all(sample.throttle for sample in samples)
    assert all(sample.quota for sample in samples)
    assert all("super-secret-key" not in (sample.error or "") for sample in samples)
    assert all("[redacted]" in (sample.error or "") for sample in samples)
    assert bindings.released == 0
    assert sorted(bindings.destroyed) == sorted(bindings.created)


def test_probe_settings_safe_environment_and_repr_exclude_api_key() -> None:
    settings = _settings(concurrency=1)

    assert "super-secret-key" not in repr(settings)
    assert "super-secret-key" not in str(settings.safe_environment())
    assert settings.safe_environment()["template"] == "benchmark-template"

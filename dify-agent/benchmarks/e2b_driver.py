"""Real E2B lifecycle calibration with explicit per-resource cleanup."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import time
from typing import Protocol
from uuid import uuid4

from dify_agent.runtime_backend import (
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    RuntimeLease,
)
from dify_agent.runtime_backend.e2b import E2BExecutionBindingBackend, E2BSDKControlPlane
from dify_agent.runtime_backend.shellctl import run_shellctl_control_command

from benchmarks.capacity import E2BLifecycleSample


class ExecutionBindings(Protocol):
    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation: ...

    async def acquire(self, binding_ref: str) -> RuntimeLease: ...

    async def release(self, lease: RuntimeLease) -> None: ...

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None: ...


@dataclass(slots=True, frozen=True)
class E2BProbeSettings:
    """Secret-bearing driver settings with an explicitly safe serialized view."""

    api_key: str = field(repr=False)
    template: str
    results_dir: Path
    block_id: str
    concurrency: int
    waves: int = 5
    active_timeout_seconds: int = 900

    @classmethod
    def from_environment(cls) -> "E2BProbeSettings":
        return cls(
            api_key=_required_environment("BENCH_E2B_API_KEY"),
            template=_required_environment("BENCH_E2B_TEMPLATE"),
            results_dir=Path(os.environ.get("BENCH_RESULTS_DIR", "/results")),
            block_id=_required_environment("BENCH_BLOCK_ID"),
            concurrency=int(_required_environment("BENCH_CONCURRENCY")),
            waves=int(os.environ.get("BENCH_E2B_WAVES", "5")),
            active_timeout_seconds=int(os.environ.get("BENCH_E2B_ACTIVE_TIMEOUT_SECONDS", "900")),
        )

    def safe_environment(self) -> dict[str, str | int]:
        return {
            "template": self.template,
            "block_id": self.block_id,
            "concurrency": self.concurrency,
            "waves": self.waves,
            "active_timeout_seconds": self.active_timeout_seconds,
        }


@dataclass(slots=True)
class ActiveProbeTracker:
    active: int = 0
    peak: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def entered(self) -> None:
        async with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)

    async def exited(self) -> None:
        async with self.lock:
            self.active -= 1


async def run_probe(
    settings: E2BProbeSettings,
    *,
    bindings: ExecutionBindings | None = None,
) -> tuple[list[E2BLifecycleSample], int, float]:
    """Run fixed concurrent waves and return samples, observed concurrency, and wall time."""
    if settings.concurrency < 1 or settings.waves < 1:
        raise ValueError("concurrency and waves must be positive")
    resolved_bindings = bindings or E2BExecutionBindingBackend(
        control_plane=E2BSDKControlPlane(api_key=settings.api_key),
        template=settings.template,
        active_timeout_seconds=settings.active_timeout_seconds,
    )
    tracker = ActiveProbeTracker()
    started = time.perf_counter()
    samples: list[E2BLifecycleSample] = []
    for wave_index in range(settings.waves):
        wave = await asyncio.gather(
            *(
                _run_operation(
                    settings=settings,
                    bindings=resolved_bindings,
                    wave_index=wave_index,
                    worker_index=worker_index,
                    tracker=tracker,
                )
                for worker_index in range(settings.concurrency)
            )
        )
        samples.extend(wave)
    return samples, tracker.peak, time.perf_counter() - started


async def _run_operation(
    *,
    settings: E2BProbeSettings,
    bindings: ExecutionBindings,
    wave_index: int,
    worker_index: int,
    tracker: ActiveProbeTracker,
) -> E2BLifecycleSample:
    sample = E2BLifecycleSample(
        block_id=settings.block_id,
        worker_index=worker_index,
        wave_index=wave_index,
    )
    marker = uuid4().hex
    allocation: ExecutionBindingAllocation | None = None
    lease: RuntimeLease | None = None
    tracker_entered = False
    try:
        started = time.perf_counter()
        allocation = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="benchmark-tenant",
                agent_id="benchmark-agent",
                binding_id=f"binding-{marker}",
                workspace_id=f"workspace-{marker}",
                existing_workspace_ref=None,
                home_snapshot_ref=None,
            )
        )
        sample.create_pause_ms = (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        lease = await bindings.acquire(allocation.binding_ref)
        sample.connect_acquire_ms = (time.perf_counter() - started) * 1000
        active_started = time.perf_counter()
        await tracker.entered()
        tracker_entered = True
        started = time.perf_counter()
        result = await run_shellctl_control_command(lease.commands, "printf 'e2b-capacity\\n'")
        sample.first_output_ms = (time.perf_counter() - started) * 1000
        if result.exit_code != 0 or result.output != "e2b-capacity\n":
            raise RuntimeError("E2B shellctl probe returned unexpected output")
        started = time.perf_counter()
        await bindings.release(lease)
        lease = None
        sample.release_pause_ms = (time.perf_counter() - started) * 1000
        sample.active_window_seconds = time.perf_counter() - active_started
        await tracker.exited()
        tracker_entered = False
        started = time.perf_counter()
        await bindings.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref=allocation.binding_ref,
                workspace_ref=allocation.workspace_ref,
                destroy_workspace=True,
            )
        )
        allocation = None
        sample.destroy_kill_ms = (time.perf_counter() - started) * 1000
        sample.success = True
    except BaseException as exc:
        message = f"{type(exc).__name__}: {exc}".replace(settings.api_key, "[redacted]")
        lowered = message.lower()
        sample.throttle = any(token in lowered for token in ("throttle", "quota", "429"))
        sample.quota = "quota" in lowered
        sample.not_found = "notfound" in lowered or "not found" in lowered or "no longer exists" in lowered
        sample.error = message
    finally:
        if lease is not None:
            try:
                await bindings.release(lease)
            except BaseException as exc:
                sample.cleanup_error = True
                sample.error = _append_cleanup_error(sample.error, exc, settings.api_key)
        if tracker_entered:
            await tracker.exited()
        if allocation is not None:
            try:
                await bindings.destroy_binding(
                    ExecutionBindingDestroySpec(
                        binding_ref=allocation.binding_ref,
                        workspace_ref=allocation.workspace_ref,
                        destroy_workspace=True,
                    )
                )
            except BaseException as exc:
                sample.cleanup_error = True
                sample.error = _append_cleanup_error(sample.error, exc, settings.api_key)
    return sample


def _append_cleanup_error(current: str | None, error: BaseException, api_key: str) -> str:
    detail = f"cleanup {type(error).__name__}: {error}".replace(api_key, "[redacted]")
    return f"{current}; {detail}" if current else detail


def _required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


async def main() -> int:
    settings = E2BProbeSettings.from_environment()
    samples, observed_max_active, elapsed_seconds = await run_probe(settings)
    settings.results_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "environment": settings.safe_environment(),
        "observed_max_active": observed_max_active,
        "elapsed_seconds": elapsed_seconds,
        "samples": [sample.model_dump(mode="json") for sample in samples],
    }
    (settings.results_dir / "e2b-lifecycle.json").write_text(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if all(sample.success and not sample.cleanup_error for sample in samples) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))


__all__ = ["E2BProbeSettings", "ExecutionBindings", "run_probe"]

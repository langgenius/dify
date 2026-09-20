import asyncio
from typing import Any

import pytest

from dify_agent.runtime_backend.usage import (
    current_runtime_usage_context,
    observe_runtime_operation,
    runtime_usage_context,
)


@pytest.mark.anyio
async def test_usage_context_is_task_local_and_restored_after_failure() -> None:
    ready = asyncio.Event()
    values: dict[str, tuple[str | None, dict[str, str]]] = {}

    async def task(run_id: str) -> None:
        with runtime_usage_context(purpose="agent_run", correlation={"run_id": run_id}):
            await ready.wait()
            with runtime_usage_context(purpose="file_read", lease_id=run_id):
                context = current_runtime_usage_context()
                values[run_id] = (context.lease_id, dict(context.correlation))
            assert current_runtime_usage_context().purpose == "agent_run"

    async with asyncio.TaskGroup() as group:
        group.create_task(task("one"))
        group.create_task(task("two"))
        ready.set()
    assert values == {"one": ("one", {"run_id": "one"}), "two": ("two", {"run_id": "two"})}
    assert current_runtime_usage_context().purpose is None
    with pytest.raises(RuntimeError):
        with runtime_usage_context(purpose="snapshot"):
            raise RuntimeError("primary")
    assert current_runtime_usage_context().purpose is None


@pytest.mark.anyio
async def test_observation_failure_does_not_change_resource_outcome(caplog: pytest.LogCaptureFixture) -> None:
    class BrokenObserver:
        async def observe_safely(self, event: dict[str, Any]) -> None:
            raise RuntimeError("must-not-log-sensitive-contents")

    await observe_runtime_operation(
        BrokenObserver(),
        operation_id="op",
        attempt=1,
        phase="observed",
        operation="pause",
        cleanup_stage="binding_release",
        outcome="success",
    )
    assert "RuntimeError" in caplog.text
    assert "must-not-log-sensitive-contents" not in caplog.text


@pytest.mark.anyio
async def test_direct_observation_can_suspend_and_preserves_business_cancellation() -> None:
    entered = asyncio.Event()

    class DirectObserver:
        async def observe_safely(self, event: dict[str, Any]) -> None:
            entered.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(
        observe_runtime_operation(
            DirectObserver(),
            operation_id="operation",
            attempt=1,
            phase="observed",
            operation="connect",
            cleanup_stage="binding_acquire",
            sandbox_id="sandbox",
        )
    )
    async with asyncio.timeout(2):
        await entered.wait()
    task.cancel("original cancellation")
    with pytest.raises(asyncio.CancelledError, match="original cancellation"):
        await task

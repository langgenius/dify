"""Deterministic plugin-daemon wire service used only by local Docker benchmarks.

The service implements the two invoke endpoints exercised by the MVP. Scenario
identity is carried in otherwise inert benchmark credentials, which lets one
shared sidecar keep concurrent run ledgers isolated without changing production
request schemas.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from decimal import Decimal
import json
import time
from typing import ClassVar

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from pydantic import BaseModel, ConfigDict, JsonValue

from benchmarks.scenario import BenchmarkScenario, load_scenario_manifest
from benchmarks.schemas import FakeDependencyLedger


_MODEL_NAME = "benchmark-model"
_TOOL_NAME = "benchmark_tool"
_ZERO_PRICE = Decimal(0)


class PluginInvokeRequest(BaseModel):
    """Subset of the plugin-daemon request envelope required by the fake."""

    data: dict[str, JsonValue]
    user_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")


class BenchmarkLedgerStore:
    """Concurrency-safe in-memory ledger keyed by benchmark run identity."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._ledgers: dict[str, FakeDependencyLedger] = {}

    async def reset(self) -> None:
        """Remove all prior warmup and measurement ledgers."""
        async with self._lock:
            self._ledgers.clear()

    async def read(self, benchmark_run_id: str) -> FakeDependencyLedger:
        """Return a defensive copy of one run ledger."""
        async with self._lock:
            ledger = self._ledgers.get(benchmark_run_id)
            if ledger is None:
                raise KeyError(benchmark_run_id)
            return ledger.model_copy(deep=True)

    async def begin_model_call(
        self,
        *,
        benchmark_run_id: str,
        scenario: BenchmarkScenario,
    ) -> int:
        """Register a model request and return its one-based round number."""
        async with self._lock:
            ledger = self._get_or_create(benchmark_run_id, scenario)
            ledger.model_calls += 1
            return ledger.model_calls

    async def record_model_item(
        self,
        *,
        benchmark_run_id: str,
        text_chunk: bool,
    ) -> None:
        """Record one daemon stream item produced for a model request."""
        async with self._lock:
            ledger = self._ledgers[benchmark_run_id]
            ledger.model_stream_items += 1
            if text_chunk:
                ledger.text_chunks += 1

    async def record_model_start(self, *, benchmark_run_id: str, elapsed_ms: float) -> None:
        """Record time to the first deterministic model stream item."""
        async with self._lock:
            self._ledgers[benchmark_run_id].model_start_elapsed_ms.append(elapsed_ms)

    async def record_tool_call(
        self,
        *,
        benchmark_run_id: str,
        scenario: BenchmarkScenario,
        elapsed_ms: float,
    ) -> None:
        """Record one deterministic tool response."""
        async with self._lock:
            ledger = self._get_or_create(benchmark_run_id, scenario)
            ledger.tool_calls += 1
            ledger.tool_response_bytes += scenario.tool_response_bytes
            ledger.tool_elapsed_ms.append(elapsed_ms)

    def _get_or_create(
        self,
        benchmark_run_id: str,
        scenario: BenchmarkScenario,
    ) -> FakeDependencyLedger:
        ledger = self._ledgers.get(benchmark_run_id)
        if ledger is None:
            ledger = FakeDependencyLedger(
                benchmark_run_id=benchmark_run_id,
                scenario_id=scenario.id,
                scenario_version=scenario.version,
                dependency_budget_ms=scenario.dependency_budget_ms,
            )
            self._ledgers[benchmark_run_id] = ledger
        elif ledger.scenario_id != scenario.id or ledger.scenario_version != scenario.version:
            raise ValueError(f"benchmark run {benchmark_run_id!r} changed scenario identity")
        return ledger


manifest = load_scenario_manifest()
ledger_store = BenchmarkLedgerStore()
app = FastAPI(title="Dify Agent deterministic benchmark dependencies")


@app.get("/health")
async def health() -> dict[str, str]:
    """Return readiness for Docker Compose health checks."""
    return {"status": "ok"}


@app.post("/__bench/reset")
async def reset_ledgers() -> dict[str, str]:
    """Clear warmup ledgers before a measured block."""
    await ledger_store.reset()
    return {"status": "reset"}


@app.get("/__bench/ledgers/{benchmark_run_id}", response_model=FakeDependencyLedger)
async def get_ledger(benchmark_run_id: str) -> FakeDependencyLedger:
    """Return observed dependency work for driver-side validation."""
    try:
        return await ledger_store.read(benchmark_run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="benchmark ledger not found") from exc


@app.post("/plugin/{tenant_id}/dispatch/llm/invoke")
async def invoke_llm(tenant_id: str, request: PluginInvokeRequest) -> StreamingResponse:
    """Emit deterministic Graphon LLM chunks using the production daemon envelope."""
    del tenant_id
    scenario, benchmark_run_id = _resolve_benchmark_identity(request)
    round_number = await ledger_store.begin_model_call(
        benchmark_run_id=benchmark_run_id,
        scenario=scenario,
    )
    if round_number > scenario.model_rounds:
        raise HTTPException(status_code=409, detail="model invoked more times than configured")

    async def stream() -> AsyncIterator[str]:
        started_ns = time.perf_counter_ns()
        await asyncio.sleep(scenario.model_delay_ms / 1000)
        await ledger_store.record_model_start(
            benchmark_run_id=benchmark_run_id,
            elapsed_ms=(time.perf_counter_ns() - started_ns) / 1_000_000,
        )
        if round_number <= scenario.tool_rounds:
            item = _tool_call_chunk(round_number)
            await ledger_store.record_model_item(
                benchmark_run_id=benchmark_run_id,
                text_chunk=False,
            )
            yield _wrap_stream_item(item)
            return

        for index in range(scenario.text_chunks):
            if index > 0:
                if scenario.chunk_interval_ms:
                    await asyncio.sleep(scenario.chunk_interval_ms / 1000)
                else:
                    await asyncio.sleep(0)
            item = _text_chunk(index=index, final=index == scenario.text_chunks - 1)
            await ledger_store.record_model_item(
                benchmark_run_id=benchmark_run_id,
                text_chunk=True,
            )
            yield _wrap_stream_item(item)

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/plugin/{tenant_id}/dispatch/tool/invoke")
async def invoke_tool(tenant_id: str, request: PluginInvokeRequest) -> StreamingResponse:
    """Return a fixed-size text observation through the production tool envelope."""
    del tenant_id
    scenario, benchmark_run_id = _resolve_benchmark_identity(request)
    started_ns = time.perf_counter_ns()
    await asyncio.sleep(scenario.tool_delay_ms / 1000)
    await ledger_store.record_tool_call(
        benchmark_run_id=benchmark_run_id,
        scenario=scenario,
        elapsed_ms=(time.perf_counter_ns() - started_ns) / 1_000_000,
    )
    response_text = "x" * scenario.tool_response_bytes
    data = {"type": "text", "message": {"text": response_text}}
    return StreamingResponse(iter([_wrap_data(data)]), media_type="text/event-stream")


def _resolve_benchmark_identity(request: PluginInvokeRequest) -> tuple[BenchmarkScenario, str]:
    credentials = request.data.get("credentials")
    if not isinstance(credentials, dict):
        raise HTTPException(status_code=422, detail="benchmark credentials are required")
    benchmark_run_id = credentials.get("benchmark_run_id")
    scenario_id = credentials.get("scenario_id")
    scenario_version = credentials.get("scenario_version")
    if not isinstance(benchmark_run_id, str) or not benchmark_run_id:
        raise HTTPException(status_code=422, detail="benchmark_run_id is required")
    if not isinstance(scenario_id, str):
        raise HTTPException(status_code=422, detail="scenario_id is required")
    if not isinstance(scenario_version, int):
        raise HTTPException(status_code=422, detail="scenario_version is required")
    try:
        scenario = manifest.get(scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if scenario.version != scenario_version:
        raise HTTPException(status_code=409, detail="scenario version mismatch")
    return scenario, benchmark_run_id


def _tool_call_chunk(round_number: int) -> LLMResultChunk:
    tool_call = AssistantPromptMessage.ToolCall(
        id=f"benchmark-tool-call-{round_number}",
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
            name=_TOOL_NAME,
            arguments='{"query":"benchmark"}',
        ),
    )
    return LLMResultChunk(
        model=_MODEL_NAME,
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content="", tool_calls=[tool_call]),
            finish_reason="tool_calls",
        ),
    )


def _text_chunk(*, index: int, final: bool) -> LLMResultChunk:
    return LLMResultChunk(
        model=_MODEL_NAME,
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content="x", tool_calls=[]),
            usage=_usage() if final else None,
            finish_reason="stop" if final else None,
        ),
    )


def _usage() -> LLMUsage:
    return LLMUsage(
        prompt_tokens=10,
        prompt_unit_price=_ZERO_PRICE,
        prompt_price_unit=_ZERO_PRICE,
        prompt_price=_ZERO_PRICE,
        completion_tokens=5,
        completion_unit_price=_ZERO_PRICE,
        completion_price_unit=_ZERO_PRICE,
        completion_price=_ZERO_PRICE,
        total_tokens=15,
        total_price=_ZERO_PRICE,
        currency="USD",
        latency=0.01,
    )


def _wrap_stream_item(item: LLMResultChunk) -> str:
    return _wrap_data(item.model_dump(mode="json"))


def _wrap_data(data: object) -> str:
    return f"data: {json.dumps({'code': 0, 'message': 'ok', 'data': data})}\n\n"


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5002)

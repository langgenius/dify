"""Deterministic plugin-daemon wire service used only by local Docker benchmarks.

The service implements the two invoke endpoints exercised by the MVP. Scenario
identity is carried in otherwise inert benchmark credentials, which lets one
shared sidecar keep concurrent run ledgers isolated without changing production
request schemas.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
from collections.abc import AsyncIterator
from decimal import Decimal
import json
import os
import time
from typing import ClassVar, Literal, cast
import zipfile

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from pydantic import BaseModel, ConfigDict, JsonValue

from benchmarks.scenario import CapacityScenario, config_file_name, config_skill_name, load_scenario_manifest
from benchmarks.schemas import FakeDependencyLedger


_MODEL_NAME = "benchmark-model"
_SHELL_TOOL_NAME = "shell_run"
_CONFIG_MATERIALIZATION_MARKER = "DIFY_CONFIG_MATERIALIZATION_SHA256="
_ZERO_PRICE = Decimal(0)


def _benchmark_data_url(path: str) -> str:
    """Return the public data-plane URL used by an external E2B Sandbox."""
    base_url = os.environ.get(
        "BENCH_PUBLIC_DATA_BASE_URL",
        "http://fake-deps:5002/__bench",
    ).rstrip("/")
    return f"{base_url}/{path.lstrip('/')}"


def _benchmark_data_uri(path: str) -> str:
    """Return an origin-free URI matching the current Dify file data plane."""
    return f"/files/benchmarks/{path.lstrip('/')}"


class PluginInvokeRequest(BaseModel):
    """Subset of the plugin-daemon request envelope required by the fake."""

    data: dict[str, JsonValue]
    user_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")


class AgentLLMInvokeRequest(BaseModel):
    """Subset of the API-owned Agent LLM gateway request required by the fake."""

    caller: dict[str, JsonValue]
    target: dict[str, JsonValue]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class PrepareLedgerRequest(BaseModel):
    """Register capability identity before layer initialization calls the Stub."""

    benchmark_run_id: str
    scenario_id: str
    scenario_version: int
    payload_bytes: int | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BenchmarkLedgerStore:
    """Concurrency-safe in-memory ledger keyed by benchmark run identity."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._ledgers: dict[str, FakeDependencyLedger] = {}
        self._files: dict[str, tuple[str, str, bytes]] = {}
        self._scenarios: dict[str, CapacityScenario] = {}

    async def reset(self) -> None:
        """Remove all prior warmup and measurement ledgers."""
        async with self._lock:
            self._ledgers.clear()
            self._files.clear()
            self._scenarios.clear()

    async def prepare(
        self,
        *,
        benchmark_run_id: str,
        scenario: CapacityScenario,
    ) -> None:
        async with self._lock:
            _ = self._get_or_create(benchmark_run_id, scenario)
            self._scenarios[benchmark_run_id] = scenario.model_copy(deep=True)

    async def read(self, benchmark_run_id: str) -> FakeDependencyLedger:
        """Return a defensive copy of one run ledger."""
        async with self._lock:
            ledger = self._ledgers.get(benchmark_run_id)
            if ledger is None:
                raise KeyError(benchmark_run_id)
            return ledger.model_copy(deep=True)

    async def read_scenario(self, benchmark_run_id: str) -> CapacityScenario:
        """Return the per-run scenario, including benchmark-only payload overrides."""
        async with self._lock:
            scenario = self._scenarios.get(benchmark_run_id)
            if scenario is None:
                raise KeyError(benchmark_run_id)
            return scenario.model_copy(deep=True)

    async def begin_model_call(
        self,
        *,
        benchmark_run_id: str,
        scenario: CapacityScenario,
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
        scenario: CapacityScenario,
        elapsed_ms: float,
    ) -> None:
        """Record one deterministic tool response."""
        async with self._lock:
            ledger = self._get_or_create(benchmark_run_id, scenario)
            ledger.tool_calls += 1
            ledger.tool_elapsed_ms.append(elapsed_ms)

    async def record_capability_tool_plan(self, *, benchmark_run_id: str) -> None:
        async with self._lock:
            self._ledgers[benchmark_run_id].tool_calls += 1

    async def record_config_materialization(
        self,
        *,
        benchmark_run_id: str,
        digest: str | None,
        expected_digest: str,
    ) -> None:
        async with self._lock:
            ledger = self._ledgers[benchmark_run_id]
            ledger.config_materialization_sha256 = digest
            ledger.config_materialization_valid = digest == expected_digest

    async def record_stub_call(
        self,
        *,
        benchmark_run_id: str,
        name: str,
        payload: bytes | None = None,
        elapsed_ms: float | None = None,
    ) -> None:
        async with self._lock:
            ledger = self._ledgers[benchmark_run_id]
            ledger.stub_calls[name] = ledger.stub_calls.get(name, 0) + 1
            if elapsed_ms is not None:
                ledger.stub_elapsed_ms.append(elapsed_ms)
            if payload is not None:
                ledger.payload_bytes += len(payload)
                ledger.payload_sha256.append(hashlib.sha256(payload).hexdigest())

    async def store_file(
        self,
        *,
        benchmark_run_id: str,
        filename: str,
        payload: bytes,
        elapsed_ms: float,
    ) -> str:
        record_id = hashlib.sha256(f"{benchmark_run_id}:{filename}:{len(payload)}".encode()).hexdigest()[:32]
        async with self._lock:
            self._files[record_id] = (benchmark_run_id, filename, payload)
        await self.record_stub_call(
            benchmark_run_id=benchmark_run_id,
            name="signed_upload",
            payload=payload,
            elapsed_ms=elapsed_ms,
        )
        return record_id

    async def read_file(self, record_id: str) -> tuple[str, str, bytes]:
        async with self._lock:
            try:
                return self._files[record_id]
            except KeyError as exc:
                raise KeyError(record_id) from exc

    async def consume_file(self, record_id: str) -> tuple[str, str, bytes]:
        async with self._lock:
            try:
                return self._files.pop(record_id)
            except KeyError as exc:
                raise KeyError(record_id) from exc

    def _get_or_create(
        self,
        benchmark_run_id: str,
        scenario: CapacityScenario,
    ) -> FakeDependencyLedger:
        ledger = self._ledgers.get(benchmark_run_id)
        if ledger is None:
            ledger = FakeDependencyLedger(
                benchmark_run_id=benchmark_run_id,
                scenario_id=scenario.id,
                scenario_version=scenario.version,
            )
            self._ledgers[benchmark_run_id] = ledger
        elif ledger.scenario_id != scenario.id or ledger.scenario_version != scenario.version:
            raise ValueError(f"benchmark run {benchmark_run_id!r} changed scenario identity")
        return ledger


scenario_manifest = load_scenario_manifest()
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


@app.post("/__bench/prepare")
async def prepare_ledger(request: PrepareLedgerRequest) -> dict[str, str]:
    try:
        scenario = scenario_manifest.get(request.scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if scenario.version != request.scenario_version:
        raise HTTPException(status_code=409, detail="scenario version mismatch")
    if request.payload_bytes is not None:
        if not scenario.is_file_workload or request.payload_bytes < 1:
            raise HTTPException(
                status_code=422,
                detail="payload_bytes is only valid as a positive file override",
            )
        scenario = scenario.model_copy(update={"payload_bytes": request.payload_bytes})
    await ledger_store.prepare(benchmark_run_id=request.benchmark_run_id, scenario=scenario)
    return {"status": "prepared"}


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
    scenario, benchmark_run_id = await _resolve_benchmark_identity(request)
    return await _invoke_benchmark_llm(
        request=request,
        scenario=scenario,
        benchmark_run_id=benchmark_run_id,
    )


@app.post("/inner/api/agent/llm/invoke")
async def invoke_agent_llm(request: AgentLLMInvokeRequest) -> StreamingResponse:
    """Emit deterministic chunks through the current API-owned Agent LLM gateway."""
    benchmark_run_id = request.caller.get("user_id")
    if not isinstance(benchmark_run_id, str) or not benchmark_run_id:
        raise HTTPException(status_code=422, detail="caller.user_id is required")
    try:
        scenario = await ledger_store.read_scenario(benchmark_run_id)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await _invoke_benchmark_llm(
        request=PluginInvokeRequest(data=request.target, user_id=benchmark_run_id),
        scenario=scenario,
        benchmark_run_id=benchmark_run_id,
    )


async def _invoke_benchmark_llm(
    *,
    request: PluginInvokeRequest,
    scenario: CapacityScenario,
    benchmark_run_id: str,
) -> StreamingResponse:
    round_number = await ledger_store.begin_model_call(
        benchmark_run_id=benchmark_run_id,
        scenario=scenario,
    )
    if round_number > scenario.model_rounds:
        raise HTTPException(status_code=409, detail="model invoked more times than configured")
    if scenario.workload == "config" and round_number == scenario.model_rounds:
        digest = _config_materialization_digest_from_request(request)
        await ledger_store.record_config_materialization(
            benchmark_run_id=benchmark_run_id,
            digest=digest,
            expected_digest=_expected_config_materialization_digest(scenario, benchmark_run_id),
        )

    async def stream() -> AsyncIterator[str]:
        started_ns = time.perf_counter_ns()
        await asyncio.sleep(scenario.model_delay_ms / 1000)
        await ledger_store.record_model_start(
            benchmark_run_id=benchmark_run_id,
            elapsed_ms=(time.perf_counter_ns() - started_ns) / 1_000_000,
        )
        if round_number <= scenario.tool_rounds:
            await ledger_store.record_capability_tool_plan(benchmark_run_id=benchmark_run_id)
            item = _capability_tool_call_chunk(
                scenario=scenario,
                round_number=round_number,
                benchmark_run_id=benchmark_run_id,
            )
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
    """Reject unexpected plugin-tool calls; capacity workloads use the Shell layer."""
    del tenant_id
    del request
    raise HTTPException(status_code=409, detail="capacity workloads do not invoke plugin tools")


@app.get("/inner/api/agent-config/{benchmark_run_id}/manifest")
async def config_manifest(benchmark_run_id: str) -> dict[str, object]:
    started_ns = time.perf_counter_ns()
    scenario = await _capability_scenario(benchmark_run_id)
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="config_manifest",
        elapsed_ms=_elapsed_ms(started_ns),
    )
    return {
        "agent_id": benchmark_run_id,
        "config_version": {"id": "benchmark-config", "kind": "snapshot", "writable": False},
        "skills": {
            "items": [
                {
                    "name": config_skill_name(benchmark_run_id, index),
                    "description": "deterministic benchmark skill",
                    "size": scenario.item_bytes,
                    "mime_type": "application/zip",
                }
                for index in range(scenario.config_skill_count)
            ]
        },
        "files": {
            "items": [
                {
                    "name": config_file_name(benchmark_run_id, index),
                    "size": scenario.item_bytes,
                    "mime_type": "application/octet-stream",
                }
                for index in range(scenario.config_file_count)
            ]
        },
        "env_keys": [],
        "note": "benchmark",
    }


@app.post("/inner/api/agent-config/{benchmark_run_id}/download-request")
async def config_download_request(benchmark_run_id: str, request: Request) -> dict[str, object]:
    """Allocate one current-contract Config data-plane URI."""
    scenario = await _capability_scenario(benchmark_run_id)
    body = cast(dict[str, object], await request.json())
    source = body.get("config")
    if not isinstance(source, dict):
        raise HTTPException(status_code=422, detail="config source is required")
    source_mapping = cast(dict[str, object], source)
    kind = _required_string(source_mapping, "kind")
    name = _required_string(source_mapping, "name")
    if kind not in {"skill", "file"}:
        raise HTTPException(status_code=422, detail="config kind must be skill or file")
    typed_kind = cast(Literal["skill", "file"], kind)
    _require_config_item(scenario=scenario, benchmark_run_id=benchmark_run_id, kind=typed_kind, name=name)
    payload = _config_asset_payload(scenario=scenario, kind=typed_kind, name=name)
    encoded_name = base64.urlsafe_b64encode(name.encode()).decode().rstrip("=")
    return {
        "filename": f"{name}.zip" if kind == "skill" else name,
        "mime_type": "application/zip" if kind == "skill" else "application/octet-stream",
        "size": len(payload),
        "download_uri": _benchmark_data_uri(f"config/{benchmark_run_id}/{kind}/{encoded_name}"),
    }


@app.get("/files/benchmarks/config/{benchmark_run_id}/{kind}/{encoded_name}")
async def config_asset_download(benchmark_run_id: str, kind: str, encoded_name: str) -> Response:
    """Serve one Config asset after the control-plane URI allocation."""
    started_ns = time.perf_counter_ns()
    scenario = await _capability_scenario(benchmark_run_id)
    try:
        name = base64.urlsafe_b64decode(encoded_name + "=" * (-len(encoded_name) % 4)).decode()
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="invalid config asset name") from exc
    if kind not in {"skill", "file"}:
        raise HTTPException(status_code=422, detail="config kind must be skill or file")
    typed_kind = cast(Literal["skill", "file"], kind)
    _require_config_item(
        scenario=scenario,
        benchmark_run_id=benchmark_run_id,
        kind=typed_kind,
        name=name,
    )
    payload = _config_asset_payload(scenario=scenario, kind=typed_kind, name=name)
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="config_skill_pull" if typed_kind == "skill" else "config_file_pull",
        payload=_fixed_payload(f"{typed_kind if typed_kind == 'skill' else 'config'}:{name}", scenario.item_bytes),
        elapsed_ms=_elapsed_ms(started_ns),
    )
    return Response(
        payload,
        media_type="application/zip" if typed_kind == "skill" else "application/octet-stream",
    )


@app.get("/inner/api/agent-config/{benchmark_run_id}/skills/{name}/pull")
async def config_skill_pull(benchmark_run_id: str, name: str) -> Response:
    started_ns = time.perf_counter_ns()
    scenario = await _capability_scenario(benchmark_run_id)
    payload = _skill_archive(name=name, content_bytes=scenario.item_bytes)
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="config_skill_pull",
        payload=_fixed_payload(f"skill:{name}", scenario.item_bytes),
        elapsed_ms=_elapsed_ms(started_ns),
    )
    return Response(payload, media_type="application/zip")


@app.get("/inner/api/agent-config/{benchmark_run_id}/files/{name}/pull")
async def config_file_pull(benchmark_run_id: str, name: str) -> Response:
    started_ns = time.perf_counter_ns()
    scenario = await _capability_scenario(benchmark_run_id)
    payload = _fixed_payload(f"config:{name}", scenario.item_bytes)
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="config_file_pull",
        payload=payload,
        elapsed_ms=_elapsed_ms(started_ns),
    )
    return Response(payload, media_type="application/octet-stream")


@app.post("/inner/api/upload/file/request")
async def request_file_upload(request: Request) -> dict[str, object]:
    started_ns = time.perf_counter_ns()
    payload = cast(dict[str, object], await request.json())
    benchmark_run_id = _required_string(payload, "user_id")
    filename = _required_string(payload, "filename")
    await _capability_scenario(benchmark_run_id)
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="file_upload_request",
        elapsed_ms=_elapsed_ms(started_ns),
    )
    encoded_name = base64.urlsafe_b64encode(filename.encode()).decode().rstrip("=")
    return {
        "data": {
            "url": _benchmark_data_url(f"files/upload/{benchmark_run_id}/{encoded_name}"),
        }
    }


@app.post("/inner/api/agent/files/upload-request")
async def request_agent_file_upload(request: Request) -> dict[str, str]:
    """Allocate the origin-free upload URI used by the current Agent Stub."""
    started_ns = time.perf_counter_ns()
    payload = cast(dict[str, object], await request.json())
    benchmark_run_id = _required_string(payload, "user_id")
    filename = _required_string(payload, "filename")
    scenario = await _capability_scenario(benchmark_run_id)
    if not scenario.is_file_workload:
        raise HTTPException(status_code=409, detail="file upload requested for a non-file workload")
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="file_upload_request",
        elapsed_ms=_elapsed_ms(started_ns),
    )
    encoded_name = base64.urlsafe_b64encode(filename.encode()).decode().rstrip("=")
    return {"upload_uri": _benchmark_data_uri(f"upload/{benchmark_run_id}/{encoded_name}")}


@app.post("/__bench/files/upload/{benchmark_run_id}/{encoded_name}")
async def upload_file(benchmark_run_id: str, encoded_name: str, request: Request) -> dict[str, str]:
    started_ns = time.perf_counter_ns()
    await _capability_scenario(benchmark_run_id)
    filename = base64.urlsafe_b64decode(encoded_name + "=" * (-len(encoded_name) % 4)).decode()
    body = await request.body()
    payload = _multipart_file_bytes(body, request.headers.get("content-type", ""))
    record_id = await ledger_store.store_file(
        benchmark_run_id=benchmark_run_id,
        filename=filename,
        payload=payload,
        elapsed_ms=_elapsed_ms(started_ns),
    )
    reference = _canonical_file_reference(record_id)
    return {"reference": reference}


@app.post("/files/benchmarks/upload/{benchmark_run_id}/{encoded_name}")
async def upload_agent_file(benchmark_run_id: str, encoded_name: str, request: Request) -> dict[str, str]:
    """Receive bytes from the current Agent CLI signed-upload data path."""
    return await upload_file(benchmark_run_id, encoded_name, request)


@app.post("/inner/api/download/file/request")
async def request_file_download(request: Request) -> dict[str, object]:
    started_ns = time.perf_counter_ns()
    payload = cast(dict[str, object], await request.json())
    benchmark_run_id = _required_string(payload, "user_id")
    file_mapping = payload.get("file")
    if not isinstance(file_mapping, dict):
        raise HTTPException(status_code=422, detail="file mapping is required")
    reference = _required_string(cast(dict[str, object], file_mapping), "reference")
    record_id = _record_id_from_reference(reference)
    owner_run_id, filename, content = await ledger_store.read_file(record_id)
    if owner_run_id != benchmark_run_id:
        raise HTTPException(status_code=403, detail="file reference belongs to another run")
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="file_download_request",
        elapsed_ms=_elapsed_ms(started_ns),
    )
    return {
        "data": {
            "filename": filename,
            "mime_type": "application/octet-stream",
            "size": len(content),
            "download_url": _benchmark_data_url(f"files/download/{record_id}"),
        }
    }


@app.post("/inner/api/agent/files/download-request")
async def request_agent_file_download(request: Request) -> dict[str, object]:
    """Resolve a canonical ToolFile ref using the current inner API contract."""
    started_ns = time.perf_counter_ns()
    payload = cast(dict[str, object], await request.json())
    benchmark_run_id = _required_string(payload, "user_id")
    file_mapping = payload.get("file")
    if not isinstance(file_mapping, dict):
        raise HTTPException(status_code=422, detail="file mapping is required")
    reference = _required_string(cast(dict[str, object], file_mapping), "reference")
    record_id = _record_id_from_reference(reference)
    owner_run_id, filename, content = await ledger_store.read_file(record_id)
    if owner_run_id != benchmark_run_id:
        raise HTTPException(status_code=403, detail="file reference belongs to another run")
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="file_download_request",
        elapsed_ms=_elapsed_ms(started_ns),
    )
    return {
        "filename": filename,
        "mime_type": "application/octet-stream",
        "size": len(content),
        "download_uri": _benchmark_data_uri(f"download/{record_id}"),
    }


@app.get("/__bench/files/download/{record_id}")
async def download_file(record_id: str) -> Response:
    started_ns = time.perf_counter_ns()
    try:
        benchmark_run_id, _filename, payload = await ledger_store.consume_file(record_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="benchmark file was already consumed") from exc
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="signed_download",
        payload=payload,
        elapsed_ms=_elapsed_ms(started_ns),
    )
    return Response(payload, media_type="application/octet-stream")


@app.get("/files/benchmarks/download/{record_id}")
async def download_agent_file(record_id: str) -> Response:
    """Stream current-contract ToolFile bytes exactly once."""
    return await download_file(record_id)


async def _capability_scenario(benchmark_run_id: str) -> CapacityScenario:
    try:
        return await ledger_store.read_scenario(benchmark_run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="capability ledger was not prepared") from exc


def _require_config_item(
    *,
    scenario: CapacityScenario,
    benchmark_run_id: str,
    kind: Literal["skill", "file"],
    name: str,
) -> None:
    expected = (
        {config_skill_name(benchmark_run_id, index) for index in range(scenario.config_skill_count)}
        if kind == "skill"
        else {config_file_name(benchmark_run_id, index) for index in range(scenario.config_file_count)}
    )
    if scenario.workload != "config" or name not in expected:
        raise HTTPException(status_code=404, detail="config asset was not declared for this benchmark run")


def _config_asset_payload(
    *,
    scenario: CapacityScenario,
    kind: Literal["skill", "file"],
    name: str,
) -> bytes:
    if kind == "skill":
        return _skill_archive(name=name, content_bytes=scenario.item_bytes)
    return _fixed_payload(f"config:{name}", scenario.item_bytes)


def _fixed_payload(label: str, size: int) -> bytes:
    seed = hashlib.sha256(label.encode()).digest()
    return (seed * ((size + len(seed) - 1) // len(seed)))[:size]


def _elapsed_ms(started_ns: int) -> float:
    return (time.perf_counter_ns() - started_ns) / 1_000_000


def _skill_archive(*, name: str, content_bytes: int) -> bytes:
    payload = _fixed_payload(f"skill:{name}", content_bytes)
    skill_markdown = b"# Benchmark skill\n\n" + payload
    buffer = io.BytesIO()
    info = zipfile.ZipInfo("SKILL.md", date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o644 << 16
    with zipfile.ZipFile(buffer, mode="w") as archive:
        archive.writestr(info, skill_markdown)
    return buffer.getvalue()


def _multipart_file_bytes(body: bytes, content_type: str) -> bytes:
    marker = "boundary="
    if marker not in content_type:
        raise HTTPException(status_code=422, detail="multipart boundary is required")
    boundary = content_type.split(marker, 1)[1].strip().strip('"').encode()
    header_end = body.find(b"\r\n\r\n")
    trailer = b"\r\n--" + boundary
    payload_end = body.rfind(trailer)
    if header_end < 0 or payload_end < header_end:
        raise HTTPException(status_code=422, detail="invalid multipart upload")
    return body[header_end + 4 : payload_end]


def _canonical_file_reference(record_id: str) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{encoded}"


def _record_id_from_reference(reference: str) -> str:
    try:
        encoded = reference.removeprefix("dify-file-ref:")
        payload = json.loads(base64.urlsafe_b64decode(encoded.encode()))
        record_id = payload["record_id"]
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="invalid file reference") from exc
    if not isinstance(record_id, str):
        raise HTTPException(status_code=422, detail="invalid file reference record id")
    return record_id


def _required_string(payload: dict[str, object], name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value:
        raise HTTPException(status_code=422, detail=f"{name} is required")
    return value


async def _resolve_benchmark_identity(
    request: PluginInvokeRequest,
) -> tuple[CapacityScenario, str]:
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
        scenario = await ledger_store.read_scenario(benchmark_run_id)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if scenario.id != scenario_id or scenario.version != scenario_version:
        raise HTTPException(status_code=409, detail="scenario version mismatch")
    return scenario, benchmark_run_id


def _capability_tool_call_chunk(
    *,
    scenario: CapacityScenario,
    round_number: int,
    benchmark_run_id: str,
) -> LLMResultChunk:
    script = _capability_script(scenario, benchmark_run_id=benchmark_run_id)
    arguments: dict[str, str | float] = {"script": script}
    if scenario.is_file_workload:
        arguments["timeout"] = 120.0
    tool_call = AssistantPromptMessage.ToolCall(
        id=f"benchmark-shell-call-{round_number}",
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
            name=_SHELL_TOOL_NAME,
            arguments=json.dumps(arguments, separators=(",", ":")),
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


def _capability_script(scenario: CapacityScenario, *, benchmark_run_id: str = "run") -> str:
    if scenario.workload in {"shell", "resume"}:
        return "set -eu\nprintf 'DIFY_CAPABILITY_SHELL_OK\\n'"
    if scenario.workload == "config":
        paths = [
            *(
                f".dify_conf/skills/{config_skill_name(benchmark_run_id, index)}/SKILL.md"
                for index in range(scenario.config_skill_count)
            ),
            *(
                f".dify_conf/files/{config_file_name(benchmark_run_id, index)}"
                for index in range(scenario.config_file_count)
            ),
        ]
        return "\n".join(
            [
                "set -eu",
                "python - <<'PY'",
                "from hashlib import sha256",
                "from pathlib import Path",
                f"paths = {paths!r}",
                "digest = sha256()",
                "for raw_path in paths:",
                "    payload = Path(raw_path).read_bytes()",
                "    digest.update(raw_path.encode())",
                "    digest.update(b'\\0')",
                "    digest.update(len(payload).to_bytes(8, 'big'))",
                "    digest.update(payload)",
                f"print('{_CONFIG_MATERIALIZATION_MARKER}' + digest.hexdigest())",
                "PY",
            ]
        )
    if not scenario.is_file_workload:
        raise ValueError(f"{scenario.workload} does not use shell_run")
    return "\n".join(
        [
            "set -eu",
            "mkdir -p dify-bench-file",
            f'python -c "from pathlib import Path; size={scenario.payload_bytes}; '
            "pattern=bytes(range(256)); Path('dify-bench-file/payload.bin').write_bytes("
            '(pattern*((size+255)//256))[:size])"',
            "printf 'DIFY_CAPABILITY_FILE_READY\\n'",
        ]
    )


def _expected_config_materialization_digest(scenario: CapacityScenario, benchmark_run_id: str = "run") -> str:
    digest = hashlib.sha256()
    entries = [
        *(
            (
                f".dify_conf/skills/{config_skill_name(benchmark_run_id, index)}/SKILL.md",
                b"# Benchmark skill\n\n"
                + _fixed_payload(
                    f"skill:{config_skill_name(benchmark_run_id, index)}",
                    scenario.item_bytes,
                ),
            )
            for index in range(scenario.config_skill_count)
        ),
        *(
            (
                f".dify_conf/files/{config_file_name(benchmark_run_id, index)}",
                _fixed_payload(
                    f"config:{config_file_name(benchmark_run_id, index)}",
                    scenario.item_bytes,
                ),
            )
            for index in range(scenario.config_file_count)
        ),
    ]
    for path, payload in entries:
        digest.update(path.encode())
        digest.update(b"\0")
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest()


def _config_materialization_digest_from_request(request: PluginInvokeRequest) -> str | None:
    messages = request.data.get("prompt_messages")
    if not isinstance(messages, list):
        return None
    for raw_message in reversed(messages):
        if not isinstance(raw_message, dict):
            continue
        message = cast(dict[str, object], raw_message)
        if message.get("role") != "tool" or message.get("name") != _SHELL_TOOL_NAME:
            continue
        content = message.get("content")
        if not isinstance(content, str):
            return None
        for line in reversed(content.splitlines()):
            if not line.startswith(_CONFIG_MATERIALIZATION_MARKER):
                continue
            digest = line.removeprefix(_CONFIG_MATERIALIZATION_MARKER)
            if len(digest) == 64 and all(character in "0123456789abcdef" for character in digest):
                return digest
            return None
        return None
    return None


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

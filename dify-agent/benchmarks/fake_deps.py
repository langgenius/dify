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
import time
from typing import ClassVar, cast
import zipfile

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from pydantic import BaseModel, ConfigDict, JsonValue

from benchmarks.scenario import (
    AgentBenchmarkScenario,
    BenchmarkScenario,
    CapabilityBenchmarkScenario,
    load_scenario_manifest,
)
from benchmarks.schemas import FakeDependencyLedger


_MODEL_NAME = "benchmark-model"
_TOOL_NAME = "benchmark_tool"
_SHELL_TOOL_NAME = "shell_run"
_ZERO_PRICE = Decimal(0)


class PluginInvokeRequest(BaseModel):
    """Subset of the plugin-daemon request envelope required by the fake."""

    data: dict[str, JsonValue]
    user_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")


class PrepareLedgerRequest(BaseModel):
    """Register capability identity before layer initialization calls the Stub."""

    benchmark_run_id: str
    scenario_id: str
    scenario_version: int

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BenchmarkLedgerStore:
    """Concurrency-safe in-memory ledger keyed by benchmark run identity."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._ledgers: dict[str, FakeDependencyLedger] = {}
        self._files: dict[str, tuple[str, str, bytes]] = {}

    async def reset(self) -> None:
        """Remove all prior warmup and measurement ledgers."""
        async with self._lock:
            self._ledgers.clear()
            self._files.clear()

    async def prepare(
        self,
        *,
        benchmark_run_id: str,
        scenario: CapabilityBenchmarkScenario,
    ) -> None:
        async with self._lock:
            _ = self._get_or_create(benchmark_run_id, scenario)

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
        scenario: BenchmarkScenario | CapabilityBenchmarkScenario,
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

    async def record_capability_tool_plan(self, *, benchmark_run_id: str) -> None:
        async with self._lock:
            self._ledgers[benchmark_run_id].tool_calls += 1

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

    def _get_or_create(
        self,
        benchmark_run_id: str,
        scenario: BenchmarkScenario | CapabilityBenchmarkScenario,
    ) -> FakeDependencyLedger:
        ledger = self._ledgers.get(benchmark_run_id)
        if ledger is None:
            ledger = FakeDependencyLedger(
                benchmark_run_id=benchmark_run_id,
                profile="capability" if isinstance(scenario, CapabilityBenchmarkScenario) else "agent",
                scenario_id=scenario.id,
                scenario_version=scenario.version,
                dependency_budget_ms=scenario.dependency_budget_ms,
            )
            self._ledgers[benchmark_run_id] = ledger
        elif ledger.scenario_id != scenario.id or ledger.scenario_version != scenario.version:
            raise ValueError(f"benchmark run {benchmark_run_id!r} changed scenario identity")
        return ledger


agent_manifest = load_scenario_manifest(profile="agent")
capability_manifest = load_scenario_manifest(profile="capability")
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
        scenario = capability_manifest.get(request.scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not isinstance(scenario, CapabilityBenchmarkScenario):
        raise HTTPException(status_code=422, detail="scenario is not a capability workload")
    if scenario.version != request.scenario_version:
        raise HTTPException(status_code=409, detail="scenario version mismatch")
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
            if isinstance(scenario, CapabilityBenchmarkScenario):
                await ledger_store.record_capability_tool_plan(benchmark_run_id=benchmark_run_id)
                item = _capability_tool_call_chunk(scenario=scenario, round_number=round_number)
            else:
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
    if not isinstance(scenario, AgentBenchmarkScenario):
        raise HTTPException(status_code=409, detail="capability workloads do not invoke plugin tools")
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
                    "name": f"skill-{index}",
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
                    "name": f"file-{index}.bin",
                    "size": scenario.item_bytes,
                    "mime_type": "application/octet-stream",
                }
                for index in range(scenario.config_file_count)
            ]
        },
        "env_keys": [],
        "note": "benchmark",
    }


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


@app.get("/inner/api/drive/{drive_ref}/manifest")
async def drive_manifest(
    drive_ref: str,
    prefix: str = "",
    include_download_url: bool = False,
) -> dict[str, object]:
    started_ns = time.perf_counter_ns()
    benchmark_run_id = drive_ref.removeprefix("agent-")
    scenario = await _capability_scenario(benchmark_run_id)
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="drive_manifest",
        elapsed_ms=_elapsed_ms(started_ns),
    )
    items: list[dict[str, object]] = []
    for index in range(scenario.drive_file_count):
        key = f"drive/file-{index}.bin"
        if prefix and key != prefix and not key.startswith(prefix.rstrip("/") + "/"):
            continue
        payload = _fixed_payload(f"drive:{key}", scenario.item_bytes)
        item: dict[str, object] = {
            "key": key,
            "size": len(payload),
            "hash": hashlib.sha256(payload).hexdigest(),
            "mime_type": "application/octet-stream",
        }
        if include_download_url:
            item["download_url"] = f"http://fake-deps:5002/__bench/drive/{benchmark_run_id}/{index}"
        items.append(item)
    return {"items": items}


@app.get("/__bench/drive/{benchmark_run_id}/{index}")
async def download_drive_file(benchmark_run_id: str, index: int) -> Response:
    started_ns = time.perf_counter_ns()
    scenario = await _capability_scenario(benchmark_run_id)
    if index < 0 or index >= scenario.drive_file_count:
        raise HTTPException(status_code=404, detail="drive item not found")
    key = f"drive/file-{index}.bin"
    payload = _fixed_payload(f"drive:{key}", scenario.item_bytes)
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="drive_download",
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
            "url": f"http://fake-deps:5002/__bench/files/upload/{benchmark_run_id}/{encoded_name}",
        }
    }


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
    return {"id": record_id, "reference": reference}


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
            "download_url": f"http://fake-deps:5002/__bench/files/download/{record_id}",
        }
    }


@app.get("/__bench/files/download/{record_id}")
async def download_file(record_id: str) -> Response:
    started_ns = time.perf_counter_ns()
    benchmark_run_id, _filename, payload = await ledger_store.read_file(record_id)
    await ledger_store.record_stub_call(
        benchmark_run_id=benchmark_run_id,
        name="signed_download",
        payload=payload,
        elapsed_ms=_elapsed_ms(started_ns),
    )
    return Response(payload, media_type="application/octet-stream")


async def _capability_scenario(benchmark_run_id: str) -> CapabilityBenchmarkScenario:
    try:
        ledger = await ledger_store.read(benchmark_run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="capability ledger was not prepared") from exc
    try:
        scenario = capability_manifest.get(ledger.scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not isinstance(scenario, CapabilityBenchmarkScenario):
        raise HTTPException(status_code=422, detail="ledger scenario is not a capability workload")
    return scenario


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


def _resolve_benchmark_identity(
    request: PluginInvokeRequest,
) -> tuple[AgentBenchmarkScenario | CapabilityBenchmarkScenario, str]:
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
        profile = credentials.get("benchmark_profile", "agent")
        selected_manifest = capability_manifest if profile == "capability" else agent_manifest
        scenario = selected_manifest.get(scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if scenario.version != scenario_version:
        raise HTTPException(status_code=409, detail="scenario version mismatch")
    if not isinstance(scenario, (AgentBenchmarkScenario, CapabilityBenchmarkScenario)):
        raise HTTPException(status_code=422, detail="scenario profile does not support fake dependencies")
    return scenario, benchmark_run_id


def _capability_tool_call_chunk(
    *,
    scenario: CapabilityBenchmarkScenario,
    round_number: int,
) -> LLMResultChunk:
    script = _capability_script(scenario)
    tool_call = AssistantPromptMessage.ToolCall(
        id=f"benchmark-shell-call-{round_number}",
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
            name=_SHELL_TOOL_NAME,
            arguments=json.dumps({"script": script}, separators=(",", ":")),
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


def _capability_script(scenario: CapabilityBenchmarkScenario) -> str:
    if scenario.workload in {"shell", "shell_resume"}:
        return "set -eu\nprintf 'DIFY_CAPABILITY_SHELL_OK\\n'"
    if scenario.workload != "file_roundtrip":
        raise ValueError(f"{scenario.workload} does not use shell_run")
    return "\n".join(
        [
            "set -eu",
            'workdir="$(mktemp -d "$PWD/dify-bench-file-XXXXXX")"',
            "trap 'rm -rf \"$workdir\"' EXIT",
            f'python -c "from pathlib import Path; size={scenario.payload_bytes}; '
            "pattern=bytes(range(256)); Path('$workdir/payload.bin').write_bytes("
            '(pattern*((size+255)//256))[:size])"',
            'upload_json="$(dify-agent file upload "$workdir/payload.bin")"',
            'reference="$(printf \'%s\' "$upload_json" | python -c '
            '\'import json,sys; print(json.load(sys.stdin)["reference"])\')"',
            'mkdir -p "$workdir/download"',
            'dify-agent file download tool_file "$reference" --to "$workdir/download" >/dev/null',
            'test "$(sha256sum "$workdir/payload.bin" | cut -d\' \' -f1)" = '
            '"$(sha256sum "$workdir/download/payload.bin" | cut -d\' \' -f1)"',
            "printf 'DIFY_CAPABILITY_FILE_OK\\n'",
        ]
    )


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

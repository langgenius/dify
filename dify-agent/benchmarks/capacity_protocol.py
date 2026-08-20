"""Synchronous Dify Agent Run protocol used by the Locust load engine."""

from __future__ import annotations

import base64
from collections.abc import Iterator
from dataclasses import dataclass
import hashlib
import json
import time
from typing import ClassVar, Protocol, cast
from uuid import uuid4

import httpx
from pydantic import BaseModel, ConfigDict, Field

from benchmarks.scenario import (
    BenchmarkMode,
    CapacityScenario,
    config_file_name,
    config_skill_name,
    deterministic_file_payload_sha256,
)
from benchmarks.schemas import FailureKind, RunSample, TerminalStatus
from dify_agent.agent_stub.protocol import is_canonical_dify_file_reference


_TERMINAL_EVENT_TYPES = {"run_succeeded", "run_failed", "run_cancelled"}
_RUN_RECOVERY_TIMEOUT_SECONDS = 30
_HTTP_ERROR_BODY_LIMIT = 512


def _http_error(response: httpx.Response) -> str:
    body = " ".join(response.text.split())
    if len(body) > _HTTP_ERROR_BODY_LIMIT:
        body = f"{body[:_HTTP_ERROR_BODY_LIMIT]}..."
    return f"HTTP {response.status_code}: {body}" if body else f"HTTP {response.status_code}"


@dataclass(slots=True, frozen=True)
class RequestMetric:
    """One protocol request forwarded to Locust's request event."""

    request_type: str
    name: str
    response_time_ms: float
    response_length: int = 0
    error: str | None = None


class MetricRecorder(Protocol):
    def __call__(self, metric: RequestMetric, /) -> None: ...


class ActiveTracker(Protocol):
    def admitted(self, run_id: str) -> None: ...

    def finished(self, run_id: str, *, terminal: bool) -> None: ...


class CapacityObservation(BaseModel):
    """Serializable evidence produced by one complete Agent Run."""

    sample: RunSample
    sse_event_ids: list[str] = Field(default_factory=list)
    session_snapshot: dict[str, object] | None = None
    binding_ref: str | None = None
    started_at_ns: int
    ended_at_ns: int
    e2b_active_windows: list[tuple[int, int]] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


_OBSERVATION_RECORD_PREFIX = "base64:"


def encode_observation_record(observation: CapacityObservation) -> str:
    """Encode one private Locust observation as an unambiguous single line."""
    payload = observation.model_dump_json().encode()
    return _OBSERVATION_RECORD_PREFIX + base64.b64encode(payload).decode("ascii")


def decode_observation_record(record: str) -> CapacityObservation:
    """Decode current records while accepting legacy plain-JSON private files."""
    if not record.startswith(_OBSERVATION_RECORD_PREFIX):
        return CapacityObservation.model_validate_json(record)
    payload = base64.b64decode(record.removeprefix(_OBSERVATION_RECORD_PREFIX), validate=True)
    return CapacityObservation.model_validate_json(payload)


class AgentRunClient:
    """Execute one complete create-Run and terminal-SSE transaction."""

    def __init__(
        self,
        *,
        mode: BenchmarkMode,
        agent_client: httpx.Client,
        fake_client: httpx.Client,
        data_client: httpx.Client | None = None,
        scenario: CapacityScenario,
        block_id: str,
        recorder: MetricRecorder,
    ) -> None:
        self._mode: BenchmarkMode = mode
        self._agent_client: httpx.Client = agent_client
        self._fake_client: httpx.Client = fake_client
        self._data_client: httpx.Client = data_client or fake_client
        self._scenario: CapacityScenario = scenario
        self._block_id: str = block_id
        self._recorder: MetricRecorder = recorder

    def run_once(
        self,
        *,
        sequence: int,
        worker_index: int,
        binding_ref: str | None,
        session_snapshot: dict[str, object] | None,
        tracker: ActiveTracker | None,
        suspend: bool = False,
    ) -> CapacityObservation:
        benchmark_run_id = f"{self._block_id}-{sequence}-{uuid4().hex}"
        self._prepare_ledger(benchmark_run_id)
        sample = RunSample(
            mode=self._mode,
            scenario_id=self._scenario.id,
            block_id=self._block_id,
            benchmark_run_id=benchmark_run_id,
            worker_index=worker_index,
            payload_bytes=self._scenario.payload_bytes,
        )
        sse_event_ids: list[str] = []
        terminal_snapshot: dict[str, object] | None = None
        started_at_ns = time.time_ns()
        started_ns = time.perf_counter_ns()
        metrics: list[RequestMetric] = []
        sse_started_ns: int | None = None
        terminal_type: str | None = None
        recovered_terminal = False
        run_ended_at_ns = started_at_ns
        try:
            response = self._agent_client.post(
                "/runs",
                json=build_capacity_run_request(
                    scenario=self._scenario,
                    benchmark_run_id=benchmark_run_id,
                    binding_ref=binding_ref,
                    session_snapshot=session_snapshot,
                    suspend=suspend,
                ),
            )
            sample.create_run_http_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
            _ = response.raise_for_status()
            raw_payload = cast(object, response.json())
            if not isinstance(raw_payload, dict):
                raise TypeError("create-run response did not contain run_id")
            payload = cast(dict[str, object], raw_payload)
            run_id = payload.get("run_id")
            if not isinstance(run_id, str):
                raise TypeError("create-run response did not contain run_id")
            metrics.append(
                RequestMetric(
                    request_type="HTTP",
                    name="POST /runs",
                    response_time_ms=sample.create_run_http_ms,
                )
            )
            sample.run_id = run_id
            sample.admitted = True
            if tracker:
                tracker.admitted(run_id)
            first_event_ns: int | None = None
            sse_started_ns = time.perf_counter_ns()
            with self._agent_client.stream("GET", f"/runs/{run_id}/events/sse") as stream_response:
                _ = stream_response.raise_for_status()
                for event in iter_sse_data(stream_response):
                    received_ns = time.perf_counter_ns()
                    first_event_ns = first_event_ns or received_ns
                    if isinstance(event.get("id"), str):
                        sse_event_ids.append(cast(str, event["id"]))
                    sample.event_count += 1
                    event_type = event.get("type")
                    if event_type in _TERMINAL_EVENT_TYPES:
                        terminal_type = cast(str, event_type)
                        data = event.get("data")
                        if isinstance(data, dict):
                            event_data = cast(dict[str, object], data)
                            if isinstance(event_data.get("session_snapshot"), dict):
                                terminal_snapshot = cast(dict[str, object], event_data["session_snapshot"])
                            if terminal_type == "run_failed" and isinstance(event_data.get("error"), str):
                                sample.error = cast(str, event_data["error"])
                        break
            if first_event_ns is None or terminal_type is None:
                raise RuntimeError("SSE stream ended before a terminal event")
            sample.time_to_first_event_ms = (first_event_ns - started_ns) / 1_000_000
            sample.terminal_e2e_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
            metrics.append(
                RequestMetric(
                    request_type="SSE",
                    name="GET /runs/:id/events/sse",
                    response_time_ms=(time.perf_counter_ns() - sse_started_ns) / 1_000_000,
                )
            )
            sample.terminal_status = cast(
                TerminalStatus,
                {
                    "run_succeeded": "succeeded",
                    "run_failed": "failed",
                    "run_cancelled": "cancelled",
                }[terminal_type],
            )
            if sample.terminal_status != "succeeded":
                sample.failure_kind = "terminal_failed"
            run_ended_at_ns = time.time_ns()
        except Exception as exc:
            sample.failure_kind = cast(FailureKind, "stream_error" if sample.admitted else "admission_error")
            sample.error = f"{type(exc).__name__}: {exc}"
            if sample.admitted and sample.run_id is not None:
                recovery_error = self._cancel_and_drain_run(sample.run_id)
                recovered_terminal = recovery_error is None
                if recovery_error is not None:
                    sample.error = f"{sample.error}; {recovery_error}"
            if not any(metric.name == "POST /runs" for metric in metrics):
                metrics.append(
                    RequestMetric(
                        request_type="HTTP",
                        name="POST /runs",
                        response_time_ms=sample.create_run_http_ms
                        if sample.create_run_http_ms is not None
                        else (time.perf_counter_ns() - started_ns) / 1_000_000,
                        error=sample.failure_kind,
                    )
                )
            if sse_started_ns is not None:
                metrics.append(
                    RequestMetric(
                        request_type="SSE",
                        name="GET /runs/:id/events/sse",
                        response_time_ms=(time.perf_counter_ns() - sse_started_ns) / 1_000_000,
                        error=sample.failure_kind,
                    )
                )
        finally:
            if sample.run_id is not None and tracker:
                tracker.finished(sample.run_id, terminal=terminal_type is not None or recovered_terminal)
        e2b_active_windows: list[tuple[int, int]] = []
        if sample.terminal_status == "succeeded":
            e2b_active_windows.append((started_at_ns, run_ended_at_ns))
            if self._scenario.is_file_workload:
                try:
                    e2b_active_windows.append(
                        self._export_binding_file(
                            benchmark_run_id=benchmark_run_id,
                            binding_ref=binding_ref,
                            metrics=metrics,
                        )
                    )
                except Exception as exc:
                    sample.failure_kind = "validation_error"
                    sample.error = f"file data-plane validation failed: {type(exc).__name__}: {exc}"
        composite_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        composite_error = sample.failure_kind
        metrics.append(
            RequestMetric(
                request_type="AGENT_RUN",
                name=self._scenario.id,
                response_time_ms=composite_ms,
                error=composite_error,
            )
        )
        observation = CapacityObservation(
            sample=sample,
            sse_event_ids=sse_event_ids,
            session_snapshot=terminal_snapshot,
            binding_ref=binding_ref,
            started_at_ns=started_at_ns,
            ended_at_ns=time.time_ns(),
            e2b_active_windows=e2b_active_windows,
        )
        for metric in metrics:
            self._recorder(metric)
        return observation

    def _export_binding_file(
        self,
        *,
        benchmark_run_id: str,
        binding_ref: str | None,
        metrics: list[RequestMetric],
    ) -> tuple[int, int]:
        if binding_ref is None:
            raise ValueError("File workload requires a Runtime binding")
        upload_started_at_ns = time.time_ns()
        upload_started_ns = time.perf_counter_ns()
        response = self._agent_client.post(
            "/execution-bindings/files/download",
            json={
                "backend_binding_ref": binding_ref,
                "path": "dify-bench-file/payload.bin",
                "execution_context": _execution_context(benchmark_run_id),
            },
        )
        upload_elapsed_ms = (time.perf_counter_ns() - upload_started_ns) / 1_000_000
        metrics.append(
            RequestMetric(
                request_type="HTTP",
                name="POST /execution-bindings/files/download",
                response_time_ms=upload_elapsed_ms,
                error=None if response.is_success else _http_error(response),
            )
        )
        if response.is_error:
            raise RuntimeError(_http_error(response))
        upload_ended_at_ns = time.time_ns()
        payload = cast(object, response.json())
        if not isinstance(payload, dict):
            raise TypeError("Binding file download response was not an object")
        response_payload = cast(dict[str, object], payload)
        reference = response_payload.get("reference")
        if not isinstance(reference, str) or not is_canonical_dify_file_reference(reference):
            raise TypeError("Binding file download response did not contain a canonical reference")

        allocation_started_ns = time.perf_counter_ns()
        allocation = self._data_client.post(
            "/inner/api/agent/files/download-request",
            json={
                "tenant_id": "benchmark-tenant",
                "user_id": benchmark_run_id,
                "user_from": "account",
                "invoke_from": "service-api",
                "file": {"transfer_method": "tool_file", "reference": reference},
                "for_frontend": True,
            },
        )
        allocation_elapsed_ms = (time.perf_counter_ns() - allocation_started_ns) / 1_000_000
        metrics.append(
            RequestMetric(
                request_type="HTTP",
                name="POST /inner/api/agent/files/download-request",
                response_time_ms=allocation_elapsed_ms,
                error=None if allocation.is_success else _http_error(allocation),
            )
        )
        if allocation.is_error:
            raise RuntimeError(_http_error(allocation))
        download_payload = cast(object, allocation.json())
        if not isinstance(download_payload, dict):
            raise TypeError("file download allocation response was not an object")
        allocation_payload = cast(dict[str, object], download_payload)
        download_url = allocation_payload.get("download_uri")
        if not isinstance(download_url, str) or not download_url:
            raise TypeError("file download allocation response did not contain download_uri")
        download_started_ns = time.perf_counter_ns()
        download = self._data_client.get(download_url)
        download_elapsed_ms = (time.perf_counter_ns() - download_started_ns) / 1_000_000
        metrics.append(
            RequestMetric(
                request_type="HTTP",
                name="GET Binding file download",
                response_time_ms=download_elapsed_ms,
                response_length=len(download.content),
                error=None if download.is_success else f"HTTP {download.status_code}",
            )
        )
        _ = download.raise_for_status()
        content = download.content
        if len(content) != self._scenario.payload_bytes:
            raise ValueError(f"Binding payload size {len(content)} did not match {self._scenario.payload_bytes}")
        actual_sha256 = hashlib.sha256(content).hexdigest()
        expected_sha256 = deterministic_file_payload_sha256(self._scenario.payload_bytes)
        if actual_sha256 != expected_sha256:
            raise ValueError(f"Binding payload SHA256 {actual_sha256} did not match {expected_sha256}")
        return upload_started_at_ns, upload_ended_at_ns

    def _cancel_and_drain_run(self, run_id: str) -> str | None:
        deadline = time.monotonic() + _RUN_RECOVERY_TIMEOUT_SECONDS
        try:
            status = self._agent_client.get(f"/runs/{run_id}")
            status.raise_for_status()
            if _run_status_is_terminal(status):
                return None
            cancel = self._agent_client.post(
                f"/runs/{run_id}/cancel",
                json={"reason": "benchmark SSE stream interrupted"},
            )
            if cancel.status_code not in {httpx.codes.OK, httpx.codes.CONFLICT}:
                cancel.raise_for_status()
            while time.monotonic() < deadline:
                status = self._agent_client.get(f"/runs/{run_id}")
                status.raise_for_status()
                if _run_status_is_terminal(status):
                    return None
                time.sleep(0.1)
            return f"Run {run_id} did not reach terminal status within the recovery timeout"
        except Exception as exc:
            return f"failed to recover interrupted Run {run_id}: {type(exc).__name__}: {exc}"

    def _prepare_ledger(self, benchmark_run_id: str) -> None:
        started_ns = time.perf_counter_ns()
        response_recorded = False
        try:
            response = self._fake_client.post(
                "/__bench/prepare",
                json={
                    "benchmark_run_id": benchmark_run_id,
                    "scenario_id": self._scenario.id,
                    "scenario_version": self._scenario.version,
                    "payload_bytes": self._scenario.payload_bytes if self._scenario.is_file_workload else None,
                },
            )
            elapsed_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
            self._record_response("HTTP", "POST fake/__bench/prepare", elapsed_ms, response)
            response_recorded = True
            _ = response.raise_for_status()
        except Exception as exc:
            if not response_recorded:
                self._recorder(
                    RequestMetric(
                        request_type="HTTP",
                        name="POST fake/__bench/prepare",
                        response_time_ms=(time.perf_counter_ns() - started_ns) / 1_000_000,
                        error=type(exc).__name__,
                    )
                )
            raise

    def _record_response(
        self,
        request_type: str,
        name: str,
        response_time_ms: float,
        response: httpx.Response,
        *,
        response_length: int = 0,
    ) -> None:
        error = None if response.is_success else f"HTTP {response.status_code}"
        self._recorder(
            RequestMetric(
                request_type=request_type,
                name=name,
                response_time_ms=response_time_ms,
                response_length=response_length,
                error=error,
            )
        )


def build_capacity_run_request(
    *,
    scenario: CapacityScenario,
    benchmark_run_id: str,
    binding_ref: str | None,
    session_snapshot: dict[str, object] | None,
    suspend: bool,
) -> dict[str, object]:
    credentials = {
        "benchmark_run_id": benchmark_run_id,
        "scenario_id": scenario.id,
        "scenario_version": scenario.version,
    }
    execution_context = _execution_context(benchmark_run_id)
    layers: list[dict[str, object]] = [
        {
            "name": "prompt",
            "type": "plain.prompt",
            "config": {"prefix": "deterministic capacity benchmark", "user": "execute the benchmark plan"},
        },
        {"name": "execution_context", "type": "dify.execution_context", "config": execution_context},
    ]
    if scenario.uses_runtime:
        if binding_ref is not None:
            layers.append(
                {
                    "name": "runtime",
                    "type": "dify.runtime",
                    "config": {"backend_binding_ref": binding_ref},
                }
            )
        shell_dependencies = {"execution_context": "execution_context"}
        if binding_ref is not None:
            shell_dependencies["runtime"] = "runtime"
        layers.append(
            {
                "name": "shell",
                "type": "dify.shell",
                "deps": shell_dependencies,
                "config": {},
            }
        )
    if scenario.workload == "config":
        skills = [
            {
                "name": config_skill_name(benchmark_run_id, index),
                "description": "deterministic benchmark skill",
                "size": scenario.item_bytes,
                "mime_type": "application/zip",
            }
            for index in range(scenario.config_skill_count)
        ]
        files = [
            {
                "name": config_file_name(benchmark_run_id, index),
                "size": scenario.item_bytes,
                "mime_type": "application/octet-stream",
            }
            for index in range(scenario.config_file_count)
        ]
        layers.append(
            {
                "name": "config",
                "type": "dify.config",
                "deps": {"shell": "shell"},
                "config": {
                    "agent_id": benchmark_run_id,
                    "config_version": {"id": "benchmark-config", "kind": "snapshot", "writable": False},
                    "skills": skills,
                    "files": files,
                    "mentioned_skill_names": [item["name"] for item in skills],
                    "mentioned_file_names": [item["name"] for item in files],
                },
            }
        )
    layers.append(
        {
            "name": "llm",
            "type": "dify.plugin.llm",
            "deps": {"execution_context": "execution_context"},
            "config": {
                "plugin_id": "benchmark/model",
                "model_provider": "benchmark",
                "model": "benchmark-model",
                "credentials": credentials,
            },
        }
    )
    request: dict[str, object] = {
        "composition": {"schema_version": 1, "layers": layers},
        "metadata": {
            "benchmark_run_id": benchmark_run_id,
            "scenario_id": scenario.id,
            "scenario_version": scenario.version,
        },
        "on_exit": {"default": "suspend" if suspend else "delete", "layers": {}},
    }
    if session_snapshot is not None:
        request["session_snapshot"] = session_snapshot
    return request


def _execution_context(benchmark_run_id: str) -> dict[str, object]:
    return {
        "tenant_id": "benchmark-tenant",
        "user_id": benchmark_run_id,
        "user_from": "account",
        "app_id": "benchmark-app",
        "agent_id": benchmark_run_id,
        "agent_config_version_id": "benchmark-config",
        "agent_config_version_kind": "snapshot",
        "agent_mode": "workflow_run",
        "invoke_from": "service-api",
    }


def iter_sse_data(response: httpx.Response) -> Iterator[dict[str, object]]:
    for line in response.iter_lines():
        if not line.startswith("data: "):
            continue
        raw_payload = cast(object, json.loads(line.removeprefix("data: ")))
        if not isinstance(raw_payload, dict):
            raise TypeError("SSE payload must be a JSON object")
        yield cast(dict[str, object], raw_payload)


def _run_status_is_terminal(response: httpx.Response) -> bool:
    payload = response.json()
    return isinstance(payload, dict) and payload.get("status") in {"succeeded", "failed", "cancelled"}


__all__ = [
    "AgentRunClient",
    "CapacityObservation",
    "RequestMetric",
    "build_capacity_run_request",
    "decode_observation_record",
    "encode_observation_record",
    "iter_sse_data",
]

"""Public Service API protocol client for the Staging Agent smoke benchmark.

Unlike the internal Agent backend benchmark, this client follows the same
``POST /v1/chat-messages`` SSE contract as a real Service API caller.  One
client represents one logical end user and owns one conversation chain; the
caller is responsible for invoking :meth:`cleanup_conversation` in ``finally``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping, Sequence
import json
import re
import time
from typing import ClassVar, Literal, cast, final
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from benchmarks.capacity_protocol import RequestMetric
from benchmarks.staging_public_schemas import (
    StagingPublicCleanupResult,
    StagingPublicEdgeProbeEvidence,
    StagingPublicRunSample,
    StagingPublicScenarioId,
)


_REQUEST_MARKER_PREFIX = "DIFY_BENCHMARK_REQUEST:"
_RESPONSE_MARKER_PREFIX = "DIFY_BENCHMARK_MARKER:"
_CANONICAL_MARKER_PAYLOAD_PATTERN = r'\{"[^{}\r\n]*\}'
_RESPONSE_MARKER_RE = re.compile(r"DIFY_BENCHMARK_MARKER:(" + _CANONICAL_MARKER_PAYLOAD_PATTERN + r")")
_SHELL_EVIDENCE_RE = re.compile(
    r"DIFY_BENCHMARK_SHELL_OK\|(DIFY_BENCHMARK_MARKER:" + _CANONICAL_MARKER_PAYLOAD_PATTERN + r")"
)
_CONFIG_EVIDENCE_RE = re.compile(
    "".join(
        (
            r"DIFY_BENCHMARK_CONFIG_SHA256\|",
            r"(DIFY_BENCHMARK_MARKER:",
            _CANONICAL_MARKER_PAYLOAD_PATTERN,
            r")",
            r"\|items=(\d+)\|bytes=(\d+)\|sha256=([0-9a-f]{64})",
        )
    )
)
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_EXPECTED_CONFIG_SKILLS = 3
_EXPECTED_CONFIG_FILES = 10
_EXPECTED_CONFIG_ITEMS = _EXPECTED_CONFIG_SKILLS + _EXPECTED_CONFIG_FILES
_EXPECTED_CONFIG_BYTES = 53_248
_ANSWER_EVENT_TYPES = frozenset({"message", "agent_message", "text_chunk"})


class StagingPublicProtocolSettings(BaseModel):
    """Validated public endpoint plus a non-serializable Service API key."""

    service_api_base_url: str
    api_key: SecretStr = Field(exclude=True, repr=False)
    config_expected_sha256: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    @field_validator("service_api_base_url")
    @classmethod
    def normalize_service_api_base_url(cls, value: str) -> str:
        return _normalize_service_api_base_url(value)

    @field_validator("config_expected_sha256")
    @classmethod
    def validate_config_sha256(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _SHA256_RE.fullmatch(normalized):
            raise ValueError("config_expected_sha256 must be a SHA256 digest")
        return normalized


class PublicBenchmarkMarker(BaseModel):
    """Deterministic identity embedded in public request and response text."""

    benchmark_run_id: str
    scenario_id: StagingPublicScenarioId
    scenario_version: Literal[1] = 1
    round: int = Field(ge=1)
    kind: Literal["tool_call", "terminal"]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


class StagingPublicObservation(BaseModel):
    """One public transaction with private continuation identifiers excluded."""

    sample: StagingPublicRunSample
    conversation_id: str | None = Field(default=None, exclude=True, repr=False)
    task_id: str | None = Field(default=None, exclude=True, repr=False)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class StagingPublicValidationError(RuntimeError):
    """The public wire transaction completed but violated its contract."""


StagingPublicOperationalErrorType = Literal[
    "throttle",
    "timeout",
    "http_error",
    "sse_error",
    "e2b_inventory_limited",
]


class StagingPublicOperationalError(RuntimeError):
    """A capacity-sensitive HTTP or SSE transaction failure."""

    def __init__(self, error_type: StagingPublicOperationalErrorType, message: str) -> None:
        super().__init__(message)
        self.error_type = error_type


def probe_staging_public_edge(
    service_api_base_url: str,
    *,
    transport: httpx.BaseTransport | None = None,
) -> StagingPublicEdgeProbeEvidence:
    """Probe public routing headers without authentication or resource creation.

    ``OPTIONS`` on the same relative ``chat-messages`` path used by the load
    client reaches ``/v1/chat-messages`` but cannot create a Conversation or
    Agent Run. The response status is evidence only; the required signal is a
    sanitized ``x-version`` header.
    """

    base_url = _normalize_service_api_base_url(service_api_base_url)
    try:
        with httpx.Client(
            base_url=base_url,
            headers={"Accept": "*/*"},
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=httpx.Timeout(10.0),
        ) as client:
            response = client.options("chat-messages")
    except httpx.RequestError as exc:
        raise StagingPublicValidationError("public edge x-version probe failed") from exc
    edge_version = _sanitized_header(response, "x-version")
    if edge_version is None:
        raise StagingPublicValidationError(
            "public edge x-version probe did not return a valid x-version header"
        )
    return StagingPublicEdgeProbeEvidence(
        http_status_code=response.status_code,
        edge_version=edge_version,
        edge_server=_sanitized_header(response, "server"),
    )


@final
class StagingPublicServiceClient:
    """Execute a serial conversation chain through the public Service API."""

    def __init__(
        self,
        *,
        settings: StagingPublicProtocolSettings,
        end_user: str,
        recorder: Callable[[RequestMetric], None],
        transport: httpx.BaseTransport | None = None,
        conversation_lifecycle: Callable[[Literal["allocated", "deleted"], str], None] | None = None,
    ) -> None:
        if not end_user.strip() or len(end_user) > 255:
            raise ValueError("end_user must be a non-empty identifier of at most 255 characters")
        api_key = settings.api_key.get_secret_value()
        if not api_key:
            raise ValueError("Service API key cannot be empty")
        self._settings = settings
        self._end_user = end_user
        self._recorder = recorder
        self._sensitive_values = (api_key,)
        self._conversation_id: str | None = None
        self._conversation_allocation_unknown = False
        self._conversation_lifecycle = conversation_lifecycle
        self._client = httpx.Client(
            base_url=settings.service_api_base_url,
            headers={
                "Accept": "text/event-stream",
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            transport=transport,
            trust_env=False,
            timeout=httpx.Timeout(180.0),
        )

    def __enter__(self) -> StagingPublicServiceClient:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    @property
    def has_conversation(self) -> bool:
        """Whether this client has captured a public conversation to clean up."""

        return self._conversation_id is not None

    def close(self) -> None:
        self._client.close()

    def run_once(
        self,
        *,
        benchmark_run_id: str,
        scenario_id: StagingPublicScenarioId,
        scenario_version: int,
    ) -> StagingPublicObservation:
        """Run one streamed chat turn, preserving the conversation for the next turn."""

        _validate_benchmark_identity(benchmark_run_id, scenario_version)
        conversation_before = self._conversation_id
        sample = StagingPublicRunSample(
            scenario_id=scenario_id,
            benchmark_run_id=benchmark_run_id,
            conversation_reused=conversation_before is not None,
        )
        started_ns = time.perf_counter_ns()
        events: list[dict[str, object]] = []
        first_sse_ns: int | None = None
        first_answer_ns: int | None = None
        terminal_ns: int | None = None
        terminal_count = 0
        task_id: str | None = None
        response: httpx.Response | None = None
        try:
            request = build_staging_public_chat_request(
                benchmark_run_id=benchmark_run_id,
                scenario_id=scenario_id,
                scenario_version=scenario_version,
                end_user=self._end_user,
                conversation_id=conversation_before,
            )
            with self._client.stream("POST", "chat-messages", json=request) as response:
                headers_ns = time.perf_counter_ns()
                sample.response_headers_ms = (headers_ns - started_ns) / 1_000_000
                sample.http_status_code = response.status_code
                sample.edge_version = _sanitized_header(response, "x-version")
                sample.edge_server = _sanitized_header(response, "server")
                self._emit_metric(
                    "HTTP",
                    "POST /v1/chat-messages headers",
                    sample.response_headers_ms,
                    error=None if response.status_code == 200 else f"HTTP {response.status_code}",
                )
                if response.status_code != 200:
                    _ = response.read()
                    error_type = _http_operational_error_type(response.status_code)
                    if error_type == "validation_error":
                        raise StagingPublicValidationError(self._http_error(response))
                    raise StagingPublicOperationalError(error_type, self._http_error(response))
                content_type_header = cast(str, response.headers.get("content-type", ""))
                content_type = content_type_header.partition(";")[0].strip().lower()
                if content_type != "text/event-stream":
                    _ = response.read()
                    raise StagingPublicValidationError(
                        f"expected text/event-stream, received {content_type or 'missing Content-Type'}"
                    )
                sample.admitted = True

                for frame in _iter_sse_frames(response):
                    received_ns = time.perf_counter_ns()
                    if first_sse_ns is None:
                        first_sse_ns = received_ns
                        sample.time_to_first_sse_ms = (received_ns - started_ns) / 1_000_000
                        self._emit_metric(
                            "SSE",
                            "POST /v1/chat-messages first_sse",
                            sample.time_to_first_sse_ms,
                        )
                    if frame.event == "ping" and frame.data is None:
                        continue
                    if frame.data is None:
                        continue
                    event = _parse_json_event(frame.data)
                    events.append(event)
                    sample.event_count += 1
                    event_conversation_id = _required_event_identifier(event, "conversation_id")
                    if self._conversation_id is None:
                        self._conversation_id = event_conversation_id
                        if self._conversation_lifecycle is not None:
                            try:
                                self._conversation_lifecycle("allocated", event_conversation_id)
                            except Exception as exc:
                                raise StagingPublicValidationError(
                                    f"Conversation allocation evidence failed: {type(exc).__name__}"
                                ) from exc
                    elif event_conversation_id != self._conversation_id:
                        raise StagingPublicValidationError("SSE conversation identity changed within the chain")

                    # AgentChatAppGenerateResponseConverter intentionally omits
                    # task_id from ErrorStreamResponse payloads. Classify that
                    # public contract before applying normal-event task identity
                    # checks, otherwise capacity-side SSE failures become false
                    # correctness failures.
                    event_type = event.get("event")
                    if event_type == "error":
                        sample.terminal_e2e_ms = (received_ns - started_ns) / 1_000_000
                        error_type = _sse_operational_error_type(event)
                        raise StagingPublicOperationalError(
                            error_type,
                            f"public SSE error ({error_type})",
                        )

                    event_task_id = _required_event_identifier(event, "task_id")
                    if task_id is None:
                        task_id = event_task_id
                    elif event_task_id != task_id:
                        raise StagingPublicValidationError("SSE task identity changed within one turn")

                    answer = _answer_delta(event)
                    if answer is not None:
                        sample.answer_bytes += len(answer.encode("utf-8"))
                        if first_answer_ns is None:
                            first_answer_ns = received_ns
                            sample.time_to_first_answer_ms = (received_ns - started_ns) / 1_000_000
                            self._emit_metric(
                                "SSE",
                                "POST /v1/chat-messages first_answer",
                                sample.time_to_first_answer_ms,
                            )
                    if event_type == "message_end":
                        terminal_count += 1
                        terminal_ns = terminal_ns or received_ns

            if first_sse_ns is None:
                raise StagingPublicValidationError("SSE stream ended before its first frame")
            if terminal_count != 1 or terminal_ns is None:
                raise StagingPublicValidationError(f"SSE message_end count was {terminal_count}, expected exactly one")
            sample.terminal_e2e_ms = (terminal_ns - started_ns) / 1_000_000
            markers = validate_public_benchmark_markers(
                events=events,
                benchmark_run_id=benchmark_run_id,
                scenario_id=scenario_id,
                scenario_version=scenario_version,
            )
            sample.deterministic_markers_valid = True
            if scenario_id == "shell":
                _validate_shell_evidence(events, markers)
                sample.shell_evidence_valid = True
            elif scenario_id == "config":
                _validate_config_evidence(
                    sample=sample,
                    events=events,
                    markers=markers,
                    expected_sha256=self._settings.config_expected_sha256,
                )
            sample.terminal_status = "succeeded"
        except StagingPublicOperationalError as exc:
            sample.terminal_status = "failed" if sample.terminal_e2e_ms is not None else "not_terminal"
            sample.error_type = exc.error_type
            sample.error = self._redact(str(exc))
        except StagingPublicValidationError as exc:
            sample.terminal_status = "failed" if sample.terminal_e2e_ms is not None else "not_terminal"
            sample.error_type = "validation_error"
            sample.error = self._redact(str(exc))
        except httpx.TimeoutException as exc:
            sample.terminal_status = "not_terminal"
            sample.error_type = "timeout"
            sample.error = self._redact(f"{type(exc).__name__}: {exc}")
        except Exception as exc:
            sample.error_type = "sse_error" if sample.admitted else "http_error"
            sample.error = self._redact(f"{type(exc).__name__}: {exc}")
        finally:
            if conversation_before is None and sample.admitted and self._conversation_id is None:
                self._conversation_allocation_unknown = True
            elapsed_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
            self._emit_metric(
                "AGENT_RUN",
                scenario_id,
                sample.terminal_e2e_ms if sample.terminal_e2e_ms is not None else elapsed_ms,
                error=sample.error_type,
                response_length=sample.answer_bytes,
            )
        return StagingPublicObservation(
            sample=sample,
            conversation_id=self._conversation_id,
            task_id=task_id,
        )

    def cleanup_conversation(self) -> StagingPublicCleanupResult:
        """Delete this user's conversation and retire its Runtime Binding."""

        conversation_id = self._conversation_id
        if conversation_id is None:
            if self._conversation_allocation_unknown:
                return StagingPublicCleanupResult(
                    complete=False,
                    error="an admitted cold request did not expose a Conversation identity for cleanup",
                )
            return StagingPublicCleanupResult(complete=True)
        result = StagingPublicCleanupResult(attempted=True)
        started_ns = time.perf_counter_ns()
        try:
            response = self._client.request(
                "DELETE",
                f"conversations/{conversation_id}",
                json={"user": self._end_user},
            )
            result.http_status_code = response.status_code
            if response.status_code != 204:
                raise StagingPublicValidationError(self._http_error(response))
            result.conversation_deleted = True
            result.complete = True
            if self._conversation_lifecycle is not None:
                self._conversation_lifecycle("deleted", conversation_id)
            self._conversation_id = None
        except Exception as exc:
            result.error = self._redact(f"{type(exc).__name__}: {exc}")
        finally:
            self._emit_metric(
                "HTTP",
                "DELETE /v1/conversations/:id",
                (time.perf_counter_ns() - started_ns) / 1_000_000,
                error=None if result.complete else "cleanup_error",
            )
        return result

    def _emit_metric(
        self,
        request_type: str,
        name: str,
        response_time_ms: float,
        *,
        error: str | None = None,
        response_length: int = 0,
    ) -> None:
        self._recorder(
            RequestMetric(
                request_type=request_type,
                name=name,
                response_time_ms=response_time_ms,
                response_length=response_length,
                error=error,
            )
        )

    def _http_error(self, response: httpx.Response) -> str:
        # Public error bodies may include task, message, or conversation IDs.
        # Classification only needs the status; never persist an untrusted body.
        return f"HTTP {response.status_code}"

    def _redact(self, value: str) -> str:
        redacted = value
        for secret in self._sensitive_values:
            redacted = redacted.replace(secret, "[REDACTED]")
        return redacted


def build_staging_public_chat_request(
    *,
    benchmark_run_id: str,
    scenario_id: StagingPublicScenarioId,
    scenario_version: int,
    end_user: str,
    conversation_id: str | None,
) -> dict[str, object]:
    """Build one secret-free public chat request with deterministic identity."""

    _validate_benchmark_identity(benchmark_run_id, scenario_version)
    marker = json.dumps(
        {
            "benchmark_run_id": benchmark_run_id,
            "scenario_id": scenario_id,
            "scenario_version": scenario_version,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    payload: dict[str, object] = {
        "inputs": {},
        "query": _REQUEST_MARKER_PREFIX + marker,
        "response_mode": "streaming",
        "user": end_user,
        "auto_generate_name": False,
    }
    if conversation_id is not None:
        payload["conversation_id"] = conversation_id
    return payload


def validate_public_benchmark_markers(
    *,
    events: object,
    benchmark_run_id: str,
    scenario_id: StagingPublicScenarioId,
    scenario_version: int,
) -> list[PublicBenchmarkMarker]:
    """Require the exact deterministic logical model-round sequence."""

    extracted: list[PublicBenchmarkMarker] = []
    for value in _iter_strings(events):
        for match in _RESPONSE_MARKER_RE.finditer(value):
            extracted.append(_parse_response_marker(_RESPONSE_MARKER_PREFIX + match.group(1)))
    if not extracted:
        raise StagingPublicValidationError("no deterministic benchmark marker was present in SSE events")
    identity = (benchmark_run_id, scenario_id, scenario_version)
    for marker in extracted:
        if (marker.benchmark_run_id, marker.scenario_id, marker.scenario_version) != identity:
            raise StagingPublicValidationError("deterministic benchmark marker identity did not match this turn")
    logical: list[PublicBenchmarkMarker] = []
    for marker in extracted:
        if not logical or logical[-1] != marker:
            logical.append(marker)
    expected = [(1, "terminal")] if scenario_id == "basic" else [(1, "tool_call"), (2, "terminal")]
    actual = [(marker.round, marker.kind) for marker in logical]
    if actual != expected:
        raise StagingPublicValidationError(
            f"deterministic benchmark marker sequence {actual!r} did not match {expected!r}"
        )
    return logical


class _SSEFrame(BaseModel):
    event: str | None = None
    data: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


def _iter_sse_frames(response: httpx.Response) -> Iterator[_SSEFrame]:
    event: str | None = None
    data_lines: list[str] = []
    for line in response.iter_lines():
        if line == "":
            if event is not None or data_lines:
                yield _SSEFrame(event=event, data="\n".join(data_lines) if data_lines else None)
            event = None
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        field, separator, value = line.partition(":")
        if separator and value.startswith(" "):
            value = value[1:]
        if field == "event":
            event = value
        elif field == "data":
            data_lines.append(value)
    if event is not None or data_lines:
        yield _SSEFrame(event=event, data="\n".join(data_lines) if data_lines else None)


def _parse_json_event(value: str) -> dict[str, object]:
    try:
        payload = cast(object, json.loads(value))
    except json.JSONDecodeError as exc:
        raise StagingPublicValidationError("SSE data was not valid JSON") from exc
    if not isinstance(payload, dict):
        raise StagingPublicValidationError("SSE data was not a JSON object")
    event = cast(dict[str, object], payload)
    if not isinstance(event.get("event"), str):
        raise StagingPublicValidationError("SSE JSON object did not contain an event type")
    return event


def _required_event_identifier(event: Mapping[str, object], key: str) -> str:
    value = event.get(key)
    if not isinstance(value, str) or not value:
        raise StagingPublicValidationError(f"SSE event did not contain {key}")
    return value


def _answer_delta(event: Mapping[str, object]) -> str | None:
    event_type = event.get("event")
    if event_type not in _ANSWER_EVENT_TYPES:
        return None
    answer = event.get("answer")
    if isinstance(answer, str):
        return answer
    data = event.get("data")
    if isinstance(data, Mapping):
        text = cast(Mapping[str, object], data).get("text")
        if isinstance(text, str):
            return text
    return None


def _http_operational_error_type(
    status_code: int,
) -> Literal["throttle", "timeout", "http_error", "validation_error"]:
    if status_code == 429:
        return "throttle"
    if status_code in {408, 504}:
        return "timeout"
    if 400 <= status_code < 500:
        return "validation_error"
    return "http_error"


def _sse_operational_error_type(event: Mapping[str, object]) -> StagingPublicOperationalErrorType:
    evidence = " ".join(str(event.get(key, "")) for key in ("message", "code", "status")).lower()
    if "sandbox" in evidence and any(
        token in evidence for token in ("quota", "concurrency", "inventory", "capacity", "limit")
    ):
        return "e2b_inventory_limited"
    if any(token in evidence for token in ("429", "quota", "rate limit", "rate_limit", "too many", "concurrency")):
        return "throttle"
    if any(token in evidence for token in ("timeout", "timed out", "deadline")):
        return "timeout"
    return "sse_error"


def _validate_shell_evidence(
    events: object,
    markers: Sequence[PublicBenchmarkMarker],
) -> None:
    evidence = _extract_single_match(
        _iter_tool_observations(events),
        _SHELL_EVIDENCE_RE,
        label="Shell execution",
    )
    if _parse_response_marker(evidence.group(1)) != markers[0]:
        raise StagingPublicValidationError("Shell output marker did not match the tool-call identity")


def _validate_config_evidence(
    *,
    sample: StagingPublicRunSample,
    events: object,
    markers: Sequence[PublicBenchmarkMarker],
    expected_sha256: str,
) -> None:
    evidence = _extract_single_match(
        _iter_tool_observations(events),
        _CONFIG_EVIDENCE_RE,
        label="Config materialization",
    )
    if _parse_response_marker(evidence.group(1)) != markers[0]:
        raise StagingPublicValidationError("Config marker did not match the tool-call identity")
    item_count = int(evidence.group(2))
    payload_bytes = int(evidence.group(3))
    digest = evidence.group(4)
    sample.config_materialized_item_count = item_count
    sample.config_materialized_bytes = payload_bytes
    sample.config_materialized_sha256 = digest
    sample.config_sha_valid = (
        item_count == _EXPECTED_CONFIG_ITEMS and payload_bytes == _EXPECTED_CONFIG_BYTES and digest == expected_sha256
    )
    if not sample.config_sha_valid:
        raise StagingPublicValidationError(
            "Config evidence did not match 3 skills, 10 files, 53248 bytes, and expected SHA256"
        )


def _extract_single_match(values: Iterator[str], pattern: re.Pattern[str], *, label: str) -> re.Match[str]:
    matches = [match for text in values for match in pattern.finditer(text)]
    unique = {match.group(0): match for match in matches}
    if len(unique) != 1:
        raise StagingPublicValidationError(f"{label} evidence count was {len(unique)}, expected exactly one")
    return next(iter(unique.values()))


def _iter_tool_observations(events: object) -> Iterator[str]:
    """Yield only executed tool output exposed by the public Agent contract.

    The Service API also echoes tool input, including the deterministic script
    and its expected evidence string.  Searching every SSE field would allow a
    failed tool execution to pass merely because its input was echoed.  The
    target Agent API exposes executed output specifically as
    ``agent_thought.observation``; no other field is accepted as evidence.
    """

    if not isinstance(events, Sequence) or isinstance(events, (str, bytes, bytearray)):
        return
    for raw_event in events:
        if not isinstance(raw_event, Mapping):
            continue
        event = cast(Mapping[str, object], raw_event)
        if event.get("event") != "agent_thought" or event.get("tool") != "shell_run":
            continue
        observation = event.get("observation")
        if isinstance(observation, str) and observation:
            yield _successful_shell_output(observation)


def _successful_shell_output(observation: str) -> str:
    metadata_prefix = "<metadata>\n"
    output_separator = "\n</metadata>\n\n<output>\n"
    output_suffix = "\n</output>"
    if not observation.startswith(metadata_prefix) or not observation.endswith(output_suffix):
        raise StagingPublicValidationError("Shell execution observation did not use the tagged output contract")
    metadata_text, separator, output_with_suffix = observation.removeprefix(metadata_prefix).partition(output_separator)
    if not separator:
        raise StagingPublicValidationError("Shell execution observation did not use the tagged output contract")
    try:
        metadata_value = cast(object, json.loads(metadata_text))
    except json.JSONDecodeError as exc:
        raise StagingPublicValidationError("Shell execution metadata was not valid JSON") from exc
    if not isinstance(metadata_value, dict):
        raise StagingPublicValidationError("Shell execution metadata was not a JSON object")
    metadata = cast(dict[str, object], metadata_value)
    exit_code = metadata.get("exit_code")
    if (
        metadata.get("done") is not True
        or not isinstance(exit_code, int)
        or isinstance(exit_code, bool)
        or exit_code != 0
    ):
        raise StagingPublicValidationError("Shell execution did not finish successfully with exit code 0")
    return output_with_suffix.removesuffix(output_suffix)


def _parse_response_marker(value: str) -> PublicBenchmarkMarker:
    if not value.startswith(_RESPONSE_MARKER_PREFIX):
        raise StagingPublicValidationError("invalid deterministic benchmark marker prefix")
    try:
        return PublicBenchmarkMarker.model_validate_json(value.removeprefix(_RESPONSE_MARKER_PREFIX))
    except (ValueError, TypeError) as exc:
        raise StagingPublicValidationError("invalid deterministic benchmark marker payload") from exc


def _iter_strings(value: object) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for nested in value.values():
            yield from _iter_strings(nested)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for nested in value:
            yield from _iter_strings(nested)


def _validate_benchmark_identity(benchmark_run_id: str, scenario_version: int) -> None:
    if not _SAFE_ID_RE.fullmatch(benchmark_run_id):
        raise ValueError("benchmark_run_id must contain only benchmark-safe identity characters")
    if isinstance(scenario_version, bool) or scenario_version != 1:
        raise ValueError("public Staging scenario_version must be exactly 1")


def _normalize_service_api_base_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Service API base URL must be an absolute http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Service API base URL cannot contain credentials, query, or fragment")
    normalized_path = parsed.path.rstrip("/")
    if normalized_path != "/v1":
        raise ValueError("Service API base URL must end with /v1/")
    return urlunsplit((parsed.scheme, parsed.netloc, "/v1/", "", ""))


def _sanitized_header(response: httpx.Response, name: str) -> str | None:
    value = response.headers.get(name)
    if value is None:
        return None
    stripped = value.strip()
    if not stripped or len(stripped) > 120 or any(ord(character) < 32 for character in stripped):
        return None
    return stripped


__all__ = [
    "PublicBenchmarkMarker",
    "StagingPublicObservation",
    "StagingPublicProtocolSettings",
    "StagingPublicServiceClient",
    "StagingPublicOperationalError",
    "StagingPublicValidationError",
    "probe_staging_public_edge",
    "build_staging_public_chat_request",
    "validate_public_benchmark_markers",
]

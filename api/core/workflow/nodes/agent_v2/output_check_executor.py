"""Per-output file benchmark check executor for Workflow Agent Node v2.

Stage 4 §6: after :class:`PerOutputTypeChecker` has confirmed that every
declared output is structurally well-formed, this executor runs an *optional*,
model-based semantic check on file outputs whose
``DeclaredOutputCheckConfig.enabled`` is ``True``. The check is performed:

* by **directly invoking the configured model** (NOT through the Agent backend),
  because the backend's ``dify.output`` layer only enforces structural JSON
  schema and has no notion of "compare two file payloads";
* with **its token usage bucketed separately** as ``output_check_usage`` so
  billing / observability never confuses agent-run usage with output-validation
  usage (decision D-2);
* with **file content loading and model invocation pluggable** via
  :class:`FileContentLoader` and :class:`OutputCheckModelInvoker` Protocols so
  unit tests can drive the executor without DB / network access.

Failures here surface upward as
``OutputFailureKind.OUTPUT_CHECK`` and feed the existing
:class:`OutputFailureOrchestrator` decision chain alongside type-check
failures.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal, Protocol

from models.agent_config_entities import DeclaredOutputConfig, DeclaredOutputType


class OutputCheckModelInvocationError(Exception):
    """Raised by :class:`OutputCheckModelInvoker` when the LLM call fails.

    The executor catches this and produces a ``SKIPPED`` result tagged with
    :attr:`FileOutputCheckSkipReason.MODEL_INVOCATION_ERROR` so the surrounding
    retry / fail-branch logic can still proceed deterministically.
    """


class FileOutputCheckStatus(StrEnum):
    """Lifecycle status of a single file output after the benchmark check."""

    PASSED = "passed"
    FAILED = "failed"
    # Check did not produce a pass/fail signal (unsupported file type, file
    # not accessible, model error, ...). Skipped checks do NOT feed the
    # failure orchestrator — they are surfaced as warnings in metadata.
    SKIPPED = "skipped"


class FileOutputCheckSkipReason(StrEnum):
    """Why an output-check result is :attr:`FileOutputCheckStatus.SKIPPED`."""

    UNSUPPORTED_FILE_FOR_OUTPUT_CHECK = "unsupported_file_for_output_check"
    BENCHMARK_FILE_NOT_ACCESSIBLE = "benchmark_file_not_accessible"
    PRODUCED_FILE_MISSING = "produced_file_missing"
    MODEL_INVOCATION_ERROR = "output_check_model_error"


@dataclass(frozen=True, slots=True)
class FileOutputCheckUsage:
    """Token / cost accounting for one output-check LLM invocation (§6.2 D-2).

    Shape intentionally mirrors ``LLMUsage`` so future code can aggregate
    multiple per-output usages and serialize them next to (but separate from)
    agent run usage. Zero-valued instance means "no model call was made".
    """

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    total_price: Decimal = field(default_factory=lambda: Decimal(0))
    currency: str = "USD"
    latency_ms: int = 0

    def __add__(self, other: FileOutputCheckUsage) -> FileOutputCheckUsage:
        if not isinstance(other, FileOutputCheckUsage):
            return NotImplemented
        return FileOutputCheckUsage(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
            total_price=self.total_price + other.total_price,
            currency=self.currency if self.total_price else other.currency,
            latency_ms=self.latency_ms + other.latency_ms,
        )


@dataclass(frozen=True, slots=True)
class FileOutputCheckResult:
    """Outcome of running benchmark check on one declared file output."""

    output_name: str
    status: FileOutputCheckStatus
    reason: str
    usage: FileOutputCheckUsage = field(default_factory=FileOutputCheckUsage)
    skip_reason: FileOutputCheckSkipReason | None = None
    content_truncated: bool = False


@dataclass(frozen=True, slots=True)
class FileOutputCheckOutcome:
    """Aggregate of per-output check results for one agent backend run."""

    results: tuple[FileOutputCheckResult, ...]

    @property
    def failures(self) -> tuple[FileOutputCheckResult, ...]:
        return tuple(r for r in self.results if r.status == FileOutputCheckStatus.FAILED)

    @property
    def has_failures(self) -> bool:
        return bool(self.failures)

    @property
    def total_usage(self) -> FileOutputCheckUsage:
        total = FileOutputCheckUsage()
        for r in self.results:
            total = total + r.usage
        return total

    def by_name(self) -> dict[str, FileOutputCheckResult]:
        return {r.output_name: r for r in self.results}


@dataclass(frozen=True, slots=True)
class LoadedFileContent:
    """Output of :class:`FileContentLoader`.

    ``text`` is empty when ``unsupported`` is ``True``; callers must check the
    flag before reading text. ``truncated`` indicates the loader had to drop
    content to fit the configured budget.
    """

    text: str
    truncated: bool = False
    unsupported: bool = False


class FileContentLoader(Protocol):
    """Resolve a ``file_id`` for the given tenant into model-readable text.

    Returning ``None`` signals the file is missing / cross-tenant / failed to
    extract — the executor maps that to a SKIPPED result instead of failing
    the whole node. Implementations must not raise on those cases; raising is
    reserved for unexpected runtime errors.
    """

    def load(self, *, file_id: str, tenant_id: str) -> LoadedFileContent | None: ...


@dataclass(frozen=True, slots=True)
class OutputCheckModelResponse:
    """LLM response wrapping the raw assistant text plus token usage."""

    text: str
    usage: FileOutputCheckUsage


class OutputCheckModelInvoker(Protocol):
    """Direct (non-streaming) LLM invocation for output check.

    The contract is intentionally narrow: one prompt in, one assistant message
    out. The Agent Soul's model identity is passed explicitly so the executor
    stays agnostic of how callers resolve the agent's model config.
    """

    def invoke(
        self,
        *,
        tenant_id: str,
        model_provider: str,
        model_name: str,
        prompt: str,
        model_settings: Mapping[str, Any] | None = None,
    ) -> OutputCheckModelResponse: ...


# Recognized aliases for the file id key in a produced file payload. Mirrors
# :data:`output_type_checker._FILE_ID_KEYS` so both stages handle the same
# field set.
_FILE_ID_KEYS: tuple[str, ...] = ("file_id", "upload_file_id", "tool_file_id")

# Verdict / reason parsing patterns. The prompt instructs the model to start
# with ``VERDICT: PASS|FAIL`` followed by ``REASON: ...``; we tolerate
# whitespace and case variations.
_VERDICT_PATTERN = re.compile(r"VERDICT\s*:\s*(PASS|FAIL)", re.IGNORECASE)
_REASON_PATTERN = re.compile(r"REASON\s*:\s*(.+)", re.IGNORECASE | re.DOTALL)

_DEFAULT_MAX_CONTENT_CHARS = 32_000
_TRUNCATION_NOTICE = "…[content truncated]"


class FileOutputCheckExecutor:
    """Run benchmark checks against every file output that opted in."""

    def __init__(
        self,
        *,
        content_loader: FileContentLoader,
        model_invoker: OutputCheckModelInvoker,
        max_content_chars: int = _DEFAULT_MAX_CONTENT_CHARS,
    ) -> None:
        self._content_loader = content_loader
        self._model_invoker = model_invoker
        self._max_content_chars = max_content_chars

    def check_all(
        self,
        *,
        declared_outputs: list[DeclaredOutputConfig],
        raw_output: Mapping[str, Any] | Any,
        tenant_id: str,
        model_provider: str,
        model_name: str,
        model_settings: Mapping[str, Any] | None = None,
    ) -> FileOutputCheckOutcome:
        """Run benchmark checks for the file outputs that opted in.

        ``raw_output`` matches the shape of ``run_succeeded.data.output`` —
        normally a dict, but we widen the signature like
        :meth:`PerOutputTypeChecker.check` so a misbehaving backend cannot
        crash the executor. Non-mapping payloads yield an empty outcome
        (type-check already surfaced the failure).

        Skips:
          - non-file declared outputs (silently — handled by type check)
          - file outputs without ``check.enabled``
          - file outputs whose produced value is missing (already flagged by
            type check; we do not want to surface a duplicate signal here)
        """
        if not isinstance(raw_output, Mapping):
            return FileOutputCheckOutcome(results=())

        results: list[FileOutputCheckResult] = []
        for declared in declared_outputs:
            if declared.type != DeclaredOutputType.FILE:
                continue
            if not (declared.check and declared.check.enabled):
                continue
            produced_value = raw_output.get(declared.name)
            if produced_value is None:
                results.append(
                    FileOutputCheckResult(
                        output_name=declared.name,
                        status=FileOutputCheckStatus.SKIPPED,
                        reason=f"Produced value for {declared.name!r} is missing.",
                        skip_reason=FileOutputCheckSkipReason.PRODUCED_FILE_MISSING,
                    )
                )
                continue
            results.append(
                self._check_one(
                    declared=declared,
                    produced_value=produced_value,
                    tenant_id=tenant_id,
                    model_provider=model_provider,
                    model_name=model_name,
                    model_settings=model_settings,
                )
            )
        return FileOutputCheckOutcome(results=tuple(results))

    def _check_one(
        self,
        *,
        declared: DeclaredOutputConfig,
        produced_value: Any,
        tenant_id: str,
        model_provider: str,
        model_name: str,
        model_settings: Mapping[str, Any] | None,
    ) -> FileOutputCheckResult:
        # ``declared.check`` is guaranteed non-None by the caller; access via
        # the model validator that ensured prompt + benchmark_file_ref exist.
        assert declared.check is not None
        assert declared.check.enabled
        check = declared.check

        produced_file_id = self._extract_file_id(produced_value)
        if produced_file_id is None:
            return FileOutputCheckResult(
                output_name=declared.name,
                status=FileOutputCheckStatus.SKIPPED,
                reason="Produced value lacks a recognized file_id field.",
                skip_reason=FileOutputCheckSkipReason.PRODUCED_FILE_MISSING,
            )
        bench_ref = check.benchmark_file_ref or {}
        benchmark_file_id = self._extract_file_id(bench_ref)
        if benchmark_file_id is None:
            return FileOutputCheckResult(
                output_name=declared.name,
                status=FileOutputCheckStatus.SKIPPED,
                reason="benchmark_file_ref is missing a recognized file_id field.",
                skip_reason=FileOutputCheckSkipReason.BENCHMARK_FILE_NOT_ACCESSIBLE,
            )

        produced = self._content_loader.load(file_id=produced_file_id, tenant_id=tenant_id)
        if produced is None:
            return FileOutputCheckResult(
                output_name=declared.name,
                status=FileOutputCheckStatus.SKIPPED,
                reason=f"Produced file {produced_file_id!r} is not accessible to tenant.",
                skip_reason=FileOutputCheckSkipReason.PRODUCED_FILE_MISSING,
            )
        if produced.unsupported:
            return FileOutputCheckResult(
                output_name=declared.name,
                status=FileOutputCheckStatus.SKIPPED,
                reason="Produced file type is not supported for output check.",
                skip_reason=FileOutputCheckSkipReason.UNSUPPORTED_FILE_FOR_OUTPUT_CHECK,
            )

        benchmark = self._content_loader.load(file_id=benchmark_file_id, tenant_id=tenant_id)
        if benchmark is None:
            return FileOutputCheckResult(
                output_name=declared.name,
                status=FileOutputCheckStatus.SKIPPED,
                reason=f"Benchmark file {benchmark_file_id!r} is not accessible to tenant.",
                skip_reason=FileOutputCheckSkipReason.BENCHMARK_FILE_NOT_ACCESSIBLE,
            )
        if benchmark.unsupported:
            return FileOutputCheckResult(
                output_name=declared.name,
                status=FileOutputCheckStatus.SKIPPED,
                reason="Benchmark file type is not supported for output check.",
                skip_reason=FileOutputCheckSkipReason.UNSUPPORTED_FILE_FOR_OUTPUT_CHECK,
            )

        benchmark_text, produced_text, truncated = self._truncate_for_budget(
            benchmark_text=benchmark.text, produced_text=produced.text
        )
        truncated = truncated or benchmark.truncated or produced.truncated

        # ``check.prompt`` is guaranteed non-None by the model validator when
        # enabled=True, but we coerce defensively for older records.
        user_prompt = check.prompt or ""
        prompt = self._build_prompt(
            user_prompt=user_prompt,
            benchmark_text=benchmark_text,
            produced_text=produced_text,
        )

        try:
            response = self._model_invoker.invoke(
                tenant_id=tenant_id,
                model_provider=model_provider,
                model_name=model_name,
                prompt=prompt,
                model_settings=model_settings,
            )
        except OutputCheckModelInvocationError as exc:
            return FileOutputCheckResult(
                output_name=declared.name,
                status=FileOutputCheckStatus.SKIPPED,
                reason=f"Model invocation failed: {exc}",
                skip_reason=FileOutputCheckSkipReason.MODEL_INVOCATION_ERROR,
                content_truncated=truncated,
            )

        verdict, reason = self._parse_verdict(response.text)
        if verdict == "pass":
            status = FileOutputCheckStatus.PASSED
        elif verdict == "fail":
            status = FileOutputCheckStatus.FAILED
        else:
            # Indeterminate output. We treat it as FAIL so the orchestrator
            # gets a real signal; the raw model text is included in the
            # reason for debugging.
            status = FileOutputCheckStatus.FAILED
            reason = f"Indeterminate model response: {response.text.strip()[:300]}"

        return FileOutputCheckResult(
            output_name=declared.name,
            status=status,
            reason=reason,
            usage=response.usage,
            content_truncated=truncated,
        )

    def _truncate_for_budget(
        self,
        *,
        benchmark_text: str,
        produced_text: str,
    ) -> tuple[str, str, bool]:
        """Split the char budget equally between benchmark and produced.

        Returns ``(benchmark_text, produced_text, truncated)``. Each half is
        capped at ``max_content_chars // 2`` so a single huge document cannot
        starve the other side.
        """
        half = self._max_content_chars // 2
        truncated = False
        if len(benchmark_text) > half:
            benchmark_text = benchmark_text[:half] + _TRUNCATION_NOTICE
            truncated = True
        if len(produced_text) > half:
            produced_text = produced_text[:half] + _TRUNCATION_NOTICE
            truncated = True
        return benchmark_text, produced_text, truncated

    @staticmethod
    def _build_prompt(*, user_prompt: str, benchmark_text: str, produced_text: str) -> str:
        return (
            "You are an output validator. The user has defined the following acceptance criteria:\n"
            "<criteria>\n"
            f"{user_prompt.strip()}\n"
            "</criteria>\n\n"
            "Below is the BENCHMARK file the produced output should be evaluated against:\n"
            "<benchmark>\n"
            f"{benchmark_text}\n"
            "</benchmark>\n\n"
            "Below is the PRODUCED file from the agent run:\n"
            "<produced>\n"
            f"{produced_text}\n"
            "</produced>\n\n"
            "Decide whether the PRODUCED file satisfies the criteria when compared to the BENCHMARK.\n"
            "Respond strictly in this format on two lines:\n"
            "VERDICT: PASS\n"
            "REASON: <one-sentence explanation>\n"
            "(or VERDICT: FAIL when the produced file does not meet the criteria)."
        )

    @staticmethod
    def _parse_verdict(text: str) -> tuple[Literal["pass", "fail", "unknown"], str]:
        verdict_match = _VERDICT_PATTERN.search(text)
        reason_match = _REASON_PATTERN.search(text)
        if verdict_match is None:
            return "unknown", text.strip()[:300]
        verdict_raw = verdict_match.group(1).lower()
        verdict: Literal["pass", "fail", "unknown"] = "pass" if verdict_raw == "pass" else "fail"
        if reason_match is not None:
            reason = reason_match.group(1).strip()
            # Reasons can run multi-line in some model outputs; first line is
            # usually the salient one.
            reason = reason.split("\n", 1)[0].strip()
        else:
            reason = "" if verdict == "pass" else "Model returned FAIL without a reason."
        return verdict, reason

    @staticmethod
    def _extract_file_id(value: Any) -> str | None:
        if not isinstance(value, Mapping):
            return None
        for key in _FILE_ID_KEYS:
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate:
                return candidate
        return None

"""Unit tests for FileOutputCheckExecutor.

Stage 4 §6. The executor orchestrates per-file benchmark checks; the loader
and model invoker are injected as Protocols so these tests stay free of DB
and network access.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
from typing import Any

import pytest

from core.workflow.nodes.agent_v2.output_check_executor import (
    FileContentLoader,
    FileOutputCheckExecutor,
    FileOutputCheckOutcome,
    FileOutputCheckSkipReason,
    FileOutputCheckStatus,
    FileOutputCheckUsage,
    LoadedFileContent,
    OutputCheckModelInvocationError,
    OutputCheckModelInvoker,
    OutputCheckModelResponse,
)
from models.agent_config_entities import (
    DeclaredOutputCheckConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
)

# ──────────────────────────────────────────────────────────────────────────────
# Stubs
# ──────────────────────────────────────────────────────────────────────────────


class StubContentLoader(FileContentLoader):
    """Maps ``file_id`` → ``LoadedFileContent`` (or ``None`` for not accessible)."""

    def __init__(self, *, contents: Mapping[str, LoadedFileContent | None]) -> None:
        self._contents = dict(contents)
        self.calls: list[tuple[str, str]] = []

    def load(self, *, file_id: str, tenant_id: str) -> LoadedFileContent | None:
        self.calls.append((file_id, tenant_id))
        return self._contents.get(file_id)


class StubModelInvoker(OutputCheckModelInvoker):
    """Returns a canned response or raises a configured error."""

    def __init__(
        self,
        *,
        response: OutputCheckModelResponse | None = None,
        error: OutputCheckModelInvocationError | None = None,
    ) -> None:
        self._response = response
        self._error = error
        self.calls: list[Mapping[str, Any]] = []

    def invoke(
        self,
        *,
        tenant_id: str,
        model_provider: str,
        model_name: str,
        prompt: str,
        model_settings: Mapping[str, Any] | None = None,
    ) -> OutputCheckModelResponse:
        self.calls.append(
            {
                "tenant_id": tenant_id,
                "model_provider": model_provider,
                "model_name": model_name,
                "prompt": prompt,
                "model_settings": dict(model_settings or {}),
            }
        )
        if self._error is not None:
            raise self._error
        assert self._response is not None
        return self._response


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _file_output(
    *,
    name: str = "report",
    enabled: bool = True,
    prompt: str | None = "Check structure matches benchmark.",
    benchmark_ref: dict[str, Any] | None = None,
) -> DeclaredOutputConfig:
    if enabled:
        # Validator requires a populated benchmark_file_ref when enabled. The
        # default ``{"file_id": "bench-1"}`` matches the canonical contract;
        # tests that want to exercise "missing file_id" pass a ref like
        # ``{"filename": "x.pdf"}`` instead.
        ref = benchmark_ref if benchmark_ref is not None else {"file_id": "bench-1"}
        check = DeclaredOutputCheckConfig(
            enabled=True,
            prompt=prompt,
            benchmark_file_ref=ref,
        )
    else:
        check = DeclaredOutputCheckConfig(enabled=False)
    return DeclaredOutputConfig(
        name=name,
        type=DeclaredOutputType.FILE,
        check=check,
    )


def _ok_response(text: str, *, prompt_tokens: int = 10, completion_tokens: int = 5) -> OutputCheckModelResponse:
    return OutputCheckModelResponse(
        text=text,
        usage=FileOutputCheckUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            total_price=Decimal("0.001"),
            currency="USD",
            latency_ms=42,
        ),
    )


def _make_executor(
    *,
    contents: Mapping[str, LoadedFileContent | None] | None = None,
    response: OutputCheckModelResponse | None = None,
    error: OutputCheckModelInvocationError | None = None,
    max_content_chars: int = 32_000,
) -> tuple[FileOutputCheckExecutor, StubContentLoader, StubModelInvoker]:
    loader = StubContentLoader(contents=contents or {})
    invoker = StubModelInvoker(response=response, error=error)
    executor = FileOutputCheckExecutor(
        content_loader=loader,
        model_invoker=invoker,
        max_content_chars=max_content_chars,
    )
    return executor, loader, invoker


def _ok_loader_contents() -> dict[str, LoadedFileContent]:
    return {
        "produced-1": LoadedFileContent(text="produced body"),
        "bench-1": LoadedFileContent(text="benchmark body"),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Skip-path: nothing-to-check declarations
# ──────────────────────────────────────────────────────────────────────────────


def test_non_file_outputs_are_silently_skipped():
    executor, _, invoker = _make_executor(response=_ok_response("VERDICT: PASS\nREASON: ok"))
    declared = [
        DeclaredOutputConfig(name="text", type=DeclaredOutputType.STRING),
        DeclaredOutputConfig(name="json", type=DeclaredOutputType.OBJECT),
    ]
    outcome = executor.check_all(
        declared_outputs=declared,
        raw_output={"text": "hi", "json": {}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results == ()
    assert invoker.calls == []


def test_file_output_without_check_enabled_is_skipped():
    executor, _, invoker = _make_executor(response=_ok_response("VERDICT: PASS"))
    declared = [_file_output(enabled=False)]
    outcome = executor.check_all(
        declared_outputs=declared,
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results == ()
    assert invoker.calls == []


def test_missing_produced_value_emits_skipped_result():
    executor, _, invoker = _make_executor(response=_ok_response("VERDICT: PASS"))
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert len(outcome.results) == 1
    result = outcome.results[0]
    assert result.status == FileOutputCheckStatus.SKIPPED
    assert result.skip_reason == FileOutputCheckSkipReason.PRODUCED_FILE_MISSING
    assert invoker.calls == []


def test_produced_value_lacking_file_id_is_skipped():
    executor, _, invoker = _make_executor(response=_ok_response("VERDICT: PASS"))
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"filename": "x.pdf"}},  # no file_id
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].status == FileOutputCheckStatus.SKIPPED
    assert outcome.results[0].skip_reason == FileOutputCheckSkipReason.PRODUCED_FILE_MISSING
    assert invoker.calls == []


def test_benchmark_ref_lacking_file_id_is_skipped():
    executor, _, invoker = _make_executor(response=_ok_response("VERDICT: PASS"))
    outcome = executor.check_all(
        # benchmark_file_ref is populated (validator allows it) but has no
        # recognized file_id key — only metadata. Executor must SKIP, not
        # crash.
        declared_outputs=[_file_output(benchmark_ref={"filename": "ignored.pdf"})],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].status == FileOutputCheckStatus.SKIPPED
    assert outcome.results[0].skip_reason == FileOutputCheckSkipReason.BENCHMARK_FILE_NOT_ACCESSIBLE
    assert invoker.calls == []


# ──────────────────────────────────────────────────────────────────────────────
# Loader-driven SKIP cases
# ──────────────────────────────────────────────────────────────────────────────


def test_produced_file_inaccessible_is_skipped():
    executor, _, invoker = _make_executor(
        contents={"produced-1": None, "bench-1": LoadedFileContent(text="b")},
        response=_ok_response("VERDICT: PASS"),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].skip_reason == FileOutputCheckSkipReason.PRODUCED_FILE_MISSING
    assert invoker.calls == []


def test_benchmark_file_inaccessible_is_skipped():
    executor, _, invoker = _make_executor(
        contents={"produced-1": LoadedFileContent(text="p"), "bench-1": None},
        response=_ok_response("VERDICT: PASS"),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].skip_reason == FileOutputCheckSkipReason.BENCHMARK_FILE_NOT_ACCESSIBLE
    assert invoker.calls == []


def test_produced_file_unsupported_is_skipped():
    executor, _, invoker = _make_executor(
        contents={
            "produced-1": LoadedFileContent(text="", unsupported=True),
            "bench-1": LoadedFileContent(text="b"),
        },
        response=_ok_response("VERDICT: PASS"),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].skip_reason == FileOutputCheckSkipReason.UNSUPPORTED_FILE_FOR_OUTPUT_CHECK
    assert invoker.calls == []


def test_benchmark_file_unsupported_is_skipped():
    executor, _, invoker = _make_executor(
        contents={
            "produced-1": LoadedFileContent(text="p"),
            "bench-1": LoadedFileContent(text="", unsupported=True),
        },
        response=_ok_response("VERDICT: PASS"),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].skip_reason == FileOutputCheckSkipReason.UNSUPPORTED_FILE_FOR_OUTPUT_CHECK
    assert invoker.calls == []


# ──────────────────────────────────────────────────────────────────────────────
# Model error
# ──────────────────────────────────────────────────────────────────────────────


def test_model_invocation_error_yields_skipped_with_usage_zero():
    executor, _, _ = _make_executor(
        contents=_ok_loader_contents(),
        error=OutputCheckModelInvocationError("provider down"),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    result = outcome.results[0]
    assert result.status == FileOutputCheckStatus.SKIPPED
    assert result.skip_reason == FileOutputCheckSkipReason.MODEL_INVOCATION_ERROR
    assert "provider down" in result.reason
    assert result.usage == FileOutputCheckUsage()  # no usage on failure


# ──────────────────────────────────────────────────────────────────────────────
# Verdict parsing
# ──────────────────────────────────────────────────────────────────────────────


def test_pass_verdict_is_parsed_with_reason():
    executor, _, _ = _make_executor(
        contents=_ok_loader_contents(),
        response=_ok_response("VERDICT: PASS\nREASON: matches structure."),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    result = outcome.results[0]
    assert result.status == FileOutputCheckStatus.PASSED
    assert result.reason == "matches structure."


def test_fail_verdict_is_parsed_with_reason():
    executor, _, _ = _make_executor(
        contents=_ok_loader_contents(),
        response=_ok_response("VERDICT: FAIL\nREASON: missing section 3."),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    result = outcome.results[0]
    assert result.status == FileOutputCheckStatus.FAILED
    assert result.reason == "missing section 3."


def test_verdict_parsing_tolerates_case_and_whitespace():
    executor, _, _ = _make_executor(
        contents=_ok_loader_contents(),
        response=_ok_response("verdict:   pass   \n  reason  :  ok!"),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].status == FileOutputCheckStatus.PASSED


def test_indeterminate_response_is_treated_as_failure():
    executor, _, _ = _make_executor(
        contents=_ok_loader_contents(),
        response=_ok_response("Sure thing! The file looks great I guess."),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    result = outcome.results[0]
    assert result.status == FileOutputCheckStatus.FAILED
    assert "Indeterminate model response" in result.reason


def test_pass_without_reason_yields_empty_reason():
    executor, _, _ = _make_executor(
        contents=_ok_loader_contents(),
        response=_ok_response("VERDICT: PASS"),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].status == FileOutputCheckStatus.PASSED
    assert outcome.results[0].reason == ""


# ──────────────────────────────────────────────────────────────────────────────
# Truncation
# ──────────────────────────────────────────────────────────────────────────────


def test_text_within_budget_does_not_truncate():
    executor, _, _ = _make_executor(
        contents=_ok_loader_contents(),
        response=_ok_response("VERDICT: PASS\nREASON: ok"),
        max_content_chars=10_000,
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].content_truncated is False


def test_oversized_content_is_truncated():
    big_text = "x" * 50_000
    executor, _, invoker = _make_executor(
        contents={
            "produced-1": LoadedFileContent(text=big_text),
            "bench-1": LoadedFileContent(text="ok"),
        },
        response=_ok_response("VERDICT: PASS\nREASON: ok"),
        max_content_chars=10_000,
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].content_truncated is True
    # Prompt should contain the truncation marker because the produced body
    # exceeded the half-budget.
    assert "content truncated" in invoker.calls[0]["prompt"]


def test_loader_reported_truncation_propagates_to_result():
    executor, _, _ = _make_executor(
        contents={
            "produced-1": LoadedFileContent(text="p", truncated=True),
            "bench-1": LoadedFileContent(text="b"),
        },
        response=_ok_response("VERDICT: PASS\nREASON: ok"),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].content_truncated is True


# ──────────────────────────────────────────────────────────────────────────────
# Usage propagation + aggregation
# ──────────────────────────────────────────────────────────────────────────────


def test_usage_is_propagated_from_model_response_to_result():
    executor, _, _ = _make_executor(
        contents=_ok_loader_contents(),
        response=_ok_response("VERDICT: PASS\nREASON: ok", prompt_tokens=42, completion_tokens=7),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    usage = outcome.results[0].usage
    assert usage.prompt_tokens == 42
    assert usage.completion_tokens == 7
    assert usage.total_tokens == 49


def test_total_usage_sums_across_multiple_outputs():
    decl_a = _file_output(name="a")
    decl_b = _file_output(name="b")
    executor, _, _ = _make_executor(
        contents={
            "produced-a": LoadedFileContent(text="pa"),
            "produced-b": LoadedFileContent(text="pb"),
            "bench-1": LoadedFileContent(text="b"),
        },
        response=_ok_response("VERDICT: PASS\nREASON: ok", prompt_tokens=10, completion_tokens=5),
    )
    outcome = executor.check_all(
        declared_outputs=[decl_a, decl_b],
        raw_output={"a": {"file_id": "produced-a"}, "b": {"file_id": "produced-b"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    total = outcome.total_usage
    assert total.prompt_tokens == 20
    assert total.completion_tokens == 10
    assert total.total_tokens == 30


def test_outcome_failures_and_by_name_helpers():
    decl_a = _file_output(name="a")
    decl_b = _file_output(name="b")
    executor, _, _ = _make_executor(
        contents={
            "produced-a": LoadedFileContent(text="pa"),
            "produced-b": LoadedFileContent(text="pb"),
            "bench-1": LoadedFileContent(text="b"),
        },
    )

    # First call: a passes
    executor._model_invoker = StubModelInvoker(  # type: ignore[attr-defined]
        response=_ok_response("VERDICT: PASS\nREASON: ok")
    )
    outcome_a = executor.check_all(
        declared_outputs=[decl_a],
        raw_output={"a": {"file_id": "produced-a"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    # Second call: b fails
    executor._model_invoker = StubModelInvoker(  # type: ignore[attr-defined]
        response=_ok_response("VERDICT: FAIL\nREASON: missing")
    )
    outcome_b = executor.check_all(
        declared_outputs=[decl_b],
        raw_output={"b": {"file_id": "produced-b"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome_a.has_failures is False
    assert outcome_b.has_failures is True
    assert outcome_b.by_name()["b"].status == FileOutputCheckStatus.FAILED


# ──────────────────────────────────────────────────────────────────────────────
# Prompt construction
# ──────────────────────────────────────────────────────────────────────────────


def test_prompt_includes_user_prompt_benchmark_and_produced_sections():
    executor, _, invoker = _make_executor(
        contents={
            "produced-1": LoadedFileContent(text="HELLO_PRODUCED"),
            "bench-1": LoadedFileContent(text="HELLO_BENCHMARK"),
        },
        response=_ok_response("VERDICT: PASS\nREASON: ok"),
    )
    declared = _file_output(prompt="My specific criteria.")
    executor.check_all(
        declared_outputs=[declared],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    prompt_text = invoker.calls[0]["prompt"]
    assert "My specific criteria." in prompt_text
    assert "HELLO_PRODUCED" in prompt_text
    assert "HELLO_BENCHMARK" in prompt_text
    assert "VERDICT: PASS" in prompt_text  # format instruction


def test_invoker_receives_tenant_provider_model_and_settings():
    executor, _, invoker = _make_executor(
        contents=_ok_loader_contents(),
        response=_ok_response("VERDICT: PASS\nREASON: ok"),
    )
    executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {"file_id": "produced-1"}},
        tenant_id="t-tenant",
        model_provider="anthropic",
        model_name="claude-sonnet",
        model_settings={"temperature": 0.0},
    )
    call = invoker.calls[0]
    assert call["tenant_id"] == "t-tenant"
    assert call["model_provider"] == "anthropic"
    assert call["model_name"] == "claude-sonnet"
    assert call["model_settings"] == {"temperature": 0.0}


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("alias_key", ["file_id", "upload_file_id", "tool_file_id"])
def test_produced_file_id_alias_keys_are_recognized(alias_key: str):
    executor, _, _ = _make_executor(
        contents={
            "produced-1": LoadedFileContent(text="p"),
            "bench-1": LoadedFileContent(text="b"),
        },
        response=_ok_response("VERDICT: PASS\nREASON: ok"),
    )
    outcome = executor.check_all(
        declared_outputs=[_file_output()],
        raw_output={"report": {alias_key: "produced-1"}},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].status == FileOutputCheckStatus.PASSED


def test_usage_addition_associates_currency_when_present():
    a = FileOutputCheckUsage(
        prompt_tokens=1, completion_tokens=2, total_tokens=3, total_price=Decimal("0.5"), currency="USD"
    )
    b = FileOutputCheckUsage(
        prompt_tokens=4, completion_tokens=5, total_tokens=9, total_price=Decimal("1.5"), currency="EUR"
    )
    summed = a + b
    assert summed.prompt_tokens == 5
    assert summed.completion_tokens == 7
    assert summed.total_tokens == 12
    assert summed.total_price == Decimal("2.0")
    assert summed.currency == "USD"  # a had positive price → wins


def test_empty_check_all_returns_empty_outcome():
    executor, _, _ = _make_executor()
    outcome = executor.check_all(
        declared_outputs=[],
        raw_output={},
        tenant_id="t-1",
        model_provider="openai",
        model_name="gpt-4",
    )
    assert isinstance(outcome, FileOutputCheckOutcome)
    assert outcome.results == ()
    assert outcome.has_failures is False

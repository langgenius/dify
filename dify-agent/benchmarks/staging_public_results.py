"""Finalize the local Locust public Staging smoke into Schema v3 artifacts."""

from __future__ import annotations

from datetime import datetime, timezone
from importlib.metadata import version
import json
from pathlib import Path
import platform
from typing import Literal

from benchmarks.staging_public_artifact_safety import (
    validate_public_artifact_payload,
    validate_public_artifact_text,
)
from benchmarks.staging_public_schemas import (
    STAGING_PUBLIC_SCENARIO_SEQUENCE,
    StagingPublicEnvironment,
    StagingPublicRunSample,
    StagingPublicSmokeExecution,
    StagingPublicSmokeResult,
)


def build_staging_public_environment(
    *,
    invocation_id: str,
    service_api_base_url: str,
    harness_commit: str,
    harness_dirty: bool,
    target_commit: str,
    scenario_manifest_sha256: str,
    deterministic_plugin_version: str,
    deterministic_plugin_package_sha256: str,
    config_expected_sha256: str | None = None,
    e2b_observer_mode: Literal["local"] = "local",
    benchmark_scope_fingerprint: str | None = None,
    edge_version: str | None = None,
    edge_server: str | None = None,
    edge_version_before: str | None = None,
    edge_version_after: str | None = None,
    edge_server_before: str | None = None,
    edge_server_after: str | None = None,
) -> StagingPublicEnvironment:
    """Build a non-secret fingerprint for the local-to-public request path."""

    return StagingPublicEnvironment(
        captured_at=datetime.now(timezone.utc).isoformat(),
        invocation_id=invocation_id,
        service_api_base_url=service_api_base_url,
        harness_commit=harness_commit,
        harness_dirty=harness_dirty,
        target_commit=target_commit,
        scenario_manifest_sha256=scenario_manifest_sha256,
        deterministic_plugin_version=deterministic_plugin_version,
        deterministic_plugin_package_sha256=deterministic_plugin_package_sha256,
        config_expected_sha256=config_expected_sha256,
        e2b_observer_mode=e2b_observer_mode,
        benchmark_scope_fingerprint=benchmark_scope_fingerprint,
        python_version=platform.python_version(),
        locust_version=version("locust"),
        edge_version=edge_version,
        edge_server=edge_server,
        edge_version_before=edge_version_before,
        edge_version_after=edge_version_after,
        edge_server_before=edge_server_before,
        edge_server_after=edge_server_after,
    )


def finalize_staging_public_smoke(
    *,
    artifact_dir: Path,
    environment: StagingPublicEnvironment,
    execution: StagingPublicSmokeExecution,
) -> tuple[StagingPublicSmokeResult, bool]:
    """Validate the serial smoke contract and write every public artifact."""

    errors = list(execution.load.fatal_errors)
    observed_sequence = tuple(sample.scenario_id for sample in execution.samples)
    if observed_sequence != STAGING_PUBLIC_SCENARIO_SEQUENCE:
        errors.append(
            "public smoke scenario sequence was incomplete: "
            f"expected {STAGING_PUBLIC_SCENARIO_SEQUENCE}, observed {observed_sequence}"
        )
    if len({sample.benchmark_run_id for sample in execution.samples}) != len(execution.samples):
        errors.append("public smoke benchmark run identities were not unique")
    for sample in execution.samples:
        if not sample.succeeded:
            errors.append(_sample_failure(sample))
    if execution.samples:
        expected_reuse = [False, *(True for _ in execution.samples[1:])]
        observed_reuse = [sample.conversation_reused for sample in execution.samples]
        if observed_reuse != expected_reuse:
            errors.append(
                "public smoke did not preserve one conversation chain: "
                f"expected reuse={expected_reuse}, observed={observed_reuse}"
            )
    if execution.load.spawned_users != 1 or execution.load.observed_max_active != 1:
        errors.append(
            "public smoke did not execute exactly one active Locust User: "
            f"spawned={execution.load.spawned_users}, max_active={execution.load.observed_max_active}"
        )
    if not (
        execution.cleanup.attempted
        and execution.cleanup.http_status_code == 204
        and execution.cleanup.conversation_deleted
        and execution.cleanup.complete
    ):
        errors.append("public conversation cleanup was incomplete")
    if execution.load.timed_out:
        errors.append("public smoke load engine timed out")
    errors = list(dict.fromkeys(errors))
    success = not errors
    result = StagingPublicSmokeResult(
        status="passed" if success else "failed",
        environment=environment,
        samples=[sample.model_copy(deep=True) for sample in execution.samples],
        cleanup=execution.cleanup.model_copy(deep=True),
        load=execution.load.model_copy(deep=True),
        errors=errors,
    )
    _write_artifacts(artifact_dir=artifact_dir, result=result)
    return result, success


def render_staging_public_markdown(result: StagingPublicSmokeResult) -> str:
    """Render a smoke-only report without internal resource or capacity claims."""

    successful_samples = sum(sample.succeeded for sample in result.samples)
    success_rate = successful_samples / len(result.samples) if result.samples else 0
    lines = [
        "# Dify Agent Staging public E2E smoke",
        "",
        "> One local Locust User exercised the real public Service API. This is a smoke result, not a capacity test or SLO.",
        "",
        "## Conclusion",
        "",
        f"- Status: **{result.status}**",
        f"- Successful transactions: **{successful_samples}/{len(result.samples)} ({success_rate:.2%})**",
        "- Confidence: **low_confidence** (one serial sample per scenario)",
        "- Capacity: **N/A**",
        "- Endpoint path: local load generator → public edge → Dify API → Agent Service → Runtime/E2B",
        "- Traffic isolation: **false**",
        "- Internal Agent, Kubernetes, Redis, E2B lifecycle, and resource attribution: **not observed**",
        "",
        "## Public transactions",
        "",
        "| Scenario | HTTP | Reused conversation | Headers ms | First SSE ms | First answer ms | Terminal ms | Events | Answer bytes | Correctness |",
        "|---|---:|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for sample in result.samples:
        lines.append(
            f"| `{sample.scenario_id}` | {_integer(sample.http_status_code)} | "
            f"`{str(sample.conversation_reused).lower()}` | {_number(sample.response_headers_ms)} | "
            f"{_number(sample.time_to_first_sse_ms)} | {_number(sample.time_to_first_answer_ms)} | "
            f"{_number(sample.terminal_e2e_ms)} | {sample.event_count} | {sample.answer_bytes} | "
            f"`{'passed' if sample.succeeded else 'failed'}` |"
        )
    config_samples = [sample for sample in result.samples if sample.scenario_id == "config"]
    if config_samples:
        sample = config_samples[-1]
        lines.extend(
            [
                "",
                "## Config correctness",
                "",
                f"- Materialized items: **{sample.config_materialized_item_count}**",
                f"- Materialized bytes: **{sample.config_materialized_bytes}**",
                f"- SHA256: `{sample.config_materialized_sha256 or 'N/A'}`",
                f"- Expected SHA matched: `{str(sample.config_sha_valid).lower()}`",
            ]
        )
    lines.extend(
        [
            "",
            "## Cleanup",
            "",
            f"- Attempted: `{str(result.cleanup.attempted).lower()}`",
            f"- HTTP status: {_integer(result.cleanup.http_status_code)}",
            f"- Conversation deleted: `{str(result.cleanup.conversation_deleted).lower()}`",
            f"- Complete: `{str(result.cleanup.complete).lower()}`",
            "- Physical Binding/Sandbox collection: `not_observable_from_public_api`",
        ]
    )
    if result.errors:
        lines.extend(["", "## Diagnostics", ""])
        lines.extend(f"- {error}" for error in result.errors)
    lines.extend(
        [
            "",
            "## Environment",
            "",
            f"- Service API: `{result.environment.service_api_base_url}`",
            f"- Harness commit: `{result.environment.harness_commit}`",
            f"- Harness dirty: `{str(result.environment.harness_dirty).lower()}`",
            f"- Target commit: `{result.environment.target_commit}` (`operator_asserted`)",
            f"- Scenario manifest SHA256: `{result.environment.scenario_manifest_sha256}`",
            f"- Deterministic plugin expected package: `{result.environment.deterministic_plugin_version}` / "
            f"`{result.environment.deterministic_plugin_package_sha256}` "
            f"(`{result.environment.deterministic_plugin_package_evidence}`)",
            f"- Config fixture expected SHA256: `{result.environment.config_expected_sha256 or 'N/A'}`",
            f"- Python / Locust: `{result.environment.python_version}` / `{result.environment.locust_version}`",
            f"- Public edge x-version / server: `{result.environment.edge_version or 'N/A'}` / "
            f"`{result.environment.edge_server or 'N/A'}`",
            "- Environment proxies: `disabled`",
        ]
    )
    return "\n".join(lines) + "\n"


def _write_artifacts(*, artifact_dir: Path, result: StagingPublicSmokeResult) -> None:
    result_payload = result.model_dump(mode="json")
    report = render_staging_public_markdown(result)
    validate_public_artifact_payload(result_payload)
    validate_public_artifact_text(report)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = artifact_dir / "logs"
    logs_dir.mkdir(exist_ok=True)
    (artifact_dir / "result.json").write_text(result.model_dump_json(indent=2), encoding="utf-8")
    (artifact_dir / "report.md").write_text(report, encoding="utf-8")
    (artifact_dir / "environment.json").write_text(
        result.environment.model_dump_json(indent=2),
        encoding="utf-8",
    )
    (artifact_dir / "cleanup.json").write_text(
        result.cleanup.model_dump_json(indent=2),
        encoding="utf-8",
    )
    (artifact_dir / "locust-stats.json").write_text(
        json.dumps(result.load.stats, indent=2, sort_keys=True, default=str),
        encoding="utf-8",
    )
    with (artifact_dir / "samples.jsonl").open("w", encoding="utf-8") as output:
        for sample in result.samples:
            output.write(sample.model_dump_json() + "\n")
    (logs_dir / "smoke-summary.log").write_text(
        f"status={result.status}\nsamples={len(result.samples)}\ncleanup_complete={result.cleanup.complete}\n",
        encoding="utf-8",
    )


def _sample_failure(sample: StagingPublicRunSample) -> str:
    details = sample.error_type or sample.error or sample.terminal_status
    return f"{sample.scenario_id} public E2E correctness failed: {details}"


def _number(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.2f}"


def _integer(value: int | None) -> str:
    return "N/A" if value is None else str(value)


__all__ = [
    "build_staging_public_environment",
    "finalize_staging_public_smoke",
    "render_staging_public_markdown",
]

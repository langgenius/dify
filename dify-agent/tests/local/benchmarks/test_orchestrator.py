import json
from pathlib import Path
import subprocess
from typing import Sequence

import pytest

from benchmarks.capacity import CapacityMatrixPoint
from benchmarks.orchestrator import (
    BenchmarkCommandError,
    CapacityOptions,
    _cleanup_e2b_allocation_journal,
    _driver_timeout_seconds,
    _finalize_block_result,
    _pin_target_image,
    _redact_secret_in_directory,
    _run_command,
    _services_for_point,
    _should_keep_failed_compose_project,
    _stop_compose_service_containers,
    _teardown_compose_project,
)
from benchmarks.scenario import load_scenario_manifest
from benchmarks.schemas import BlockResult, RedisSnapshot, RunOutcomeSummary


_AGENT_IMAGE_ID = f"sha256:{'a' * 64}"


def test_local_e2b_requires_credentials_and_selected_concurrency_limit() -> None:
    with pytest.raises(ValueError, match="API_KEY"):
        CapacityOptions(mode="local-e2b")

    with pytest.raises(ValueError, match="at least 20"):
        CapacityOptions(
            mode="local-e2b",
            e2b_api_key="secret",
            e2b_template="template",
            e2b_max_concurrency=10,
        )

    options = CapacityOptions(
        mode="local-e2b",
        e2b_api_key="secret",
        e2b_template="template",
        e2b_max_concurrency=10,
        concurrency=10,
    )
    assert "secret" not in repr(options)


def test_explicit_concurrency_accepts_positive_non_default_value() -> None:
    options = CapacityOptions(
        mode="local-e2b",
        e2b_api_key="secret",
        e2b_template="template",
        e2b_max_concurrency=20,
        concurrency=5,
    )

    assert options.concurrency == 5

    with pytest.raises(ValueError, match="positive"):
        CapacityOptions(mode="local-runtime", concurrency=0)


def test_built_target_image_gets_an_independent_frozen_tag(monkeypatch: pytest.MonkeyPatch) -> None:
    commands: list[list[str]] = []

    def run_command(command: Sequence[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
        commands.append(list(command))
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr("benchmarks.orchestrator._run_command", run_command)

    tag = _pin_target_image(_AGENT_IMAGE_ID, prefix="dify-agent-bench-frozen")

    assert tag == f"dify-agent-bench-frozen:{'a' * 64}"
    assert commands == [["docker", "image", "tag", _AGENT_IMAGE_ID, tag]]


def test_secret_redaction_covers_nested_text_artifacts(tmp_path: Path) -> None:
    nested = tmp_path / "logs"
    nested.mkdir()
    artifact = nested / "service.log"
    artifact.write_text("before e2b-secret after")

    _redact_secret_in_directory(tmp_path, "e2b-secret")

    assert artifact.read_text() == "before [redacted] after"


def test_basic_e2b_point_does_not_start_public_callback_proxy() -> None:
    manifest = load_scenario_manifest()
    basic = CapacityMatrixPoint(
        mode="local-e2b",
        scenario=manifest.get("basic"),
        requested_concurrency=1,
    )
    shell = basic.model_copy(update={"scenario": manifest.get("shell")})

    assert _services_for_point(basic) == ("redis", "fake-deps", "agent")
    assert _services_for_point(shell) == ("redis", "fake-deps", "agent", "agent-stub-proxy")


def test_driver_timeout_covers_locust_drain_and_resume_setup() -> None:
    manifest = load_scenario_manifest()
    basic = CapacityMatrixPoint(
        mode="local-runtime",
        scenario=manifest.get("basic"),
        requested_concurrency=10,
    )
    resume = basic.model_copy(update={"scenario": manifest.get("resume")})
    e2b_resume = resume.model_copy(update={"mode": "local-e2b"})

    assert _driver_timeout_seconds(basic) == 675
    assert _driver_timeout_seconds(resume) == 1095
    assert _driver_timeout_seconds(e2b_resume) == 885


def test_local_e2b_never_keeps_failed_compose_project() -> None:
    assert not _should_keep_failed_compose_project(
        mode="local-e2b",
        keep_containers=True,
        block_valid=False,
    )
    assert _should_keep_failed_compose_project(
        mode="local-runtime",
        keep_containers=True,
        block_valid=False,
    )
    assert not _should_keep_failed_compose_project(
        mode="local-runtime",
        keep_containers=True,
        block_valid=True,
    )


def test_finalization_error_preserves_real_block_result_as_invalid(tmp_path: Path) -> None:
    result = BlockResult(
        mode="local-e2b",
        scenario_id="basic",
        scenario_version=1,
        workload="basic",
        requested_concurrency=10,
        block_id="block",
        measurement_started_at_ns=1,
        measurement_ended_at_ns=2,
        elapsed_seconds=1,
        outcomes=RunOutcomeSummary(successful_runs=100),
        redis_before=RedisSnapshot(),
        redis_after=RedisSnapshot(),
        samples=[],
        valid=True,
    )

    _finalize_block_result(result=result, block_dir=tmp_path, errors=["Compose teardown failed"])

    persisted = BlockResult.model_validate_json((tmp_path / "block-result.json").read_text())
    assert not result.valid
    assert persisted.outcomes.successful_runs == 100
    assert persisted.invalid_reasons == ["Compose teardown failed"]


def test_finalization_error_without_result_still_fails_command(tmp_path: Path) -> None:
    with pytest.raises(BenchmarkCommandError, match="cleanup failed"):
        _finalize_block_result(result=None, block_dir=tmp_path, errors=["cleanup failed"])


def test_successful_finalization_persists_cleanup_evidence(tmp_path: Path) -> None:
    result = BlockResult(
        mode="local-e2b",
        scenario_id="basic",
        scenario_version=1,
        workload="basic",
        requested_concurrency=1,
        block_id="block",
        measurement_started_at_ns=1,
        measurement_ended_at_ns=2,
        elapsed_seconds=1,
        outcomes=RunOutcomeSummary(successful_runs=1),
        redis_before=RedisSnapshot(),
        redis_after=RedisSnapshot(),
        samples=[],
        cleanup={"host_e2b_allocations_destroyed": True},
        valid=True,
    )

    _finalize_block_result(result=result, block_dir=tmp_path, errors=[])

    persisted = BlockResult.model_validate_json((tmp_path / "block-result.json").read_text())
    assert persisted.cleanup == {"host_e2b_allocations_destroyed": True}
    assert persisted.valid


def test_host_cleanup_kills_only_unresolved_e2b_allocations(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    journal = tmp_path / ".e2b-allocations.jsonl"
    events = [
        {"binding_ref": "sandbox-1", "workspace_ref": "workspace-1", "state": "allocated"},
        {"binding_ref": "sandbox-2", "workspace_ref": "workspace-2", "state": "allocated"},
        {"binding_ref": "sandbox-1", "workspace_ref": "workspace-1", "state": "destroyed"},
    ]
    journal.write_text("".join(json.dumps(event) + "\n" for event in events))
    killed: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "benchmarks.orchestrator._kill_e2b_sandbox",
        lambda sandbox_id, *, api_key: killed.append((sandbox_id, api_key)),
    )

    cleanup_valid, evidence = _cleanup_e2b_allocation_journal(journal, api_key="e2b-secret")

    assert cleanup_valid
    assert killed == [("sandbox-2", "e2b-secret")]
    assert evidence == {
        "journal_found": True,
        "allocated_events": 2,
        "destroyed_events": 1,
        "unresolved_allocations": 1,
        "killed_allocations": 1,
        "parse_errors": 0,
        "kill_errors": 0,
        "orchestration_errors": 0,
    }
    assert "sandbox" not in json.dumps(evidence)
    assert not journal.exists()


def test_host_cleanup_retains_private_journal_when_kill_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    journal = tmp_path / ".e2b-allocations.jsonl"
    journal.write_text(
        json.dumps({"binding_ref": "sandbox-1", "workspace_ref": "workspace-1", "state": "allocated"}) + "\n"
    )

    def fail_kill(_sandbox_id: str, *, api_key: str) -> None:
        assert api_key == "e2b-secret"
        raise RuntimeError("vendor unavailable")

    monkeypatch.setattr("benchmarks.orchestrator._kill_e2b_sandbox", fail_kill)

    cleanup_valid, evidence = _cleanup_e2b_allocation_journal(journal, api_key="e2b-secret")

    assert not cleanup_valid
    assert evidence["kill_errors"] == 1
    assert journal.exists()
    assert journal.stat().st_mode & 0o777 == 0o600


def test_compose_teardown_checks_command_and_project_residuals(monkeypatch: pytest.MonkeyPatch) -> None:
    containers_present = True

    def fake_run_command(
        command: Sequence[str],
        **_kwargs: object,
    ) -> subprocess.CompletedProcess[str]:
        nonlocal containers_present
        if "down" in command:
            return subprocess.CompletedProcess(command, 1, "", "daemon error")
        if command[1:3] == ["container", "ls"]:
            output = "container-id\n" if containers_present else ""
            return subprocess.CompletedProcess(command, 0, output, "")
        if command[1:3] == ["container", "rm"]:
            containers_present = False
            return subprocess.CompletedProcess(command, 0, "container-id\n", "")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr("benchmarks.orchestrator._run_command", fake_run_command)

    with pytest.raises(BenchmarkCommandError, match="down exited"):
        _teardown_compose_project(
            compose=["docker", "compose", "-p", "bench-project"],
            project="bench-project",
            environment={},
        )
    assert not containers_present


def test_stop_compose_driver_containers_kills_lingering_one_offs(monkeypatch: pytest.MonkeyPatch) -> None:
    commands: list[list[str]] = []

    def fake_run_command(
        command: Sequence[str],
        **_kwargs: object,
    ) -> subprocess.CompletedProcess[str]:
        rendered = list(command)
        commands.append(rendered)
        if rendered[1:3] == ["container", "ls"]:
            return subprocess.CompletedProcess(rendered, 0, "driver-1\ndriver-2\n", "")
        return subprocess.CompletedProcess(rendered, 0, "", "")

    monkeypatch.setattr("benchmarks.orchestrator._run_command", fake_run_command)

    _stop_compose_service_containers(project="bench-project", service="driver", environment={})

    assert commands[-1] == ["docker", "container", "kill", "driver-1", "driver-2"]


def test_run_command_reports_timeout_output(monkeypatch: pytest.MonkeyPatch) -> None:
    def timeout(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
        raise subprocess.TimeoutExpired(["driver"], 12, output="partial output", stderr="partial error")

    monkeypatch.setattr(subprocess, "run", timeout)

    with pytest.raises(BenchmarkCommandError, match="timed out after 12s") as raised:
        _run_command(["driver"], timeout_seconds=12)
    assert "partial outputpartial error" in str(raised.value)

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
from pydantic import BaseModel, SecretStr

from benchmarks.staging_public_capacity_locust import (
    StagingPublicCapacityRequest,
    run_staging_public_capacity_point,
)
from benchmarks.staging_public_capacity_schemas import (
    StagingPublicCapacityExecution,
    StagingPublicCapacityLoadResult,
    StagingPublicCapacitySetupResult,
    StagingPublicCapacityUserCleanup,
)


class _Settings(BaseModel):
    service_api_base_url: str = "https://api-staging.example/v1/"
    api_key: SecretStr
    config_expected_sha256: str = "a" * 64


def _execution(*, concurrency: int = 1) -> StagingPublicCapacityExecution:
    return StagingPublicCapacityExecution(
        scenario_id="basic",
        requested_concurrency=concurrency,
        block_index=1,
        phase="initial",
        setup=StagingPublicCapacitySetupResult(
            attempted_users=concurrency,
            allocated_users=concurrency,
            successful_users=concurrency,
            complete=True,
        ),
        warmup_samples=[],
        observations=[],
        cleanup=[],
        load=StagingPublicCapacityLoadResult(
            requested_users=concurrency,
            spawned_users=concurrency,
            setup_ready_users=concurrency,
        ),
    )


def test_capacity_parent_uses_secret_free_wire_and_private_environment(monkeypatch) -> None:
    secret = "secret-never-write"
    observed: dict[str, object] = {}

    def fake_run(argv, **kwargs):
        request_path = Path(argv[argv.index("--request") + 1])
        result_path = Path(argv[argv.index("--result") + 1])
        observed["request"] = request_path.read_text(encoding="utf-8")
        observed["environment"] = kwargs["env"]
        result_path.write_text(_execution().model_dump_json(), encoding="utf-8")
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid")
    monkeypatch.setattr(subprocess, "run", fake_run)
    execution = run_staging_public_capacity_point(
        StagingPublicCapacityRequest(
            invocation_id="capacity-123",
            settings=_Settings(api_key=SecretStr(secret)),
            scenario_id="basic",
            requested_concurrency=1,
        )
    )

    assert execution == _execution()
    assert secret not in str(observed["request"])
    wire_request = json.loads(str(observed["request"]))
    assert wire_request["expected_backend_replicas"] == 1
    environment = observed["environment"]
    assert isinstance(environment, dict)
    assert environment["BENCH_STAGING_API_KEY"] == secret
    assert "HTTPS_PROXY" not in environment


@pytest.mark.parametrize("concurrency", [1, 2, 30, 160])
def test_capacity_parent_accepts_positive_dynamic_concurrency(concurrency: int) -> None:
    request = StagingPublicCapacityRequest(
        invocation_id="capacity-dynamic",
        settings=_Settings(api_key=SecretStr("secret")),
        scenario_id="basic",
        requested_concurrency=concurrency,
    )

    assert request.requested_concurrency == concurrency


@pytest.mark.parametrize("concurrency", [False, 0, 161])
def test_capacity_parent_rejects_concurrency_outside_safe_range(concurrency: int) -> None:
    with pytest.raises(ValueError, match="integer from 1 through 160"):
        StagingPublicCapacityRequest(
            invocation_id="capacity-invalid",
            settings=_Settings(api_key=SecretStr("secret")),
            scenario_id="basic",
            requested_concurrency=concurrency,
        )


def test_capacity_parent_wires_expected_backend_replicas_without_claiming_observation(monkeypatch) -> None:
    observed: dict[str, object] = {}

    def fake_run(argv, **_kwargs):
        request_path = Path(argv[argv.index("--request") + 1])
        result_path = Path(argv[argv.index("--result") + 1])
        observed["request"] = json.loads(request_path.read_text(encoding="utf-8"))
        result_path.write_text(_execution(concurrency=30).model_dump_json(), encoding="utf-8")
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    execution = run_staging_public_capacity_point(
        StagingPublicCapacityRequest(
            invocation_id="capacity-replicas",
            settings=_Settings(api_key=SecretStr("secret")),
            scenario_id="basic",
            requested_concurrency=30,
            expected_backend_replicas=4,
        )
    )

    assert execution.backend_replicas is None
    wire = observed["request"]
    assert isinstance(wire, dict)
    assert wire["requested_concurrency"] == 30
    assert wire["expected_backend_replicas"] == 4


def test_capacity_parent_persists_private_manifest_with_restricted_permissions(
    monkeypatch, tmp_path: Path
) -> None:
    conversation_id = "private-conversation"
    secret = "secret-never-persist"
    manifest_path = tmp_path / "private" / "allocation-manifest.jsonl"
    manifest_path.parent.mkdir()

    def fake_run(argv, **_kwargs):
        observed_argv.extend(argv)
        journal_path = Path(argv[argv.index("--journal") + 1])
        result_path = Path(argv[argv.index("--result") + 1])
        journal_path.write_text(
            json.dumps({"event": "allocated", "worker_index": 0, "conversation_id": conversation_id}) + "\n",
            encoding="utf-8",
        )
        result_path.write_text(_execution().model_dump_json(), encoding="utf-8")
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

    observed_argv: list[str] = []
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(
        "benchmarks.staging_public_capacity_locust._delete_conversation",
        lambda **_kwargs: pytest.fail("normal worker completion must not trigger fallback DELETE"),
    )
    execution = run_staging_public_capacity_point(
        StagingPublicCapacityRequest(
            invocation_id="capacity-manifest",
            settings=_Settings(api_key=SecretStr(secret)),
            scenario_id="basic",
            requested_concurrency=1,
            private_manifest_output=manifest_path,
        )
    )

    manifest = manifest_path.read_text(encoding="utf-8")
    assert conversation_id in manifest
    assert secret not in manifest
    assert manifest_path.stat().st_mode & 0o777 == 0o600
    assert str(manifest_path) not in observed_argv
    assert conversation_id not in execution.model_dump_json()
    assert execution.cleanup == []


def test_capacity_parent_recovers_with_exact_worker_end_user(monkeypatch) -> None:
    conversation_id = "private-conversation"

    def fake_run(argv, **_kwargs):
        journal_path = Path(argv[argv.index("--journal") + 1])
        journal_path.write_text(
            json.dumps({"event": "allocated", "worker_index": 0, "conversation_id": conversation_id}) + "\n",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(argv, 2, stdout="", stderr="")

    deleted: list[tuple[str, str]] = []

    def fake_delete(**kwargs):
        deleted.append((kwargs["end_user"], kwargs["conversation_id"]))
        return StagingPublicCapacityUserCleanup(
            worker_index=0,
            attempted=True,
            http_status_code=204,
            conversation_deleted=True,
            complete=True,
            recovered_by_parent=True,
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr("benchmarks.staging_public_capacity_locust._delete_conversation", fake_delete)
    execution = run_staging_public_capacity_point(
        StagingPublicCapacityRequest(
            invocation_id="capacity-123",
            settings=_Settings(api_key=SecretStr("secret")),
            scenario_id="basic",
            requested_concurrency=1,
            block_index=1,
        )
    )

    assert deleted == [("dify-bench-capacity-123.b1.w0", conversation_id)]
    assert execution.cleanup[0].complete is True
    assert execution.cleanup[0].recovered_by_parent is True
    assert execution.load.fatal_errors
    assert conversation_id not in execution.model_dump_json()


def test_capacity_parent_preserves_crash_journal_for_outer_physical_cleanup(
    monkeypatch, tmp_path: Path
) -> None:
    conversation_id = "private-conversation"
    manifest_path = tmp_path / "private" / "allocation-manifest.jsonl"
    manifest_path.parent.mkdir()

    def fake_run(argv, **_kwargs):
        journal_path = Path(argv[argv.index("--journal") + 1])
        journal_path.write_text(
            json.dumps({"event": "allocated", "worker_index": 0, "conversation_id": conversation_id})
            + "\n",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(argv, 2, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(
        "benchmarks.staging_public_capacity_locust._delete_conversation",
        lambda **_kwargs: pytest.fail("outer physical reconciler must DELETE after DB capture"),
    )
    execution = run_staging_public_capacity_point(
        StagingPublicCapacityRequest(
            invocation_id="capacity-crash",
            settings=_Settings(api_key=SecretStr("secret")),
            scenario_id="basic",
            requested_concurrency=1,
            private_manifest_output=manifest_path,
        )
    )

    assert execution.cleanup == []
    assert execution.setup.attempted_users == 1
    assert execution.setup.allocated_users == 1
    assert execution.load.fatal_errors
    assert conversation_id in manifest_path.read_text(encoding="utf-8")
    assert conversation_id not in execution.model_dump_json()


def test_capacity_parent_preserves_interrupted_worker_journal_for_outer_physical_cleanup(
    monkeypatch, tmp_path: Path
) -> None:
    conversation_id = "private-interrupted-conversation"
    manifest_path = tmp_path / "private" / "allocation-manifest.jsonl"
    manifest_path.parent.mkdir()

    def fake_run(argv, **_kwargs):
        journal_path = Path(argv[argv.index("--journal") + 1])
        journal_path.write_text(
            json.dumps({"event": "allocated", "worker_index": 0, "conversation_id": conversation_id})
            + "\n",
            encoding="utf-8",
        )
        raise KeyboardInterrupt

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(
        "benchmarks.staging_public_capacity_locust._delete_conversation",
        lambda **_kwargs: pytest.fail("outer physical reconciler must DELETE after DB capture"),
    )

    execution = run_staging_public_capacity_point(
        StagingPublicCapacityRequest(
            invocation_id="capacity-interrupted",
            settings=_Settings(api_key=SecretStr("secret")),
            scenario_id="basic",
            requested_concurrency=1,
            private_manifest_output=manifest_path,
        )
    )

    assert execution.cleanup == []
    assert execution.setup.attempted_users == 1
    assert execution.setup.allocated_users == 1
    assert "isolated public capacity worker was interrupted" in execution.load.fatal_errors
    assert conversation_id in manifest_path.read_text(encoding="utf-8")
    assert manifest_path.stat().st_mode & 0o777 == 0o600
    assert conversation_id not in execution.model_dump_json()


def test_capacity_parent_does_not_recover_a_graceful_invalid_worker(monkeypatch) -> None:
    deleted = False

    def fake_run(argv, **_kwargs):
        journal_path = Path(argv[argv.index("--journal") + 1])
        result_path = Path(argv[argv.index("--result") + 1])
        journal_path.write_text(
            json.dumps({"event": "allocated", "worker_index": 0, "conversation_id": "private"}) + "\n",
            encoding="utf-8",
        )
        execution = _execution().model_copy(
            update={
                "setup": StagingPublicCapacitySetupResult(
                    attempted_users=1,
                    successful_users=0,
                    complete=False,
                    errors=["setup failed"],
                )
            }
        )
        result_path.write_text(execution.model_dump_json(), encoding="utf-8")
        return subprocess.CompletedProcess(argv, 1, stdout="", stderr="")

    def fake_delete(**_kwargs):
        nonlocal deleted
        deleted = True
        raise AssertionError("gracefully completed worker must be reconciled outside the facade")

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr("benchmarks.staging_public_capacity_locust._delete_conversation", fake_delete)
    execution = run_staging_public_capacity_point(
        StagingPublicCapacityRequest(
            invocation_id="capacity-invalid",
            settings=_Settings(api_key=SecretStr("secret")),
            scenario_id="basic",
            requested_concurrency=1,
        )
    )

    assert deleted is False
    assert execution.cleanup == []
    assert execution.setup.complete is False


def test_capacity_worker_imports_locust_in_clean_interpreter() -> None:
    environment = dict(os.environ)
    environment.pop("LOCUST_SKIP_MONKEY_PATCH", None)
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        environment.pop(key, None)
    process = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "benchmarks.staging_public_capacity_worker", "--help"],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
        env=environment,
    )
    assert process.returncode == 0, process.stderr
    assert "--journal" in process.stdout


def test_capacity_worker_spawns_setup_users_at_one_per_second(tmp_path: Path) -> None:
    script = r'''
from pathlib import Path
import benchmarks.staging_public_capacity_worker as worker
from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityPointRequest

observed = {}
class FakeStats:
    total = type("Total", (), {"serialize": lambda self: {}})()
    def reset_all(self): pass
    def serialize_stats(self): return []
    def serialize_errors(self): return []
class FakeGreenlet:
    def join(self, *, timeout): pass
class FakeRunner:
    greenlet = FakeGreenlet()
    def __init__(self, state): self.state = state
    def start(self, *, user_count, spawn_rate):
        observed["start"] = (user_count, spawn_rate)
        self.state.spawned_users = user_count
        self.state.setup_attempted = user_count
        self.state.setup_ready = user_count
        self.state.setup_finished = user_count
        self.state._worker_conversation = {
            index: f"private-conversation-{index}" for index in range(user_count)
        }
        self.state.setup_done.set()
        self.state.warmup_finished_users = user_count
        self.state.warmup_done.set()
        self.state.measurement_finished_users = user_count
        self.state.measurement_done.set()
        self.state.closed_clients = set(range(user_count))
        self.state.cleanup_done.set()
    def quit(self): pass
class FakeEnvironment:
    def __init__(self, *, user_classes, catch_exceptions):
        assert catch_exceptions is False
        self.state = user_classes[0].worker_state
        self.stats = FakeStats()
    def create_local_runner(self): return FakeRunner(self.state)

worker.Environment = FakeEnvironment
request = StagingPublicCapacityPointRequest(
    invocation_id="capacity.spawn-rate", service_api_base_url="https://api-staging.example/v1/",
    config_expected_sha256="a" * 64, scenario_id="basic", requested_concurrency=2,
    block_index=1, phase="initial", setup_timeout_seconds=1,
    warmup_seconds=0.001, measurement_seconds=0.001, drain_timeout_seconds=1,
)
worker.run_worker(request, api_key="not-real", journal_path=Path(__import__('sys').argv[1]))
assert observed["start"] == (2, 1.0)
'''
    environment = dict(os.environ)
    environment.pop("LOCUST_SKIP_MONKEY_PATCH", None)
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        environment.pop(key, None)
    process = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script, str(tmp_path / "journal.jsonl")],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
        env=environment,
        timeout=10,
    )
    assert process.returncode == 0, process.stderr


def test_capacity_worker_runs_closed_loop_phases_and_unique_conversations(tmp_path: Path) -> None:
    script = r'''
from pathlib import Path
import json
import gevent
import benchmarks.staging_public_capacity_worker as worker
from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityPointRequest
from benchmarks.staging_public_schemas import StagingPublicRunSample

end_users = set()
calls = {}
closed = set()
class Observation:
    def __init__(self, sample): self.sample = sample
class FakeClient:
    def __init__(self, *, end_user, conversation_lifecycle, **_kwargs):
        assert end_user not in end_users
        end_users.add(end_user)
        self.end_user = end_user
        self.lifecycle = conversation_lifecycle
        self.conversation = f"conversation-{len(end_users)}"
        self.allocated = False
        calls[end_user] = []
    def run_once(self, *, benchmark_run_id, scenario_id, scenario_version):
        assert scenario_version == 1
        if not self.allocated:
            self.lifecycle("allocated", self.conversation)
            self.allocated = True
        calls[self.end_user].append(scenario_id)
        gevent.sleep(0.02)
        return Observation(StagingPublicRunSample(
            scenario_id=scenario_id, benchmark_run_id=benchmark_run_id,
            admitted=True, http_status_code=200, conversation_reused=len(calls[self.end_user]) > 1,
            response_headers_ms=1, time_to_first_sse_ms=1, time_to_first_answer_ms=1,
            terminal_e2e_ms=20, event_count=1, terminal_status="succeeded",
            deterministic_markers_valid=True,
            shell_evidence_valid=scenario_id == "shell",
            config_materialized_item_count=13 if scenario_id == "config" else 0,
            config_materialized_bytes=53248 if scenario_id == "config" else 0,
            config_materialized_sha256="a" * 64 if scenario_id == "config" else None,
            config_sha_valid=scenario_id == "config",
        ))
    def cleanup_conversation(self): raise AssertionError("worker must not DELETE Conversation")
    def close(self): closed.add(self.end_user)

worker.StagingPublicServiceClient = FakeClient
request = StagingPublicCapacityPointRequest(
    invocation_id="capacity.config.c10", service_api_base_url="https://api-staging.example/v1/",
    config_expected_sha256="a" * 64, scenario_id="config", requested_concurrency=10,
    block_index=1, phase="initial", setup_timeout_seconds=10,
    warmup_seconds=0.08, measurement_seconds=0.10, drain_timeout_seconds=10,
)
execution = worker.run_worker(request, api_key="not-real", journal_path=Path(__import__('sys').argv[1]))
assert len(end_users) == 10
assert execution.setup.complete
assert len(execution.warmup_samples) >= 10
assert len(execution.observations) >= 10
assert execution.load.observed_max_active == 10
assert 0 < execution.load.active_mean <= 10
assert execution.load.measurement_started_at is not None
assert execution.load.measurement_ended_at is not None
assert execution.load.measurement_started_at.tzinfo is not None
assert execution.load.measurement_ended_at >= execution.load.measurement_started_at
assert execution.load.attempted == len(execution.observations)
assert execution.load.successful == len(execution.observations)
assert all(item.sample.scenario_id == "config" for item in execution.observations)
assert all(item.turn_index >= 0 for item in execution.observations)
run_ids = [item.sample.benchmark_run_id for item in execution.observations]
assert len(run_ids) == len(set(run_ids))
assert execution.cleanup == []
assert execution.physical_cleanup.complete is False
assert len(closed) == 10
assert all(sequence[:2] == ["basic", "shell"] for sequence in calls.values())
events = [json.loads(line) for line in Path(__import__('sys').argv[1]).read_text().splitlines()]
assert len(events) == 10 and all(item["event"] == "allocated" for item in events)
assert Path(__import__('sys').argv[1]).stat().st_mode & 0o777 == 0o600
'''
    environment = dict(os.environ)
    environment.pop("LOCUST_SKIP_MONKEY_PATCH", None)
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        environment.pop(key, None)
    process = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script, str(tmp_path / "journal.jsonl")],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
        env=environment,
        timeout=20,
    )
    assert process.returncode == 0, process.stderr


def test_capacity_worker_never_reuses_conversation_after_failed_turn(tmp_path: Path) -> None:
    script = r'''
from pathlib import Path
import benchmarks.staging_public_capacity_worker as worker
from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityPointRequest
from benchmarks.staging_public_schemas import StagingPublicRunSample
class Observation:
    def __init__(self, sample): self.sample = sample
class FakeClient:
    calls = 0
    closed = 0
    def __init__(self, *, conversation_lifecycle, **_kwargs): self.lifecycle = conversation_lifecycle
    def run_once(self, *, benchmark_run_id, scenario_id, scenario_version):
        self.__class__.calls += 1
        if self.calls == 1: self.lifecycle("allocated", "private-conversation")
        succeeded = self.calls == 1
        return Observation(StagingPublicRunSample(
            scenario_id=scenario_id, benchmark_run_id=benchmark_run_id,
            admitted=True, http_status_code=200, conversation_reused=self.calls > 1,
            response_headers_ms=1, time_to_first_sse_ms=1, time_to_first_answer_ms=1,
            terminal_e2e_ms=1, event_count=1,
            terminal_status="succeeded" if succeeded else "failed",
            deterministic_markers_valid=succeeded,
            error_type=None if succeeded else "validation_error",
            error=None if succeeded else "marker mismatch",
        ))
    def cleanup_conversation(self): raise AssertionError("worker must not DELETE Conversation")
    def close(self): self.__class__.closed += 1
worker.StagingPublicServiceClient = FakeClient
request = StagingPublicCapacityPointRequest(
    invocation_id="capacity.failed-user", service_api_base_url="https://api-staging.example/v1/",
    config_expected_sha256="a" * 64, scenario_id="basic", requested_concurrency=1,
    block_index=1, phase="initial", setup_timeout_seconds=2,
    warmup_seconds=0.03, measurement_seconds=0.03, drain_timeout_seconds=2,
)
execution = worker.run_worker(request, api_key="not-real", journal_path=Path(__import__('sys').argv[1]))
assert FakeClient.calls == 2
assert len(execution.warmup_samples) == 1
assert execution.load.warmup_attempted == 1
assert execution.load.warmup_completed == 0
assert execution.observations == []
assert execution.cleanup == []
assert FakeClient.closed == 1
'''
    environment = dict(os.environ)
    environment.pop("LOCUST_SKIP_MONKEY_PATCH", None)
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        environment.pop(key, None)
    process = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script, str(tmp_path / "journal.jsonl")],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
        env=environment,
        timeout=10,
    )
    assert process.returncode == 0, process.stderr


def test_capacity_worker_stops_admission_after_first_correctness_failure(tmp_path: Path) -> None:
    script = r'''
from pathlib import Path
from pydantic import SecretStr
import benchmarks.staging_public_capacity_worker as worker
from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityPointRequest
from benchmarks.staging_public_protocol import StagingPublicProtocolSettings
from benchmarks.staging_public_schemas import StagingPublicRunSample
request = StagingPublicCapacityPointRequest(
    invocation_id="capacity.correctness-stop", service_api_base_url="https://api-staging.example/v1/",
    config_expected_sha256="a" * 64, scenario_id="basic", requested_concurrency=10,
    setup_timeout_seconds=2, warmup_seconds=1, measurement_seconds=1, drain_timeout_seconds=2,
)
journal = worker._AllocationJournal(Path(__import__('sys').argv[1]))
state = worker._WorkerState(
    request,
    StagingPublicProtocolSettings(
        service_api_base_url=request.service_api_base_url,
        api_key=SecretStr("not-real"),
        config_expected_sha256=request.config_expected_sha256,
    ),
    journal,
)
try:
    capacity_state = worker._WorkerState(
        request,
        StagingPublicProtocolSettings(
            service_api_base_url=request.service_api_base_url,
            api_key=SecretStr("not-real"),
            config_expected_sha256=request.config_expected_sha256,
        ),
        journal,
    )
    for index in range(3):
        capacity_state._record_outcome(StagingPublicRunSample(
            scenario_id="basic", benchmark_run_id=f"timeout-{index}", error_type="timeout",
            error="request timed out",
        ), phase="warmup")
        assert capacity_state.abort_admission.is_set() is (index == 2)
    assert capacity_state.warmup_peak_consecutive_capacity_failures == 3
    state._record_outcome(StagingPublicRunSample(
        scenario_id="basic", benchmark_run_id="run-1", error_type="validation_error",
        error="marker mismatch",
    ))
    assert state.abort_admission.is_set()
finally:
    journal.close()
'''
    environment = dict(os.environ)
    environment.pop("LOCUST_SKIP_MONKEY_PATCH", None)
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        environment.pop(key, None)
    process = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script, str(tmp_path / "journal.jsonl")],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
        env=environment,
        timeout=10,
    )
    assert process.returncode == 0, process.stderr


def test_capacity_worker_counts_isolated_warmup_failure_without_measurement(
    tmp_path: Path,
) -> None:
    script = r'''
from pathlib import Path
import benchmarks.staging_public_capacity_worker as worker
from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityPointRequest
from benchmarks.staging_public_schemas import StagingPublicRunSample
class Observation:
    def __init__(self, sample): self.sample = sample
class FakeClient:
    calls = 0
    def __init__(self, *, conversation_lifecycle, **_kwargs): self.lifecycle = conversation_lifecycle
    def run_once(self, *, benchmark_run_id, scenario_id, scenario_version):
        self.__class__.calls += 1
        if self.calls == 1:
            self.lifecycle("allocated", "private-conversation")
        succeeded = self.calls == 1
        return Observation(StagingPublicRunSample(
            scenario_id=scenario_id, benchmark_run_id=benchmark_run_id,
            admitted=True, http_status_code=200,
            terminal_status="succeeded" if succeeded else "not_terminal",
            response_headers_ms=1 if succeeded else None,
            time_to_first_sse_ms=1 if succeeded else None,
            time_to_first_answer_ms=1 if succeeded else None,
            terminal_e2e_ms=1 if succeeded else None, event_count=2 if succeeded else 0,
            deterministic_markers_valid=succeeded,
            error_type=None if succeeded else "timeout",
            error=None if succeeded else "request timed out",
        ))
    def close(self): pass
worker.StagingPublicServiceClient = FakeClient
request = StagingPublicCapacityPointRequest(
    invocation_id="capacity.warmup-boundary", service_api_base_url="https://api-staging.example/v1/",
    config_expected_sha256="a" * 64, scenario_id="basic", requested_concurrency=1,
    setup_timeout_seconds=2, warmup_seconds=0.03, measurement_seconds=0.03, drain_timeout_seconds=2,
)
execution = worker.run_worker(request, api_key="not-real", journal_path=Path(__import__('sys').argv[1]))
assert execution.load.warmup_attempted >= 1, execution.load
assert execution.load.warmup_completed == execution.load.warmup_attempted - 1, execution.load
assert execution.load.warmup_operational_failures == 1, execution.load
assert execution.load.warmup_correctness_failures == 0
assert execution.load.warmup_peak_consecutive_operational_failures == 1
assert execution.load.measurement_started_at is None
assert execution.observations == []
'''
    environment = dict(os.environ)
    environment.pop("LOCUST_SKIP_MONKEY_PATCH", None)
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        environment.pop(key, None)
    process = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script, str(tmp_path / "journal.jsonl")],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
        env=environment,
        timeout=10,
    )
    assert process.returncode == 0, process.stderr


def test_capacity_cleanup_gate_waits_for_every_requested_user_after_early_setup_failure(tmp_path: Path) -> None:
    script = r'''
from pathlib import Path
import benchmarks.staging_public_capacity_worker as worker
from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityPointRequest
from benchmarks.staging_public_schemas import StagingPublicRunSample
class Observation:
    def __init__(self, sample): self.sample = sample
class FakeClient:
    created = 0
    closed = 0
    def __init__(self, *, conversation_lifecycle, **_kwargs):
        self.index = self.__class__.created; self.__class__.created += 1
        self.lifecycle = conversation_lifecycle; self.conversation = f"conversation-{self.index}"
    def run_once(self, *, benchmark_run_id, scenario_id, scenario_version):
        self.lifecycle("allocated", self.conversation)
        ok = self.index != 0
        return Observation(StagingPublicRunSample(
            scenario_id=scenario_id, benchmark_run_id=benchmark_run_id,
            admitted=True, http_status_code=200, response_headers_ms=1,
            time_to_first_sse_ms=1, time_to_first_answer_ms=1, terminal_e2e_ms=1,
            event_count=1, terminal_status="succeeded" if ok else "failed",
            deterministic_markers_valid=ok, error_type=None if ok else "validation_error",
            error=None if ok else "setup marker mismatch",
        ))
    def cleanup_conversation(self): raise AssertionError("worker must not DELETE Conversation")
    def close(self): self.__class__.closed += 1
worker.StagingPublicServiceClient = FakeClient
request = StagingPublicCapacityPointRequest(
    invocation_id="capacity.setup-fail", service_api_base_url="https://api-staging.example/v1/",
    config_expected_sha256="a" * 64, scenario_id="basic", requested_concurrency=10,
    block_index=1, phase="initial", setup_timeout_seconds=10,
    warmup_seconds=0.02, measurement_seconds=0.02, drain_timeout_seconds=10,
)
execution = worker.run_worker(request, api_key="not-real", journal_path=Path(__import__('sys').argv[1]))
assert execution.setup.complete is False
assert execution.setup.attempted_users == 1
assert execution.setup.allocated_users == 1
assert execution.load.spawned_users == 10
assert execution.cleanup == []
assert FakeClient.closed == 10
'''
    environment = dict(os.environ)
    environment.pop("LOCUST_SKIP_MONKEY_PATCH", None)
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        environment.pop(key, None)
    process = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script, str(tmp_path / "journal.jsonl")],
        cwd=Path(__file__).resolve().parents[3],
        capture_output=True,
        text=True,
        check=False,
        env=environment,
        timeout=20,
    )
    assert process.returncode == 0, process.stderr

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import threading
import time

from benchmarks import capacity_driver
from benchmarks.capacity_driver import (
    CapacityDriverSettings,
    _execute_load_phase,
    _load_subprocess_environment,
    _write_redacted_contexts,
)
from benchmarks.capacity_protocol import CapacityObservation
from benchmarks.load_phase import LoadPhaseRequest, LoadPhaseResult, WorkerContext


def test_parent_driver_does_not_import_locust() -> None:
    assert "locust" not in sys.modules


def test_locust_is_the_only_capacity_load_engine() -> None:
    assert "load_engine" not in CapacityDriverSettings.__dataclass_fields__
    assert not hasattr(capacity_driver, "_run_timed")
    assert "benchmarks.locust_load" in capacity_driver._execute_load_phase.__code__.co_consts
    assert not (Path(capacity_driver.__file__).parent / "parity.py").exists()


def test_phase_request_requires_exactly_one_limit(tmp_path: Path) -> None:
    common = {
        "mode": "local-runtime",
        "phase": "measurement",
        "agent_url": "http://agent",
        "fake_deps_url": "http://fake",
        "scenario_id": "basic",
        "block_id": "block",
        "contexts_path": tmp_path / "contexts.json",
        "observations_path": tmp_path / "observations.jsonl",
        "active_runs_path": tmp_path / "active-runs.json",
        "stats_path": tmp_path / "stats.json",
        "result_path": tmp_path / "result.json",
        "sequence_stride": 2,
    }

    request = LoadPhaseRequest.model_validate({**common, "duration_seconds": 1})

    assert request.duration_seconds == 1
    try:
        LoadPhaseRequest.model_validate(common)
    except ValueError:
        pass
    else:
        raise AssertionError("phase request without a limit was accepted")


def test_child_environment_excludes_e2b_secrets(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("BENCH_E2B_API_KEY", "bench-secret")
    monkeypatch.setenv("DIFY_AGENT_E2B_API_KEY", "agent-secret")
    monkeypatch.setenv("LOCUST_SKIP_MONKEY_PATCH", "1")
    monkeypatch.setenv("PYTHONPATH", "/safe/path")

    environment = _load_subprocess_environment()

    assert environment["PYTHONPATH"] == "/safe/path"
    assert "BENCH_E2B_API_KEY" not in environment
    assert "DIFY_AGENT_E2B_API_KEY" not in environment
    assert "LOCUST_SKIP_MONKEY_PATCH" not in environment


def test_public_worker_context_is_redacted(tmp_path: Path) -> None:
    output = tmp_path / "worker-context.redacted.json"

    _write_redacted_contexts(
        output,
        [
            WorkerContext(
                worker_index=0,
                binding_ref="secret-sandbox-id",
                session_snapshot={"secret": "snapshot"},
            )
        ],
    )

    text = output.read_text()
    assert "secret-sandbox-id" not in text
    assert '"secret": "snapshot"' not in text
    assert json.loads(text) == [{"has_binding": True, "has_session_snapshot": True, "worker_index": 0}]


class _SseHandler(BaseHTTPRequestHandler):
    run_count = 0
    sse_delay_seconds = 0.1
    count_lock = threading.Lock()

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("content-length", "0"))
        self.rfile.read(content_length)
        if self.path == "/__bench/prepare":
            self._json_response({"status": "prepared"})
            return
        if self.path == "/runs":
            with self.count_lock:
                type(self).run_count += 1
                run_id = f"run-{type(self).run_count}"
            self._json_response({"run_id": run_id})
            return
        self.send_error(404)

    def do_GET(self) -> None:  # noqa: N802
        if not self.path.endswith("/events/sse"):
            self.send_error(404)
            return
        time.sleep(type(self).sse_delay_seconds)
        body = ('data: {"id":"1-0","type":"run_succeeded","data":{"session_snapshot":{"version":1}}}\n\n').encode()
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *_args: object) -> None:
        del format
        return

    def _json_response(self, payload: object) -> None:
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def test_locust_subprocess_runs_two_users_concurrently(tmp_path: Path) -> None:
    _SseHandler.run_count = 0
    _SseHandler.sse_delay_seconds = 0.1
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SseHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    settings = CapacityDriverSettings(
        mode="local-runtime",
        agent_url=origin,
        runtime_url=origin,
        fake_deps_url=origin,
        redis_url="redis://unused",
        redis_prefix="prefix",
        results_dir=tmp_path,
        scenario_id="basic",
        block_id="block",
        concurrency=2,
        warmup_seconds=0,
        measurement_seconds=1,
    )

    async def exercise() -> tuple[LoadPhaseResult, list[CapacityObservation]]:
        return await _execute_load_phase(
            settings=settings,
            contexts=[WorkerContext(worker_index=0), WorkerContext(worker_index=1)],
            phase="resume-setup",
            private_dir=tmp_path / "private",
            iterations_per_user=1,
            stats_path=tmp_path / "stats.json",
        )

    (tmp_path / "private").mkdir()
    try:
        phase, observations = asyncio.run(exercise())
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)

    assert phase.spawned_users == 2
    assert phase.observed_max_active == 2
    assert phase.observation_count == 2
    assert phase.composite_request is not None
    assert phase.composite_request.request_count == 2
    assert phase.composite_request.failure_count == 0
    assert phase.elapsed_seconds < 0.19
    assert len(observations) == 2
    assert {item.sample.worker_index for item in observations} == {0, 1}
    active_journal = (tmp_path / "private" / "resume-setup-active-runs.jsonl").read_text().splitlines()
    active_states = [json.loads(line)["state"] for line in active_journal]
    assert active_states.count("admitted") == 2
    assert active_states.count("terminal") == 2
    assert len((tmp_path / "private" / "resume-setup-observations.jsonl").read_text().splitlines()) == 2
    stats = json.loads((tmp_path / "stats.json").read_text())
    assert {"entries", "errors", "total"} <= stats.keys()
    assert any(entry["method"] == "AGENT_RUN" and entry["name"] == "basic" for entry in stats["entries"])
    child_log = (tmp_path / "locust-resume-setup.log").read_text()
    assert "greenlet is being finalized" not in child_log
    assert "gevent.exceptions.LoopExit" not in child_log


def test_phase_deadline_stops_admission_but_drains_active_run(tmp_path: Path) -> None:
    _SseHandler.run_count = 0
    _SseHandler.sse_delay_seconds = 0.12
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SseHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    settings = CapacityDriverSettings(
        mode="local-runtime",
        agent_url=origin,
        runtime_url=origin,
        fake_deps_url=origin,
        redis_url="redis://unused",
        redis_prefix="prefix",
        results_dir=tmp_path,
        scenario_id="basic",
        block_id="block",
        concurrency=1,
        warmup_seconds=0,
        measurement_seconds=1,
    )

    async def exercise() -> tuple[LoadPhaseResult, list[CapacityObservation]]:
        return await _execute_load_phase(
            settings=settings,
            contexts=[WorkerContext(worker_index=0)],
            phase="measurement",
            private_dir=tmp_path / "private",
            duration_seconds=0.05,
            stats_path=tmp_path / "stats.json",
        )

    (tmp_path / "private").mkdir()
    try:
        phase, observations = asyncio.run(exercise())
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)

    assert _SseHandler.run_count == 1
    assert len(observations) == 1
    assert observations[0].sample.terminal_status == "succeeded"
    assert phase.elapsed_seconds >= 0.1
    assert phase.drain_seconds > 0
    assert not phase.timed_out
    assert phase.fatal_errors == []


def test_on_start_failure_is_reported_as_fatal(tmp_path: Path) -> None:
    settings = CapacityDriverSettings(
        mode="local-runtime",
        agent_url="http://unused",
        runtime_url="http://unused",
        fake_deps_url="http://unused",
        redis_url="redis://unused",
        redis_prefix="prefix",
        results_dir=tmp_path,
        scenario_id="unknown-scenario",
        block_id="block",
        concurrency=1,
        warmup_seconds=0,
        measurement_seconds=1,
    )

    async def exercise() -> tuple[LoadPhaseResult, list[CapacityObservation]]:
        return await _execute_load_phase(
            settings=settings,
            contexts=[WorkerContext(worker_index=0)],
            phase="resume-setup",
            private_dir=tmp_path / "private",
            iterations_per_user=1,
            stats_path=tmp_path / "stats.json",
        )

    (tmp_path / "private").mkdir()
    phase, observations = asyncio.run(exercise())

    assert observations == []
    assert not phase.timed_out
    assert any("unknown capacity scenario" in error for error in phase.fatal_errors)


def test_observation_persistence_failure_stops_user_without_drain_timeout(tmp_path: Path) -> None:
    _SseHandler.run_count = 0
    _SseHandler.sse_delay_seconds = 0.01
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SseHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    request = _phase_request(tmp_path, origin=origin)
    script = """
from pathlib import Path
import sys

from benchmarks import locust_load

def fail_persistence(state, observation):
    raise OSError("synthetic observation persistence failure")

locust_load._PhaseState.record_observation = fail_persistence
request = locust_load.LoadPhaseRequest.model_validate_json(Path(sys.argv[1]).read_text())
result = locust_load.run_load_phase(request)
raise SystemExit(1 if result.timed_out or result.fatal_errors else 0)
"""

    try:
        completed = subprocess.run(
            [sys.executable, "-c", script, str(tmp_path / "request.json")],
            cwd=Path(__file__).resolve().parents[3],
            env=_load_subprocess_environment(),
            check=False,
            capture_output=True,
            timeout=10,
        )
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)
    phase = LoadPhaseResult.model_validate_json(request.result_path.read_text())

    assert completed.returncode == 1
    assert not phase.timed_out
    assert any("synthetic observation persistence failure" in error for error in phase.fatal_errors)


def test_phase_elapsed_excludes_slow_user_teardown(tmp_path: Path) -> None:
    _SseHandler.run_count = 0
    _SseHandler.sse_delay_seconds = 0.05
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SseHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    request = _phase_request(tmp_path, origin=origin)
    script = """
from pathlib import Path
import sys
import time

from benchmarks import locust_load
import httpx

original_close = httpx.Client.close

def slow_close(client):
    time.sleep(0.25)
    original_close(client)

httpx.Client.close = slow_close
request = locust_load.LoadPhaseRequest.model_validate_json(Path(sys.argv[1]).read_text())
result = locust_load.run_load_phase(request)
raise SystemExit(1 if result.timed_out or result.fatal_errors else 0)
"""

    started = time.perf_counter()
    try:
        completed = subprocess.run(
            [sys.executable, "-c", script, str(tmp_path / "request.json")],
            cwd=Path(__file__).resolve().parents[3],
            env=_load_subprocess_environment(),
            check=False,
            capture_output=True,
            timeout=10,
        )
        subprocess_elapsed = time.perf_counter() - started
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)
    phase = LoadPhaseResult.model_validate_json(request.result_path.read_text())

    assert completed.returncode == 0, completed.stderr.decode()
    assert phase.elapsed_seconds < 0.25
    assert subprocess_elapsed >= 0.5


def test_locust_stats_are_reset_when_measurement_gate_opens(tmp_path: Path) -> None:
    _SseHandler.run_count = 0
    _SseHandler.sse_delay_seconds = 0.01
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SseHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    request = _phase_request(tmp_path, origin=origin)
    script = """
from pathlib import Path
import sys

from benchmarks import locust_load

original_on_start = locust_load._PhaseUser.on_start

def record_pre_gate_metric(user):
    user.environment.events.request.fire(
        request_type="TEST",
        name="before measurement gate",
        response_time=1,
        response_length=0,
        exception=None,
    )
    original_on_start(user)

locust_load._PhaseUser.on_start = record_pre_gate_metric
request = locust_load.LoadPhaseRequest.model_validate_json(Path(sys.argv[1]).read_text())
result = locust_load.run_load_phase(request)
raise SystemExit(1 if result.timed_out or result.fatal_errors else 0)
"""

    try:
        completed = subprocess.run(
            [sys.executable, "-c", script, str(tmp_path / "request.json")],
            cwd=Path(__file__).resolve().parents[3],
            env=_load_subprocess_environment(),
            check=False,
            capture_output=True,
            timeout=10,
        )
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)
    stats = json.loads(request.stats_path.read_text())
    pre_gate = [entry for entry in stats["entries"] if entry["name"] == "before measurement gate"]

    assert completed.returncode == 0, completed.stderr.decode()
    assert not pre_gate or all(entry["num_requests"] == 0 for entry in pre_gate)


def test_nonzero_active_tracker_is_reported_as_fatal(tmp_path: Path) -> None:
    _SseHandler.run_count = 0
    _SseHandler.sse_delay_seconds = 0.01
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SseHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    request = _phase_request(tmp_path, origin=origin)
    script = """
from pathlib import Path
import sys

from benchmarks import locust_load

original_run_once = locust_load.AgentRunClient.run_once

def leak_active_run(client, **kwargs):
    tracker = kwargs.pop("tracker")
    observation = original_run_once(client, tracker=None, **kwargs)
    tracker.admitted("leaked-run")
    return observation

locust_load.AgentRunClient.run_once = leak_active_run
request = locust_load.LoadPhaseRequest.model_validate_json(Path(sys.argv[1]).read_text())
result = locust_load.run_load_phase(request)
raise SystemExit(1 if result.timed_out or result.fatal_errors else 0)
"""

    try:
        completed = subprocess.run(
            [sys.executable, "-c", script, str(tmp_path / "request.json")],
            cwd=Path(__file__).resolve().parents[3],
            env=_load_subprocess_environment(),
            check=False,
            capture_output=True,
            timeout=10,
        )
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)
    phase = LoadPhaseResult.model_validate_json(request.result_path.read_text())

    assert completed.returncode == 1
    assert any("1 active Run" in error for error in phase.fatal_errors)


def test_admitted_nonterminal_observation_retires_worker_context(tmp_path: Path) -> None:
    request = _phase_request(tmp_path, origin="http://unused")
    request = request.model_copy(update={"iterations_per_user": 3})
    (tmp_path / "request.json").write_text(request.model_dump_json())
    script = """
from pathlib import Path
import sys
import time

from benchmarks import locust_load
from benchmarks.capacity_protocol import CapacityObservation, RequestMetric
from benchmarks.schemas import RunSample

def return_nonterminal(client, *, sequence, worker_index, binding_ref, **kwargs):
    del kwargs
    client._recorder(RequestMetric(
        request_type="AGENT_RUN",
        name="basic",
        response_time_ms=1,
        error="stream_error",
    ))
    now = time.time_ns()
    return CapacityObservation(
        sample=RunSample(
            mode="local-runtime",
            scenario_id="basic",
            block_id="block",
            benchmark_run_id=f"run-{sequence}",
            worker_index=worker_index,
            run_id=f"run-{sequence}",
            admitted=True,
            failure_kind="stream_error",
            error="synthetic SSE EOF",
        ),
        binding_ref=binding_ref,
        started_at_ns=now,
        ended_at_ns=now + 1,
    )

locust_load.AgentRunClient.run_once = return_nonterminal
request = locust_load.LoadPhaseRequest.model_validate_json(Path(sys.argv[1]).read_text())
result = locust_load.run_load_phase(request)
raise SystemExit(1 if result.timed_out or result.fatal_errors else 0)
"""

    completed = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path / "request.json")],
        cwd=Path(__file__).resolve().parents[3],
        env=_load_subprocess_environment(),
        check=False,
        capture_output=True,
        timeout=10,
    )
    phase = LoadPhaseResult.model_validate_json(request.result_path.read_text())

    assert completed.returncode == 0, completed.stderr.decode()
    assert phase.observation_count == 1
    assert phase.composite_request is not None
    assert phase.composite_request.failure_count == 1


def _phase_request(tmp_path: Path, *, origin: str) -> LoadPhaseRequest:
    contexts_path = tmp_path / "contexts.json"
    contexts_path.write_text(json.dumps([WorkerContext(worker_index=0).model_dump(mode="json")]))
    request = LoadPhaseRequest(
        mode="local-runtime",
        phase="resume-setup",
        agent_url=origin,
        fake_deps_url=origin,
        scenario_id="basic",
        block_id="block",
        contexts_path=contexts_path,
        observations_path=tmp_path / "observations.jsonl",
        active_runs_path=tmp_path / "active-runs.json",
        stats_path=tmp_path / "stats.json",
        result_path=tmp_path / "result.json",
        iterations_per_user=1,
        sequence_stride=1,
    )
    (tmp_path / "request.json").write_text(request.model_dump_json())
    return request

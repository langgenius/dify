import json
import time
from typing import cast

import httpx
import pytest

from benchmarks.capacity_protocol import (
    AgentRunClient,
    CapacityObservation,
    RequestMetric,
    build_capacity_run_request,
)
from benchmarks.scenario import load_scenario_manifest


class _Tracker:
    def __init__(self) -> None:
        self.active: int = 0
        self.peak: int = 0
        self.finished_terminals: list[bool] = []

    def admitted(self, run_id: str) -> None:
        assert run_id
        self.active += 1
        self.peak = max(self.peak, self.active)

    def finished(self, run_id: str, *, terminal: bool) -> None:
        assert run_id
        self.finished_terminals.append(terminal)
        self.active -= 1


def _clients(
    *,
    agent_handler: httpx.MockTransport,
    fake_handler: httpx.MockTransport | None = None,
) -> tuple[httpx.Client, httpx.Client]:
    fake_transport = fake_handler or httpx.MockTransport(lambda _request: httpx.Response(200, json={}))
    return (
        httpx.Client(base_url="http://agent", transport=agent_handler),
        httpx.Client(base_url="http://fake", transport=fake_transport),
    )


def test_sync_protocol_preserves_successful_run_evidence() -> None:
    requests_seen: list[httpx.Request] = []

    def agent_handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"run_id": "run-1"})
        return httpx.Response(
            200,
            text=(
                ": heartbeat\n\n"
                'data: {"id":"1-0","type":"run_started","data":{}}\n\n'
                'data: {"id":"2-0","type":"run_succeeded",'
                '"data":{"session_snapshot":{"version":1}}}\n\n'
            ),
            headers={"content-type": "text/event-stream"},
        )

    metrics: list[RequestMetric] = []
    tracker = _Tracker()
    agent, fake = _clients(agent_handler=httpx.MockTransport(agent_handler))
    try:
        observation = AgentRunClient(
            mode="local-runtime",
            agent_client=agent,
            fake_client=fake,
            scenario=load_scenario_manifest().get("shell"),
            block_id="block",
            recorder=metrics.append,
        ).run_once(
            sequence=3,
            worker_index=1,
            binding_ref="binding-1",
            session_snapshot={"prior": True},
            tracker=tracker,
        )
    finally:
        agent.close()
        fake.close()

    assert observation.sample.terminal_status == "succeeded"
    assert observation.sample.admitted
    assert observation.sample.event_count == 2
    assert observation.sse_event_ids == ["1-0", "2-0"]
    assert observation.session_snapshot == {"version": 1}
    assert observation.binding_ref == "binding-1"
    assert observation.sample.create_run_http_ms is not None
    assert observation.sample.time_to_first_event_ms is not None
    assert observation.sample.terminal_e2e_ms is not None
    assert tracker.active == 0
    assert tracker.peak == 1
    assert tracker.finished_terminals == [True]
    assert [metric.name for metric in metrics] == [
        "POST fake/__bench/prepare",
        "POST /runs",
        "GET /runs/:id/events/sse",
        "shell",
    ]
    assert all(metric.response_length == 0 for metric in metrics)
    request_payload = cast(dict[str, object], json.loads(requests_seen[0].content))
    assert request_payload["session_snapshot"] == {"prior": True}


def test_terminal_failure_remains_a_terminal_failed_sample() -> None:
    def agent_handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"run_id": "run-1"})
        return httpx.Response(
            200,
            text='data: {"id":"1-0","type":"run_failed","data":{"error":"tmux missing"}}\n\n',
        )

    metrics: list[RequestMetric] = []
    agent, fake = _clients(agent_handler=httpx.MockTransport(agent_handler))
    try:
        observation = AgentRunClient(
            mode="local-runtime",
            agent_client=agent,
            fake_client=fake,
            scenario=load_scenario_manifest().get("shell"),
            block_id="block",
            recorder=metrics.append,
        ).run_once(
            sequence=0,
            worker_index=0,
            binding_ref=None,
            session_snapshot=None,
            tracker=_Tracker(),
        )
    finally:
        agent.close()
        fake.close()

    assert observation.sample.terminal_status == "failed"
    assert observation.sample.failure_kind == "terminal_failed"
    assert observation.sample.error == "tmux missing"
    assert metrics[-1].error == "terminal_failed"


def test_post_failure_records_create_latency_without_admission() -> None:
    metrics: list[RequestMetric] = []
    agent, fake = _clients(
        agent_handler=httpx.MockTransport(lambda _request: httpx.Response(503)),
    )
    try:
        observation = AgentRunClient(
            mode="local-runtime",
            agent_client=agent,
            fake_client=fake,
            scenario=load_scenario_manifest().get("basic"),
            block_id="block",
            recorder=metrics.append,
        ).run_once(
            sequence=0,
            worker_index=0,
            binding_ref=None,
            session_snapshot=None,
            tracker=_Tracker(),
        )
    finally:
        agent.close()
        fake.close()

    assert not observation.sample.admitted
    assert observation.sample.create_run_http_ms is not None
    assert observation.sample.failure_kind == "admission_error"
    assert metrics[-1].error == "admission_error"


def test_prepare_failure_is_a_fatal_protocol_error() -> None:
    agent, fake = _clients(
        agent_handler=httpx.MockTransport(lambda _request: httpx.Response(200, json={"run_id": "unused"})),
        fake_handler=httpx.MockTransport(lambda _request: httpx.Response(500)),
    )
    try:
        with pytest.raises(httpx.HTTPStatusError):
            _ = AgentRunClient(
                mode="local-runtime",
                agent_client=agent,
                fake_client=fake,
                scenario=load_scenario_manifest().get("basic"),
                block_id="block",
                recorder=lambda _metric: None,
            ).run_once(
                sequence=0,
                worker_index=0,
                binding_ref=None,
                session_snapshot=None,
                tracker=None,
            )
    finally:
        agent.close()
        fake.close()


def test_capacity_observation_roundtrip_preserves_run_sample_schema() -> None:
    observation = CapacityObservation.model_validate(
        {
            "sample": {
                "mode": "local-e2b",
                "scenario_id": "file",
                "block_id": "block",
                "benchmark_run_id": "benchmark-run",
                "worker_index": 2,
                "run_id": "run",
                "admitted": True,
                "terminal_status": "succeeded",
            },
            "sse_event_ids": ["1-0"],
            "session_snapshot": {"version": 1},
            "binding_ref": "sandbox",
            "started_at_ns": 1,
            "ended_at_ns": 2,
        }
    )

    restored = CapacityObservation.model_validate_json(observation.model_dump_json())

    assert restored.model_dump() == observation.model_dump()


def test_config_request_keeps_three_skills_and_ten_files() -> None:
    request = build_capacity_run_request(
        scenario=load_scenario_manifest().get("config"),
        benchmark_run_id="run",
        binding_ref="binding",
        session_snapshot=None,
        suspend=False,
    )

    composition = cast(dict[str, object], request["composition"])
    layers = cast(list[dict[str, object]], composition["layers"])
    config_layer = next(layer for layer in layers if layer["name"] == "config")
    config = cast(dict[str, object], config_layer["config"])
    assert len(cast(list[object], config["skills"])) == 3
    assert len(cast(list[object], config["files"])) == 10


def test_recorder_delay_does_not_change_run_timings_or_observation_window() -> None:
    def agent_handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"run_id": "run-1"})
        return httpx.Response(
            200,
            text='data: {"id":"1-0","type":"run_succeeded","data":{}}\n\n',
        )

    def slow_recorder(metric: RequestMetric) -> None:
        if metric.name in {"POST /runs", "GET /runs/:id/events/sse", "basic"}:
            time.sleep(0.05)

    agent, fake = _clients(agent_handler=httpx.MockTransport(agent_handler))
    try:
        observation = AgentRunClient(
            mode="local-runtime",
            agent_client=agent,
            fake_client=fake,
            scenario=load_scenario_manifest().get("basic"),
            block_id="block",
            recorder=slow_recorder,
        ).run_once(
            sequence=0,
            worker_index=0,
            binding_ref=None,
            session_snapshot=None,
            tracker=None,
        )
    finally:
        agent.close()
        fake.close()

    assert observation.sample.time_to_first_event_ms is not None
    assert observation.sample.terminal_e2e_ms is not None
    assert observation.sample.time_to_first_event_ms < 50
    assert observation.sample.terminal_e2e_ms < 50
    assert (observation.ended_at_ns - observation.started_at_ns) / 1_000_000 < 50


def test_missing_run_id_records_one_semantic_post_failure() -> None:
    metrics: list[RequestMetric] = []
    agent, fake = _clients(
        agent_handler=httpx.MockTransport(lambda _request: httpx.Response(202, json={})),
    )
    try:
        observation = AgentRunClient(
            mode="local-e2b",
            agent_client=agent,
            fake_client=fake,
            scenario=load_scenario_manifest().get("basic"),
            block_id="block",
            recorder=metrics.append,
        ).run_once(
            sequence=0,
            worker_index=0,
            binding_ref=None,
            session_snapshot=None,
            tracker=None,
        )
    finally:
        agent.close()
        fake.close()

    post_metrics = [metric for metric in metrics if metric.name == "POST /runs"]
    assert observation.sample.mode == "local-e2b"
    assert observation.sample.failure_kind == "admission_error"
    assert len(post_metrics) == 1
    assert post_metrics[0].error == "admission_error"
    assert not any(metric.request_type == "SSE" for metric in metrics)


def test_sse_eof_records_one_stream_failure() -> None:
    requests_seen: list[tuple[str, str]] = []
    statuses = iter(("running", "cancelled"))

    def agent_handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append((request.method, request.url.path))
        if request.method == "POST" and request.url.path == "/runs":
            return httpx.Response(202, json={"run_id": "run-1"})
        if request.method == "GET" and request.url.path.endswith("/events/sse"):
            return httpx.Response(
                200,
                text='data: {"id":"1-0","type":"run_started","data":{}}\n\n',
            )
        if request.method == "GET":
            return httpx.Response(200, json={"status": next(statuses)})
        if request.method == "POST" and request.url.path.endswith("/cancel"):
            return httpx.Response(200, json={})
        raise AssertionError(f"unexpected request: {request.method} {request.url.path}")

    metrics: list[RequestMetric] = []
    tracker = _Tracker()
    agent, fake = _clients(agent_handler=httpx.MockTransport(agent_handler))
    try:
        observation = AgentRunClient(
            mode="local-runtime",
            agent_client=agent,
            fake_client=fake,
            scenario=load_scenario_manifest().get("basic"),
            block_id="block",
            recorder=metrics.append,
        ).run_once(
            sequence=0,
            worker_index=0,
            binding_ref=None,
            session_snapshot=None,
            tracker=tracker,
        )
    finally:
        agent.close()
        fake.close()

    sse_metrics = [metric for metric in metrics if metric.request_type == "SSE"]
    assert observation.sample.failure_kind == "stream_error"
    assert tracker.active == 0
    assert tracker.finished_terminals == [True]
    assert len(sse_metrics) == 1
    assert sse_metrics[0].error == "stream_error"
    assert ("POST", "/runs/run-1/cancel") in requests_seen


def test_cancelled_terminal_keeps_successful_sse_and_failed_composite() -> None:
    def agent_handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"run_id": "run-1"})
        return httpx.Response(
            200,
            text='data: {"id":"1-0","type":"run_cancelled","data":{}}\n\n',
        )

    metrics: list[RequestMetric] = []
    agent, fake = _clients(agent_handler=httpx.MockTransport(agent_handler))
    try:
        observation = AgentRunClient(
            mode="local-runtime",
            agent_client=agent,
            fake_client=fake,
            scenario=load_scenario_manifest().get("basic"),
            block_id="block",
            recorder=metrics.append,
        ).run_once(
            sequence=0,
            worker_index=0,
            binding_ref=None,
            session_snapshot=None,
            tracker=_Tracker(),
        )
    finally:
        agent.close()
        fake.close()

    sse_metrics = [metric for metric in metrics if metric.request_type == "SSE"]
    composite = [metric for metric in metrics if metric.request_type == "AGENT_RUN"]
    assert observation.sample.terminal_status == "cancelled"
    assert observation.sample.failure_kind == "terminal_failed"
    assert len(sse_metrics) == 1
    assert sse_metrics[0].error is None
    assert len(composite) == 1
    assert composite[0].error == "terminal_failed"


def test_sse_http_error_records_one_stream_failure_and_balances_tracker() -> None:
    def agent_handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"run_id": "run-1"})
        return httpx.Response(503)

    metrics: list[RequestMetric] = []
    tracker = _Tracker()
    agent, fake = _clients(agent_handler=httpx.MockTransport(agent_handler))
    try:
        observation = AgentRunClient(
            mode="local-runtime",
            agent_client=agent,
            fake_client=fake,
            scenario=load_scenario_manifest().get("basic"),
            block_id="block",
            recorder=metrics.append,
        ).run_once(
            sequence=0,
            worker_index=0,
            binding_ref=None,
            session_snapshot=None,
            tracker=tracker,
        )
    finally:
        agent.close()
        fake.close()

    sse_metrics = [metric for metric in metrics if metric.request_type == "SSE"]
    assert observation.sample.failure_kind == "stream_error"
    assert tracker.active == 0
    assert tracker.finished_terminals == [False]
    assert len(sse_metrics) == 1
    assert sse_metrics[0].error == "stream_error"

from __future__ import annotations

import json
from unittest import TestCase, mock

from run_container_benchmarks import (
    ContainerBenchmarkError,
    bootstrap_median_ci,
    collect_health_preflights,
    comparisons,
    parse_docker_top_runtime_rss,
    parse_memory_size,
    parse_published_port,
    parse_runtime_process_rss,
    require_exited,
    stats,
)


class MemoryParsingTests(TestCase):
    def test_memory_units_are_normalized_to_mib(self) -> None:
        self.assertEqual(parse_memory_size("1GiB"), 1024.0)
        self.assertEqual(parse_memory_size("512MiB"), 512.0)
        self.assertAlmostEqual(parse_memory_size("1000kB"), 1000 * 1000 / 1024 / 1024)

    def test_runtime_rss_excludes_sampler_and_keeps_long_lived_processes(self) -> None:
        raw = """
              972 tini
             9856 shellctl
             3400 tmux: server
             8128 ps
        """
        self.assertAlmostEqual(
            parse_runtime_process_rss(raw), (972 + 9856 + 3400) / 1024
        )

    def test_runtime_rss_rejects_malformed_rows(self) -> None:
        with self.assertRaisesRegex(ContainerBenchmarkError, "unexpected ps row"):
            parse_runtime_process_rss("1234")

    def test_docker_top_rss_works_without_procps_in_the_image(self) -> None:
        raw = """
        PID                 RSS                 COMMAND
        3497512             15644               shellctl
        3497513             3400                tmux: server
        """
        self.assertAlmostEqual(
            parse_docker_top_runtime_rss(raw), (15644 + 3400) / 1024
        )

    def test_docker_top_rss_rejects_an_unexpected_header(self) -> None:
        with self.assertRaisesRegex(ContainerBenchmarkError, "unexpected docker top header"):
            parse_docker_top_runtime_rss("RSS COMMAND\n15644 shellctl")


class PortParsingTests(TestCase):
    def test_published_port_accepts_ipv4_and_ipv6_mappings(self) -> None:
        self.assertEqual(parse_published_port("127.0.0.1:49152"), 49152)
        self.assertEqual(parse_published_port("[::1]:49153"), 49153)

    def test_published_port_rejects_malformed_mapping(self) -> None:
        with self.assertRaisesRegex(
            ContainerBenchmarkError, "unexpected Docker port mapping"
        ):
            parse_published_port("5004/tcp -> nowhere")


class CorrectnessValidationTests(TestCase):
    def test_terminal_success_and_expected_output_are_required(self) -> None:
        require_exited(
            {"done": True, "status": "exited", "exit_code": 0, "output": "expected"},
            "test",
            "expected",
        )

        with self.assertRaisesRegex(ContainerBenchmarkError, "unexpected lifecycle"):
            require_exited(
                {"done": False, "status": "running", "exit_code": None, "output": ""},
                "test",
            )

        with self.assertRaisesRegex(ContainerBenchmarkError, "output mismatch"):
            require_exited(
                {"done": True, "status": "exited", "exit_code": 0, "output": "wrong"},
                "test",
                "expected",
            )

    def test_stats_keep_raw_samples_and_terminal_percentiles(self) -> None:
        result = stats([1.0, 2.0, 3.0, 4.0])
        self.assertEqual(result["raw_values"], [1.0, 2.0, 3.0, 4.0])
        self.assertEqual(result["median"], 2.5)
        self.assertEqual(result["p95"], 4.0)


class _HealthResponse:
    status = 200

    def __init__(self, payload: object) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload).encode()


class _HealthConnection:
    instances: list[_HealthConnection] = []
    payload: object = {"status": "ok"}

    def __init__(self, host: str, port: int, timeout: int) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.closed = False
        self.instances.append(self)

    def request(self, method: str, path: str) -> None:
        if (method, path) != ("GET", "/healthz"):
            raise AssertionError((method, path))

    def getresponse(self) -> _HealthResponse:
        return _HealthResponse(self.payload)

    def close(self) -> None:
        self.closed = True


class HealthPreflightTests(TestCase):
    def setUp(self) -> None:
        _HealthConnection.instances = []
        _HealthConnection.payload = {"status": "ok"}

    @mock.patch(
        "run_container_benchmarks.http.client.HTTPConnection", _HealthConnection
    )
    def test_preflight_uses_fresh_connections_and_checks_exact_payload(self) -> None:
        result = collect_health_preflights(5004, 3)

        self.assertEqual(result["samples"], 3)
        self.assertEqual(len(_HealthConnection.instances), 3)
        self.assertTrue(
            all(connection.closed for connection in _HealthConnection.instances)
        )

    @mock.patch(
        "run_container_benchmarks.http.client.HTTPConnection", _HealthConnection
    )
    def test_preflight_rejects_non_contract_payload(self) -> None:
        _HealthConnection.payload = {"status": "degraded"}

        with self.assertRaisesRegex(ContainerBenchmarkError, "unexpected payload"):
            collect_health_preflights(5004, 1)


def _implementation(value: float) -> dict:
    memory = {
        "cgroup_memory_current": {"median": value},
        "docker_stats_memory": {"median": value},
        "runtime_process_rss_sum": {"median": value},
    }
    workloads = {
        "fresh_connection_health_preflight": {"median": value},
        "sequential_small": {"median": value},
        "output_32k": {"median": value},
        "concurrent_8_workers": {"median": value},
        "cold_first_job": {"median": value},
    }
    return {
        "startup_health_ready_ms": value,
        "idle_memory": memory,
        "post_jobs_memory": memory,
        "workloads": workloads,
    }


class PairedComparisonTests(TestCase):
    def test_comparison_uses_within_round_pairs(self) -> None:
        rounds = [
            {
                "implementations": {
                    "go": _implementation(10.0),
                    "rust": _implementation(5.0),
                }
            },
            {
                "implementations": {
                    "go": _implementation(20.0),
                    "rust": _implementation(10.0),
                }
            },
        ]

        result = comparisons(rounds)

        self.assertTrue(result)
        self.assertTrue(
            all(item["go_over_rust_ratio"]["median"] == 2.0 for item in result)
        )
        self.assertTrue(
            all(item["rust_reduction_percent"]["median"] == 50.0 for item in result)
        )

    def test_bootstrap_is_deterministic(self) -> None:
        self.assertEqual(
            bootstrap_median_ci([1.0, 2.0, 3.0]), bootstrap_median_ci([1.0, 2.0, 3.0])
        )

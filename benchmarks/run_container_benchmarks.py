#!/usr/bin/env python3
"""Paired Linux-container benchmark for the Go and Rust shellctl runtimes."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import math
import os
import platform
import random
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

IMAGES = {
    "go": "dify-agent-runtime:test",
    "rust": "dify-agent-runtime-rust:test",
}
PROCESS_RSS_EXCLUDED_COMMANDS = {"ps"}
REPO = Path(__file__).resolve().parents[1]
RUNTIME = REPO / "dify-agent-runtime"


class ContainerBenchmarkError(RuntimeError):
    pass


def _sample_percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, math.ceil((len(ordered) - 1) * probability))
    return ordered[index]


def stats(values: list[float], *, unit: str = "ms") -> dict[str, Any]:
    if not values:
        return {"samples": 0, "unit": unit}
    total = sum(values)
    seconds = total / 1000 if unit == "ms" else total
    return {
        "samples": len(values),
        "unit": unit,
        "avg": total / len(values),
        "median": statistics.median(values),
        "p50": _sample_percentile(values, 0.50),
        "p95": _sample_percentile(values, 0.95),
        "p99": _sample_percentile(values, 0.99),
        "min": min(values),
        "max": max(values),
        "throughput_per_sec": len(values) / seconds if seconds else 0.0,
        "raw_values": values,
    }


def _paired_percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    return ordered[round((len(ordered) - 1) * probability)]


def describe(values: list[float]) -> dict[str, Any]:
    return {
        "samples": len(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "p95": _paired_percentile(values, 0.95),
        "min": min(values),
        "max": max(values),
        "raw_values": values,
    }


def bootstrap_median_ci(values: list[float], samples: int = 10_000) -> list[float]:
    if len(values) == 1:
        return [values[0], values[0]]
    generator = random.Random(0xD1F1)
    estimates = []
    for _ in range(samples):
        resample = [generator.choice(values) for _ in values]
        estimates.append(statistics.median(resample))
    return [_paired_percentile(estimates, 0.025), _paired_percentile(estimates, 0.975)]


def source_digest(files: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(str(path.relative_to(REPO)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def command_output(command: list[str], *, check: bool = True) -> str:
    completed = subprocess.run(command, check=check, text=True, capture_output=True)
    return completed.stdout.strip()


def docker(*args: str, check: bool = True) -> str:
    return command_output(["docker", *args], check=check)


def parse_published_port(value: str) -> int:
    first = next((line.strip() for line in value.splitlines() if line.strip()), "")
    _, separator, port_text = first.rpartition(":")
    if not separator or not port_text.isdigit():
        raise ContainerBenchmarkError(f"unexpected Docker port mapping: {value!r}")
    port = int(port_text)
    if not 1 <= port <= 65_535:
        raise ContainerBenchmarkError(f"unexpected Docker port mapping: {value!r}")
    return port


def wait_for_health(port: int, process_started_ns: int) -> float:
    for _ in range(300):
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
            conn.request("GET", "/healthz")
            response = conn.getresponse()
            response.read()
            conn.close()
            if response.status == 200:
                return (time.perf_counter_ns() - process_started_ns) / 1_000_000
        except OSError:
            pass
        time.sleep(0.02)
    raise ContainerBenchmarkError(f"container health check timed out on port {port}")


def request_json(
    conn: http.client.HTTPConnection,
    method: str,
    path: str,
    token: str,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], float]:
    body = json.dumps(payload)
    started = time.perf_counter_ns()
    conn.request(
        method,
        path,
        body=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    response = conn.getresponse()
    raw = response.read()
    elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
    if response.status != 200:
        raise ContainerBenchmarkError(
            f"{method} {path} returned HTTP {response.status}: {raw[:500]!r}"
        )
    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContainerBenchmarkError(
            f"{method} {path} returned invalid JSON: {raw[:500]!r}"
        ) from exc
    if not isinstance(result, dict):
        raise ContainerBenchmarkError(f"{method} {path} returned non-object JSON")
    return result, elapsed_ms


def require_exited(
    payload: dict[str, Any], label: str, output: str | None = None
) -> None:
    if (
        not payload.get("done")
        or payload.get("status") != "exited"
        or payload.get("exit_code") != 0
    ):
        raise ContainerBenchmarkError(
            f"{label} returned unexpected lifecycle: {payload!r}"
        )
    if output is not None and output not in payload.get("output", ""):
        raise ContainerBenchmarkError(f"{label} output mismatch: {payload!r}")


def collect_health_preflights(port: int, requests: int) -> dict[str, Any]:
    """Measure the fresh-connection health request used before Rust admission."""
    samples = []
    for index in range(requests):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        started = time.perf_counter_ns()
        try:
            conn.request("GET", "/healthz")
            response = conn.getresponse()
            raw = response.read()
        finally:
            conn.close()
        samples.append((time.perf_counter_ns() - started) / 1_000_000)
        if response.status != 200:
            raise ContainerBenchmarkError(
                f"health preflight {index} returned HTTP {response.status}: {raw[:500]!r}"
            )
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ContainerBenchmarkError(
                f"health preflight {index} returned invalid JSON: {raw[:500]!r}"
            ) from exc
        if payload != {"status": "ok"}:
            raise ContainerBenchmarkError(
                f"health preflight {index} returned unexpected payload: {payload!r}"
            )
    return stats(samples)


def collect_job_workloads(port: int, token: str, jobs: int) -> dict[str, Any]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    try:
        cold, cold_ms = request_json(
            conn,
            "POST",
            "/v1/jobs/run",
            token,
            {"script": "printf cold-container"},
        )
        require_exited(cold, "cold job", "cold-container")

        for index in range(5):
            result, _ = request_json(
                conn,
                "POST",
                "/v1/jobs/run",
                token,
                {"script": "printf warmup"},
            )
            require_exited(result, f"warmup {index}", "warmup")

        sequential = []
        for index in range(jobs):
            result, elapsed = request_json(
                conn,
                "POST",
                "/v1/jobs/run",
                token,
                {"script": "printf benchmark"},
            )
            require_exited(result, f"sequential job {index}", "benchmark")
            sequential.append(elapsed)

        output_samples = []
        output_sizes = []
        for index in range(max(10, jobs // 4)):
            result, elapsed = request_json(
                conn,
                "POST",
                "/v1/jobs/run",
                token,
                {
                    "script": 'python3 -c \'print("x" * 32768, end="")\'',
                    "output_limit": 65_536,
                },
            )
            require_exited(result, f"output job {index}")
            output_size = len(result.get("output", "").encode())
            if output_size < 32_768:
                raise ContainerBenchmarkError(
                    f"output job {index} returned only {output_size} bytes"
                )
            output_samples.append(elapsed)
            output_sizes.append(output_size)

        concurrent_count = max(24, jobs // 2)

        def one_concurrent(index: int) -> float:
            local = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
            try:
                result, elapsed = request_json(
                    local,
                    "POST",
                    "/v1/jobs/run",
                    token,
                    {"script": "printf concurrent"},
                )
                require_exited(result, f"concurrent job {index}", "concurrent")
                return elapsed
            finally:
                local.close()

        wall_started = time.perf_counter_ns()
        with ThreadPoolExecutor(max_workers=8) as executor:
            concurrent = list(executor.map(one_concurrent, range(concurrent_count)))
        concurrent_wall_ms = (time.perf_counter_ns() - wall_started) / 1_000_000

        output_result = stats(output_samples)
        output_result["min_output_bytes"] = min(output_sizes)
        concurrent_result = stats(concurrent)
        concurrent_result["wall_ms"] = concurrent_wall_ms
        return {
            "cold_first_job": stats([cold_ms]),
            "sequential_small": stats(sequential),
            "output_32k": output_result,
            "concurrent_8_workers": concurrent_result,
        }
    finally:
        conn.close()


def parse_memory_size(value: str) -> float:
    value = value.strip()
    units = {
        "B": 1 / (1024 * 1024),
        "kB": 1000 / (1024 * 1024),
        "KB": 1000 / (1024 * 1024),
        "KiB": 1 / 1024,
        "MB": 1_000_000 / (1024 * 1024),
        "MiB": 1.0,
        "GB": 1_000_000_000 / (1024 * 1024),
        "GiB": 1024.0,
    }
    for unit in sorted(units, key=len, reverse=True):
        if value.endswith(unit):
            return float(value[: -len(unit)].strip()) * units[unit]
    raise ContainerBenchmarkError(f"unsupported memory size: {value!r}")


def parse_runtime_process_rss(value: str) -> float:
    """Sum resident memory while excluding the short-lived sampler itself."""
    total_kib = 0
    for line in value.splitlines():
        fields = line.strip().split(maxsplit=1)
        if not fields:
            continue
        if len(fields) != 2:
            raise ContainerBenchmarkError(f"unexpected ps row: {line!r}")
        rss, command = fields
        if command in PROCESS_RSS_EXCLUDED_COMMANDS:
            continue
        try:
            total_kib += int(rss)
        except ValueError as exc:
            raise ContainerBenchmarkError(
                f"unexpected RSS value in ps row: {line!r}"
            ) from exc
    return total_kib / 1024.0


def parse_docker_top_runtime_rss(value: str) -> float:
    """Sum container RSS from host-side ``docker top`` output.

    The official 1.16.1 runtime image does not include procps. Sampling from
    the host also avoids adding a short-lived measurement process to the
    container being measured.
    """
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    if not lines or lines[0].split()[:3] != ["PID", "RSS", "COMMAND"]:
        raise ContainerBenchmarkError("unexpected docker top header")
    total_kib = 0
    for line in lines[1:]:
        fields = line.split(maxsplit=2)
        if len(fields) != 3:
            raise ContainerBenchmarkError(f"unexpected docker top row: {line!r}")
        pid, rss, command = fields
        if not pid.isdigit():
            raise ContainerBenchmarkError(f"unexpected PID in docker top row: {line!r}")
        if command in PROCESS_RSS_EXCLUDED_COMMANDS:
            continue
        try:
            total_kib += int(rss)
        except ValueError as exc:
            raise ContainerBenchmarkError(
                f"unexpected RSS value in docker top row: {line!r}"
            ) from exc
    return total_kib / 1024.0


def collect_memory(container: str, samples: int = 20) -> dict[str, Any]:
    cgroup_values = []
    for _ in range(samples):
        raw = docker("exec", container, "cat", "/sys/fs/cgroup/memory.current")
        cgroup_values.append(int(raw) / (1024 * 1024))
        time.sleep(0.05)

    docker_stats_values = []
    for _ in range(3):
        usage = docker("stats", "--no-stream", "--format", "{{.MemUsage}}", container)
        docker_stats_values.append(parse_memory_size(usage.split("/")[0]))

    runtime_process_rss_values = []
    for _ in range(samples):
        raw = docker("top", container, "-eo", "pid,rss,comm")
        runtime_process_rss_values.append(parse_docker_top_runtime_rss(raw))
        time.sleep(0.05)

    process_table = docker("top", container, "-eo", "pid,ppid,rss,comm,args")
    return {
        "cgroup_memory_current": {
            **stats(cgroup_values, unit="MiB"),
            "throughput_per_sec": None,
        },
        "docker_stats_memory": {
            **stats(docker_stats_values, unit="MiB"),
            "throughput_per_sec": None,
        },
        "runtime_process_rss_sum": {
            **stats(runtime_process_rss_values, unit="MiB"),
            "throughput_per_sec": None,
            "excluded_commands": sorted(PROCESS_RSS_EXCLUDED_COMMANDS),
        },
        "process_table": process_table.splitlines(),
    }


def run_implementation(
    implementation: str, round_index: int, jobs: int, cpus: float
) -> dict[str, Any]:
    image = IMAGES[implementation]
    token = f"bench-{os.getpid()}-{round_index}-{implementation}"
    container = f"dify-bench-{os.getpid()}-{round_index}-{implementation}"
    started_ns = time.perf_counter_ns()
    docker(
        "run",
        "-d",
        "--pull",
        "never",
        "--name",
        container,
        "--cpus",
        str(cpus),
        "--memory",
        "1g",
        "-p",
        "127.0.0.1::5004",
        "-e",
        f"SHELLCTL_AUTH_TOKEN={token}",
        image,
    )
    try:
        # Let Docker allocate and publish the port atomically. Probing a free
        # port and closing it before `docker run` leaves a real TOCTOU window.
        port = parse_published_port(docker("port", container, "5004/tcp"))
        startup_ms = wait_for_health(port, started_ns)
        time.sleep(0.5)
        idle_memory = collect_memory(container)
        health_preflight = collect_health_preflights(port, jobs)
        workloads = collect_job_workloads(port, token, jobs)
        workloads["fresh_connection_health_preflight"] = health_preflight
        post_jobs_memory = collect_memory(container)
        return {
            "status": "ok",
            "implementation": implementation,
            "image": image,
            "startup_health_ready_ms": startup_ms,
            "idle_memory": idle_memory,
            "workloads": workloads,
            "post_jobs_memory": post_jobs_memory,
        }
    except Exception as exc:
        logs = docker("logs", "--tail", "200", container, check=False)
        return {
            "status": "failed",
            "implementation": implementation,
            "image": image,
            "error": repr(exc),
            "logs": logs,
        }
    finally:
        docker("rm", "-f", container, check=False)


def metric_value(run: dict[str, Any], path: tuple[str, ...]) -> float:
    value: Any = run
    for part in path:
        value = value[part]
    return float(value)


def comparisons(rounds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    metrics = {
        "startup-health-ready": ("startup_health_ready_ms",),
        "idle-cgroup-memory": ("idle_memory", "cgroup_memory_current", "median"),
        "idle-docker-stats-memory": ("idle_memory", "docker_stats_memory", "median"),
        "idle-runtime-process-rss-sum": (
            "idle_memory",
            "runtime_process_rss_sum",
            "median",
        ),
        "post-jobs-cgroup-memory": (
            "post_jobs_memory",
            "cgroup_memory_current",
            "median",
        ),
        "fresh-connection-health-preflight": (
            "workloads",
            "fresh_connection_health_preflight",
            "median",
        ),
        "sequential-small": ("workloads", "sequential_small", "median"),
        "output-32k": ("workloads", "output_32k", "median"),
        "concurrent-8-workers": ("workloads", "concurrent_8_workers", "median"),
        "cold-first-job": ("workloads", "cold_first_job", "median"),
    }
    output = []
    for name, path in metrics.items():
        go_values = []
        rust_values = []
        reductions = []
        ratios = []
        for round_result in rounds:
            go = metric_value(round_result["implementations"]["go"], path)
            rust = metric_value(round_result["implementations"]["rust"], path)
            go_values.append(go)
            rust_values.append(rust)
            reductions.append((go - rust) / go * 100)
            ratios.append(go / rust)
        output.append(
            {
                "metric": name,
                "rounds": len(rounds),
                "go": describe(go_values),
                "rust": describe(rust_values),
                "go_over_rust_ratio": describe(ratios),
                "rust_reduction_percent": describe(reductions),
                "rust_reduction_percent_bootstrap_median_ci95": bootstrap_median_ci(
                    reductions
                ),
            }
        )
    return output


def image_metadata(image: str) -> dict[str, Any]:
    raw = docker(
        "image",
        "inspect",
        "--format",
        "{{json .Id}}|{{json .Architecture}}|{{json .Os}}|{{json .Size}}|{{json .Created}}",
        image,
    )
    image_id, architecture, os_name, size, created = raw.split("|", 4)
    return {
        "name": image,
        "id": json.loads(image_id),
        "architecture": json.loads(architecture),
        "os": json.loads(os_name),
        "size_bytes": json.loads(size),
        "created": json.loads(created),
    }


def metadata(
    round_count: int,
    jobs: int,
    cpus: float,
    rust_source_sha256: str | None,
) -> dict[str, Any]:
    go_sources = [RUNTIME / "go.mod", RUNTIME / "go.sum"]
    go_sources.extend((RUNTIME / "cmd").rglob("*.go"))
    go_sources.extend((RUNTIME / "internal").rglob("*.go"))
    rust_sources = [RUNTIME / "rust" / "Cargo.toml", RUNTIME / "rust" / "Cargo.lock"]
    rust_sources.extend((RUNTIME / "rust" / "src").rglob("*.rs"))
    return {
        "schema_version": 2,
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "git_head": command_output(["git", "rev-parse", "HEAD"]),
        "git_status": command_output(["git", "status", "--short"]).splitlines(),
        "host": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "logical_cpu_count": os.cpu_count(),
        },
        "docker_server": docker("version", "--format", "{{.Server.Version}}"),
        "round_count": round_count,
        "jobs_per_round": jobs,
        "container_cpu_limit": cpus,
        "container_memory_limit": "1g",
        "process_rss_excluded_commands": sorted(PROCESS_RSS_EXCLUDED_COMMANDS),
        "images": {name: image_metadata(image) for name, image in IMAGES.items()},
        "source_sha256": {
            "go_runtime": source_digest(go_sources),
            "rust_runtime": rust_source_sha256 or source_digest(rust_sources),
            "benchmark_harness": source_digest([Path(__file__).resolve()]),
        },
    }


def print_summary(report: dict[str, Any]) -> None:
    print("\n== Paired Linux container benchmark ==")
    print(
        "metric                         Go median    Rust median  Go/Rust  Rust reduction"
    )
    for item in report.get("comparisons", []):
        print(
            f"{item['metric']:<30} "
            f"{item['go']['median']:>10.3f} "
            f"{item['rust']['median']:>12.3f} "
            f"{item['go_over_rust_ratio']['median']:>7.2f}x "
            f"{item['rust_reduction_percent']['median']:>13.1f}%"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--jobs", type=int, default=50)
    parser.add_argument("--cpus", type=float, default=2.0)
    parser.add_argument("--go-image", default=IMAGES["go"])
    parser.add_argument("--rust-image", default=IMAGES["rust"])
    parser.add_argument(
        "--rust-source-sha256",
        help="source digest embedded in a prebuilt Rust image (defaults to the working tree)",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    IMAGES.update(go=args.go_image, rust=args.rust_image)

    rounds = []
    failed = False
    for round_index in range(args.rounds):
        order = ["go", "rust"] if round_index % 2 == 0 else ["rust", "go"]
        print(f"round {round_index + 1}/{args.rounds}: {','.join(order)}", flush=True)
        implementations = {}
        for implementation in order:
            result = run_implementation(
                implementation, round_index, args.jobs, args.cpus
            )
            implementations[implementation] = result
            if result["status"] != "ok":
                failed = True
                print(f"  {implementation}: failed {result['error']}", flush=True)
            else:
                median = result["workloads"]["sequential_small"]["median"]
                memory = result["idle_memory"]["docker_stats_memory"]["median"]
                print(
                    f"  {implementation}: sequential p50={median:.3f}ms idle={memory:.3f}MiB",
                    flush=True,
                )
            time.sleep(0.25)
        rounds.append(
            {
                "round": round_index + 1,
                "order": order,
                "implementations": implementations,
            }
        )

    report: dict[str, Any] = {
        "metadata": metadata(
            args.rounds, args.jobs, args.cpus, args.rust_source_sha256
        ),
        "rounds": rounds,
    }
    if not failed:
        report["comparisons"] = comparisons(rounds)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print_summary(report)
    print(f"JSON report: {args.output}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

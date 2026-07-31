"""Build and run the two local Docker capacity modes."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import platform
import re
import socket
import subprocess
import time
from typing import Iterable, Sequence, cast

from pydantic import BaseModel

from benchmarks.capacity import (
    CONCURRENCY_LEVELS,
    CapacityMatrixPoint,
    aggregate_capacity_point,
    build_capacity_matrix,
    render_capacity_markdown,
)
from benchmarks.docker_stats import DockerStatsSampler, summarize_resource_window
from benchmarks.scenario import BenchmarkMode, CapacityWorkload, load_scenario_manifest
from benchmarks.schemas import (
    BlockResult,
    CapacityPoint,
    CapacityResult,
    EnvironmentFingerprint,
    TargetIdentity,
)


logger = logging.getLogger(__name__)

_HARNESS_VERSION = 1
_REDIS_IMAGE = "redis:7.4.10-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2"
_CLOUDFLARED_IMAGE = "cloudflare/cloudflared@sha256:e39ee8da81ad5e05d77f38d2f51c60ca51bf2a8450ac3abab50c17fdb91d91bf"
_COMPOSE_FILE = "docker-compose.capacity.yml"
_AGENT_INPUTS = (
    "dify-agent/src",
    "dify-agent/pyproject.toml",
    "dify-agent/uv.lock",
    "dify-agent/Dockerfile",
)
_RUNTIME_INPUTS = (
    "dify-agent-runtime/cmd",
    "dify-agent-runtime/gen",
    "dify-agent-runtime/internal",
    "dify-agent-runtime/go.mod",
    "dify-agent-runtime/go.sum",
    "dify-agent-runtime/docker/Dockerfile",
)
_RESOURCE_LIMITS = {
    "agent": "2 CPU/2 GiB",
    "runtime": "4 CPU/2 GiB",
    "redis": "2 CPU/512 MiB",
    "fake-deps": "2 CPU/512 MiB",
    "driver": "2 CPU/1 GiB",
    "agent-stub-proxy": "1 CPU/256 MiB",
}


@dataclass(slots=True, frozen=True)
class CapacityOptions:
    """User-facing options for one mode."""

    mode: BenchmarkMode
    keep_containers: bool = False
    scenario_id: str | None = None
    concurrency: int | None = None
    results_root: Path | None = None
    e2b_api_key: str | None = field(default=None, repr=False)
    e2b_template: str | None = None
    e2b_max_concurrency: int | None = None

    def __post_init__(self) -> None:
        if self.mode == "local-e2b":
            if not self.e2b_api_key or not self.e2b_template:
                raise ValueError("BENCH_E2B_API_KEY and BENCH_E2B_TEMPLATE are required")
            required = self.concurrency or max(CONCURRENCY_LEVELS)
            if self.e2b_max_concurrency is None or self.e2b_max_concurrency < required:
                raise ValueError(
                    f"BENCH_E2B_MAX_CONCURRENCY must be at least {required} for the selected matrix"
                )


class BenchmarkCommandError(RuntimeError):
    """An environment or correctness failure that prevents a trustworthy block."""


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def run_capacity(options: CapacityOptions) -> tuple[Path, bool]:
    """Execute one complete local Runtime backend matrix."""
    root = repository_root()
    _verify_docker_environment(options.mode)
    manifest = load_scenario_manifest()
    matrix = build_capacity_matrix(
        mode=options.mode,
        manifest=manifest,
        scenario_id=options.scenario_id,
        concurrency=options.concurrency,
    )
    run_id = _new_run_id()
    results_root = options.results_root or root / "dify-agent" / "benchmarks" / "results"
    invocation_dir = (results_root / f"{run_id}-{options.mode}").resolve()
    blocks_dir = invocation_dir / "blocks"
    logs_dir = invocation_dir / "logs"
    blocks_dir.mkdir(parents=True)
    logs_dir.mkdir()

    harness_image = _build_harness_image(root)
    target = _build_target_images(root, mode=options.mode)
    environment = _capture_environment(
        root,
        mode=options.mode,
        e2b_template=options.e2b_template,
    )
    _write_json(invocation_dir / "environment.json", environment)
    points: list[CapacityPoint] = []
    blocks: list[BlockResult] = []
    command_failed = False
    tunnel_name: str | None = None
    public_tunnel: tuple[int, str] | None = None
    try:
        if options.mode == "local-e2b" and any(
            point.scenario.workload != "basic" for point in matrix
        ):
            host_port = _available_loopback_port()
            tunnel_name = f"dify-agent-bench-{run_id[-12:]}-tunnel"
            public_origin = _start_agent_stub_tunnel(
                name=tunnel_name,
                host_port=host_port,
                log_path=logs_dir / "tunnel.log",
            )
            public_tunnel = (host_port, public_origin)
        for position, matrix_point in enumerate(matrix):
            logger.info(
                "running %s %s c%s",
                options.mode,
                matrix_point.scenario.id,
                matrix_point.requested_concurrency,
            )
            try:
                block = _run_compose_block(
                    root=root,
                    invocation_id=run_id,
                    position=position,
                    point=matrix_point,
                    target=target,
                    harness_image=harness_image,
                    invocation_dir=invocation_dir,
                    logs_dir=logs_dir,
                    keep_containers=options.keep_containers,
                    e2b_api_key=options.e2b_api_key,
                    e2b_template=options.e2b_template,
                    public_tunnel=public_tunnel,
                )
            except Exception as exc:
                command_failed = True
                points.append(_invalid_point(matrix_point, f"{type(exc).__name__}: {exc}"))
                logger.error("capacity point failed: %s", exc)
                break
            blocks.append(block)
            point = aggregate_capacity_point(block)
            points.append(point)
            if point.status == "invalid":
                command_failed = True
    finally:
        if tunnel_name is not None:
            _stop_agent_stub_tunnel(name=tunnel_name, log_path=logs_dir / "tunnel.log")

    full_matrix = options.scenario_id is None and options.concurrency is None
    result = CapacityResult(
        harness_version=_HARNESS_VERSION,
        mode=options.mode,
        matrix_complete=full_matrix and len(points) == len(manifest.scenarios) * len(CONCURRENCY_LEVELS),
        agent_capacity_unit={"cpu_cores": 2.0, "memory_mib": 2048, "workers": 1},
        target=target,
        environment=environment,
        points=points,
    )
    _write_json(invocation_dir / "result.json", result)
    (invocation_dir / "report.md").write_text(render_capacity_markdown(result))
    _write_combined_artifacts(invocation_dir, blocks)
    if options.e2b_api_key:
        _redact_secret_in_directory(invocation_dir, options.e2b_api_key)
    return invocation_dir, not command_failed


def _run_compose_block(
    *,
    root: Path,
    invocation_id: str,
    position: int,
    point: CapacityMatrixPoint,
    target: TargetIdentity,
    harness_image: str,
    invocation_dir: Path,
    logs_dir: Path,
    keep_containers: bool,
    e2b_api_key: str | None,
    e2b_template: str | None,
    public_tunnel: tuple[int, str] | None,
) -> BlockResult:
    block_name = f"{point.scenario.id}-c{point.requested_concurrency}"
    block_dir = invocation_dir / "blocks" / block_name
    block_dir.mkdir()
    project = _compose_project_name(invocation_id, block_name)
    compose_file = root / "dify-agent" / "benchmarks" / _COMPOSE_FILE
    environment = {
        **os.environ,
        "BENCH_MODE": point.mode,
        "BENCH_HARNESS_IMAGE": harness_image,
        "BENCH_AGENT_IMAGE": _image_tag_from_id(target.agent_image_id),
        "BENCH_RUNTIME_IMAGE": (
            _image_tag_from_id(target.runtime_image_id) if target.runtime_image_id is not None else ""
        ),
        "BENCH_RESULTS_DIR": str(block_dir),
        "BENCH_SCENARIO_ID": point.scenario.id,
        "BENCH_BLOCK_ID": f"{invocation_id}-{block_name}",
        "BENCH_CONCURRENCY": str(point.requested_concurrency),
        "BENCH_WARMUP_SECONDS": str(point.warmup_seconds),
        "BENCH_MEASUREMENT_SECONDS": str(point.measurement_seconds),
        "BENCH_MIN_SUCCESSFUL_RUNS": str(point.minimum_successful_runs),
        "BENCH_MAX_DURATION_SECONDS": str(point.maximum_seconds),
        "BENCH_RUNTIME_BACKEND": "e2b" if point.mode == "local-e2b" else "local",
        "BENCH_E2B_API_KEY": e2b_api_key or "",
        "BENCH_E2B_TEMPLATE": e2b_template or "",
        "BENCH_AGENT_STUB_API_BASE_URL": "http://agent:5050/agent-stub",
        "BENCH_PUBLIC_DATA_BASE_URL": "http://fake-deps:5002/__bench",
        "BENCH_STUB_PROXY_HOST_PORT": "15050",
    }
    compose = ["docker", "compose", "-f", str(compose_file), "-p", project]
    services = _services_for_point(point)
    needs_public_tunnel = point.mode == "local-e2b" and point.scenario.workload != "basic"
    sampler: DockerStatsSampler | None = None
    sampler_stopped = False
    result: BlockResult | None = None
    try:
        if needs_public_tunnel:
            if public_tunnel is None:
                raise BenchmarkCommandError("local-e2b Runtime point requires a public callback tunnel")
            host_port, public_origin = public_tunnel
            environment["BENCH_STUB_PROXY_HOST_PORT"] = str(host_port)
            environment["BENCH_AGENT_STUB_API_BASE_URL"] = f"{public_origin}/agent-stub"
            environment["BENCH_PUBLIC_DATA_BASE_URL"] = f"{public_origin}/benchmark-data"
        _run_command([*compose, "up", "-d", "--wait", "--wait-timeout", "240", *services], env=environment)
        if needs_public_tunnel:
            _wait_for_public_proxy(
                f"{environment['BENCH_AGENT_STUB_API_BASE_URL'].removesuffix('/agent-stub')}/health",
                compose=compose,
                environment=environment,
            )
        container_ids = {
            service: _run_command([*compose, "ps", "-q", service], env=environment).stdout.strip()
            for service in services
        }
        if any(not container_id for container_id in container_ids.values()):
            raise BenchmarkCommandError(f"Compose project {project} did not expose all container ids")
        sampler = DockerStatsSampler(container_ids)
        sampler.start()
        driver = _run_command(
            [*compose, "run", "--rm", "-T", "--no-deps", "driver"],
            env=environment,
            check=False,
        )
        sampler.stop()
        sampler_stopped = True
        sampler.write_jsonl(block_dir / "docker-stats.jsonl")
        result_path = block_dir / "block-result.json"
        if not result_path.exists():
            raise BenchmarkCommandError(
                f"capacity driver did not write {result_path}\n{driver.stdout}{driver.stderr}"
            )
        result = BlockResult.model_validate_json(result_path.read_text())
        redis_commands_per_run = result.resources.redis_commands_per_run
        result.resources = summarize_resource_window(
            samples=sampler.samples,
            measurement_started_at_ns=result.measurement_started_at_ns,
            measurement_ended_at_ns=result.measurement_ended_at_ns,
            completed_runs=result.outcomes.successful_runs,
            measured_services=services,
        )
        result.resources.redis_commands_per_run = redis_commands_per_run
        if sampler.errors:
            result.invalid_reasons.extend(f"Docker stats error: {error}" for error in sampler.errors)
        for service in ("agent", "redis"):
            resource = result.resources.components.get(service)
            if resource is None or not resource.stats_coverage.window_covered:
                result.invalid_reasons.append(f"Docker stats did not cover {service} measurement boundaries")
        fake = result.resources.components.get("fake-deps")
        if (
            result.resources.fake_cpu_p95_percent is not None
            and result.resources.fake_cpu_p95_percent > 50
            and fake is not None
            and fake.stats_coverage.in_window_sample_count >= 10
        ):
            result.invalid_reasons.append("fake dependency sustained CPU p95 exceeded 50%")
        if point.mode == "local-runtime":
            cleanup_valid, cleanup_output = _check_runtime_cleanup(compose, environment)
            (block_dir / "runtime-cleanup.txt").write_text(cleanup_output)
            result.cleanup["runtime_state_empty"] = cleanup_valid
            if not cleanup_valid:
                result.invalid_reasons.append("Runtime jobs, SQLite rows, or workspace state remained")
        if driver.returncode != 0 and not result.invalid_reasons:
            result.invalid_reasons.append(f"capacity driver exited with status {driver.returncode}")
        result.invalid_reasons = list(dict.fromkeys(result.invalid_reasons))
        result.valid = not result.invalid_reasons
        result_path.write_text(result.model_dump_json(indent=2))
        return result
    finally:
        if sampler is not None and not sampler_stopped:
            sampler.stop()
            sampler.write_jsonl(block_dir / "docker-stats.jsonl")
        logs = _run_command(
            [*compose, "logs", "--no-color", "--timestamps", *services],
            env=environment,
            check=False,
        )
        (logs_dir / f"{block_name}.log").write_text(logs.stdout + logs.stderr)
        if keep_containers and (result is None or not result.valid):
            logger.warning("keeping failed benchmark Compose project %s", project)
        else:
            _ = _run_command([*compose, "down", "-v", "--remove-orphans"], env=environment, check=False)
        if e2b_api_key:
            _redact_secret_in_directory(block_dir, e2b_api_key)
            _redact_secret_in_directory(logs_dir, e2b_api_key)


def _build_harness_image(root: Path) -> str:
    content_hash = _hash_paths(
        root,
        ("dify-agent/benchmarks", "dify-agent/pyproject.toml", "dify-agent/uv.lock"),
    )
    tag = f"dify-agent-bench-harness:{content_hash[:16]}"
    _run_command(
        [
            "docker",
            "build",
            "--progress=plain",
            "-f",
            "dify-agent/benchmarks/Dockerfile",
            "-t",
            tag,
            ".",
        ],
        cwd=root,
    )
    return tag


def _build_target_images(root: Path, *, mode: BenchmarkMode) -> TargetIdentity:
    commit = _run_command(["git", "rev-parse", "HEAD"], cwd=root).stdout.strip()
    dirty_paths = [*_AGENT_INPUTS, "dify-agent/benchmarks"]
    if mode == "local-runtime":
        dirty_paths.extend(_RUNTIME_INPUTS)
    dirty = bool(
        _run_command(["git", "status", "--porcelain", "--", *dirty_paths], cwd=root).stdout.strip()
    )
    content_hash = _hash_paths(root, _AGENT_INPUTS)
    agent_tag = f"dify-agent-bench:{commit[:12]}-{content_hash[:12]}"
    _run_command(
        [
            "docker",
            "build",
            "--progress=plain",
            "-f",
            "dify-agent/Dockerfile",
            "--build-arg",
            f"COMMIT_SHA={commit}",
            "-t",
            agent_tag,
            ".",
        ],
        cwd=root,
    )
    agent_id = _image_id(agent_tag)
    _remember_image_tag(agent_id, agent_tag)
    runtime_id: str | None = None
    if mode == "local-runtime":
        runtime_hash = _hash_paths(root, _RUNTIME_INPUTS)
        runtime_base_tag = f"dify-agent-runtime-bench-base:{runtime_hash[:16]}"
        runtime_tag = f"dify-agent-runtime-bench:{runtime_hash[:16]}"
        _run_command(
            [
                "docker",
                "build",
                "--progress=plain",
                "-f",
                "docker/Dockerfile",
                "-t",
                runtime_base_tag,
                ".",
            ],
            cwd=root / "dify-agent-runtime",
        )
        _run_command(
            [
                "docker",
                "build",
                "--progress=plain",
                "-f",
                "dify-agent/benchmarks/runtime.Dockerfile",
                "--build-arg",
                f"BENCH_RUNTIME_BASE_IMAGE={runtime_base_tag}",
                "-t",
                runtime_tag,
                ".",
            ],
            cwd=root,
        )
        runtime_id = _image_id(runtime_tag)
        _remember_image_tag(runtime_id, runtime_tag)
        content_hash = hashlib.sha256(f"{content_hash}:{runtime_hash}".encode()).hexdigest()
    return TargetIdentity(
        commit=commit,
        dirty=dirty,
        content_hash=content_hash,
        agent_image_id=agent_id,
        runtime_image_id=runtime_id,
    )


_IMAGE_TAGS: dict[str, str] = {}


def _remember_image_tag(image_id: str, tag: str) -> None:
    _IMAGE_TAGS[image_id] = tag


def _image_tag_from_id(image_id: str | None) -> str:
    if image_id is None:
        return ""
    try:
        return _IMAGE_TAGS[image_id]
    except KeyError as exc:
        raise BenchmarkCommandError(f"no local image tag was registered for {image_id}") from exc


def _image_id(tag: str) -> str:
    payload = json.loads(_run_command(["docker", "image", "inspect", tag]).stdout)
    return str(payload[0]["Id"])


def _capture_environment(
    root: Path,
    *,
    mode: BenchmarkMode,
    e2b_template: str | None,
) -> EnvironmentFingerprint:
    docker_info = json.loads(_run_command(["docker", "info", "--format", "{{json .}}"]).stdout)
    server = json.loads(_run_command(["docker", "version", "--format", "{{json .Server}}"]).stdout)
    compose_file = root / "dify-agent" / "benchmarks" / _COMPOSE_FILE
    limits = {
        name: value
        for name, value in _RESOURCE_LIMITS.items()
        if name not in ({"runtime"} if mode == "local-e2b" else {"agent-stub-proxy"})
    }
    return EnvironmentFingerprint(
        captured_at=datetime.now(timezone.utc).isoformat(),
        os=str(docker_info.get("OperatingSystem", "")),
        architecture=str(docker_info.get("Architecture", "")),
        kernel=str(docker_info.get("KernelVersion", "")),
        cpu_model=_cpu_model(),
        docker_engine=str(server.get("Version", "")),
        docker_compose=_run_command(["docker", "compose", "version", "--short"]).stdout.strip(),
        docker_cpus=int(docker_info.get("NCPU", 0)),
        docker_memory_bytes=int(docker_info.get("MemTotal", 0)),
        compose_hash=_hash_file(compose_file),
        harness_hash=_hash_paths(
            root,
            ("dify-agent/benchmarks", "dify-agent/pyproject.toml", "dify-agent/uv.lock"),
        ),
        scenario_manifest_hash=_hash_file(
            root / "dify-agent" / "benchmarks" / "capacity_scenarios.json"
        ),
        redis_image=_REDIS_IMAGE,
        e2b_template=e2b_template,
        resource_limits=limits,
    )


def _invalid_point(matrix_point: CapacityMatrixPoint, reason: str) -> CapacityPoint:
    return CapacityPoint(
        mode=matrix_point.mode,
        scenario_id=matrix_point.scenario.id,
        workload=cast(CapacityWorkload, matrix_point.scenario.workload),
        requested_concurrency=matrix_point.requested_concurrency,
        observed_max_active=0,
        attempted_runs=0,
        successful_runs=0,
        timeout_runs=0,
        throttle_runs=0,
        success_rate=0,
        runs_per_second=0,
        status="invalid",
        reasons=[reason],
    )


def _write_combined_artifacts(invocation_dir: Path, blocks: Sequence[BlockResult]) -> None:
    with (invocation_dir / "samples.jsonl").open("w") as output:
        for block in blocks:
            for sample in block.samples:
                output.write(sample.model_dump_json())
                output.write("\n")
    with (invocation_dir / "docker-stats.jsonl").open("w") as output:
        for block in blocks:
            path = invocation_dir / "blocks" / f"{block.scenario_id}-c{block.requested_concurrency}" / "docker-stats.jsonl"
            if path.exists():
                output.write(path.read_text())
    _write_json(
        invocation_dir / "redis-stats.json",
        [
            {
                "scenario_id": block.scenario_id,
                "concurrency": block.requested_concurrency,
                "before": block.redis_before,
                "after": block.redis_after,
            }
            for block in blocks
        ],
    )


def _check_runtime_cleanup(
    compose: Sequence[str],
    environment: dict[str, str],
) -> tuple[bool, str]:
    script = "\n".join(
        [
            "set -eu",
            "python - <<'PY'",
            "import pathlib, sqlite3",
            "db = pathlib.Path('/state/shellctl.db')",
            "if db.exists():",
            "    with sqlite3.connect(db) as connection:",
            "        count = connection.execute('select count(*) from jobs').fetchone()[0]",
            "    assert count == 0, f'{count} SQLite job rows remain'",
            "PY",
            "for path in /state/jobs /state/materialized-homes /state/workspaces /state/home-snapshots; do",
            '  test ! -d "$path" || test -z "$(find "$path" -mindepth 1 -print -quit)"',
            "done",
        ]
    )
    result = _run_command(
        [*compose, "exec", "-T", "runtime", "sh", "-c", script],
        env=environment,
        check=False,
    )
    return result.returncode == 0, result.stdout + result.stderr


def _available_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return cast(int, listener.getsockname()[1])


def _start_agent_stub_tunnel(*, name: str, host_port: int, log_path: Path) -> str:
    result = _run_command(
        [
            "docker",
            "run",
            "-d",
            "--rm",
            "--name",
            name,
            "--label",
            "com.dify.benchmark=true",
            "--add-host",
            "host.docker.internal:host-gateway",
            _CLOUDFLARED_IMAGE,
            "tunnel",
            "--no-autoupdate",
            "--protocol",
            "http2",
            "--url",
            f"http://host.docker.internal:{host_port}",
        ],
        check=False,
    )
    if result.returncode != 0:
        raise BenchmarkCommandError(f"could not start temporary Agent Stub tunnel: {result.stderr}")
    latest_logs = ""
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            logs = _run_command(["docker", "logs", name], check=False)
            latest_logs = logs.stdout + logs.stderr
            match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", latest_logs)
            if match:
                log_path.write_text(latest_logs)
                return match.group(0)
            inspect = _run_command(["docker", "inspect", "--format", "{{.State.Running}}", name], check=False)
            if inspect.returncode != 0 or inspect.stdout.strip() != "true":
                break
            time.sleep(0.5)
    except BaseException:
        _stop_agent_stub_tunnel(name=name, log_path=log_path)
        raise
    _stop_agent_stub_tunnel(name=name, log_path=log_path)
    raise BenchmarkCommandError("temporary Agent Stub tunnel did not publish a URL within 30 seconds")


def _wait_for_public_proxy(
    health_url: str,
    *,
    compose: Sequence[str],
    environment: dict[str, str],
) -> None:
    deadline = time.monotonic() + 120
    script = "\n".join(
        [
            "import sys, urllib.request",
            "opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))",
            "with opener.open(sys.argv[1], timeout=5) as response:",
            "    raise SystemExit(0 if response.status == 200 else 1)",
        ]
    )
    while time.monotonic() < deadline:
        result = _run_command(
            [*compose, "exec", "-T", "agent-stub-proxy", "python", "-c", script, health_url],
            env=environment,
            check=False,
        )
        if result.returncode == 0:
            return
        time.sleep(0.5)
    raise BenchmarkCommandError("temporary Agent Stub tunnel was not reachable within 120 seconds")


def _services_for_point(point: CapacityMatrixPoint) -> tuple[str, ...]:
    if point.mode == "local-runtime":
        return ("redis", "fake-deps", "runtime", "agent")
    if point.scenario.workload == "basic":
        return ("redis", "fake-deps", "agent")
    return ("redis", "fake-deps", "agent", "agent-stub-proxy")


def _stop_agent_stub_tunnel(*, name: str, log_path: Path) -> None:
    logs = _run_command(["docker", "logs", name], check=False)
    if logs.stdout or logs.stderr:
        log_path.write_text(logs.stdout + logs.stderr)
    _ = _run_command(["docker", "stop", "--time", "5", name], check=False)


def _redact_secret_in_directory(directory: Path, secret: str) -> None:
    if not secret:
        return
    for path in directory.rglob("*"):
        if not path.is_file():
            continue
        try:
            content = path.read_text()
        except UnicodeDecodeError:
            continue
        if secret in content:
            path.write_text(content.replace(secret, "[redacted]"))


def _verify_docker_environment(mode: BenchmarkMode) -> None:
    _run_command(["docker", "info"])
    _run_command(["docker", "compose", "version"])
    if mode == "local-e2b":
        pull = _run_command(["docker", "pull", "--quiet", _CLOUDFLARED_IMAGE], check=False)
        inspect = _run_command(["docker", "image", "inspect", _CLOUDFLARED_IMAGE], check=False)
        if pull.returncode != 0 or inspect.returncode != 0:
            raise BenchmarkCommandError(
                "could not pull or inspect the pinned Cloudflare tunnel image\n"
                f"{pull.stdout}{pull.stderr}{inspect.stdout}{inspect.stderr}"
            )


def _hash_paths(root: Path, relative_paths: Iterable[str]) -> str:
    digest = hashlib.sha256()
    for relative in sorted(relative_paths):
        path = root / relative
        if path.is_file():
            paths = [path]
        elif path.is_dir():
            paths = sorted(candidate for candidate in path.rglob("*") if candidate.is_file())
        else:
            continue
        for candidate in paths:
            digest.update(str(candidate.relative_to(root)).encode())
            digest.update(b"\0")
            digest.update(candidate.read_bytes())
            digest.update(b"\0")
    return digest.hexdigest()


def _hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _compose_project_name(invocation_id: str, block_name: str) -> str:
    raw = f"dify-agent-bench-{invocation_id[-10:]}-{block_name}"
    return re.sub(r"[^a-z0-9_-]", "-", raw.lower())[:63]


def _new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")


def _cpu_model() -> str:
    if platform.system() == "Darwin":
        result = _run_command(["sysctl", "-n", "machdep.cpu.brand_string"], check=False)
        if result.returncode == 0:
            return result.stdout.strip()
    return platform.processor()


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(_json_value(value), indent=2, sort_keys=True))


def _json_value(value: object) -> object:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def _run_command(
    command: Sequence[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        list(command),
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and result.returncode != 0:
        raise BenchmarkCommandError(
            f"command failed ({result.returncode}): {' '.join(command)}\n{result.stdout}{result.stderr}"
        )
    return result


def _parse_args() -> CapacityOptions:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("local-runtime", "local-e2b"))
    parser.add_argument("--scenario", choices=("basic", "shell", "resume", "config", "file"))
    parser.add_argument("--concurrency", type=int, choices=CONCURRENCY_LEVELS)
    parser.add_argument("--keep-containers", action="store_true")
    parser.add_argument("--results-root", type=Path)
    args = parser.parse_args()
    mode = cast(BenchmarkMode, args.mode)
    return CapacityOptions(
        mode=mode,
        keep_containers=cast(bool, args.keep_containers),
        scenario_id=cast(str | None, args.scenario),
        concurrency=cast(int | None, args.concurrency),
        results_root=cast(Path | None, args.results_root),
        e2b_api_key=os.environ.get("BENCH_E2B_API_KEY") if mode == "local-e2b" else None,
        e2b_template=os.environ.get("BENCH_E2B_TEMPLATE") if mode == "local-e2b" else None,
        e2b_max_concurrency=(
            int(os.environ["BENCH_E2B_MAX_CONCURRENCY"])
            if mode == "local-e2b" and os.environ.get("BENCH_E2B_MAX_CONCURRENCY")
            else None
        ),
    )


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        results_dir, success = run_capacity(_parse_args())
    except (BenchmarkCommandError, ValueError) as exc:
        logger.error("%s", exc)
        return 1
    print(results_dir)
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "BenchmarkCommandError",
    "CapacityOptions",
    "repository_root",
    "run_capacity",
]

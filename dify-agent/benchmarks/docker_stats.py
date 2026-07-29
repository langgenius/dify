"""Docker Engine resource sampling for one local benchmark block."""

from __future__ import annotations

from pathlib import Path
import threading
import time
from typing import ClassVar, cast

import docker  # pyright: ignore[reportMissingTypeStubs]
from docker.models.containers import Container  # pyright: ignore[reportMissingTypeStubs]
from pydantic import BaseModel, ConfigDict

from benchmarks.schemas import ResourceSummary, StatsCoverage


class DockerStatsSample(BaseModel):
    """Small stable subset of the Docker Engine stats payload."""

    service: str
    sampled_at_ns: int
    cpu_total_ns: int
    memory_usage_bytes: int
    memory_limit_bytes: int
    network_rx_bytes: int
    network_tx_bytes: int
    block_read_bytes: int
    block_write_bytes: int
    pids: int

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DockerStatsSampler:
    """Collect streaming Docker stats for Agent, Redis, and Fake containers."""

    def __init__(self, containers: dict[str, str]) -> None:
        self._container_ids = containers
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []
        self._samples: list[DockerStatsSample] = []
        self._errors: list[str] = []
        self._lock = threading.Lock()

    @property
    def samples(self) -> list[DockerStatsSample]:
        """Return samples ordered by host receive time."""
        with self._lock:
            return sorted(self._samples, key=lambda sample: sample.sampled_at_ns)

    @property
    def errors(self) -> list[str]:
        """Return non-fatal sampler errors."""
        with self._lock:
            return list(self._errors)

    def start(self) -> None:
        """Start one Docker stats stream per requested service."""
        for service, container_id in self._container_ids.items():
            thread = threading.Thread(
                target=self._sample_container,
                args=(service, container_id),
                name=f"dify-agent-benchmark-stats-{service}",
                daemon=True,
            )
            self._threads.append(thread)
            thread.start()

    def stop(self) -> None:
        """Stop sampling and wait briefly for streaming requests to return."""
        self._stop_event.set()
        for thread in self._threads:
            thread.join(timeout=5)

    def write_jsonl(self, path: Path) -> None:
        """Persist selected raw samples for later inspection."""
        with path.open("w") as output:
            for sample in self.samples:
                output.write(sample.model_dump_json())
                output.write("\n")

    def _sample_container(self, service: str, container_id: str) -> None:
        try:
            client = docker.from_env()
            container = cast(Container, client.containers.get(container_id))
            while not self._stop_event.is_set():
                raw_sample = container.stats(stream=False, one_shot=True)
                parsed = parse_docker_stats(
                    service=service,
                    sampled_at_ns=time.time_ns(),
                    raw=cast(dict[str, object], raw_sample),
                )
                with self._lock:
                    self._samples.append(parsed)
                _ = self._stop_event.wait(0.02)
            client.close()
        except Exception as exc:
            with self._lock:
                self._errors.append(f"{service}: {type(exc).__name__}: {exc}")


def parse_docker_stats(
    *,
    service: str,
    sampled_at_ns: int,
    raw: dict[str, object],
) -> DockerStatsSample:
    """Normalize the nested Docker Engine stats payload."""
    cpu_stats = _mapping(raw.get("cpu_stats"))
    cpu_usage = _mapping(cpu_stats.get("cpu_usage"))
    memory_stats = _mapping(raw.get("memory_stats"))
    pids_stats = _mapping(raw.get("pids_stats"))
    network_rx = 0
    network_tx = 0
    for network in _mapping(raw.get("networks")).values():
        network_mapping = _mapping(network)
        network_rx += _integer(network_mapping.get("rx_bytes"))
        network_tx += _integer(network_mapping.get("tx_bytes"))
    block_read = 0
    block_write = 0
    block_io = _mapping(raw.get("blkio_stats"))
    recursive_entries = block_io.get("io_service_bytes_recursive")
    if isinstance(recursive_entries, list):
        for entry in recursive_entries:
            entry_mapping = _mapping(entry)
            operation = entry_mapping.get("op")
            value = _integer(entry_mapping.get("value"))
            if operation == "read":
                block_read += value
            elif operation == "write":
                block_write += value
    return DockerStatsSample(
        service=service,
        sampled_at_ns=sampled_at_ns,
        cpu_total_ns=_integer(cpu_usage.get("total_usage")),
        memory_usage_bytes=_integer(memory_stats.get("usage")),
        memory_limit_bytes=_integer(memory_stats.get("limit")),
        network_rx_bytes=network_rx,
        network_tx_bytes=network_tx,
        block_read_bytes=block_read,
        block_write_bytes=block_write,
        pids=_integer(pids_stats.get("current")),
    )


def summarize_resource_window(
    *,
    samples: list[DockerStatsSample],
    measurement_started_at_ns: int,
    measurement_ended_at_ns: int,
    completed_runs: int,
    fake_allocated_cpus: float = 2,
) -> ResourceSummary:
    """Calculate cost-oriented container metrics for the timed window."""
    agent_samples = [sample for sample in samples if sample.service == "agent"]
    redis_samples = [sample for sample in samples if sample.service == "redis"]
    fake_samples = [sample for sample in samples if sample.service == "fake-deps"]
    denominator = completed_runs if completed_runs > 0 else None
    agent_start, agent_end = _window_endpoints(agent_samples, measurement_started_at_ns, measurement_ended_at_ns)
    redis_start, redis_end = _window_endpoints(redis_samples, measurement_started_at_ns, measurement_ended_at_ns)
    bounded_agent = _bounded_samples(agent_samples, measurement_started_at_ns, measurement_ended_at_ns)
    bounded_redis = _bounded_samples(redis_samples, measurement_started_at_ns, measurement_ended_at_ns)
    bounded_fake = _bounded_samples(fake_samples, measurement_started_at_ns, measurement_ended_at_ns)
    return ResourceSummary(
        agent_cpu_seconds_per_successful_run=_cpu_seconds_per_run(agent_start, agent_end, denominator),
        agent_peak_memory_delta_bytes=_peak_memory_delta(bounded_agent, agent_start),
        agent_memory_gb_seconds_per_successful_run=_memory_gb_seconds_per_run(
            bounded_agent,
            measurement_started_at_ns,
            measurement_ended_at_ns,
            denominator,
        ),
        agent_network_bytes_per_successful_run=_network_bytes_per_run(agent_start, agent_end, denominator),
        redis_cpu_seconds_per_successful_run=_cpu_seconds_per_run(redis_start, redis_end, denominator),
        redis_memory_gb_seconds_per_successful_run=_memory_gb_seconds_per_run(
            bounded_redis,
            measurement_started_at_ns,
            measurement_ended_at_ns,
            denominator,
        ),
        fake_cpu_p95_percent=_cpu_percent_quantile(
            bounded_fake,
            allocated_cpus=fake_allocated_cpus,
            probability=0.95,
        ),
        agent_stats_coverage=_stats_coverage(
            agent_samples,
            measurement_started_at_ns,
            measurement_ended_at_ns,
        ),
        redis_stats_coverage=_stats_coverage(
            redis_samples,
            measurement_started_at_ns,
            measurement_ended_at_ns,
        ),
        fake_stats_coverage=_stats_coverage(
            fake_samples,
            measurement_started_at_ns,
            measurement_ended_at_ns,
        ),
    )


def _window_endpoints(
    samples: list[DockerStatsSample],
    start_ns: int,
    end_ns: int,
) -> tuple[DockerStatsSample | None, DockerStatsSample | None]:
    if not samples:
        return None, None
    ordered = sorted(samples, key=lambda sample: sample.sampled_at_ns)
    before_start = [sample for sample in ordered if sample.sampled_at_ns <= start_ns]
    after_end = [sample for sample in ordered if sample.sampled_at_ns >= end_ns]
    start_sample = before_start[-1] if before_start else ordered[0]
    end_sample = after_end[0] if after_end else ordered[-1]
    return start_sample, end_sample


def _samples_in_window(
    samples: list[DockerStatsSample],
    start_ns: int,
    end_ns: int,
) -> list[DockerStatsSample]:
    return [sample for sample in samples if start_ns <= sample.sampled_at_ns <= end_ns]


def _bounded_samples(
    samples: list[DockerStatsSample],
    start_ns: int,
    end_ns: int,
) -> list[DockerStatsSample]:
    start_sample, end_sample = _window_endpoints(samples, start_ns, end_ns)
    selected = _samples_in_window(samples, start_ns, end_ns)
    if start_sample is not None:
        selected.append(start_sample)
    if end_sample is not None:
        selected.append(end_sample)
    return sorted(
        {sample.sampled_at_ns: sample for sample in selected}.values(),
        key=lambda sample: sample.sampled_at_ns,
    )


def _cpu_seconds_per_run(
    start_sample: DockerStatsSample | None,
    end_sample: DockerStatsSample | None,
    denominator: int | None,
) -> float | None:
    if start_sample is None or end_sample is None or denominator is None:
        return None
    return max(0, end_sample.cpu_total_ns - start_sample.cpu_total_ns) / 1_000_000_000 / denominator


def _network_bytes_per_run(
    start_sample: DockerStatsSample | None,
    end_sample: DockerStatsSample | None,
    denominator: int | None,
) -> float | None:
    if start_sample is None or end_sample is None or denominator is None:
        return None
    rx_delta = max(0, end_sample.network_rx_bytes - start_sample.network_rx_bytes)
    tx_delta = max(0, end_sample.network_tx_bytes - start_sample.network_tx_bytes)
    return (rx_delta + tx_delta) / denominator


def _peak_memory_delta(
    bounded_samples: list[DockerStatsSample],
    start_sample: DockerStatsSample | None,
) -> int | None:
    if not bounded_samples or start_sample is None:
        return None
    peak = max(sample.memory_usage_bytes for sample in bounded_samples)
    return max(0, peak - start_sample.memory_usage_bytes)


def _memory_gb_seconds_per_run(
    bounded_samples: list[DockerStatsSample],
    start_ns: int,
    end_ns: int,
    denominator: int | None,
) -> float | None:
    if len(bounded_samples) < 2 or denominator is None:
        return None
    points = [
        (
            min(end_ns, max(start_ns, sample.sampled_at_ns)),
            sample.memory_usage_bytes,
        )
        for sample in bounded_samples
    ]
    memory_byte_nanoseconds = 0.0
    for (previous_ns, previous_bytes), (current_ns, current_bytes) in zip(points, points[1:], strict=False):
        elapsed_ns = current_ns - previous_ns
        if elapsed_ns > 0:
            memory_byte_nanoseconds += elapsed_ns * (previous_bytes + current_bytes) / 2
    return memory_byte_nanoseconds / 1_000_000_000 / (1024**3) / denominator


def _stats_coverage(
    samples: list[DockerStatsSample],
    start_ns: int,
    end_ns: int,
) -> StatsCoverage:
    start_sample, end_sample = _window_endpoints(samples, start_ns, end_ns)
    return StatsCoverage(
        sample_count=len(samples),
        in_window_sample_count=len(_samples_in_window(samples, start_ns, end_ns)),
        start_gap_ms=(
            abs(start_ns - start_sample.sampled_at_ns) / 1_000_000
            if start_sample is not None
            else None
        ),
        end_gap_ms=(
            abs(end_sample.sampled_at_ns - end_ns) / 1_000_000
            if end_sample is not None
            else None
        ),
        window_covered=(
            start_sample is not None
            and end_sample is not None
            and start_sample.sampled_at_ns <= start_ns
            and end_sample.sampled_at_ns >= end_ns
        ),
    )


def _cpu_percent_quantile(
    samples: list[DockerStatsSample],
    *,
    allocated_cpus: float,
    probability: float,
) -> float | None:
    percentages: list[float] = []
    for previous, current in zip(samples, samples[1:], strict=False):
        elapsed_ns = current.sampled_at_ns - previous.sampled_at_ns
        if elapsed_ns <= 0:
            continue
        cpu_delta_ns = max(0, current.cpu_total_ns - previous.cpu_total_ns)
        percentages.append(cpu_delta_ns / elapsed_ns / allocated_cpus * 100)
    if not percentages:
        return None
    ordered = sorted(percentages)
    index = round((len(ordered) - 1) * probability)
    return ordered[index]


def _mapping(value: object) -> dict[str, object]:
    return cast(dict[str, object], value) if isinstance(value, dict) else {}


def _integer(value: object) -> int:
    return int(value) if isinstance(value, int | float | str) else 0


__all__ = [
    "DockerStatsSample",
    "DockerStatsSampler",
    "parse_docker_stats",
    "summarize_resource_window",
]

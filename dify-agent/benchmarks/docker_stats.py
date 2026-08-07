"""Docker Engine sampling and friendly per-Run resource units."""

from __future__ import annotations

from pathlib import Path
import threading
import time
from typing import ClassVar, cast

import docker  # pyright: ignore[reportMissingTypeStubs]
from docker.models.containers import Container  # pyright: ignore[reportMissingTypeStubs]
from pydantic import BaseModel, ConfigDict

from benchmarks.schemas import ComponentResourceSummary, ResourceSummary, StatsCoverage


class DockerStatsSample(BaseModel):
    """Stable subset of one Docker Engine stats payload."""

    service: str
    sampled_at_ns: int
    cpu_total_ns: int
    memory_usage_bytes: int
    memory_working_set_bytes: int
    memory_limit_bytes: int
    network_rx_bytes: int
    network_tx_bytes: int
    pids: int

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DockerStatsSampler:
    """Continuously sample selected containers until the block finishes."""

    def __init__(self, containers: dict[str, str]) -> None:
        self._container_ids = containers
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []
        self._samples: list[DockerStatsSample] = []
        self._errors: list[str] = []
        self._lock = threading.Lock()

    @property
    def samples(self) -> list[DockerStatsSample]:
        with self._lock:
            return sorted(self._samples, key=lambda sample: sample.sampled_at_ns)

    @property
    def errors(self) -> list[str]:
        with self._lock:
            return list(self._errors)

    def start(self) -> None:
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
        self._stop_event.set()
        for thread in self._threads:
            thread.join(timeout=5)

    def write_jsonl(self, path: Path) -> None:
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
                _ = self._stop_event.wait(0.05)
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
    """Normalize CPU counters, working set, network counters, and PIDs."""
    cpu_stats = _mapping(raw.get("cpu_stats"))
    cpu_usage = _mapping(cpu_stats.get("cpu_usage"))
    memory_stats = _mapping(raw.get("memory_stats"))
    memory_detail = _mapping(memory_stats.get("stats"))
    usage = _integer(memory_stats.get("usage"))
    inactive_file = _integer(memory_detail.get("total_inactive_file", memory_detail.get("inactive_file")))
    network_rx = 0
    network_tx = 0
    for network in _mapping(raw.get("networks")).values():
        network_mapping = _mapping(network)
        network_rx += _integer(network_mapping.get("rx_bytes"))
        network_tx += _integer(network_mapping.get("tx_bytes"))
    return DockerStatsSample(
        service=service,
        sampled_at_ns=sampled_at_ns,
        cpu_total_ns=_integer(cpu_usage.get("total_usage")),
        memory_usage_bytes=usage,
        memory_working_set_bytes=max(0, usage - inactive_file),
        memory_limit_bytes=_integer(memory_stats.get("limit")),
        network_rx_bytes=network_rx,
        network_tx_bytes=network_tx,
        pids=_integer(_mapping(raw.get("pids_stats")).get("current")),
    )


def summarize_resource_window(
    *,
    samples: list[DockerStatsSample],
    measurement_started_at_ns: int,
    measurement_ended_at_ns: int,
    completed_runs: int,
    measured_services: tuple[str, ...],
    fake_allocated_cpus: float = 2,
) -> ResourceSummary:
    """Calculate CPU-ms/run, absolute working-set peak, and bytes/run."""
    denominator = completed_runs if completed_runs > 0 else None
    components: dict[str, ComponentResourceSummary] = {}
    for service in measured_services:
        service_samples = [sample for sample in samples if sample.service == service]
        start_sample, end_sample = _window_endpoints(
            service_samples,
            measurement_started_at_ns,
            measurement_ended_at_ns,
        )
        bounded = _bounded_samples(service_samples, measurement_started_at_ns, measurement_ended_at_ns)
        components[service] = ComponentResourceSummary(
            cpu_ms_per_run=_cpu_ms_per_run(start_sample, end_sample, denominator),
            memory_peak_mib=(
                max((sample.memory_working_set_bytes for sample in bounded), default=0) / 1024**2 if bounded else None
            ),
            network_bytes_per_run=_network_bytes_per_run(start_sample, end_sample, denominator),
            peak_pids=max((sample.pids for sample in bounded), default=None),
            stats_coverage=_stats_coverage(
                service_samples,
                measurement_started_at_ns,
                measurement_ended_at_ns,
            ),
        )
    fake_samples = _bounded_samples(
        [sample for sample in samples if sample.service == "fake-deps"],
        measurement_started_at_ns,
        measurement_ended_at_ns,
    )
    return ResourceSummary(
        components=components,
        fake_cpu_p95_percent=_cpu_percent_quantile(
            fake_samples,
            allocated_cpus=fake_allocated_cpus,
            probability=0.95,
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
    return (
        before_start[-1] if before_start else ordered[0],
        after_end[0] if after_end else ordered[-1],
    )


def _bounded_samples(
    samples: list[DockerStatsSample],
    start_ns: int,
    end_ns: int,
) -> list[DockerStatsSample]:
    start_sample, end_sample = _window_endpoints(samples, start_ns, end_ns)
    selected = [sample for sample in samples if start_ns <= sample.sampled_at_ns <= end_ns]
    if start_sample is not None:
        selected.append(start_sample)
    if end_sample is not None:
        selected.append(end_sample)
    return sorted(
        {sample.sampled_at_ns: sample for sample in selected}.values(),
        key=lambda sample: sample.sampled_at_ns,
    )


def _cpu_ms_per_run(
    start_sample: DockerStatsSample | None,
    end_sample: DockerStatsSample | None,
    denominator: int | None,
) -> float | None:
    if start_sample is None or end_sample is None or denominator is None:
        return None
    return max(0, end_sample.cpu_total_ns - start_sample.cpu_total_ns) / 1_000_000 / denominator


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


def _stats_coverage(
    samples: list[DockerStatsSample],
    start_ns: int,
    end_ns: int,
) -> StatsCoverage:
    start_sample, end_sample = _window_endpoints(samples, start_ns, end_ns)
    return StatsCoverage(
        sample_count=len(samples),
        in_window_sample_count=sum(start_ns <= sample.sampled_at_ns <= end_ns for sample in samples),
        start_gap_ms=(abs(start_ns - start_sample.sampled_at_ns) / 1_000_000 if start_sample else None),
        end_gap_ms=(abs(end_sample.sampled_at_ns - end_ns) / 1_000_000 if end_sample else None),
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
    values: list[float] = []
    for previous, current in zip(samples, samples[1:], strict=False):
        elapsed_ns = current.sampled_at_ns - previous.sampled_at_ns
        if elapsed_ns <= 0:
            continue
        cpu_delta_ns = max(0, current.cpu_total_ns - previous.cpu_total_ns)
        values.append(cpu_delta_ns / elapsed_ns / allocated_cpus * 100)
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, round((len(ordered) - 1) * probability))
    return ordered[index]


def _mapping(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _integer(value: object) -> int:
    return int(value) if isinstance(value, (int, float)) else 0


__all__ = [
    "DockerStatsSample",
    "DockerStatsSampler",
    "parse_docker_stats",
    "summarize_resource_window",
]

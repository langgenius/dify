import pytest

from benchmarks.docker_stats import DockerStatsSample, parse_docker_stats, summarize_resource_window


def test_parse_docker_stats_sums_networks_and_block_io() -> None:
    sample = parse_docker_stats(
        service="agent",
        sampled_at_ns=100,
        raw={
            "cpu_stats": {"cpu_usage": {"total_usage": 500}},
            "memory_stats": {"usage": 1024, "limit": 4096},
            "networks": {
                "eth0": {"rx_bytes": 10, "tx_bytes": 20},
                "eth1": {"rx_bytes": 3, "tx_bytes": 4},
            },
            "blkio_stats": {
                "io_service_bytes_recursive": [
                    {"op": "read", "value": 7},
                    {"op": "write", "value": 9},
                ]
            },
            "pids_stats": {"current": 6},
        },
    )

    assert sample.cpu_total_ns == 500
    assert sample.network_rx_bytes == 13
    assert sample.network_tx_bytes == 24
    assert sample.block_read_bytes == 7
    assert sample.block_write_bytes == 9
    assert sample.pids == 6


def test_summarize_resource_window_normalizes_agent_deltas() -> None:
    samples = [
        DockerStatsSample(
            service="agent",
            sampled_at_ns=90_000_000,
            cpu_total_ns=1_000_000_000,
            memory_usage_bytes=100,
            memory_limit_bytes=1000,
            network_rx_bytes=10,
            network_tx_bytes=20,
            block_read_bytes=0,
            block_write_bytes=0,
            pids=3,
        ),
        DockerStatsSample(
            service="agent",
            sampled_at_ns=210_000_000,
            cpu_total_ns=3_000_000_000,
            memory_usage_bytes=200,
            memory_limit_bytes=1000,
            network_rx_bytes=110,
            network_tx_bytes=220,
            block_read_bytes=0,
            block_write_bytes=0,
            pids=3,
        ),
        DockerStatsSample(
            service="redis",
            sampled_at_ns=90_000_000,
            cpu_total_ns=500_000_000,
            memory_usage_bytes=80,
            memory_limit_bytes=1000,
            network_rx_bytes=5,
            network_tx_bytes=10,
            block_read_bytes=0,
            block_write_bytes=0,
            pids=2,
        ),
        DockerStatsSample(
            service="redis",
            sampled_at_ns=210_000_000,
            cpu_total_ns=1_500_000_000,
            memory_usage_bytes=120,
            memory_limit_bytes=1000,
            network_rx_bytes=55,
            network_tx_bytes=110,
            block_read_bytes=0,
            block_write_bytes=0,
            pids=2,
        ),
        DockerStatsSample(
            service="fake-deps",
            sampled_at_ns=90_000_000,
            cpu_total_ns=1_000_000_000,
            memory_usage_bytes=50,
            memory_limit_bytes=1000,
            network_rx_bytes=0,
            network_tx_bytes=0,
            block_read_bytes=0,
            block_write_bytes=0,
            pids=2,
        ),
        DockerStatsSample(
            service="fake-deps",
            sampled_at_ns=150_000_000,
            cpu_total_ns=1_050_000_000,
            memory_usage_bytes=50,
            memory_limit_bytes=1000,
            network_rx_bytes=0,
            network_tx_bytes=0,
            block_read_bytes=0,
            block_write_bytes=0,
            pids=2,
        ),
        DockerStatsSample(
            service="fake-deps",
            sampled_at_ns=210_000_000,
            cpu_total_ns=1_100_000_000,
            memory_usage_bytes=50,
            memory_limit_bytes=1000,
            network_rx_bytes=0,
            network_tx_bytes=0,
            block_read_bytes=0,
            block_write_bytes=0,
            pids=2,
        ),
    ]

    summary = summarize_resource_window(
        samples=samples,
        measurement_started_at_ns=100_000_000,
        measurement_ended_at_ns=200_000_000,
        completed_runs=10,
        measured_services=("agent", "redis", "fake-deps"),
        fake_allocated_cpus=2,
    )

    agent = summary.components["agent"]
    redis = summary.components["redis"]
    assert agent.cpu_seconds_per_successful_operation == 0.2
    assert agent.peak_memory_delta_bytes == 100
    assert agent.memory_gb_seconds_per_successful_operation == 15 / (1024**3) / 10
    assert agent.network_bytes_per_successful_operation == 30
    assert redis.cpu_seconds_per_successful_operation == 0.1
    assert redis.memory_gb_seconds_per_successful_operation == 10 / (1024**3) / 10
    assert summary.total_cpu_seconds_per_successful_operation == 0.2
    assert summary.total_memory_gb_seconds_per_successful_operation == 15 / (1024**3) / 10
    assert summary.fake_cpu_p95_percent == pytest.approx(41.6666667)
    assert agent.stats_coverage.window_covered is True
    assert redis.stats_coverage.window_covered is True


def test_resource_window_marks_missing_boundary_coverage() -> None:
    sample = DockerStatsSample(
        service="agent",
        sampled_at_ns=150_000_000,
        cpu_total_ns=1,
        memory_usage_bytes=1,
        memory_limit_bytes=1000,
        network_rx_bytes=0,
        network_tx_bytes=0,
        block_read_bytes=0,
        block_write_bytes=0,
        pids=1,
    )

    summary = summarize_resource_window(
        samples=[sample],
        measurement_started_at_ns=100_000_000,
        measurement_ended_at_ns=200_000_000,
        completed_runs=1,
    )

    coverage = summary.components["agent"].stats_coverage
    assert coverage.sample_count == 1
    assert coverage.window_covered is False

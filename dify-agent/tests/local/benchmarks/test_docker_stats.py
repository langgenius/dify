from benchmarks.docker_stats import DockerStatsSample, parse_docker_stats, summarize_resource_window


def _sample(
    *,
    sampled_at_ns: int,
    cpu_total_ns: int,
    working_set: int,
    rx: int,
    tx: int,
) -> DockerStatsSample:
    return DockerStatsSample(
        service="agent",
        sampled_at_ns=sampled_at_ns,
        cpu_total_ns=cpu_total_ns,
        memory_usage_bytes=working_set,
        memory_working_set_bytes=working_set,
        memory_limit_bytes=256 * 1024**2,
        network_rx_bytes=rx,
        network_tx_bytes=tx,
        pids=4,
    )


def test_parse_stats_subtracts_inactive_file_from_working_set() -> None:
    sample = parse_docker_stats(
        service="agent",
        sampled_at_ns=1,
        raw={
            "cpu_stats": {"cpu_usage": {"total_usage": 10}},
            "memory_stats": {
                "usage": 1000,
                "limit": 2000,
                "stats": {"total_inactive_file": 250},
            },
            "networks": {"eth0": {"rx_bytes": 10, "tx_bytes": 20}},
            "pids_stats": {"current": 3},
        },
    )

    assert sample.memory_working_set_bytes == 750


def test_summary_reports_cpu_ms_absolute_peak_and_network_per_run() -> None:
    start = 1_000_000_000
    end = 2_000_000_000
    samples = [
        _sample(
            sampled_at_ns=start - 1,
            cpu_total_ns=1_000_000_000,
            working_set=100 * 1024**2,
            rx=100,
            tx=200,
        ),
        _sample(
            sampled_at_ns=(start + end) // 2,
            cpu_total_ns=1_500_000_000,
            working_set=150 * 1024**2,
            rx=600,
            tx=700,
        ),
        _sample(
            sampled_at_ns=end + 1,
            cpu_total_ns=2_000_000_000,
            working_set=120 * 1024**2,
            rx=1100,
            tx=1200,
        ),
    ]

    result = summarize_resource_window(
        samples=samples,
        measurement_started_at_ns=start,
        measurement_ended_at_ns=end,
        completed_runs=10,
        measured_services=("agent",),
    )

    agent = result.components["agent"]
    assert agent.cpu_ms_per_run == 100
    assert agent.memory_peak_mib == 150
    assert agent.network_bytes_per_run == 200
    assert agent.stats_coverage.window_covered

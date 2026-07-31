import asyncio

from benchmarks.fake_deps import BenchmarkLedgerStore, _capability_script, app
from benchmarks.scenario import load_scenario_manifest


def test_ledger_store_keeps_concurrent_runs_isolated() -> None:
    async def exercise() -> tuple[str, str]:
        store = BenchmarkLedgerStore()
        scenario = load_scenario_manifest().get("shell")
        await asyncio.gather(
            store.prepare(benchmark_run_id="one", scenario=scenario),
            store.prepare(benchmark_run_id="two", scenario=scenario),
        )
        await store.begin_model_call(benchmark_run_id="one", scenario=scenario)
        return (await store.read("one")).benchmark_run_id, (await store.read("two")).benchmark_run_id

    assert asyncio.run(exercise()) == ("one", "two")


def test_file_script_uses_fixed_payload_and_checksum_roundtrip() -> None:
    script = _capability_script(load_scenario_manifest().get("file"))

    assert "16777216" in script
    assert "dify-agent file upload" in script
    assert "sha256sum" in script


def test_fake_service_has_no_drive_routes() -> None:
    assert all("drive" not in path for route in app.routes if isinstance(path := getattr(route, "path", None), str))

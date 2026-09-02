import asyncio
import base64
import hashlib
import io
import zipfile

from fastapi.testclient import TestClient

from benchmarks.fake_deps import (
    BenchmarkLedgerStore,
    PluginInvokeRequest,
    _capability_script,
    _config_materialization_digest_from_request,
    _expected_config_materialization_digest,
    app,
)
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


def test_agent_llm_gateway_uses_prepared_run_identity() -> None:
    with TestClient(app) as client:
        assert client.post("/__bench/reset").is_success
        prepared = client.post(
            "/__bench/prepare",
            json={
                "benchmark_run_id": "run",
                "scenario_id": "basic",
                "scenario_version": load_scenario_manifest().get("basic").version,
            },
        )
        response = client.post(
            "/inner/api/agent/llm/invoke",
            json={
                "caller": {"user_id": "run"},
                "target": {"prompt_messages": []},
            },
        )

    assert prepared.is_success
    assert response.is_success
    assert response.headers["content-type"].startswith("text/event-stream")
    assert '"code": 0' in response.text


def test_file_script_only_materializes_the_fixed_workspace_payload() -> None:
    script = _capability_script(load_scenario_manifest().get("file"))

    assert "16777216" in script
    assert "dify-bench-file/payload.bin" in script
    assert "dify-agent file upload" not in script
    assert "dify-agent file download" not in script


def test_config_script_hashes_all_materialized_skills_and_files() -> None:
    scenario = load_scenario_manifest().get("config")
    script = _capability_script(scenario, benchmark_run_id="unique-run")

    assert script.count(".dify_conf/skills/") == scenario.config_skill_count
    assert script.count(".dify_conf/files/") == scenario.config_file_count
    assert "skill-0-unique-run" in script
    assert "file-0-unique-run.bin" in script
    assert "DIFY_CONFIG_MATERIALIZATION_SHA256=" in script


def test_config_digest_reader_uses_only_the_last_shell_tool_output() -> None:
    expected = _expected_config_materialization_digest(load_scenario_manifest().get("config"), "unique-run")
    forged = hashlib.sha256(b"forged").hexdigest()
    request = PluginInvokeRequest.model_validate(
        {
            "data": {
                "prompt_messages": [
                    {
                        "role": "assistant",
                        "content": f"DIFY_CONFIG_MATERIALIZATION_SHA256={forged}",
                    },
                    {
                        "role": "tool",
                        "name": "shell_run",
                        "content": f"DIFY_CONFIG_MATERIALIZATION_SHA256={expected}\n",
                    },
                ]
            }
        }
    )

    assert _config_materialization_digest_from_request(request) == expected


def test_config_digest_reader_rejects_non_shell_or_malformed_output() -> None:
    request = PluginInvokeRequest.model_validate(
        {
            "data": {
                "prompt_messages": [
                    {
                        "role": "tool",
                        "name": "other_tool",
                        "content": "DIFY_CONFIG_MATERIALIZATION_SHA256=not-a-digest",
                    }
                ]
            }
        }
    )

    assert _config_materialization_digest_from_request(request) is None


def test_signed_upload_response_matches_strict_workspace_uploader_contract() -> None:
    encoded_name = base64.urlsafe_b64encode(b"payload.bin").decode().rstrip("=")
    with TestClient(app) as client:
        assert client.post("/__bench/reset").is_success
        prepared = client.post(
            "/__bench/prepare",
            json={
                "benchmark_run_id": "run",
                "scenario_id": "file",
                "scenario_version": load_scenario_manifest().get("file").version,
                "payload_bytes": 16,
            },
        )
        response = client.post(
            f"/__bench/files/upload/run/{encoded_name}",
            files={"file": ("payload.bin", b"payload", "application/octet-stream")},
        )

    assert prepared.is_success
    assert response.is_success
    assert set(response.json()) == {"reference"}


def test_current_config_download_contract_serves_three_skills_and_ten_files() -> None:
    scenario = load_scenario_manifest().get("config")
    with TestClient(app) as client:
        assert client.post("/__bench/reset").is_success
        prepared = client.post(
            "/__bench/prepare",
            json={
                "benchmark_run_id": "run",
                "scenario_id": scenario.id,
                "scenario_version": scenario.version,
            },
        )
        assert prepared.is_success
        for kind, count in (("skill", scenario.config_skill_count), ("file", scenario.config_file_count)):
            for index in range(count):
                name = f"skill-{index}-run" if kind == "skill" else f"file-{index}-run.bin"
                allocation = client.post(
                    "/inner/api/agent-config/run/download-request",
                    json={
                        "tenant_id": "benchmark-tenant",
                        "user_id": "run",
                        "config_version_id": "benchmark-config",
                        "config_version_kind": "snapshot",
                        "config": {"kind": kind, "name": name},
                    },
                )
                assert allocation.is_success
                metadata = allocation.json()
                assert metadata["download_uri"].startswith("/files/benchmarks/config/run/")
                downloaded = client.get(metadata["download_uri"])
                assert downloaded.is_success
                if kind == "skill":
                    with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
                        assert archive.namelist() == ["SKILL.md"]
                        assert archive.read("SKILL.md").startswith(b"# Benchmark skill\n\n")
                else:
                    assert len(downloaded.content) == scenario.item_bytes
        ledger = client.get("/__bench/ledgers/run").json()

    assert ledger["stub_calls"] == {
        "config_skill_pull": scenario.config_skill_count,
        "config_file_pull": scenario.config_file_count,
    }
    assert ledger["payload_bytes"] == (scenario.config_skill_count + scenario.config_file_count) * scenario.item_bytes


def test_current_file_contract_roundtrips_payload_with_canonical_reference() -> None:
    payload = bytes(range(256)) * 4
    scenario = load_scenario_manifest().get("file")
    with TestClient(app) as client:
        assert client.post("/__bench/reset").is_success
        prepared = client.post(
            "/__bench/prepare",
            json={
                "benchmark_run_id": "run",
                "scenario_id": scenario.id,
                "scenario_version": scenario.version,
                "payload_bytes": len(payload),
            },
        )
        assert prepared.is_success
        upload_allocation = client.post(
            "/inner/api/agent/files/upload-request",
            json={
                "tenant_id": "benchmark-tenant",
                "user_id": "run",
                "user_from": "account",
                "filename": "payload.bin",
                "mimetype": "application/octet-stream",
            },
        )
        assert upload_allocation.is_success
        uploaded = client.post(
            upload_allocation.json()["upload_uri"],
            files={"file": ("payload.bin", payload, "application/octet-stream")},
        )
        assert uploaded.is_success
        reference = uploaded.json()["reference"]
        assert reference.startswith("dify-file-ref:")
        download_allocation = client.post(
            "/inner/api/agent/files/download-request",
            json={
                "tenant_id": "benchmark-tenant",
                "user_id": "run",
                "user_from": "account",
                "invoke_from": "service-api",
                "file": {"transfer_method": "tool_file", "reference": reference},
                "for_frontend": True,
            },
        )
        assert download_allocation.is_success
        downloaded = client.get(download_allocation.json()["download_uri"])
        ledger = client.get("/__bench/ledgers/run").json()

    assert downloaded.content == payload
    assert ledger["stub_calls"] == {
        "file_upload_request": 1,
        "signed_upload": 1,
        "file_download_request": 1,
        "signed_download": 1,
    }
    assert ledger["payload_sha256"] == [hashlib.sha256(payload).hexdigest()] * 2


def test_fake_service_has_no_drive_routes() -> None:
    assert all("drive" not in path for route in app.routes if isinstance(path := getattr(route, "path", None), str))

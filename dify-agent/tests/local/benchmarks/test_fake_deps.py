import json
from urllib.parse import urlparse

import httpx
import pytest
from graphon.model_runtime.entities.llm_entities import LLMResultChunk

from benchmarks.fake_deps import app
from benchmarks.capability_driver import validate_capability_ledger
from benchmarks.scenario import CapabilityBenchmarkScenario, load_scenario_manifest
from benchmarks.schemas import FakeDependencyLedger
from dify_agent.adapters.llm.provider import DifyPluginDaemonLLMClient
from dify_agent.layers.dify_plugin.tool_client import DifyPluginDaemonToolClient, DifyPluginToolInvokeMessage


def _request_payload(*, run_id: str, scenario_id: str, scenario_version: int = 1) -> dict[str, object]:
    return {
        "data": {
            "credentials": {
                "benchmark_run_id": run_id,
                "scenario_id": scenario_id,
                "scenario_version": scenario_version,
            }
        }
    }


def _capability_request_payload(*, run_id: str, scenario_id: str) -> dict[str, object]:
    payload = _request_payload(run_id=run_id, scenario_id=scenario_id)
    credentials = payload["data"]
    assert isinstance(credentials, dict)
    credential_values = credentials["credentials"]
    assert isinstance(credential_values, dict)
    credential_values["benchmark_profile"] = "capability"
    return payload


def _stream_data(response: httpx.Response) -> list[dict[str, object]]:
    items = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            items.append(json.loads(line.removeprefix("data: ")))
    return items


@pytest.mark.parametrize("scenario_id, expected_chunks", [("single_1_chunk_c1", 1), ("single_100_chunks_c1", 100)])
def test_fake_llm_emits_configured_text_chunks(scenario_id: str, expected_chunks: int) -> None:
    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://fake") as client:
            await client.post("/__bench/reset")
            response = await client.post(
                "/plugin/tenant-1/dispatch/llm/invoke",
                json=_request_payload(run_id="run-text", scenario_id=scenario_id),
            )
            ledger = (await client.get("/__bench/ledgers/run-text")).json()

        assert response.status_code == 200
        assert len(_stream_data(response)) == expected_chunks
        assert ledger["model_calls"] == 1
        assert len(ledger["model_start_elapsed_ms"]) == 1
        assert ledger["text_chunks"] == expected_chunks
        assert ledger["model_stream_items"] == expected_chunks

    import asyncio

    asyncio.run(scenario())


def test_fake_model_and_tool_complete_three_round_ledger() -> None:
    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app)
        payload = _request_payload(run_id="run-tools", scenario_id="three_tool_rounds_100_chunks_c1")
        async with httpx.AsyncClient(transport=transport, base_url="http://fake") as client:
            await client.post("/__bench/reset")
            first = await client.post("/plugin/tenant-1/dispatch/llm/invoke", json=payload)
            await client.post("/plugin/tenant-1/dispatch/tool/invoke", json=payload)
            second = await client.post("/plugin/tenant-1/dispatch/llm/invoke", json=payload)
            await client.post("/plugin/tenant-1/dispatch/tool/invoke", json=payload)
            final = await client.post("/plugin/tenant-1/dispatch/llm/invoke", json=payload)
            ledger = (await client.get("/__bench/ledgers/run-tools")).json()

        first_chunk = LLMResultChunk.model_validate(_stream_data(first)[0]["data"])
        second_chunk = LLMResultChunk.model_validate(_stream_data(second)[0]["data"])
        assert first_chunk.delta.message.tool_calls[0].function.name == "benchmark_tool"
        assert second_chunk.delta.finish_reason == "tool_calls"
        assert len(_stream_data(final)) == 100
        assert ledger["model_calls"] == 3
        assert len(ledger["model_start_elapsed_ms"]) == 3
        assert ledger["tool_calls"] == 2
        assert ledger["text_chunks"] == 100
        assert ledger["model_stream_items"] == 102
        assert ledger["tool_response_bytes"] == 2048
        assert ledger["dependency_budget_ms"] == 139

    import asyncio

    asyncio.run(scenario())


def test_fake_endpoints_decode_through_real_runtime_adapter_clients() -> None:
    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app)
        credentials: dict[str, object] = {
            "benchmark_run_id": "adapter-contract",
            "scenario_id": "three_tool_rounds_100_chunks_c1",
            "scenario_version": 1,
        }
        async with httpx.AsyncClient(transport=transport) as client:
            await client.post("http://fake/__bench/reset")
            llm_client = DifyPluginDaemonLLMClient(
                plugin_daemon_url="http://fake",
                plugin_daemon_api_key="benchmark-only",
                tenant_id="benchmark-tenant",
                plugin_id="benchmark/model",
                user_id="benchmark-user",
                http_client=client,
            )
            llm_chunks = [
                chunk
                async for chunk in llm_client.iter_llm_result_chunks(
                    provider="benchmark",
                    model="benchmark-model",
                    credentials=credentials,
                    prompt_messages=[],
                    model_parameters={},
                    tools=None,
                    stop=None,
                    stream=True,
                )
            ]
            tool_client = DifyPluginDaemonToolClient(
                plugin_daemon_url="http://fake",
                plugin_daemon_api_key="benchmark-only",
                tenant_id="benchmark-tenant",
                plugin_id="benchmark/tool",
                user_id="benchmark-user",
                http_client=client,
            )
            tool_messages = await tool_client.invoke(
                provider="benchmark",
                tool_name="benchmark_tool",
                credential_type="api-key",
                credentials=credentials,
                tool_parameters={"query": "benchmark"},
            )

        assert llm_chunks[0].delta.finish_reason == "tool_calls"
        assert llm_chunks[0].delta.message.tool_calls[0].function.name == "benchmark_tool"
        assert tool_messages[0].type == "text"
        assert isinstance(tool_messages[0].message, DifyPluginToolInvokeMessage.TextMessage)
        assert tool_messages[0].message.text == "x" * 1024

    import asyncio

    asyncio.run(scenario())


def test_fake_capability_model_emits_real_shell_run_tool_contract() -> None:
    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://fake") as client:
            await client.post("/__bench/reset")
            await client.post(
                "/__bench/prepare",
                json={
                    "benchmark_run_id": "shell-run",
                    "scenario_id": "capability_shell_noop_c1",
                    "scenario_version": 1,
                },
            )
            response = await client.post(
                "/plugin/tenant/dispatch/llm/invoke",
                json=_capability_request_payload(
                    run_id="shell-run",
                    scenario_id="capability_shell_noop_c1",
                ),
            )

        chunk = LLMResultChunk.model_validate(_stream_data(response)[0]["data"])
        tool_call = chunk.delta.message.tool_calls[0]
        assert tool_call.function.name == "shell_run"
        assert "DIFY_CAPABILITY_SHELL_OK" in tool_call.function.arguments

    import asyncio

    asyncio.run(scenario())


def test_fake_config_ledgers_remain_isolated_when_requests_interleave() -> None:
    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://fake") as client:
            await client.post("/__bench/reset")
            for run_id in ("config-a", "config-b"):
                await client.post(
                    "/__bench/prepare",
                    json={
                        "benchmark_run_id": run_id,
                        "scenario_id": "capability_config_pull_c1",
                        "scenario_version": 1,
                    },
                )
            await client.get("/inner/api/agent-config/config-a/skills/skill-0/pull")
            await client.get("/inner/api/agent-config/config-b/files/file-0.bin/pull")
            ledger_a = FakeDependencyLedger.model_validate((await client.get("/__bench/ledgers/config-a")).json())
            ledger_b = FakeDependencyLedger.model_validate((await client.get("/__bench/ledgers/config-b")).json())

        assert ledger_a.stub_calls == {"config_skill_pull": 1}
        assert ledger_b.stub_calls == {"config_file_pull": 1}
        assert ledger_a.payload_sha256 != ledger_b.payload_sha256

    import asyncio

    asyncio.run(scenario())


def test_fake_signed_file_roundtrip_matches_capability_ledger() -> None:
    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app)
        scenario_value = load_scenario_manifest(profile="capability").get("capability_file_roundtrip_16m_c1")
        assert isinstance(scenario_value, CapabilityBenchmarkScenario)
        payload = bytes(range(256)) * (scenario_value.payload_bytes // 256)
        async with httpx.AsyncClient(transport=transport, base_url="http://fake") as client:
            await client.post("/__bench/reset")
            await client.post(
                "/__bench/prepare",
                json={
                    "benchmark_run_id": "file-run",
                    "scenario_id": scenario_value.id,
                    "scenario_version": scenario_value.version,
                },
            )
            model_request = _capability_request_payload(
                run_id="file-run",
                scenario_id=scenario_value.id,
            )
            await client.post("/plugin/tenant/dispatch/llm/invoke", json=model_request)
            await client.post("/plugin/tenant/dispatch/llm/invoke", json=model_request)
            upload_request = await client.post(
                "/inner/api/upload/file/request",
                json={"user_id": "file-run", "filename": "payload.bin"},
            )
            upload_url = upload_request.json()["data"]["url"]
            upload_response = await client.post(
                urlparse(upload_url).path,
                files={"file": ("payload.bin", payload, "application/octet-stream")},
            )
            reference = upload_response.json()["reference"]
            download_request_payload = {
                "user_id": "file-run",
                "file": {"transfer_method": "tool_file", "reference": reference},
            }
            await client.post("/inner/api/download/file/request", json=download_request_payload)
            download_request = await client.post(
                "/inner/api/download/file/request",
                json=download_request_payload,
            )
            download_url = download_request.json()["data"]["download_url"]
            downloaded = await client.get(urlparse(download_url).path)
            ledger = FakeDependencyLedger.model_validate((await client.get("/__bench/ledgers/file-run")).json())

        assert downloaded.content == payload
        assert validate_capability_ledger(ledger=ledger, scenario=scenario_value)

    import asyncio

    asyncio.run(scenario())

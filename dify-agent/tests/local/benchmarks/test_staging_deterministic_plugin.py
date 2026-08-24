# pyright: reportImplicitRelativeImport=false
from __future__ import annotations

import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
from typing import cast

import pytest
import yaml

from benchmarks.staging_plugin.models.llm.contract import (
    BENCHMARK_REQUEST_PREFIX,
    CONFIG_EXPECTED_SHA256,
    CONFIG_FILE_COUNT,
    CONFIG_ITEM_COUNT,
    CONFIG_SKILL_COUNT,
    CONFIG_TOTAL_BYTES,
    FILE_EXPECTED_SHA256,
    FILE_PAYLOAD_BYTES,
    MODEL_DELAY_SECONDS,
    MODEL_NAME,
    BenchmarkIdentity,
    build_benchmark_request,
    build_response_plan,
    parse_benchmark_request,
)


PLUGIN_ROOT = Path(__file__).parents[3] / "benchmarks" / "staging_plugin"


def _identity(scenario_id: str) -> BenchmarkIdentity:
    return BenchmarkIdentity(
        benchmark_run_id="invocation-123.run",
        scenario_id=scenario_id,
        scenario_version=1,
    )


def test_real_sdk_contract_is_deterministic_and_makes_no_network_call() -> None:
    environment = dict(os.environ)
    environment.pop("VIRTUAL_ENV", None)
    environment["PYTHONPATH"] = str(PLUGIN_ROOT)
    completed = subprocess.run(
        ["uv", "run", "--project", str(PLUGIN_ROOT), "--locked", "python", "sdk_contract_probe.py"],
        cwd=PLUGIN_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    result = cast(dict[str, object], json.loads(completed.stdout))
    basic = cast(dict[str, object], result["basic"])
    basic_delta = cast(dict[str, object], basic["delta"])
    basic_message = cast(dict[str, object], basic_delta["message"])
    basic_usage = cast(dict[str, object], basic_delta["usage"])
    first_round = cast(dict[str, object], result["first_round"])
    first_delta = cast(dict[str, object], first_round["delta"])
    first_message = cast(dict[str, object], first_delta["message"])
    first_calls = cast(list[dict[str, object]], first_message["tool_calls"])
    first_function = cast(dict[str, object], first_calls[0]["function"])
    second_round = cast(dict[str, object], result["second_round"])
    second_delta = cast(dict[str, object], second_round["delta"])
    second_message = cast(dict[str, object], second_delta["message"])

    assert result["sdk_delay_calls"] == [MODEL_DELAY_SECONDS, MODEL_DELAY_SECONDS, MODEL_DELAY_SECONDS]
    assert result["expected_delay"] == MODEL_DELAY_SECONDS
    assert basic_delta["finish_reason"] == "stop"
    assert basic_message["tool_calls"] == []
    assert basic_message["content"] == (
        'DIFY_BENCHMARK_MARKER:{"benchmark_run_id":"invocation-123.run","kind":"terminal","round":1,'
        '"scenario_id":"basic","scenario_version":1}'
    )
    assert basic_usage["prompt_tokens"] == 10
    assert basic_usage["completion_tokens"] == 5
    assert basic_usage["total_tokens"] == 15
    assert basic_usage["total_price"] == "0"
    assert first_delta["finish_reason"] == "tool_calls"
    assert first_function["name"] == "shell_run"
    assert "invocation-123.run" in cast(str, first_calls[0]["id"])
    assert "shell" in cast(str, first_calls[0]["id"])
    arguments = cast(dict[str, object], json.loads(cast(str, first_function["arguments"])))
    assert "DIFY_BENCHMARK_SHELL_OK" in cast(str, arguments["script"])
    assert second_delta["finish_reason"] == "stop"
    assert second_message["tool_calls"] == []
    assert second_message["content"] == (
        'DIFY_BENCHMARK_MARKER:{"benchmark_run_id":"invocation-123.run","kind":"terminal","round":2,'
        '"scenario_id":"shell","scenario_version":1}'
    )
    assert "benchmark_run_id" in cast(str, result["invalid_error"])
    assert "explicitly enabled" in cast(str, result["disabled_error"])


@pytest.mark.parametrize("scenario_id", ["shell", "config", "file"])
def test_runtime_first_round_contract_contains_standard_shell_tool_call(scenario_id: str) -> None:
    identity = _identity(scenario_id)
    plan = build_response_plan(identity=identity, tool_result_count=0)

    assert plan.finish_reason == "tool_calls"
    assert plan.tool_name == "shell_run"
    assert plan.tool_call_id is not None
    assert "invocation-123.run" in plan.tool_call_id
    assert scenario_id in plan.tool_call_id
    assert plan.tool_arguments is not None
    arguments = cast(dict[str, object], json.loads(plan.tool_arguments))
    assert "DIFY_BENCHMARK_" in cast(str, arguments["script"])
    assert '"benchmark_run_id":"invocation-123.run"' in cast(str, arguments["script"])
    assert "timeout" not in arguments


def test_config_plan_uses_fixed_fixture_paths_and_reports_integrity_metadata() -> None:
    identity = _identity("config")
    plan = build_response_plan(identity=identity, tool_result_count=0)
    assert plan.tool_arguments is not None
    script = cast(dict[str, str], json.loads(plan.tool_arguments))["script"]

    for index in range(CONFIG_SKILL_COUNT):
        assert f".dify_conf/skills/benchmark-skill-{index}/SKILL.md" in script
    for index in range(CONFIG_FILE_COUNT):
        assert f".dify_conf/files/benchmark-file-{index}.bin" in script
    assert (
        "dify-agent config skills pull --json "
        + " ".join(f"benchmark-skill-{index}" for index in range(CONFIG_SKILL_COUNT))
    ) in script
    assert (
        "dify-agent config files pull --json "
        + " ".join(f"benchmark-file-{index}.bin" for index in range(CONFIG_FILE_COUNT))
    ) in script
    assert "skill-0-invocation-123.run" not in script
    assert "file-0-invocation-123.run.bin" not in script
    assert "rm -rf .dify_conf/skills .dify_conf/files" in script
    assert "total_bytes += len(payload)" in script
    assert f"len(paths) != {CONFIG_ITEM_COUNT}" in script
    assert f"total_bytes != {CONFIG_TOTAL_BYTES}" in script
    assert CONFIG_EXPECTED_SHA256 in script
    assert f"|items={CONFIG_ITEM_COUNT}|bytes={CONFIG_TOTAL_BYTES}|sha256=" in script


def test_file_plan_uploads_and_verifies_one_deterministic_16mib_tool_file() -> None:
    plan = build_response_plan(identity=_identity("file"), tool_result_count=0)
    assert plan.tool_arguments is not None
    script = cast(dict[str, str], json.loads(plan.tool_arguments))["script"]

    assert f"size = {FILE_PAYLOAD_BYTES}" in script
    assert "pattern = bytes(range(256))" in script
    assert "dify-agent file upload dify-bench-file/payload.bin" in script
    assert "upload['transfer_method'] != 'tool_file'" in script
    assert "reference.startswith('dify-file-ref:')" in script
    assert "upload['public_download_url']" in script
    assert "Request(public_url, headers={'User-Agent': 'dify-agent-benchmark/1.0'})" in script
    assert "urlopen(download_request, timeout=180)" in script
    assert "downloaded != expected" in script
    assert FILE_EXPECTED_SHA256 in script
    assert "DIFY_BENCHMARK_FILE_SHA256|" in script
    assert "print(reference)" not in script
    assert "print(public_url)" not in script


def test_file_plan_executes_full_upload_download_integrity_contract(tmp_path: Path) -> None:
    payload = bytes(range(256)) * (FILE_PAYLOAD_BYTES // 256)
    user_agents: list[str | None] = []

    class FileHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            user_agents.append(self.headers.get("User-Agent"))
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args: object) -> None:
            _ = format, args

    server = ThreadingHTTPServer(("127.0.0.1", 0), FileHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    reference = "dify-file-ref:" + base64.urlsafe_b64encode(b'{"record_id":"tool-file-1"}').decode()
    public_url = f"http://127.0.0.1:{server.server_port}/payload.bin?sign=private"
    fake_cli = tmp_path / "dify-agent"
    fake_cli.write_text(
        "#!/bin/sh\n"
        'test "$1 $2" = "file upload"\n'
        f"printf '%s\\n' {json.dumps(json.dumps({'transfer_method': 'tool_file', 'reference': reference, 'public_download_url': public_url}))}\n"
    )
    fake_cli.chmod(0o700)
    plan = build_response_plan(identity=_identity("file"), tool_result_count=0)
    assert plan.tool_arguments is not None
    script = cast(dict[str, str], json.loads(plan.tool_arguments))["script"]
    environment = dict(os.environ)
    environment["PATH"] = f"{tmp_path}:{environment['PATH']}"

    try:
        completed = subprocess.run(
            ["/bin/sh", "-c", script],
            cwd=tmp_path,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)

    assert completed.stdout.strip() == (
        "DIFY_BENCHMARK_FILE_SHA256|"
        + _identity("file").marker(round_number=1, kind="tool_call")
        + f"|bytes={FILE_PAYLOAD_BYTES}|sha256={FILE_EXPECTED_SHA256}"
    )
    assert reference not in completed.stdout
    assert public_url not in completed.stdout
    assert user_agents == ["dify-agent-benchmark/1.0"]


def test_invalid_identity_is_rejected_before_building_a_response() -> None:
    with pytest.raises(ValueError, match="benchmark_run_id"):
        parse_benchmark_request(
            BENCHMARK_REQUEST_PREFIX + '{"benchmark_run_id":"../escape","scenario_id":"basic","scenario_version":1}'
        )


def test_public_query_envelope_round_trips_canonical_compact_json() -> None:
    identity = _identity("shell")

    encoded = build_benchmark_request(identity)

    assert encoded == (
        'DIFY_BENCHMARK_REQUEST:{"benchmark_run_id":"invocation-123.run","scenario_id":"shell","scenario_version":1}'
    )
    assert parse_benchmark_request(encoded) == identity


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        ("run", "must be exactly"),
        (
            'DIFY_BENCHMARK_REQUEST:{"benchmark_run_id":"run-1","scenario_id":"basic",'
            '"scenario_version":1,"extra":true}',
            "extras",
        ),
        (
            'DIFY_BENCHMARK_REQUEST:{"benchmark_run_id":"run-1","benchmark_run_id":"run-2",'
            '"scenario_id":"basic","scenario_version":1}',
            "duplicate key",
        ),
        (
            'DIFY_BENCHMARK_REQUEST:{"benchmark_run_id":"run-1","scenario_id":"file_export_16mib",'
            '"scenario_version":1}',
            "unsupported benchmark scenario",
        ),
        (
            'DIFY_BENCHMARK_REQUEST:{ "benchmark_run_id":"run-1","scenario_id":"basic","scenario_version":1}',
            "canonical compact JSON",
        ),
    ],
)
def test_public_query_envelope_rejects_non_contract_inputs(payload: str, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        parse_benchmark_request(payload)


@pytest.mark.parametrize("scenario_version", ["2", '"1"', "1.0", "true"])
def test_public_query_envelope_rejects_unknown_scenario_version(scenario_version: str) -> None:
    payload = (
        'DIFY_BENCHMARK_REQUEST:{"benchmark_run_id":"run-1","scenario_id":"basic","scenario_version":'
        f"{scenario_version}}}"
    )

    with pytest.raises(ValueError, match="scenario_version must be exactly 1"):
        parse_benchmark_request(payload)


def test_plugin_manifest_and_provider_expose_only_the_deterministic_llm() -> None:
    manifest = yaml.safe_load((PLUGIN_ROOT / "manifest.yaml").read_text())
    provider = yaml.safe_load((PLUGIN_ROOT / "provider" / "dify_agent_benchmark.yaml").read_text())
    model = yaml.safe_load((PLUGIN_ROOT / "models" / "llm" / "dify-agent-benchmark-deterministic.yaml").read_text())
    project = (PLUGIN_ROOT / "pyproject.toml").read_text()

    assert manifest["name"] == "dify_agent_benchmark_model"
    assert manifest["version"] == "0.1.4"
    assert manifest["meta"]["version"] == "0.0.1"
    assert manifest["plugins"]["models"] == ["provider/dify_agent_benchmark.yaml"]
    assert manifest["resource"]["permission"]["tool"]["enabled"] is False
    assert provider["configurate_methods"] == ["predefined-model"]
    assert provider["supported_model_types"] == ["llm"]
    credential_fields = provider["provider_credential_schema"]["credential_form_schemas"]
    assert credential_fields == [
        {
            "variable": "benchmark_enabled",
            "label": {"en_US": "Benchmark provider", "zh_Hans": "Benchmark Provider"},
            "type": "select",
            "required": True,
            "default": "enabled",
            "options": [
                {
                    "value": "enabled",
                    "label": {"en_US": "Enabled", "zh_Hans": "已启用"},
                }
            ],
        }
    ]
    assert model["model"] == MODEL_NAME
    assert set(model["features"]) == {"tool-call", "stream-tool-call"}
    assert "dify-plugin==0.9.0" in project
    assert 'version = "0.1.4"' in project
    assert "requests" not in project
    assert "httpx" not in project

"""Sandbox upload uses the real shell runner and emits only a canonical locator."""

import json
import shlex

import pytest

from dify_agent.agent_stub.protocol import file_reference
from dify_agent.layers.agent_files import upload_sandbox_path
from tests.local.dify_agent.layers.shell.test_layer import (
    FakeCommands,
    _bind_execution_context,
    _command_result,
    _layer,
)


@pytest.mark.anyio
@pytest.mark.parametrize("path", ["./chart.png", "a file 'with quotes' $(secret).png", "-option.png"])
async def test_sandbox_upload_quotes_path_and_uses_stub_environment(path):
    mapping = {"transfer_method": "tool_file", "reference": file_reference("tool-record")}

    def run(script, cwd, env, timeout):
        assert shlex.split(script) == ["dify-agent", "file", "upload", "--no-download-link", "--", path]
        assert env["DIFY_AGENT_STUB_AUTH_JWE"] == "stub-token"
        assert cwd == "/home/agent-1/workspace/abc12ff"
        output = json.dumps(mapping)
        return _command_result("upload", status="exited", done=True, exit_code=0, output=output, offset=len(output))

    commands = FakeCommands(run_handler=run)
    shell, _ = _layer(commands=commands)
    _bind_execution_context(shell)
    shell.deps.services.agent_stub_api_base_url = "http://stub/agent-stub"
    shell.deps.services.agent_stub_token_factory = lambda execution_context, session_id: "stub-token"
    try:
        result = await upload_sandbox_path(shell, path)
        assert result.model_dump(exclude_none=True) == mapping
        assert len(commands.run_calls) == 1
    finally:
        await shell.deps.services.dify_api_http_client.aclose()
        await shell.deps.services.plugin_daemon_http_client.aclose()


@pytest.mark.anyio
@pytest.mark.parametrize(
    "output,exit_code,match",
    [
        ("not a file", 1, "sandbox file upload failed: exited, exit_code=1: not a file"),
        ("not JSON", 0, "Expecting value: line 1 column 1"),
        (
            '{"transfer_method":"tool_file","reference":"raw-id"}',
            0,
            "reference must be a canonical Dify file reference",
        ),
    ],
)
async def test_sandbox_upload_rejects_failed_or_malformed_results(output, exit_code, match):
    def run(*_):
        return _command_result(
            "upload", status="exited", done=True, exit_code=exit_code, output=output, offset=len(output)
        )

    commands = FakeCommands(run_handler=run)
    shell, _ = _layer(commands=commands)
    _bind_execution_context(shell)
    shell.deps.services.agent_stub_api_base_url = "http://stub/agent-stub"
    shell.deps.services.agent_stub_token_factory = lambda execution_context, session_id: "stub-token"
    try:
        with pytest.raises(ValueError, match=match):
            await upload_sandbox_path(shell, "./missing.png")
        assert len(commands.run_calls) == 1
    finally:
        await shell.deps.services.dify_api_http_client.aclose()
        await shell.deps.services.plugin_daemon_http_client.aclose()

"""Sandbox upload uses the real shell runner and emits only a canonical locator."""

import json
import shlex

import pytest

from dify_agent.agent_stub.protocol import file_reference
from dify_agent.layers.agent_files import upload_sandbox_path
from tests.local.dify_agent.shell_support import (
    FakeCommands,
    completed_shell_command,
    stub_enabled_shell,
)


@pytest.mark.anyio
@pytest.mark.parametrize("path", ["./chart.png", "a file 'with quotes' $(secret).png", "-option.png"])
async def test_sandbox_upload_quotes_path_and_uses_stub_environment(path):
    mapping = {"transfer_method": "tool_file", "reference": file_reference("tool-record")}

    def run(script, cwd, env, timeout):
        assert shlex.split(script) == ["dify-agent", "file", "upload", "--no-download-link", "--", path]
        assert env["DIFY_AGENT_STUB_AUTH_JWE"] == "stub-token"
        output = json.dumps(mapping)
        return completed_shell_command(output)

    commands = FakeCommands(run_handler=run)
    async with stub_enabled_shell(commands) as shell:
        result = await upload_sandbox_path(shell, path)
        assert result.model_dump(exclude_none=True) == mapping
        assert len(commands.run_calls) == 1


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
        return completed_shell_command(output, exit_code=exit_code)

    commands = FakeCommands(run_handler=run)
    async with stub_enabled_shell(commands) as shell:
        with pytest.raises(ValueError, match=match):
            await upload_sandbox_path(shell, "./missing.png")
        assert len(commands.run_calls) == 1

"""Config pre-pulls run inside Shell and persist only completed initialization."""

import json

import httpx
import pytest

from dify_agent.adapters.shell.protocols import CompleteShellCommandResult
from dify_agent.layers.config import layer as config_module
from dify_agent.layers.shell.layer import ShellSession
from dify_agent.protocol.schemas import RunLayerSpec
from dify_agent.runtime.context import Services
from dify_agent.runtime_backend import RuntimeBackendProfile
from tests.local.dify_agent.runtime.test_runner import Backend, Commands, request, run_runner, runtime_specs


@pytest.mark.anyio
async def test_first_pull_failure_retries_then_current_config_refreshes_without_repull(monkeypatch):
    commands = Commands()
    backend = Backend(commands)
    pulls = []
    fail = True

    async def pull(session, script, **kwargs):
        assert backend.active
        assert kwargs["inject_agent_stub_env"] is True
        pulls.append(script)
        output = (
            ""
            if fail
            else json.dumps(
                {"items": [{"name": "skill", "directory_path": "/skills/skill", "skill_md": "Instructions from skill"}]}
            )
        )
        return CompleteShellCommandResult("pull", "exited", True, 1 if fail else 0, output, True, None, len(output))

    monkeypatch.setattr(ShellSession, "run_remote_script", pull)
    seen_instructions = []

    async def stream(messages, info):
        assert "Instructions from skill" in info.instructions
        seen_instructions.append(info.instructions)
        yield "done"

    def spec(note, *, writable=False):
        return RunLayerSpec(
            name="config",
            config={
                "mentioned_skill_names": ["skill"],
                "note": note,
                "config_version": {"kind": "build_draft" if writable else "snapshot", "writable": writable},
            },
        )

    async with httpx.AsyncClient() as client:
        services = Services(client, client, runtime_backend_profile=RuntimeBackendProfile(None, backend))
        # Config precedes both resources in the submitted list; native ordering owns entry.
        first, _ = run_runner(request(spec("original"), *runtime_specs()), services, monkeypatch, stream)
        with pytest.raises(config_module.DifyConfigLayerError):
            await first.run()
        assert first.terminal_session_snapshot.layers["config"]["initialized"] is False
        assert backend.released == 1
        fail = False
        second, _ = run_runner(
            request(spec("original"), *runtime_specs(), snapshot=first.terminal_session_snapshot),
            services,
            monkeypatch,
            stream,
            run_id="second",
        )
        await second.run()
        assert second.terminal_session_snapshot.layers["config"]["initialized"] is True
        third, _ = run_runner(
            request(spec("revised", writable=True), *runtime_specs(), snapshot=second.terminal_session_snapshot),
            services,
            monkeypatch,
            stream,
            run_id="third",
        )
        await third.run()
        assert len(pulls) == 2
        assert backend.acquired == backend.released == 3
        state = third.terminal_session_snapshot.layers["config"]
        assert "original" in seen_instructions[0] and "revised" in seen_instructions[1]
        assert "dify-agent config env push --help" not in seen_instructions[0]
        assert "dify-agent config env push --help" in seen_instructions[1]
        assert set(state) == {"initialized", "pulled_skill_outputs", "pulled_file_outputs"}
        assert "Instructions from skill" in state["pulled_skill_outputs"]["skill"]

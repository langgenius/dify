"""Config pre-pulls run inside Shell and persist only completed initialization."""

import json

import httpx
import pytest
from pydantic_ai.messages import RetryPromptPart, ToolReturnPart
from pydantic_ai.models.function import DeltaToolCall

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


def _skill_spec(*skills):
    return RunLayerSpec(name="config", config={"skills": [{"name": name} for name in skills]})


def _pull_result(output, *, exit_code=0, complete=True):
    return CompleteShellCommandResult(
        "pull", "exited", True, exit_code, output, complete, None if complete else "output_limit", len(output)
    )


async def _run_skill_reads(monkeypatch, pulls, calls, *skills):
    """Drive one run whose model issues each read call in turn; return pull scripts and tool results."""
    backend = Backend(Commands())
    scripts = []

    async def pull(session, script, **kwargs):
        assert kwargs["inject_agent_stub_env"] is True
        scripts.append(script)
        return pulls.pop(0)

    monkeypatch.setattr(ShellSession, "run_remote_script", pull)
    observed = []

    async def stream(messages, info):
        if len(messages) > 1:
            observed.append(messages[-1].parts[0])
        if len(observed) == len(calls):
            yield "done"
            return
        args = json.dumps({"name": calls[len(observed)]})
        yield {0: DeltaToolCall(name="read_config_skill_md", json_args=args, tool_call_id=f"read-{len(observed)}")}

    async with httpx.AsyncClient() as client:
        services = Services(client, client, runtime_backend_profile=RuntimeBackendProfile(None, backend))
        runner, _ = run_runner(request(_skill_spec(*skills), *runtime_specs()), services, monkeypatch, stream)
        await runner.run()
    return scripts, observed


@pytest.mark.anyio
async def test_read_config_skill_md_returns_middle_of_large_skill_after_correcting_name(monkeypatch):
    decisive = "VERIFY THE IMPORT ROW COUNT BEFORE COMMITTING"
    skill_md = "# Alpha\n" + "A" * 5600 + decisive + "B" * 5600
    payload = json.dumps({"items": [{"name": "alpha", "directory_path": "/skills/alpha", "skill_md": skill_md}]})

    scripts, observed = await _run_skill_reads(monkeypatch, [_pull_result(payload)], ["other", "alpha"], "alpha")

    assert isinstance(observed[0], RetryPromptPart) and "unknown config skill" in str(observed[0].content)
    assert isinstance(observed[1], ToolReturnPart) and observed[1].content == skill_md
    assert scripts == ["set -eu\ndify-agent config skills pull --json alpha"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("failed_pull", "expected_error"),
    [
        (_pull_result("pull failed", exit_code=1), "pull failed in shell"),
        (_pull_result("partial", complete=False), "output was incomplete"),
        (_pull_result("invalid json"), "invalid JSON pull output"),
        (_pull_result('{"items": []}'), "missing skill content"),
    ],
)
async def test_read_config_skill_md_returns_pull_errors_to_model_for_retry(monkeypatch, failed_pull, expected_error):
    payload = json.dumps({"items": [{"name": "alpha", "skill_md": "é"}]})

    _, observed = await _run_skill_reads(monkeypatch, [failed_pull, _pull_result(payload)], ["alpha", "alpha"], "alpha")

    assert isinstance(observed[0], RetryPromptPart) and expected_error in str(observed[0].content)
    assert isinstance(observed[1], ToolReturnPart) and observed[1].content == "é"


@pytest.mark.anyio
@pytest.mark.parametrize("skills", [(), ("alpha",)])
async def test_read_config_skill_md_is_offered_only_with_configured_skills(monkeypatch, skills):
    backend = Backend(Commands())
    seen = []

    async def stream(messages, info):
        seen.append(({t.name for t in info.function_tools}, info.instructions))
        yield "done"

    async with httpx.AsyncClient() as client:
        services = Services(client, client, runtime_backend_profile=RuntimeBackendProfile(None, backend))
        runner, _ = run_runner(request(_skill_spec(*skills), *runtime_specs()), services, monkeypatch, stream)
        await runner.run()

    tool_names, instructions = seen[0]
    assert ("read_config_skill_md" in tool_names) is bool(skills)
    assert ("read_config_skill_md(name)" in instructions) is bool(skills)

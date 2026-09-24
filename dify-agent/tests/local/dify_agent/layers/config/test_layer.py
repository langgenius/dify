"""Behavior tests for the runtime Dify config layer."""

from __future__ import annotations

import json
from typing import Literal

import pytest

from dify_agent.layers.config import DifyConfigLayerConfig
from dify_agent.layers.config.layer import (
    DifyConfigLayer,
    DifyConfigLayerError,
    _AGENT_FILE_UPLOAD_REPLY_HINT,
)
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import CompleteRemoteCommandResult, DifyShellLayer


def _shell_layer() -> DifyShellLayer:
    return DifyShellLayer.from_config_with_settings(
        DifyShellLayerConfig(),
    )


def _build_layer(*, writable: bool = True) -> DifyConfigLayer:
    layer = DifyConfigLayer.from_config(
        DifyConfigLayerConfig.model_validate(
            {
                "agent_id": "agent-1",
                "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": writable},
                "skills": [{"name": "runtime-skill", "description": "Runtime skill."}],
                "files": [{"name": "runtime-file.txt"}],
                "env_keys": ["RUNTIME_KEY"],
                "note": "Runtime note.",
                "mentioned_skill_names": ["alpha"],
                "mentioned_file_names": ["guide.txt"],
            }
        )
    )
    layer.bind_deps({"shell": _shell_layer()})
    return layer


def _remote_result(
    output: str,
    *,
    exit_code: int | None = 0,
    output_complete: bool = True,
    incomplete_reason: Literal["output_limit", "timeout"] | None = None,
) -> CompleteRemoteCommandResult:
    return CompleteRemoteCommandResult(
        job_id="remote-config-pull",
        status="exited",
        done=True,
        exit_code=exit_code,
        output=output,
        output_complete=output_complete,
        incomplete_reason=incomplete_reason,
        offset=len(output),
        output_path="/tmp/config-pull-output.log",
    )


def _skill_pull_output(*names: str, include_skill: bool = True) -> str:
    items = []
    if include_skill:
        items = [
            {
                "name": name,
                "archive_path": f"/workspace/.dify_conf/skills/{name}.zip",
                "directory_path": f"/workspace/.dify_conf/skills/{name}",
                "skill_md": "# Alpha\nUse it.\n",
            }
            for name in names or ("alpha",)
        ]
    return json.dumps({"items": items})


def _file_pull_output(*names: str, include_file: bool = True) -> str:
    items = []
    if include_file:
        items = [{"name": name, "path": f"/workspace/.dify_conf/files/{name}"} for name in names or ("guide.txt",)]
    return json.dumps({"items": items})


def test_build_shell_pull_scripts_include_targets() -> None:
    layer = _build_layer()

    skill_script = layer._build_shell_skill_pull_script(["alpha", "skill with space"])
    file_script = layer._build_shell_file_pull_script(["guide.txt", "file with space.txt"])

    assert skill_script == "set -eu\ndify-agent config skills pull --json alpha 'skill with space'"
    assert file_script == "set -eu\ndify-agent config files pull --json guide.txt 'file with space.txt'"


@pytest.mark.anyio
async def test_on_context_create_computes_runtime_fields_and_pulls_mentioned_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()
    captured_scripts: list[str] = []
    active_commands = 0
    max_active_commands = 0

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        nonlocal active_commands, max_active_commands
        del self, timeout
        assert inject_agent_stub_env is True
        assert "--help" not in script
        assert "dify-agent config manifest" not in script
        captured_scripts.append(script)
        active_commands += 1
        max_active_commands = max(max_active_commands, active_commands)
        active_commands -= 1
        if "skills pull" in script:
            return _remote_result(_skill_pull_output())
        if "files pull" in script:
            return _remote_result(_file_pull_output())
        raise AssertionError(f"unexpected script: {script}")

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    await layer.on_context_create()

    assert max_active_commands == 1
    assert len(captured_scripts) == 2
    assert captured_scripts == [
        "set -eu\ndify-agent config skills pull --json alpha",
        "set -eu\ndify-agent config files pull --json guide.txt",
    ]
    assert layer.runtime_state.pulled_skill_outputs == {"alpha": "/workspace/.dify_conf/skills/alpha\n# Alpha\nUse it."}
    assert layer.runtime_state.pulled_file_outputs == {"guide.txt": "/workspace/.dify_conf/files/guide.txt"}
    assert "dify-agent config note push --help" in layer.runtime_state.config_cli_help
    assert "dify-agent file upload --help" in layer.runtime_state.config_cli_help
    assert "dify-agent file public-url --help" in layer.runtime_state.config_cli_help
    assert "dify-agent file download --help" in layer.runtime_state.config_cli_help
    assert layer.runtime_state.push_spec_json_schema == ""
    suffix_prompt = layer.build_suffix_prompt()
    assert suffix_prompt.index("Agent config CLI reference for installed `dify-agent`:") < suffix_prompt.index(
        "Agent file CLI reference for installed `dify-agent`:"
    )
    assert "$ dify-agent file upload --help" in suffix_prompt
    assert "$ dify-agent file public-url --help" in suffix_prompt
    assert "$ dify-agent file download --help" in suffix_prompt
    assert suffix_prompt.index("$ dify-agent file upload --help") < suffix_prompt.index(
        "$ dify-agent file public-url --help"
    )
    assert suffix_prompt.index("$ dify-agent file public-url --help") < suffix_prompt.index(
        "$ dify-agent file download --help"
    )
    assert _AGENT_FILE_UPLOAD_REPLY_HINT in suffix_prompt


@pytest.mark.anyio
async def test_on_context_create_batches_all_mentioned_assets_into_two_serial_jobs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()
    layer.config = layer.config.model_copy(
        update={
            "mentioned_skill_names": [f"skill-{index}" for index in range(4)],
            "mentioned_file_names": [f"file-{index}.txt" for index in range(4)],
        }
    )
    captured_scripts: list[str] = []

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, timeout
        assert inject_agent_stub_env is True
        captured_scripts.append(script)
        if "skills pull" in script:
            return _remote_result(_skill_pull_output(*(f"skill-{index}" for index in range(4))))
        return _remote_result(_file_pull_output(*(f"file-{index}.txt" for index in range(4))))

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    await layer.on_context_create()

    assert captured_scripts == [
        "set -eu\ndify-agent config skills pull --json skill-0 skill-1 skill-2 skill-3",
        "set -eu\ndify-agent config files pull --json file-0.txt file-1.txt file-2.txt file-3.txt",
    ]
    assert set(layer.runtime_state.pulled_skill_outputs) == {f"skill-{index}" for index in range(4)}
    assert set(layer.runtime_state.pulled_file_outputs) == {f"file-{index}.txt" for index in range(4)}


@pytest.mark.anyio
async def test_on_context_resume_does_not_recompute_or_pull(monkeypatch: pytest.MonkeyPatch) -> None:
    layer = _build_layer()
    layer.runtime_state.config_context_json = "cached"
    layer.runtime_state.config_cli_help = {"cached": "help"}

    async def fail_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, script, inject_agent_stub_env, timeout
        raise AssertionError("resume must not run config shell commands")

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fail_run_remote_script)

    await layer.on_context_resume()

    assert layer.runtime_state.config_context_json == "cached"
    assert layer.runtime_state.config_cli_help == {"cached": "help"}


@pytest.mark.anyio
async def test_on_context_create_raises_when_shell_output_is_truncated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, inject_agent_stub_env, timeout
        if "skills pull" in script:
            return _remote_result(_skill_pull_output(), output_complete=False, incomplete_reason="output_limit")
        return _remote_result(_file_pull_output())

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    with pytest.raises(DifyConfigLayerError, match="output was incomplete"):
        await layer.on_context_create()


@pytest.mark.anyio
async def test_on_context_create_raises_when_mentioned_skill_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, inject_agent_stub_env, timeout
        if "skills pull" in script:
            return _remote_result(_skill_pull_output(include_skill=False))
        return _remote_result(_file_pull_output())

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    with pytest.raises(DifyConfigLayerError, match="missing pull output"):
        await layer.on_context_create()


@pytest.mark.anyio
async def test_on_context_create_raises_when_mentioned_file_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, inject_agent_stub_env, timeout
        if "skills pull" in script:
            return _remote_result(_skill_pull_output())
        return _remote_result(_file_pull_output(include_file=False))

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    with pytest.raises(DifyConfigLayerError, match="missing pull output"):
        await layer.on_context_create()

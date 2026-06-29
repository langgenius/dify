"""Behavior tests for the runtime Dify config layer."""

from __future__ import annotations

import asyncio
from typing import Literal

import pytest

from dify_agent.adapters.shell.shellctl import ShellctlProvider
from dify_agent.layers.config import DifyConfigLayerConfig
from dify_agent.layers.config.layer import DifyConfigLayer, DifyConfigLayerError
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import CompleteRemoteCommandResult, DifyShellLayer


def _unused_client_factory():
    raise AssertionError("shellctl client should not be used by these config-layer tests")


def _shell_layer() -> DifyShellLayer:
    return DifyShellLayer.from_config_with_settings(
        DifyShellLayerConfig(agent_stub_drive_ref="agent-1"),
        shell_provider=ShellctlProvider(entrypoint="http://shellctl", token="", client_factory=_unused_client_factory),
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


def _skill_pull_output(*, include_skill: bool = True) -> str:
    if not include_skill:
        return ""
    return "/workspace/.dify_conf/skills/alpha\n# Alpha\nUse it.\n"


def _file_pull_output(*, include_file: bool = True) -> str:
    if not include_file:
        return ""
    return "/workspace/.dify_conf/files/guide.txt\n"


def test_config_layer_prefix_prompt_includes_loaded_skill_and_file_paths() -> None:
    layer = _build_layer()
    layer.runtime_state.pulled_skill_outputs = {
        "alpha": "/workspace/.dify_conf/skills/alpha\n# Alpha\nUse it."
    }
    layer.runtime_state.pulled_file_outputs = {"guide.txt": "/workspace/.dify_conf/files/guide.txt"}

    prompt = layer.build_prompt_context()

    assert "Config note" not in prompt
    assert "Loaded mentioned skills" in prompt
    assert "Name: alpha" in prompt
    assert "Pull output:\n/workspace/.dify_conf/skills/alpha\n# Alpha\nUse it." in prompt
    assert "Mentioned files pulled locally" in prompt
    assert "Name: guide.txt\nPull output:\n/workspace/.dify_conf/files/guide.txt" in prompt


def test_config_layer_suffix_prompt_uses_cached_soul_context_cli_help_and_push_schema() -> None:
    layer = _build_layer(writable=True)
    layer._initialize_runtime_prompt_state()

    prompt = layer.build_suffix_prompt()

    assert "Agent config context from the current Agent Soul" in prompt
    assert '"agent_id":"agent-1"' in prompt
    assert '"kind":"build_draft"' in prompt
    assert "runtime-skill" in prompt
    assert "runtime-file.txt" in prompt
    assert "RUNTIME_KEY" in prompt
    assert "Runtime note." in prompt
    assert "`dify-agent config manifest` output" not in prompt
    assert "Config push JSON spec" in prompt
    assert '"properties"' in prompt
    assert "./.dify_conf/files/guide.txt" in prompt
    assert "$ dify-agent config push --help" in prompt
    assert "Recommended usage reads the JSON spec from stdin" in prompt


def test_config_layer_suffix_prompt_omits_push_usage_when_config_is_not_writable() -> None:
    layer = _build_layer(writable=False)
    layer._initialize_runtime_prompt_state()

    prompt = layer.build_suffix_prompt()

    assert "Agent config context from the current Agent Soul" in prompt
    assert "$ dify-agent config manifest --help" in prompt
    assert "$ dify-agent config push --help" not in prompt
    assert "Config push JSON spec" not in prompt
    assert "Save updated build-draft config files/skills/env/note" not in prompt


def test_build_shell_pull_scripts_include_targets() -> None:
    layer = _build_layer()

    skill_script = layer._build_shell_skill_pull_script("alpha")
    file_script = layer._build_shell_file_pull_script("guide.txt")

    assert skill_script == "set -eu\ndify-agent config skill pull alpha"
    assert "__DIFY_CONFIG_SKILLS_BEGIN__" not in skill_script
    assert file_script == "set -eu\ndify-agent config file pull guide.txt"
    assert "__DIFY_CONFIG_FILES_BEGIN__" not in file_script


@pytest.mark.anyio
async def test_on_context_create_computes_runtime_fields_and_pulls_mentioned_assets_in_parallel(
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
        await asyncio.sleep(0)
        active_commands -= 1
        if "skill pull" in script:
            return _remote_result(_skill_pull_output())
        if "file pull" in script:
            return _remote_result(_file_pull_output())
        raise AssertionError(f"unexpected script: {script}")

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    await layer.on_context_create()

    assert max_active_commands > 1
    assert len(captured_scripts) == 2
    assert sorted(captured_scripts) == [
        "set -eu\ndify-agent config file pull guide.txt",
        "set -eu\ndify-agent config skill pull alpha",
    ]
    assert layer.runtime_state.pulled_skill_outputs == {
        "alpha": "/workspace/.dify_conf/skills/alpha\n# Alpha\nUse it."
    }
    assert layer.runtime_state.pulled_file_outputs == {"guide.txt": "/workspace/.dify_conf/files/guide.txt"}
    assert "dify-agent config push --help" in layer.runtime_state.config_cli_help
    assert "ConfigPushSpec" in layer.runtime_state.push_spec_json_schema


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
        if "skill pull" in script:
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
        if "skill pull" in script:
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
        if "skill pull" in script:
            return _remote_result(_skill_pull_output())
        return _remote_result(_file_pull_output(include_file=False))

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    with pytest.raises(DifyConfigLayerError, match="missing pull output"):
        await layer.on_context_create()

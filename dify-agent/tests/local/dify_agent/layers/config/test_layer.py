"""Behavior tests for the runtime Dify config layer."""

from __future__ import annotations

import asyncio
import json
from typing import Literal

import pytest

from dify_agent.adapters.shell.shellctl import ShellctlProvider
from dify_agent.agent_stub.protocol.agent_stub import AgentStubConfigManifestResponse
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


def _build_layer() -> DifyConfigLayer:
    layer = DifyConfigLayer.from_config(
        DifyConfigLayerConfig(
            mentioned_skill_names=["alpha"],
            mentioned_file_names=["guide.txt"],
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


def _pull_output(*, include_file: bool = True, include_skill: bool = True) -> str:
    parts = [
        "__DIFY_CONFIG_SKILLS_BEGIN__\n"
        '{"items":[{"name":"alpha","archive_path":"/tmp/dify-config/skills/alpha.zip",'
        '"directory_path":"/tmp/dify-config/skills/alpha","skill_md":"# Alpha\\nUse it.\\n"}]}\n'
        "__DIFY_CONFIG_SKILLS_END__\n"
        if include_skill
        else "",
        "__DIFY_CONFIG_FILES_BEGIN__\n"
        '{"items":[{"name":"guide.txt","path":"/tmp/dify-config/files/guide.txt"}]}\n'
        "__DIFY_CONFIG_FILES_END__\n"
        if include_file
        else "",
    ]
    return "".join(parts)


def _push_help_output() -> str:
    return (
        "Usage: dify-agent config push [OPTIONS]\n\n"
        "Recommended usage reads the JSON spec from stdin:\n\n"
        "cat <<'JSON' | dify-agent config push\n"
        '{"files": [{"name": "guide.txt", "path": "./.dify_conf/files/guide.txt"}], '
        '"env": "./.dify_conf/.env", "note": "./.dify_conf/note.md"}\n'
        "JSON\n"
    )


def _manifest_output(*, writable: bool = True, note: str = "Runtime note.") -> str:
    return json.dumps(
        {
            "agent_id": "agent-1",
            "config_version": {"id": "cfg-1", "kind": "build_draft", "writable": writable},
            "skills": [{"name": "runtime-skill", "description": "Runtime skill."}],
            "files": [{"name": "runtime-file.txt"}],
            "env_keys": ["RUNTIME_KEY"],
            "note": note,
        },
        separators=(",", ":"),
    )


def test_config_layer_prefix_prompt_includes_loaded_skill_and_file_paths() -> None:
    layer = _build_layer()
    layer._loaded_skill_bodies = {"alpha": "# Alpha\nUse it.\n"}
    layer._pulled_skill_paths = {"alpha": "/tmp/dify-config/skills/alpha"}
    layer._pulled_file_paths = {"guide.txt": "/tmp/dify-config/files/guide.txt"}

    prompt = layer.build_prompt_context()

    assert "Config note" not in prompt
    assert "Loaded mentioned skills" in prompt
    assert "Name: alpha" in prompt
    assert "Local path: /tmp/dify-config/skills/alpha" in prompt
    assert "SKILL.md:\n# Alpha\nUse it.\n" in prompt
    assert "Mentioned files pulled locally:\n- guide.txt -> /tmp/dify-config/files/guide.txt" in prompt


def test_config_layer_prefix_prompt_does_not_synthesize_runtime_manifest_note() -> None:
    layer = _build_layer()
    layer._config_manifest = AgentStubConfigManifestResponse.model_validate_json(_manifest_output(note="Runtime note."))

    prompt = layer.build_prompt_context()

    assert prompt == ""


def test_config_layer_suffix_prompt_without_manifest_does_not_fallback_to_request_catalog() -> None:
    layer = _build_layer()

    prompt = layer.build_suffix_prompt()

    assert "Other available skills" not in prompt
    assert "Available files" not in prompt
    assert "Available env keys" not in prompt
    assert "Config changes are saved only by a" in prompt
    assert "`dify-agent config manifest` reports" in prompt
    assert "`config_version.kind` as\n`build_draft`" in prompt
    assert "`config_version.writable` as true" in prompt
    assert "Save updated build-draft config files/skills/env/note" not in prompt
    assert "cat <<'JSON' | dify-agent config push" not in prompt
    assert "./.dify_conf/files/guide.txt" not in prompt


def test_config_layer_suffix_prompt_uses_raw_runtime_manifest_without_catalog_synthesis() -> None:
    layer = _build_layer()
    layer._config_manifest_output = _manifest_output(writable=False)
    layer._config_manifest = AgentStubConfigManifestResponse.model_validate_json(layer._config_manifest_output)

    prompt = layer.build_suffix_prompt()

    assert "`dify-agent config manifest` output" in prompt
    assert "runtime-skill" in prompt
    assert "runtime-file.txt" in prompt
    assert "RUNTIME_KEY" in prompt
    assert layer._config_manifest_output in prompt
    assert "Other available skills" not in prompt
    assert "Available files" not in prompt
    assert "Available env keys" not in prompt
    assert "Save updated build-draft config files/skills/env/note" not in prompt


def test_config_layer_suffix_prompt_uses_loaded_cli_push_help() -> None:
    layer = _build_layer()
    layer._config_manifest = AgentStubConfigManifestResponse.model_validate_json(_manifest_output(writable=True))
    layer._config_cli_help = {"dify-agent config push --help": _push_help_output()}

    prompt = layer.build_suffix_prompt()

    assert "Agent config CLI help" in prompt
    assert "$ dify-agent config push --help" in prompt
    assert "Recommended usage reads the JSON spec from stdin" in prompt
    assert "cat <<'JSON' | dify-agent config push" in prompt
    assert "./.dify_conf/files/guide.txt" in prompt


def test_build_shell_pull_script_includes_json_markers_and_targets() -> None:
    layer = _build_layer()

    script = layer._build_shell_pull_script()

    assert 'mkdir -p "$base/skills" "$base/files"' in script
    assert "__DIFY_CONFIG_SKILLS_BEGIN__" in script
    assert 'dify-agent config skill pull alpha --to "$base/skills" --json' in script
    assert "__DIFY_CONFIG_FILES_BEGIN__" in script
    assert 'dify-agent config file pull guide.txt --to "$base/files" --json' in script


def test_parse_shell_pull_output_reads_marked_json_payloads() -> None:
    layer = _build_layer()

    skill_items, file_items = layer._parse_shell_pull_output(_pull_output())

    assert skill_items == [
        {
            "name": "alpha",
            "archive_path": "/tmp/dify-config/skills/alpha.zip",
            "directory_path": "/tmp/dify-config/skills/alpha",
            "skill_md": "# Alpha\nUse it.\n",
        }
    ]
    assert file_items == [{"name": "guide.txt", "path": "/tmp/dify-config/files/guide.txt"}]


def test_parse_shell_pull_output_rejects_invalid_json() -> None:
    layer = _build_layer()

    with pytest.raises(DifyConfigLayerError, match="invalid JSON"):
        layer._parse_shell_pull_output("__DIFY_CONFIG_SKILLS_BEGIN__\nnot-json\n__DIFY_CONFIG_SKILLS_END__\n")


def test_extract_marked_json_rejects_missing_end_marker() -> None:
    with pytest.raises(DifyConfigLayerError, match="omitted end marker"):
        DifyConfigLayer._extract_marked_json("prefix __DIFY_CONFIG_SKILLS_BEGIN__\n{}", "__DIFY_CONFIG_SKILLS_BEGIN__", "__DIFY_CONFIG_SKILLS_END__")


@pytest.mark.anyio
async def test_on_context_create_pulls_mentioned_assets_and_populates_materialized_maps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()
    captured: dict[str, object] = {}
    help_scripts: list[str] = []

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, timeout
        if script == "dify-agent config manifest":
            captured["manifest_inject_agent_stub_env"] = inject_agent_stub_env
            return _remote_result(_manifest_output())
        if "--help" in script:
            help_scripts.append(script)
            return _remote_result(_push_help_output())
        captured["pull_script"] = script
        captured["pull_inject_agent_stub_env"] = inject_agent_stub_env
        return _remote_result(_pull_output())

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    await layer.on_context_create()

    assert captured["manifest_inject_agent_stub_env"] is True
    assert layer._config_manifest_output == _manifest_output()
    assert "dify-agent config --help" in help_scripts
    assert "dify-agent config manifest --help" in help_scripts
    assert "dify-agent config skill pull --help" in help_scripts
    assert "dify-agent config file pull --help" in help_scripts
    assert "dify-agent config env pull --help" in help_scripts
    assert "dify-agent config note pull --help" in help_scripts
    assert "dify-agent config push --help" in help_scripts
    assert "dify-agent config skill --help" not in help_scripts
    assert "dify-agent config file --help" not in help_scripts
    assert "dify-agent config env --help" not in help_scripts
    assert "dify-agent config note --help" not in help_scripts
    assert layer._config_cli_help["dify-agent config push --help"] == _push_help_output().strip()
    assert captured["pull_inject_agent_stub_env"] is True
    assert 'dify-agent config skill pull alpha --to "$base/skills" --json' in captured["pull_script"]
    assert 'dify-agent config file pull guide.txt --to "$base/files" --json' in captured["pull_script"]
    assert layer._loaded_skill_bodies == {"alpha": "# Alpha\nUse it.\n"}
    assert layer._pulled_skill_paths == {"alpha": "/tmp/dify-config/skills/alpha"}
    assert layer._pulled_file_paths == {"guide.txt": "/tmp/dify-config/files/guide.txt"}


@pytest.mark.anyio
async def test_config_cli_help_commands_run_in_parallel(monkeypatch: pytest.MonkeyPatch) -> None:
    layer = _build_layer()
    active_commands = 0
    max_active_commands = 0

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        nonlocal active_commands, max_active_commands
        del self, inject_agent_stub_env, timeout
        active_commands += 1
        max_active_commands = max(max_active_commands, active_commands)
        await asyncio.sleep(0)
        active_commands -= 1
        return _remote_result(f"Usage: {script}\n")

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    await layer._load_config_cli_help()

    assert max_active_commands > 1
    assert "dify-agent config skill --help" not in layer._config_cli_help
    assert "dify-agent config skill pull --help" in layer._config_cli_help


@pytest.mark.anyio
async def test_on_context_create_raises_when_shell_output_is_truncated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, inject_agent_stub_env, timeout
        if script == "dify-agent config manifest":
            return _remote_result(_manifest_output())
        if "--help" in script:
            return _remote_result(_push_help_output())
        return _remote_result(_pull_output(), output_complete=False, incomplete_reason="output_limit")

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
        if script == "dify-agent config manifest":
            return _remote_result(_manifest_output())
        if "--help" in script:
            return _remote_result(_push_help_output())
        return _remote_result(_pull_output(include_skill=False))

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    with pytest.raises(DifyConfigLayerError, match="missing pulled skill content"):
        await layer.on_context_create()


@pytest.mark.anyio
async def test_on_context_create_raises_when_mentioned_file_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, inject_agent_stub_env, timeout
        if script == "dify-agent config manifest":
            return _remote_result(_manifest_output())
        if "--help" in script:
            return _remote_result(_push_help_output())
        return _remote_result(_pull_output(include_file=False))

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    with pytest.raises(DifyConfigLayerError, match="missing pulled file"):
        await layer.on_context_create()

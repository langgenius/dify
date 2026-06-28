"""Behavior tests for the runtime Dify config layer."""

from __future__ import annotations

import pytest

from dify_agent.adapters.shell.shellctl import ShellctlProvisioner
from dify_agent.layers.config import DifyConfigFileConfig, DifyConfigLayerConfig, DifyConfigSkillConfig
from dify_agent.layers.config.layer import DifyConfigLayer, DifyConfigLayerError
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer, RemoteCommandResult


def _unused_client_factory():
    raise AssertionError("shellctl client should not be used by these config-layer tests")


def _shell_layer() -> DifyShellLayer:
    return DifyShellLayer.from_config_with_settings(
        DifyShellLayerConfig(agent_stub_drive_ref="agent-1"),
        shell_provisioner=ShellctlProvisioner(client_factory=_unused_client_factory),
    )


def _build_layer(*, writable: bool = True) -> DifyConfigLayer:
    layer = DifyConfigLayer.from_config(
        DifyConfigLayerConfig(
            skills=[
                DifyConfigSkillConfig(name="alpha", description="Primary skill."),
                DifyConfigSkillConfig(name="beta", description="Fallback skill."),
            ],
            files=[DifyConfigFileConfig(name="guide.txt"), DifyConfigFileConfig(name="report.csv")],
            env_keys=["API_KEY", "TOKEN"],
            note="Use the config carefully.",
            mentioned_skill_names=["alpha"],
            mentioned_file_names=["guide.txt"],
            writable=writable,
        )
    )
    layer.bind_deps({"shell": _shell_layer()})
    return layer


def _remote_result(output: str, *, exit_code: int | None = 0, truncated: bool = False) -> RemoteCommandResult:
    return RemoteCommandResult(status="exited", exit_code=exit_code, output=output, truncated=truncated)


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


def test_config_layer_prefix_prompt_includes_loaded_note_skill_and_file_paths() -> None:
    layer = _build_layer()
    layer._loaded_skill_bodies = {"alpha": "# Alpha\nUse it.\n"}
    layer._pulled_skill_paths = {"alpha": "/tmp/dify-config/skills/alpha"}
    layer._pulled_file_paths = {"guide.txt": "/tmp/dify-config/files/guide.txt"}

    prompt = layer.build_prompt_context()

    assert "Config note:\nUse the config carefully." in prompt
    assert "Loaded mentioned skills" in prompt
    assert "Name: alpha" in prompt
    assert "Local path: /tmp/dify-config/skills/alpha" in prompt
    assert "SKILL.md:\n# Alpha\nUse it.\n" in prompt
    assert "Mentioned files pulled locally:\n- guide.txt -> /tmp/dify-config/files/guide.txt" in prompt


def test_config_layer_suffix_prompt_shows_remaining_assets_and_writable_push_hint() -> None:
    writable_layer = _build_layer(writable=True)
    readonly_layer = _build_layer(writable=False)

    writable_prompt = writable_layer.build_suffix_prompt()
    readonly_prompt = readonly_layer.build_suffix_prompt()

    assert "Other available skills:\n- beta: Fallback skill." in writable_prompt
    assert "Available files:\n- report.csv" in writable_prompt
    assert "Available env keys:\n- API_KEY\n- TOKEN" in writable_prompt
    assert "dify-agent config push [--from PATH]" in writable_prompt
    assert "dify-agent config push [--from PATH]" not in readonly_prompt


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

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, timeout
        captured["script"] = script
        captured["inject_agent_stub_env"] = inject_agent_stub_env
        return _remote_result(_pull_output())

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    await layer.on_context_create()

    assert captured["inject_agent_stub_env"] is True
    assert 'dify-agent config skill pull alpha --to "$base/skills" --json' in captured["script"]
    assert 'dify-agent config file pull guide.txt --to "$base/files" --json' in captured["script"]
    assert layer._loaded_skill_bodies == {"alpha": "# Alpha\nUse it.\n"}
    assert layer._pulled_skill_paths == {"alpha": "/tmp/dify-config/skills/alpha"}
    assert layer._pulled_file_paths == {"guide.txt": "/tmp/dify-config/files/guide.txt"}


@pytest.mark.anyio
async def test_on_context_create_raises_when_shell_output_is_truncated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, script, inject_agent_stub_env, timeout
        return _remote_result(_pull_output(), truncated=True)

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    with pytest.raises(DifyConfigLayerError, match="output was truncated"):
        await layer.on_context_create()


@pytest.mark.anyio
async def test_on_context_create_raises_when_mentioned_skill_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script(self, script: str, *, inject_agent_stub_env: bool = False, timeout: float = 10.0):
        del self, script, inject_agent_stub_env, timeout
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
        del self, script, inject_agent_stub_env, timeout
        return _remote_result(_pull_output(include_file=False))

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)

    with pytest.raises(DifyConfigLayerError, match="missing pulled file"):
        await layer.on_context_create()

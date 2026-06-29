"""Behavior tests for the runtime Dify drive layer."""

from __future__ import annotations

from typing import Literal

import pytest

from dify_agent.adapters.shell.shellctl import ShellctlProvider
from dify_agent.layers.drive import DifyDriveLayerConfig, DifyDriveSkillConfig
from dify_agent.layers.drive.layer import DifyDriveLayer, DifyDriveLayerError
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import CompleteRemoteCommandResult, DifyShellLayer


def _unused_client_factory():
    raise AssertionError("shellctl client should not be used by these drive-layer tests")


def _shell_layer() -> DifyShellLayer:
    return DifyShellLayer.from_config_with_settings(
        DifyShellLayerConfig(agent_stub_drive_ref="agent-1"),
        shell_provider=ShellctlProvider(entrypoint="http://shellctl", token="", client_factory=_unused_client_factory),
    )


def _build_layer() -> DifyDriveLayer:
    layer = DifyDriveLayer.from_config(
        DifyDriveLayerConfig(
            drive_ref="agent-1",
            skills=[
                DifyDriveSkillConfig(
                    path="tender-analyzer",
                    name="Tender Analyzer",
                    description="Parses RFPs.",
                    skill_md_key="tender-analyzer/SKILL.md",
                    archive_key="tender-analyzer/.DIFY-SKILL-FULL.zip",
                ),
                DifyDriveSkillConfig(
                    path="other-skill",
                    name="Other Skill",
                    description="Fallback catalog entry.",
                    skill_md_key="other-skill/SKILL.md",
                    archive_key=None,
                ),
            ],
            mentioned_skill_keys=["tender-analyzer/SKILL.md"],
            mentioned_file_keys=["files/report.pdf"],
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
        job_id="remote-drive-pull",
        status="exited",
        done=True,
        exit_code=exit_code,
        output=output,
        output_complete=output_complete,
        incomplete_reason=incomplete_reason,
        offset=len(output),
        output_path="/tmp/output.log",
    )


def _pulled_output() -> str:
    return (
        "/mnt/drive/agent-1/tender-analyzer\n"
        "/mnt/drive/agent-1/files/report.pdf\n"
        "__DIFY_DRIVE_MENTIONED_PATH__\ttender-analyzer/SKILL.md\t/mnt/drive/agent-1/tender-analyzer/SKILL.md\n"
        "__DIFY_DRIVE_SKILL_BEGIN__\ttender-analyzer/SKILL.md\n"
        "# Tender Analyzer\n"
        "Use carefully.\n"
        "__DIFY_DRIVE_SKILL_END__\ttender-analyzer/SKILL.md\n"
        "__DIFY_DRIVE_MENTIONED_PATH__\tfiles/report.pdf\t/mnt/drive/agent-1/files/report.pdf\n"
    )


def _file_help_output(command: str) -> str:
    return f"Usage: {command.removesuffix(' --help')} [OPTIONS]\n\nAgent Stub file command help.\n"


def _patch_file_help(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    captured_scripts: list[str] = []

    async def fake_run_remote_script(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, timeout, inject_agent_stub_env
        captured_scripts.append(script)
        return _remote_result(_file_help_output(script))

    monkeypatch.setattr(DifyShellLayer, "run_remote_script", fake_run_remote_script)
    return captured_scripts


def test_drive_layer_exposes_agent_stub_cli_usage_suffix_prompt() -> None:
    layer = _build_layer()
    layer._agent_stub_cli_help = {
        "dify-agent file --help": _file_help_output("dify-agent file --help"),
        "dify-agent file upload --help": _file_help_output("dify-agent file upload --help"),
    }

    assert len(layer.suffix_prompts) == 1
    prompt = layer.suffix_prompts[0]
    assert "Other available skills" in prompt
    assert "other-skill: Other Skill" in prompt
    assert "Agent Stub file CLI help" in prompt
    assert "$ dify-agent file upload --help" in prompt
    assert "dify-agent drive" not in prompt


@pytest.mark.anyio
async def test_on_context_create_pulls_mentioned_targets_through_shell(monkeypatch: pytest.MonkeyPatch) -> None:
    layer = _build_layer()
    captured: dict[str, object] = {}
    help_scripts = _patch_file_help(monkeypatch)

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, timeout
        captured["script"] = script
        captured["inject_agent_stub_env"] = inject_agent_stub_env
        return _remote_result(_pulled_output())

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    await layer.on_context_create()

    assert help_scripts == [
        "dify-agent file --help",
        "dify-agent file upload --help",
        "dify-agent file download --help",
    ]
    assert "dify-agent file download --help" in layer._agent_stub_cli_help
    script = captured["script"]
    assert isinstance(script, str)
    assert captured["inject_agent_stub_env"] is True
    assert 'dify-agent drive pull tender-analyzer/ files/report.pdf --to "$base"' in script
    prompt = layer.build_prompt_context()
    assert "Loaded mentioned skills" in prompt
    assert "# Tender Analyzer\nUse carefully." in prompt


@pytest.mark.anyio
async def test_on_context_create_raises_when_shell_pull_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    layer = _build_layer()
    _patch_file_help(monkeypatch)

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, script, timeout, inject_agent_stub_env
        return _remote_result("permission denied\n", exit_code=1)

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    with pytest.raises(DifyDriveLayerError) as exc_info:
        await layer.on_context_create()

    message = str(exc_info.value)
    assert "drive mentioned pull failed in shell: exited exit_code=1" in message
    assert "output_complete=True" in message
    assert "output_path=/tmp/output.log" in message


@pytest.mark.anyio
async def test_on_context_create_raises_when_required_skill_marker_is_missing_from_complete_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()
    _patch_file_help(monkeypatch)

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, script, timeout, inject_agent_stub_env
        return _remote_result("__DIFY_DRIVE_MENTIONED_PATH__\tfiles/report.pdf\t/mnt/drive/agent-1/files/report.pdf\n")

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    with pytest.raises(DifyDriveLayerError, match="missing pulled SKILL.md"):
        await layer.on_context_create()


@pytest.mark.anyio
async def test_on_context_create_reports_incomplete_capture_when_required_marker_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()
    _patch_file_help(monkeypatch)

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, script, timeout, inject_agent_stub_env
        output = "__DIFY_DRIVE_MENTIONED_PATH__\ttender-analyzer/SKILL.md\t/mnt/drive/agent-1/tender-analyzer/SKILL.md\n"
        return _remote_result(output, output_complete=False, incomplete_reason="output_limit")

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    with pytest.raises(DifyDriveLayerError) as exc_info:
        await layer.on_context_create()

    message = str(exc_info.value)
    assert "output incomplete before required SKILL.md content was captured" in message
    assert "reason=output_limit" in message

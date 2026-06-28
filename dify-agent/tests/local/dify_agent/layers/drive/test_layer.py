"""Behavior tests for the runtime Dify drive layer."""

from __future__ import annotations

from typing import Literal, cast

import pytest

from dify_agent.layers.drive import DifyDriveLayerConfig, DifyDriveSkillConfig
from dify_agent.layers.drive.layer import DifyDriveLayer, DifyDriveLayerError
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import CompleteRemoteCommandResult, DifyShellLayer, ShellctlClientFactory


def _unused_client_factory(_entrypoint: str):
    raise AssertionError("shellctl client should not be used by these drive-layer tests")


def _shell_layer() -> DifyShellLayer:
    return DifyShellLayer.from_config_with_settings(
        DifyShellLayerConfig(agent_stub_drive_ref="agent-1"),
        shellctl_entrypoint="http://shellctl",
        shellctl_client_factory=cast(ShellctlClientFactory, _unused_client_factory),
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


def test_drive_layer_exposes_agent_stub_cli_usage_suffix_prompt() -> None:
    layer = _build_layer()

    assert len(layer.suffix_prompts) == 1
    prompt = layer.suffix_prompts[0]
    assert "Other available skills" in prompt
    assert "other-skill: Other Skill — Fallback catalog entry." in prompt
    assert "`dify-agent drive pull other-skill/`" not in prompt
    assert (
        '`skill_dir="$(dify-agent drive pull <SKILL_PATH> --to /tmp/drive)"; '
        'printf "%s\\n" "$skill_dir"; cat "$skill_dir/SKILL.md"`'
    ) in prompt
    assert "dify-agent drive list [REMOTE_PREFIX]" in prompt
    assert "dify-agent drive pull [REMOTE ...] [--to LOCAL_DIR]" in prompt
    assert "--to ." in prompt
    assert "dify-agent drive push LOCAL_FILE REMOTE_PATH" in prompt
    assert "dify-agent drive push LOCAL_DIR REMOTE_PATH --kind skill" in prompt
    assert "dify-agent drive push LOCAL_DIR REMOTE_PATH --kind dir" in prompt
    assert "dify-agent file download TRANSFER_METHOD REFERENCE_OR_URL [--to LOCAL_DIR]" in prompt
    assert "dify-agent file download --mapping" in prompt
    assert "dify-agent file upload PATH" in prompt
    assert '{"transfer_method":"tool_file","reference":"..."}' in prompt
    assert "--recursive" not in prompt
    assert "--drive-base" not in prompt


@pytest.mark.anyio
async def test_on_context_create_pulls_mentioned_targets_through_shell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()
    captured: dict[str, object] = {}

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

    script = captured["script"]
    assert isinstance(script, str)
    assert captured["inject_agent_stub_env"] is True
    assert "base=/mnt/drive/agent-1" in script
    assert 'dify-agent drive pull tender-analyzer/ files/report.pdf --to "$base"' in script
    assert "cat /mnt/drive/agent-1/tender-analyzer/SKILL.md" in script
    prompt = layer.build_prompt_context()
    assert "Loaded mentioned skills" in prompt
    assert "Path: tender-analyzer" in prompt
    assert "Local path: /mnt/drive/agent-1/tender-analyzer" in prompt
    assert "Name: Tender Analyzer" not in prompt
    assert "# Tender Analyzer\nUse carefully." in prompt
    assert "files/report.pdf -> /mnt/drive/agent-1/files/report.pdf" in prompt
    assert "Other available skills" not in prompt


@pytest.mark.anyio
async def test_on_context_resume_repulls_mentioned_targets_through_shell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()
    calls = 0

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, script, timeout
        nonlocal calls
        calls += 1
        assert inject_agent_stub_env is True
        return _remote_result(_pulled_output())

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    await layer.on_context_resume()

    assert calls == 1
    assert "Loaded mentioned skills" in layer.build_prompt_context()


@pytest.mark.anyio
async def test_on_context_create_raises_when_mentioned_file_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, script, timeout, inject_agent_stub_env
        output = (
            "__DIFY_DRIVE_MENTIONED_PATH__\ttender-analyzer/SKILL.md\t/mnt/drive/agent-1/tender-analyzer/SKILL.md\n"
            "__DIFY_DRIVE_SKILL_BEGIN__\ttender-analyzer/SKILL.md\n"
            "# Tender Analyzer\n"
            "__DIFY_DRIVE_SKILL_END__\ttender-analyzer/SKILL.md\n"
        )
        return _remote_result(output)

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    with pytest.raises(DifyDriveLayerError, match="missing pulled file"):
        await layer.on_context_create()


@pytest.mark.anyio
async def test_on_context_create_raises_when_shell_pull_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

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
    assert "incomplete_reason=None" in message
    assert "output_path=/tmp/output.log" in message
    assert "permission denied\n" in message


@pytest.mark.anyio
async def test_on_context_create_keeps_complete_business_payload_when_capture_is_incomplete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, script, timeout, inject_agent_stub_env
        return _remote_result(_pulled_output(), output_complete=False, incomplete_reason="output_limit")

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    await layer.on_context_create()

    prompt = layer.build_prompt_context()
    assert "# Tender Analyzer\nUse carefully." in prompt
    assert "files/report.pdf -> /mnt/drive/agent-1/files/report.pdf" in prompt


@pytest.mark.anyio
async def test_on_context_create_raises_incomplete_capture_when_skill_body_is_missing_from_incomplete_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, script, timeout, inject_agent_stub_env
        output = (
            "__DIFY_DRIVE_MENTIONED_PATH__\ttender-analyzer/SKILL.md\t/mnt/drive/agent-1/tender-analyzer/SKILL.md\n"
            "__DIFY_DRIVE_SKILL_BEGIN__\ttender-analyzer/SKILL.md\n"
            "# Tender Analyzer\n"
        )
        return _remote_result(output, output_complete=False, incomplete_reason="output_limit")

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    with pytest.raises(DifyDriveLayerError) as exc_info:
        await layer.on_context_create()

    message = str(exc_info.value)
    assert "drive mentioned pull output incomplete before required SKILL.md content was captured" in message
    assert "reason=output_limit" in message
    assert "output_path=/tmp/output.log" in message
    assert "__DIFY_DRIVE_SKILL_BEGIN__\ttender-analyzer/SKILL.md" in message
    assert "# Tender Analyzer\n" in message


@pytest.mark.anyio
async def test_on_context_create_raises_incomplete_capture_when_mentioned_file_path_marker_is_missing_from_incomplete_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, script, timeout, inject_agent_stub_env
        output = (
            "__DIFY_DRIVE_MENTIONED_PATH__\ttender-analyzer/SKILL.md\t/mnt/drive/agent-1/tender-analyzer/SKILL.md\n"
            "__DIFY_DRIVE_SKILL_BEGIN__\ttender-analyzer/SKILL.md\n"
            "# Tender Analyzer\n"
            "Use carefully.\n"
            "__DIFY_DRIVE_SKILL_END__\ttender-analyzer/SKILL.md\n"
        )
        return _remote_result(output, output_complete=False, incomplete_reason="output_limit")

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    with pytest.raises(DifyDriveLayerError) as exc_info:
        await layer.on_context_create()

    message = str(exc_info.value)
    assert "drive mentioned pull output incomplete before required SKILL.md content was captured" in message
    assert "reason=output_limit" in message
    assert "output_path=/tmp/output.log" in message
    assert "__DIFY_DRIVE_SKILL_END__\ttender-analyzer/SKILL.md" in message
    assert "Use carefully.\n" in message


@pytest.mark.anyio
async def test_on_context_create_raises_business_failure_when_skill_body_is_missing_from_complete_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layer = _build_layer()

    async def fake_run_remote_script_complete(
        self: DifyShellLayer,
        script: str,
        *,
        timeout: float = 10.0,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        del self, script, timeout, inject_agent_stub_env
        output = (
            "__DIFY_DRIVE_MENTIONED_PATH__\ttender-analyzer/SKILL.md\t/mnt/drive/agent-1/tender-analyzer/SKILL.md\n"
            "__DIFY_DRIVE_SKILL_BEGIN__\ttender-analyzer/SKILL.md\n"
            "# Tender Analyzer\n"
        )
        return _remote_result(output)

    monkeypatch.setattr(DifyShellLayer, "run_remote_script_complete", fake_run_remote_script_complete)

    with pytest.raises(DifyDriveLayerError, match="omitted SKILL.md end marker"):
        await layer.on_context_create()


def test_parse_shell_pull_output_rejects_unclosed_skill_marker() -> None:
    layer = _build_layer()

    with pytest.raises(DifyDriveLayerError, match="omitted SKILL.md end marker"):
        layer._parse_shell_pull_output("__DIFY_DRIVE_SKILL_BEGIN__\ttender-analyzer/SKILL.md\n# Tender\n")

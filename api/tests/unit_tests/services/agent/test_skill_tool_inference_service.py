"""Unit tests for skill → CLI tool inference (ENG-371)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.agent.skill_tool_inference_service import (
    SkillToolInferenceError,
    SkillToolInferenceService,
)
from services.agent_drive_service import AgentDriveError

_MOD = "services.agent.skill_tool_inference_service"

_SKILL_MD_PREVIEW = {
    "key": "audio-transcribe/SKILL.md",
    "size": 100,
    "truncated": False,
    "binary": False,
    "text": "# Audio Transcribe\nStep 2 runs ffmpeg, step 3 calls the whisper API.",
}


def _service(preview=_SKILL_MD_PREVIEW):
    drive = MagicMock()
    drive.preview.return_value = preview
    return SkillToolInferenceService(drive_service=drive), drive


def _patch_soul_files(monkeypatch, files):
    monkeypatch.setattr(SkillToolInferenceService, "_manifest_files_from_soul", staticmethod(lambda **kwargs: files))


def test_infer_returns_suggestions_with_inferred_from(monkeypatch):
    service, drive = _service()
    _patch_soul_files(monkeypatch, ["SKILL.md", "scripts/transcribe.sh"])
    raw = (
        '{"inferable": true, "reason": null, "cli_tools": [{"name": "ffmpeg",'
        ' "description": "transcoding for step 2", "command": "ffmpeg",'
        ' "install_commands": ["apt-get install -y ffmpeg"],'
        ' "env_suggestions": [{"key": "OPENAI_API_KEY", "reason": "whisper call", "secret_likely": true}]}]}'
    )
    with patch.object(SkillToolInferenceService, "_invoke", staticmethod(lambda **kwargs: raw)):
        result = service.infer(tenant_id="t-1", agent_id="a-1", slug="audio-transcribe")

    assert result["inferable"] is True
    tool = result["cli_tools"][0]
    assert tool["name"] == "ffmpeg"
    assert tool["inferred_from"] == "audio-transcribe"
    assert tool["env_suggestions"] == [{"key": "OPENAI_API_KEY", "reason": "whisper call", "secret_likely": True}]
    drive.preview.assert_called_once_with(tenant_id="t-1", agent_id="a-1", key="audio-transcribe/SKILL.md")


def test_infer_threads_manifest_files_into_the_prompt(monkeypatch):
    service, _ = _service()
    _patch_soul_files(monkeypatch, ["scripts/run.sh"])
    captured: dict[str, str] = {}

    def fake_invoke(*, tenant_id, user_prompt):
        captured["prompt"] = user_prompt
        return '{"inferable": false, "cli_tools": [], "reason": "none"}'

    with patch.object(SkillToolInferenceService, "_invoke", staticmethod(fake_invoke)):
        service.infer(tenant_id="t-1", agent_id="a-1", slug="audio-transcribe")

    assert "scripts/run.sh" in captured["prompt"]
    assert "ffmpeg" in captured["prompt"]  # SKILL.md body present


def test_infer_not_inferable_passes_reason_through(monkeypatch):
    service, _ = _service()
    _patch_soul_files(monkeypatch, [])
    raw = '{"inferable": false, "cli_tools": [], "reason": "SKILL.md 未描述任何外部命令依赖"}'
    with patch.object(SkillToolInferenceService, "_invoke", staticmethod(lambda **kwargs: raw)):
        result = service.infer(tenant_id="t-1", agent_id="a-1", slug="audio-transcribe")
    assert result == {"inferable": False, "cli_tools": [], "reason": "SKILL.md 未描述任何外部命令依赖"}


def test_infer_retries_once_then_422(monkeypatch):
    service, _ = _service()
    _patch_soul_files(monkeypatch, [])
    calls: list[int] = []

    def bad_invoke(**kwargs):
        calls.append(1)
        return "not json at all ]["

    with patch.object(SkillToolInferenceService, "_invoke", staticmethod(bad_invoke)):
        with pytest.raises(SkillToolInferenceError) as exc_info:
            service.infer(tenant_id="t-1", agent_id="a-1", slug="audio-transcribe")

    assert len(calls) == 2  # one retry
    assert exc_info.value.code == "inference_failed"
    assert exc_info.value.status_code == 422


def test_infer_repairs_slightly_malformed_json(monkeypatch):
    service, _ = _service()
    _patch_soul_files(monkeypatch, [])
    raw = 'Here you go: {"inferable": true, "cli_tools": [], "reason": null,}'
    with patch.object(SkillToolInferenceService, "_invoke", staticmethod(lambda **kwargs: raw)):
        result = service.infer(tenant_id="t-1", agent_id="a-1", slug="audio-transcribe")
    assert result["inferable"] is True


def test_missing_skill_maps_to_404():
    drive = MagicMock()
    drive.preview.side_effect = AgentDriveError("drive_key_not_found", "nope", status_code=404)
    service = SkillToolInferenceService(drive_service=drive)

    with pytest.raises(SkillToolInferenceError) as exc_info:
        service.infer(tenant_id="t-1", agent_id="a-1", slug="ghost")
    assert exc_info.value.code == "skill_not_found"
    assert exc_info.value.status_code == 404


def test_binary_skill_md_maps_to_404():
    service, _ = _service(preview={"key": "x/SKILL.md", "size": 1, "truncated": False, "binary": True, "text": None})
    with pytest.raises(SkillToolInferenceError) as exc_info:
        service.infer(tenant_id="t-1", agent_id="a-1", slug="x")
    assert exc_info.value.code == "skill_not_found"

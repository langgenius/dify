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


def test_infer_returns_suggestions_with_inferred_from(monkeypatch: pytest.MonkeyPatch):
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


def test_infer_threads_manifest_files_into_the_prompt(monkeypatch: pytest.MonkeyPatch):
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


def test_infer_not_inferable_passes_reason_through(monkeypatch: pytest.MonkeyPatch):
    service, _ = _service()
    _patch_soul_files(monkeypatch, [])
    raw = '{"inferable": false, "cli_tools": [], "reason": "SKILL.md 未描述任何外部命令依赖"}'
    with patch.object(SkillToolInferenceService, "_invoke", staticmethod(lambda **kwargs: raw)):
        result = service.infer(tenant_id="t-1", agent_id="a-1", slug="audio-transcribe")
    assert result == {"inferable": False, "cli_tools": [], "reason": "SKILL.md 未描述任何外部命令依赖"}


def test_infer_retries_once_then_422(monkeypatch: pytest.MonkeyPatch):
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


def test_infer_repairs_slightly_malformed_json(monkeypatch: pytest.MonkeyPatch):
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


# ── real-path coverage: _invoke / _manifest_files_from_soul / passthrough ────


def test_invoke_maps_missing_default_model_to_400(monkeypatch: pytest.MonkeyPatch):
    import services.agent.skill_tool_inference_service as module
    from core.errors.error import ProviderTokenNotInitError

    fake_manager = MagicMock()
    fake_manager.get_default_model_instance.side_effect = ProviderTokenNotInitError("no default")
    monkeypatch.setattr(module.ModelManager, "for_tenant", classmethod(lambda cls, tenant_id: fake_manager))

    with pytest.raises(SkillToolInferenceError) as exc_info:
        SkillToolInferenceService._invoke(tenant_id="t-1", user_prompt="x")
    assert exc_info.value.code == "default_model_not_configured"
    assert exc_info.value.status_code == 400


def test_invoke_maps_model_failure_to_422_and_success_returns_text(monkeypatch: pytest.MonkeyPatch):
    import services.agent.skill_tool_inference_service as module

    fake_manager = MagicMock()
    fake_instance = MagicMock()
    fake_manager.get_default_model_instance.return_value = fake_instance
    monkeypatch.setattr(module.ModelManager, "for_tenant", classmethod(lambda cls, tenant_id: fake_manager))

    fake_instance.invoke_llm.side_effect = RuntimeError("provider down")
    with pytest.raises(SkillToolInferenceError) as exc_info:
        SkillToolInferenceService._invoke(tenant_id="t-1", user_prompt="x")
    assert exc_info.value.code == "inference_failed"
    assert exc_info.value.status_code == 422

    fake_instance.invoke_llm.side_effect = None
    fake_instance.invoke_llm.return_value.message.get_text_content.return_value = '{"inferable": false}'
    raw = SkillToolInferenceService._invoke(tenant_id="t-1", user_prompt="x")
    assert raw == '{"inferable": false}'
    call = fake_instance.invoke_llm.call_args.kwargs
    assert call["model_parameters"] == {"temperature": 0.1}
    assert call["stream"] is False


def test_load_skill_md_passes_through_non_missing_drive_errors():
    drive = MagicMock()
    drive.preview.side_effect = AgentDriveError("agent_not_found", "tenant mismatch", status_code=404)
    service = SkillToolInferenceService(drive_service=drive)

    with pytest.raises(SkillToolInferenceError) as exc_info:
        service.infer(tenant_id="t-1", agent_id="a-1", slug="x")
    assert exc_info.value.code == "agent_not_found"


def _patch_inference_db(monkeypatch: pytest.MonkeyPatch, *, agent, snapshot):
    from types import SimpleNamespace

    import services.agent.skill_tool_inference_service as module

    results = iter([agent, snapshot])
    monkeypatch.setattr(module.db, "session", SimpleNamespace(scalar=lambda stmt: next(results)))


def test_manifest_files_from_soul_reads_active_snapshot(monkeypatch: pytest.MonkeyPatch):
    from types import SimpleNamespace

    soul_dict = {
        "skills_files": {
            "skills": [
                {"name": "Other", "skill_md_key": "other/SKILL.md", "manifest_files": ["x.md"]},
                {"name": "Audio", "skill_md_key": "audio-transcribe/SKILL.md", "manifest_files": ["scripts/a.sh"]},
            ]
        }
    }
    agent = SimpleNamespace(active_config_snapshot_id="snap-1")
    snapshot = SimpleNamespace(config_snapshot_dict=soul_dict)
    _patch_inference_db(monkeypatch, agent=agent, snapshot=snapshot)

    files = SkillToolInferenceService._manifest_files_from_soul(
        tenant_id="t-1", agent_id="a-1", slug="audio-transcribe"
    )
    assert files == ["scripts/a.sh"]


def test_manifest_files_from_soul_degrades_when_agent_or_snapshot_missing(monkeypatch: pytest.MonkeyPatch):
    _patch_inference_db(monkeypatch, agent=None, snapshot=None)
    assert SkillToolInferenceService._manifest_files_from_soul(tenant_id="t", agent_id="a", slug="s") == []

    from types import SimpleNamespace

    _patch_inference_db(monkeypatch, agent=SimpleNamespace(active_config_snapshot_id="snap-1"), snapshot=None)
    assert SkillToolInferenceService._manifest_files_from_soul(tenant_id="t", agent_id="a", slug="s") == []


def test_manifest_files_from_soul_empty_when_slug_not_in_soul(monkeypatch: pytest.MonkeyPatch):
    from types import SimpleNamespace

    soul_dict = {"skills_files": {"skills": [{"name": "Other", "skill_md_key": "other/SKILL.md"}]}}
    _patch_inference_db(
        monkeypatch,
        agent=SimpleNamespace(active_config_snapshot_id="snap-1"),
        snapshot=SimpleNamespace(config_snapshot_dict=soul_dict),
    )
    assert SkillToolInferenceService._manifest_files_from_soul(tenant_id="t", agent_id="a", slug="ghost") == []

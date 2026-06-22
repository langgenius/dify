"""Behavior tests for the runtime Dify drive layer."""

from __future__ import annotations

from pathlib import Path
import pytest

from agenton.layers import EmptyRuntimeState, LayerConfig, NoLayerDeps, PlainLayer
from dify_agent.layers.drive import DifyDriveLayerConfig, DifyDriveSkillConfig
from dify_agent.layers.drive.layer import DifyDriveLayer, DifyDriveLayerError, _DriveManifestItem


class _FakeExecutionContextConfig(LayerConfig):
    tenant_id: str


class _FakeExecutionContextLayer(PlainLayer[NoLayerDeps, _FakeExecutionContextConfig, EmptyRuntimeState]):
    type_id = None

    def __init__(self, tenant_id: str) -> None:
        self.config = _FakeExecutionContextConfig(tenant_id=tenant_id)


def _build_layer(tmp_path: Path) -> DifyDriveLayer:
    layer = DifyDriveLayer.from_config_with_settings(
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
        ),
        inner_api_url="https://api.example.com",
        inner_api_key="secret",
    )
    layer.bind_deps({"execution_context": _FakeExecutionContextLayer("tenant-1")})
    return layer


@pytest.mark.anyio
async def test_on_context_create_loads_mentioned_targets_into_prompt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    layer = _build_layer(tmp_path)

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[_DriveManifestItem]:
        assert tenant_id == "tenant-1"
        assert targets == [("tender-analyzer/", False), ("files/report.pdf", True)]
        return [
            _DriveManifestItem(key="tender-analyzer/SKILL.md", download_url="https://files/skill-md"),
            _DriveManifestItem(key="files/report.pdf", download_url="https://files/report"),
        ]

    async def _download_items(items: list[_DriveManifestItem]) -> dict[str, str]:
        assert {item.key for item in items} == {"files/report.pdf", "tender-analyzer/SKILL.md"}
        skill_path = tmp_path / "tender-analyzer" / "SKILL.md"
        skill_path.parent.mkdir(parents=True, exist_ok=True)
        skill_path.write_text("# Tender Analyzer\nUse carefully.\n", encoding="utf-8")
        file_path = tmp_path / "files" / "report.pdf"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(b"pdf")
        return {
            "tender-analyzer/SKILL.md": str(skill_path),
            "files/report.pdf": str(file_path),
        }

    monkeypatch.setattr(layer, "_fetch_manifest_items", _fetch_manifest_items)
    monkeypatch.setattr(layer, "_download_items", _download_items)

    await layer.on_context_create()

    prompt = layer.build_prompt_context()
    assert "Loaded mentioned skills" in prompt
    assert "# Tender Analyzer\nUse carefully." in prompt
    assert f"files/report.pdf -> {tmp_path / 'files' / 'report.pdf'}" in prompt
    assert "Other available skills" in prompt
    assert "other-skill: Other Skill — Fallback catalog entry." in prompt


@pytest.mark.anyio
async def test_on_context_resume_loads_mentioned_targets_into_prompt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    layer = _build_layer(tmp_path)

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[_DriveManifestItem]:
        assert tenant_id == "tenant-1"
        assert targets == [("tender-analyzer/", False), ("files/report.pdf", True)]
        return [
            _DriveManifestItem(key="tender-analyzer/SKILL.md", download_url="https://files/skill-md"),
            _DriveManifestItem(key="files/report.pdf", download_url="https://files/report"),
        ]

    async def _download_items(items: list[_DriveManifestItem]) -> dict[str, str]:
        assert {item.key for item in items} == {"files/report.pdf", "tender-analyzer/SKILL.md"}
        skill_path = tmp_path / "tender-analyzer" / "SKILL.md"
        skill_path.parent.mkdir(parents=True, exist_ok=True)
        skill_path.write_text("# Tender Analyzer\nUse carefully.\n", encoding="utf-8")
        file_path = tmp_path / "files" / "report.pdf"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(b"pdf")
        return {
            "tender-analyzer/SKILL.md": str(skill_path),
            "files/report.pdf": str(file_path),
        }

    monkeypatch.setattr(layer, "_fetch_manifest_items", _fetch_manifest_items)
    monkeypatch.setattr(layer, "_download_items", _download_items)

    await layer.on_context_resume()

    prompt = layer.build_prompt_context()
    assert "Loaded mentioned skills" in prompt
    assert "# Tender Analyzer\nUse carefully." in prompt
    assert f"files/report.pdf -> {tmp_path / 'files' / 'report.pdf'}" in prompt
    assert "Other available skills" in prompt
    assert "other-skill: Other Skill — Fallback catalog entry." in prompt


@pytest.mark.anyio
async def test_on_context_create_raises_when_mentioned_file_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    layer = _build_layer(tmp_path)

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[_DriveManifestItem]:
        del tenant_id, targets
        return [_DriveManifestItem(key="tender-analyzer/SKILL.md", download_url="https://files/skill-md")]

    async def _download_items(items: list[_DriveManifestItem]) -> dict[str, str]:
        del items
        skill_path = tmp_path / "tender-analyzer" / "SKILL.md"
        skill_path.parent.mkdir(parents=True, exist_ok=True)
        skill_path.write_text("# Tender Analyzer\nUse carefully.\n", encoding="utf-8")
        return {"tender-analyzer/SKILL.md": str(skill_path)}

    monkeypatch.setattr(layer, "_fetch_manifest_items", _fetch_manifest_items)
    monkeypatch.setattr(layer, "_download_items", _download_items)

    with pytest.raises(DifyDriveLayerError, match="missing pulled file"):
        await layer.on_context_create()


@pytest.mark.anyio
async def test_on_context_resume_raises_when_mentioned_targets_are_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    layer = _build_layer(tmp_path)

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[_DriveManifestItem]:
        del tenant_id, targets
        return []

    async def _download_items(items: list[_DriveManifestItem]) -> dict[str, str]:
        assert items == []
        return {}

    monkeypatch.setattr(layer, "_fetch_manifest_items", _fetch_manifest_items)
    monkeypatch.setattr(layer, "_download_items", _download_items)

    with pytest.raises(DifyDriveLayerError, match="missing pulled file"):
        await layer.on_context_resume()


@pytest.mark.anyio
async def test_on_context_create_raises_when_manifest_is_empty_for_mentioned_targets(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    layer = _build_layer(tmp_path)

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[_DriveManifestItem]:
        del tenant_id, targets
        return []

    async def _download_items(items: list[_DriveManifestItem]) -> dict[str, str]:
        assert items == []
        return {}

    monkeypatch.setattr(layer, "_fetch_manifest_items", _fetch_manifest_items)
    monkeypatch.setattr(layer, "_download_items", _download_items)

    with pytest.raises(DifyDriveLayerError, match="missing pulled file"):
        await layer.on_context_create()

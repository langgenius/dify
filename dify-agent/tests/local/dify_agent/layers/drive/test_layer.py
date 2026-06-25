"""Behavior tests for the runtime Dify drive layer."""

from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pytest

from agenton.layers import EmptyRuntimeState, LayerConfig, NoLayerDeps, PlainLayer
from dify_agent.agent_stub._drive_materialization import DriveDownloadPayload
from dify_agent.agent_stub.protocol.agent_stub import AgentStubDriveItem
from dify_agent.layers.drive import DifyDriveLayerConfig, DifyDriveSkillConfig
from dify_agent.layers.drive.layer import DifyDriveLayer, DifyDriveLayerError


class _FakeExecutionContextConfig(LayerConfig):
    tenant_id: str


class _FakeExecutionContextLayer(PlainLayer[NoLayerDeps, _FakeExecutionContextConfig, EmptyRuntimeState]):
    type_id: ClassVar[str | None] = None

    config: _FakeExecutionContextConfig

    def __new__(cls) -> _FakeExecutionContextLayer:
        return super().__new__(cls)

    def __init__(self) -> None:
        self.config = _FakeExecutionContextConfig(tenant_id="tenant-1")


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
    layer.bind_deps({"execution_context": _FakeExecutionContextLayer()})
    return layer


class _FakeAsyncResponse:
    def __init__(self, *, status_code: int = 200, json_data: object | None = None, content: bytes = b"") -> None:
        self.status_code = status_code
        self._json_data = json_data
        self.content = content

    @property
    def is_error(self) -> bool:
        return self.status_code >= 400

    def json(self) -> object:
        if isinstance(self._json_data, Exception):
            raise self._json_data
        return self._json_data


class _FakeAsyncClient:
    def __init__(self, responses: dict[str, _FakeAsyncResponse]) -> None:
        self._responses = responses

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        del exc_type, exc, tb

    async def get(self, url: str, **kwargs) -> _FakeAsyncResponse:
        prefix = kwargs.get("params", {}).get("prefix")
        key = f"manifest:{prefix}" if prefix is not None else f"download:{url}"
        return self._responses[key]


def test_drive_layer_exposes_agent_stub_cli_usage_suffix_prompt(tmp_path: Path) -> None:
    layer = _build_layer(tmp_path)

    assert len(layer.suffix_prompts) == 1
    prompt = layer.suffix_prompts[0]
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
async def test_on_context_create_loads_mentioned_targets_into_prompt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    layer = _build_layer(tmp_path)

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[AgentStubDriveItem]:
        assert tenant_id == "tenant-1"
        assert targets == [("tender-analyzer/", False), ("files/report.pdf", True)]
        return [
            AgentStubDriveItem(key="tender-analyzer/SKILL.md", download_url="https://files/skill-md"),
            AgentStubDriveItem(key="files/report.pdf", download_url="https://files/report"),
        ]

    async def _download_items(items: list[AgentStubDriveItem]) -> dict[str, str]:
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

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[AgentStubDriveItem]:
        assert tenant_id == "tenant-1"
        assert targets == [("tender-analyzer/", False), ("files/report.pdf", True)]
        return [
            AgentStubDriveItem(key="tender-analyzer/SKILL.md", download_url="https://files/skill-md"),
            AgentStubDriveItem(key="files/report.pdf", download_url="https://files/report"),
        ]

    async def _download_items(items: list[AgentStubDriveItem]) -> dict[str, str]:
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

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[AgentStubDriveItem]:
        del tenant_id, targets
        return [AgentStubDriveItem(key="tender-analyzer/SKILL.md", download_url="https://files/skill-md")]

    async def _download_items(items: list[AgentStubDriveItem]) -> dict[str, str]:
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
async def test_fetch_manifest_items_validates_payload_filters_exact_targets_and_deduplicates(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    layer = _build_layer(tmp_path)
    responses = {
        "manifest:tender-analyzer/": _FakeAsyncResponse(
            json_data={
                "items": [
                    {"key": "tender-analyzer/SKILL.md", "download_url": "https://files/skill-md", "size": 7},
                    {"key": "files/report.pdf", "download_url": "https://files/report", "size": 3},
                ]
            }
        ),
        "manifest:files/report.pdf": _FakeAsyncResponse(
            json_data={
                "items": [
                    {"key": "files/report.pdf", "download_url": "https://files/report", "size": 3},
                    {"key": "files/other.pdf", "download_url": "https://files/other", "size": 4},
                ]
            }
        ),
    }
    monkeypatch.setattr(
        "dify_agent.layers.drive.layer.httpx.AsyncClient",
        lambda **_kwargs: _FakeAsyncClient(responses),
    )

    result = await layer._fetch_manifest_items(
        tenant_id="tenant-1",
        targets=[("tender-analyzer/", False), ("files/report.pdf", True)],
    )

    assert {(item.key, item.download_url, item.size) for item in result} == {
        ("files/report.pdf", "https://files/report", 3),
        ("tender-analyzer/SKILL.md", "https://files/skill-md", 7),
    }
    assert [item.key for item in result].count("files/report.pdf") == 1


@pytest.mark.anyio
async def test_fetch_manifest_items_rejects_invalid_manifest_payload(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    layer = _build_layer(tmp_path)
    responses = {"manifest:tender-analyzer/": _FakeAsyncResponse(json_data={"items": "bad"})}
    monkeypatch.setattr(
        "dify_agent.layers.drive.layer.httpx.AsyncClient",
        lambda **_kwargs: _FakeAsyncClient(responses),
    )

    with pytest.raises(DifyDriveLayerError, match="drive manifest response is invalid"):
        await layer._fetch_manifest_items(tenant_id="tenant-1", targets=[("tender-analyzer/", False)])


@pytest.mark.anyio
async def test_fetch_manifest_items_rejects_missing_download_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    layer = _build_layer(tmp_path)
    responses = {
        "manifest:tender-analyzer/": _FakeAsyncResponse(
            json_data={"items": [{"key": "tender-analyzer/SKILL.md", "download_url": None, "size": 7}]}
        )
    }
    monkeypatch.setattr(
        "dify_agent.layers.drive.layer.httpx.AsyncClient",
        lambda **_kwargs: _FakeAsyncClient(responses),
    )

    with pytest.raises(DifyDriveLayerError, match="missing download_url"):
        await layer._fetch_manifest_items(tenant_id="tenant-1", targets=[("tender-analyzer/", False)])


@pytest.mark.anyio
async def test_download_items_hands_validated_downloads_to_materialization(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    layer = _build_layer(tmp_path)
    responses = {
        "download:https://files/skill-md": _FakeAsyncResponse(content=b"skill-md"),
        "download:https://files/report": _FakeAsyncResponse(content=b"pdf"),
    }
    monkeypatch.setattr(
        "dify_agent.layers.drive.layer.httpx.AsyncClient",
        lambda **_kwargs: _FakeAsyncClient(responses),
    )
    captured: dict[str, object] = {}

    def fake_materialize_drive_downloads(*, base_path: Path, downloads: list[DriveDownloadPayload], archive_skip_entry_names_by_dir):
        captured["base_path"] = base_path
        captured["downloads"] = downloads
        captured["archive_skip_entry_names_by_dir"] = archive_skip_entry_names_by_dir
        return [tmp_path / "tender-analyzer" / "SKILL.md", tmp_path / "files" / "report.pdf"]

    monkeypatch.setattr(
        "dify_agent.layers.drive.layer.materialize_drive_downloads",
        fake_materialize_drive_downloads,
    )

    result = await layer._download_items(
        [
            AgentStubDriveItem(key="tender-analyzer/SKILL.md", download_url="https://files/skill-md", size=8),
            AgentStubDriveItem(key="files/report.pdf", download_url="https://files/report", size=3),
        ]
    )

    downloads = captured["downloads"]
    assert isinstance(downloads, list)
    assert downloads == [
        DriveDownloadPayload(key="tender-analyzer/SKILL.md", payload=b"skill-md", size=8),
        DriveDownloadPayload(key="files/report.pdf", payload=b"pdf", size=3),
    ]
    assert captured["archive_skip_entry_names_by_dir"] == {"tender-analyzer": {"SKILL.md"}}
    assert result == {
        "tender-analyzer/SKILL.md": str(tmp_path / "tender-analyzer" / "SKILL.md"),
        "files/report.pdf": str(tmp_path / "files" / "report.pdf"),
    }


@pytest.mark.anyio
async def test_on_context_resume_raises_when_mentioned_targets_are_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    layer = _build_layer(tmp_path)

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[AgentStubDriveItem]:
        del tenant_id, targets
        return []

    async def _download_items(items: list[AgentStubDriveItem]) -> dict[str, str]:
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

    async def _fetch_manifest_items(*, tenant_id: str, targets: list[tuple[str, bool]]) -> list[AgentStubDriveItem]:
        del tenant_id, targets
        return []

    async def _download_items(items: list[AgentStubDriveItem]) -> dict[str, str]:
        assert items == []
        return {}

    monkeypatch.setattr(layer, "_fetch_manifest_items", _fetch_manifest_items)
    monkeypatch.setattr(layer, "_download_items", _download_items)

    with pytest.raises(DifyDriveLayerError, match="missing pulled file"):
        await layer.on_context_create()

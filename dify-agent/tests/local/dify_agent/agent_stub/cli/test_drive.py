from __future__ import annotations

from io import BytesIO
from pathlib import Path
import stat
from zipfile import ZipFile, ZipInfo

import pytest

from dify_agent.agent_stub.cli._drive import (
    DrivePullResult,
    format_drive_manifest,
    list_drive_manifest_from_environment,
    pull_drive_from_environment,
    push_drive_from_environment,
)
from dify_agent.agent_stub.cli._files import UploadedToolFileMapping, UploadedToolFileResource
from dify_agent.agent_stub.client._errors import AgentStubTransferError, AgentStubValidationError
from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubDriveCommitRequest,
    AgentStubDriveCommitResponse,
    AgentStubDriveItem,
    AgentStubDriveManifestResponse,
)


def test_list_drive_manifest_from_environment_returns_manifest_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    captured: dict[str, object] = {}

    def fake_manifest(**kwargs):
        captured.update(kwargs)
        return AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/example/SKILL.md",
                    size=12,
                    hash="sha256:abc",
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                )
            ]
        )

    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        fake_manifest,
    )

    result = list_drive_manifest_from_environment(prefix="skills/")

    assert isinstance(result, AgentStubDriveManifestResponse)
    assert result.items[0].key == "skills/example/SKILL.md"
    assert captured["prefix"] == "skills/"
    assert captured["include_download_url"] is False


def test_format_drive_manifest_returns_human_readable_listing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    captured: dict[str, object] = {}

    def fake_manifest(**kwargs):
        captured.update(kwargs)
        return AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/example/SKILL.md",
                    size=12,
                    hash=None,
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                ),
                AgentStubDriveItem(
                    key="skills/example/helper.py",
                    size=None,
                    hash="sha256:abc",
                    mime_type=None,
                    file_kind="tool_file",
                    file_id="tool-file-2",
                ),
            ]
        )

    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        fake_manifest,
    )

    result = format_drive_manifest(list_drive_manifest_from_environment(prefix="skills/"))

    assert result == ("12\ttext/markdown\t-\tskills/example/SKILL.md\n-\t-\tsha256:abc\tskills/example/helper.py")
    assert captured["prefix"] == "skills/"
    assert captured["include_download_url"] is False


def test_pull_drive_from_environment_writes_files_under_drive_base(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    captured: dict[str, object] = {}

    def fake_manifest(**kwargs):
        captured.update(kwargs)
        return AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/example/SKILL.md",
                    size=11,
                    hash=None,
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/download",
                )
            ]
        )

    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        fake_manifest,
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: b"hello world",
    )

    result = pull_drive_from_environment(targets=["skills/"], local_base=str(tmp_path))

    assert result.model_dump() == {"items": [{"key": "skills/", "local_path": str(tmp_path / "skills")}]}
    assert (tmp_path / "skills" / "example" / "SKILL.md").read_bytes() == b"hello world"
    assert captured["prefix"] == "skills/"
    assert captured["include_download_url"] is True


def test_pull_drive_from_environment_auto_extracts_skill_archive(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, mode="w") as archive:
        archive.writestr("SKILL.md", "# Example\n")
        archive.writestr("nested/helper.py", "print('x')\n")
    archive_bytes = archive_buffer.getvalue()

    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **_kwargs: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/foo/.DIFY-SKILL-FULL.zip",
                    size=len(archive_bytes),
                    hash=None,
                    mime_type="application/zip",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/download",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: archive_bytes,
    )

    result = pull_drive_from_environment(targets=["skills/foo"], local_base=str(tmp_path))

    archive_path = tmp_path / "skills" / "foo" / ".DIFY-SKILL-FULL.zip"
    assert result.model_dump() == {"items": [{"key": "skills/foo", "local_path": str(tmp_path / "skills" / "foo")}]}
    assert not archive_path.exists()
    assert (tmp_path / "skills" / "foo" / "SKILL.md").read_text(encoding="utf-8") == "# Example\n"
    assert (tmp_path / "skills" / "foo" / "nested" / "helper.py").read_text(encoding="utf-8") == "print('x')\n"


def test_pull_drive_from_environment_rejects_traversal_keys(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **_kwargs: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="../escape.txt",
                    size=4,
                    hash=None,
                    mime_type="text/plain",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/download",
                )
            ]
        ),
    )

    with pytest.raises(AgentStubValidationError, match="outside the drive base"):
        _ = pull_drive_from_environment(targets=[""], local_base=str(tmp_path))


def test_pull_drive_from_environment_rejects_skill_archive_path_traversal(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, mode="w") as archive:
        archive.writestr("SKILL.md", "# Example\n")
        archive.writestr("../escape.txt", "escape")
    archive_bytes = archive_buffer.getvalue()

    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **_kwargs: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/foo/.DIFY-SKILL-FULL.zip",
                    size=len(archive_bytes),
                    hash=None,
                    mime_type="application/zip",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/download",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: archive_bytes,
    )

    with pytest.raises(AgentStubValidationError, match="path traversal"):
        _ = pull_drive_from_environment(targets=["skills/foo"], local_base=str(tmp_path))
    assert not (tmp_path / "skills" / "foo" / "SKILL.md").exists()


def test_pull_drive_from_environment_rejects_skill_archive_absolute_entry(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, mode="w") as archive:
        archive.writestr("/escape.txt", "escape")
    archive_bytes = archive_buffer.getvalue()

    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **_kwargs: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/foo/.DIFY-SKILL-FULL.zip",
                    size=len(archive_bytes),
                    hash=None,
                    mime_type="application/zip",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/download",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: archive_bytes,
    )

    with pytest.raises(AgentStubValidationError, match="absolute path"):
        _ = pull_drive_from_environment(targets=["skills/foo"], local_base=str(tmp_path))


def test_pull_drive_from_environment_rejects_skill_archive_symlink_entry(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, mode="w") as archive:
        symlink_info = ZipInfo("linked.txt")
        symlink_info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(symlink_info, "outside.txt")
    archive_bytes = archive_buffer.getvalue()

    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **_kwargs: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/foo/.DIFY-SKILL-FULL.zip",
                    size=len(archive_bytes),
                    hash=None,
                    mime_type="application/zip",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/download",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: archive_bytes,
    )

    with pytest.raises(AgentStubValidationError, match="symlink entry"):
        _ = pull_drive_from_environment(targets=["skills/foo"], local_base=str(tmp_path))


def test_pull_drive_from_environment_rejects_invalid_skill_archive(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    archive_bytes = b"not-a-zip"

    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **_kwargs: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/foo/.DIFY-SKILL-FULL.zip",
                    size=len(archive_bytes),
                    hash=None,
                    mime_type="application/zip",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/download",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: archive_bytes,
    )

    with pytest.raises(AgentStubTransferError, match="downloaded skill archive is invalid"):
        _ = pull_drive_from_environment(targets=["skills/foo"], local_base=str(tmp_path))


def test_pull_drive_from_environment_rejects_missing_download_url(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **_kwargs: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/example/SKILL.md",
                    size=11,
                    hash=None,
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                )
            ]
        ),
    )

    with pytest.raises(AgentStubValidationError, match="missing download_url"):
        _ = pull_drive_from_environment(targets=["skills/"], local_base=str(tmp_path))


def test_pull_drive_from_environment_rejects_size_mismatch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **_kwargs: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/example/SKILL.md",
                    size=99,
                    hash=None,
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/download",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: b"hello world",
    )

    with pytest.raises(AgentStubTransferError, match="size mismatch"):
        _ = pull_drive_from_environment(targets=["skills/"], local_base=str(tmp_path))


def test_pull_drive_from_environment_requests_multiple_targets_and_deduplicates_overlaps(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    captured_prefixes: list[str] = []

    def fake_manifest(**kwargs):
        captured_prefixes.append(kwargs["prefix"])
        if kwargs["prefix"] == "skills/foo":
            return AgentStubDriveManifestResponse(
                items=[
                    AgentStubDriveItem(
                        key="skills/foo/SKILL.md",
                        size=5,
                        hash=None,
                        mime_type="text/markdown",
                        file_kind="tool_file",
                        file_id="tool-file-1",
                        download_url="https://files.example.com/skill-md",
                    )
                ]
            )
        return AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="skills/foo/SKILL.md",
                    size=5,
                    hash=None,
                    mime_type="text/markdown",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/skill-md",
                ),
                AgentStubDriveItem(
                    key="files/a.txt",
                    size=1,
                    hash=None,
                    mime_type="text/plain",
                    file_kind="tool_file",
                    file_id="tool-file-2",
                    download_url="https://files.example.com/a-txt",
                ),
            ]
        )

    downloaded_urls: list[str] = []
    monkeypatch.setattr("dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync", fake_manifest)
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.download_file_bytes_from_signed_url_sync",
        lambda *, download_url: (
            downloaded_urls.append(download_url) or (b"hello" if download_url.endswith("skill-md") else b"a")
        ),
    )

    result = pull_drive_from_environment(targets=["skills/foo", "files/a.txt"], local_base=str(tmp_path))

    assert set(captured_prefixes) == {"skills/foo", "files/a.txt"}
    assert len(captured_prefixes) == 2
    assert {(item.key, item.local_path) for item in result.items} == {
        ("files/a.txt", str(tmp_path / "files" / "a.txt")),
        ("skills/foo", str(tmp_path / "skills" / "foo")),
    }
    assert set(downloaded_urls) == {"https://files.example.com/a-txt", "https://files.example.com/skill-md"}
    assert len(downloaded_urls) == 2


def test_pull_drive_from_environment_without_targets_preserves_whole_drive_pull(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    captured_prefixes: list[str] = []
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **kwargs: captured_prefixes.append(kwargs["prefix"]) or AgentStubDriveManifestResponse(items=[]),
    )

    assert pull_drive_from_environment(local_base=str(tmp_path)).model_dump() == {"items": []}
    assert captured_prefixes == [""]


def test_pull_drive_from_environment_returns_json_result(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_manifest_sync",
        lambda **_kwargs: AgentStubDriveManifestResponse(
            items=[
                AgentStubDriveItem(
                    key="files/a.txt",
                    size=1,
                    hash=None,
                    mime_type="text/plain",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    download_url="https://files.example.com/a-txt",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: b"a",
    )

    result = pull_drive_from_environment(targets=["files/a.txt"], local_base=str(tmp_path))

    assert isinstance(result, DrivePullResult)
    assert result.model_dump() == {"items": [{"key": "files/a.txt", "local_path": str(tmp_path / "files" / "a.txt")}]}
    assert (tmp_path / "files" / "a.txt").read_bytes() == b"a"


def test_push_drive_from_environment_commits_single_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    source = tmp_path / "report.pdf"
    source.write_bytes(b"report")
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.upload_tool_file_resource_from_environment",
        lambda *, path: UploadedToolFileResource(
            mapping=UploadedToolFileMapping(reference="dify-file-ref:tool-file-1"),
            tool_file_id="tool-file-1",
        ),
    )
    captured: dict[str, object] = {}

    def fake_commit(**kwargs):
        captured.update(kwargs)
        return AgentStubDriveCommitResponse(
            items=[
                AgentStubDriveItem(
                    key="files/report.pdf",
                    size=6,
                    hash=None,
                    mime_type="application/pdf",
                    file_kind="tool_file",
                    file_id="tool-file-1",
                    value_owned_by_drive=True,
                )
            ]
        )

    monkeypatch.setattr("dify_agent.agent_stub.cli._drive.request_agent_stub_drive_commit_sync", fake_commit)

    response = push_drive_from_environment(local_path=str(source), drive_path="files/report.pdf", kind=None)

    assert response.items[0].key == "files/report.pdf"
    request = captured["request"]
    assert isinstance(request, AgentStubDriveCommitRequest)
    assert request.items[0].key == "files/report.pdf"
    assert request.items[0].file_ref is not None
    assert request.items[0].file_ref.kind == "tool_file"
    assert request.items[0].file_ref.id == "tool-file-1"


def test_push_drive_from_environment_rejects_file_with_kind_skill(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "report.pdf"
    source.write_bytes(b"report")
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(AgentStubValidationError, match="--kind skill requires a directory containing SKILL.md"):
        _ = push_drive_from_environment(local_path=str(source), drive_path="files/report.pdf", kind="skill")


def test_push_drive_from_environment_rejects_symlinked_file_root(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "report.pdf"
    source.write_bytes(b"report")
    symlink_path = tmp_path / "report-link.pdf"
    symlink_path.symlink_to(source)
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(AgentStubValidationError, match="symlink"):
        _ = push_drive_from_environment(local_path=str(symlink_path), drive_path="files/report.pdf", kind=None)


def test_push_drive_from_environment_requires_kind_for_directory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(AgentStubValidationError, match="requires --kind skill or --kind dir"):
        _ = push_drive_from_environment(local_path=str(skill_dir), drive_path="skills/example", kind=None)


def test_push_drive_from_environment_kind_skill_requires_skill_md(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(AgentStubValidationError, match="requires a directory containing SKILL.md"):
        _ = push_drive_from_environment(local_path=str(skill_dir), drive_path="skills/example", kind="skill")


def test_push_drive_from_environment_kind_skill_standardizes_skill_directory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# Example\n", encoding="utf-8")
    (skill_dir / "helper.py").write_text("print('x')\n", encoding="utf-8")
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    uploaded_paths: list[str] = []

    def fake_upload(*, path: str) -> UploadedToolFileResource:
        uploaded_paths.append(Path(path).name)
        return UploadedToolFileResource(
            mapping=UploadedToolFileMapping(reference=f"dify-file-ref:{Path(path).name}"),
            tool_file_id=Path(path).name,
        )

    monkeypatch.setattr("dify_agent.agent_stub.cli._drive.upload_tool_file_resource_from_environment", fake_upload)
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_commit_sync",
        lambda **kwargs: AgentStubDriveCommitResponse(
            items=[
                AgentStubDriveItem(
                    key=item.key,
                    size=None,
                    hash=None,
                    mime_type=None,
                    file_kind=item.file_ref.kind,
                    file_id=item.file_ref.id,
                    value_owned_by_drive=item.value_owned_by_drive,
                )
                for item in kwargs["request"].items
            ]
        ),
    )

    response = push_drive_from_environment(local_path=str(skill_dir), drive_path="skills/example", kind="skill")

    assert set(uploaded_paths) == {"SKILL.md", ".DIFY-SKILL-FULL.zip"}
    assert {item.key for item in response.items} == {
        "skills/example/SKILL.md",
        "skills/example/.DIFY-SKILL-FULL.zip",
    }


def test_push_drive_from_environment_kind_skill_archive_excludes_transient_entries(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# Example\n", encoding="utf-8")
    (skill_dir / "helper.py").write_text("print('x')\n", encoding="utf-8")
    (skill_dir / ".DIFY-SKILL-FULL.zip").write_bytes(b"old-archive")
    git_dir = skill_dir / ".git"
    git_dir.mkdir()
    (git_dir / "config").write_text("[core]\n", encoding="utf-8")
    pycache_dir = skill_dir / "__pycache__"
    pycache_dir.mkdir()
    (pycache_dir / "helper.pyc").write_bytes(b"compiled")
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    archive_entries: list[str] = []

    def fake_upload(*, path: str) -> UploadedToolFileResource:
        if Path(path).name == ".DIFY-SKILL-FULL.zip":
            with ZipFile(path) as archive:
                archive_entries.extend(sorted(archive.namelist()))
        return UploadedToolFileResource(
            mapping=UploadedToolFileMapping(reference=f"dify-file-ref:{Path(path).name}"),
            tool_file_id=Path(path).name,
        )

    monkeypatch.setattr("dify_agent.agent_stub.cli._drive.upload_tool_file_resource_from_environment", fake_upload)
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_commit_sync",
        lambda **kwargs: AgentStubDriveCommitResponse(
            items=[
                AgentStubDriveItem(
                    key=item.key,
                    size=None,
                    hash=None,
                    mime_type=None,
                    file_kind=item.file_ref.kind,
                    file_id=item.file_ref.id,
                    value_owned_by_drive=item.value_owned_by_drive,
                )
                for item in kwargs["request"].items
            ]
        ),
    )

    _ = push_drive_from_environment(local_path=str(skill_dir), drive_path="skills/example", kind="skill")

    assert {"SKILL.md", "helper.py"}.issubset(archive_entries)
    assert ".git/config" not in archive_entries
    assert "__pycache__/helper.pyc" not in archive_entries
    assert ".DIFY-SKILL-FULL.zip" not in archive_entries


def test_push_drive_from_environment_kind_skill_rejects_symlinked_archive_entries(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# Example\n", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("outside", encoding="utf-8")
    (skill_dir / "linked.txt").symlink_to(outside)
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(AgentStubValidationError, match="symlink"):
        _ = push_drive_from_environment(local_path=str(skill_dir), drive_path="skills/example", kind="skill")


def test_push_drive_from_environment_kind_dir_requires_directory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "report.pdf"
    source.write_bytes(b"report")
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(AgentStubValidationError, match="--kind dir requires a directory"):
        _ = push_drive_from_environment(local_path=str(source), drive_path="files/report.pdf", kind="dir")


def test_push_drive_from_environment_kind_file_requires_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(AgentStubValidationError, match="--kind file requires a file"):
        _ = push_drive_from_environment(local_path=str(skill_dir), drive_path="skills/example", kind="file")


def test_push_drive_from_environment_rejects_symlinked_directory_root(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source_dir = tmp_path / "skill"
    source_dir.mkdir()
    (source_dir / "SKILL.md").write_text("# Example\n", encoding="utf-8")
    symlink_path = tmp_path / "skill-link"
    symlink_path.symlink_to(source_dir, target_is_directory=True)
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(AgentStubValidationError, match="symlink"):
        _ = push_drive_from_environment(local_path=str(symlink_path), drive_path="skills/example", kind="skill")


def test_push_drive_from_environment_kind_dir_rejects_symlinked_files(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    root = tmp_path / "skill"
    root.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("outside", encoding="utf-8")
    (root / "linked.txt").symlink_to(outside)
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    with pytest.raises(AgentStubValidationError, match="symlink"):
        _ = push_drive_from_environment(local_path=str(root), drive_path="skills/example", kind="dir")


def test_push_drive_from_environment_kind_dir_keeps_user_files_that_skill_packaging_skips(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    root = tmp_path / "skill"
    root.mkdir()
    (root / ".DIFY-SKILL-FULL.zip").write_bytes(b"archive")
    node_modules_dir = root / "node_modules"
    node_modules_dir.mkdir()
    (node_modules_dir / "module.js").write_text("export default 1\n", encoding="utf-8")
    monkeypatch.setenv("DIFY_AGENT_STUB_API_BASE_URL", "https://agent.example.com/agent-stub")
    monkeypatch.setenv("DIFY_AGENT_STUB_AUTH_JWE", "test-jwe")

    uploaded_paths: list[str] = []

    def fake_upload(*, path: str) -> UploadedToolFileResource:
        uploaded_paths.append(Path(path).relative_to(root).as_posix())
        return UploadedToolFileResource(
            mapping=UploadedToolFileMapping(reference=f"dify-file-ref:{Path(path).name}"),
            tool_file_id=Path(path).name,
        )

    monkeypatch.setattr("dify_agent.agent_stub.cli._drive.upload_tool_file_resource_from_environment", fake_upload)
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._drive.request_agent_stub_drive_commit_sync",
        lambda **kwargs: AgentStubDriveCommitResponse(
            items=[
                AgentStubDriveItem(
                    key=item.key,
                    size=None,
                    hash=None,
                    mime_type=None,
                    file_kind=item.file_ref.kind,
                    file_id=item.file_ref.id,
                    value_owned_by_drive=item.value_owned_by_drive,
                )
                for item in kwargs["request"].items
            ]
        ),
    )

    response = push_drive_from_environment(local_path=str(root), drive_path="skills/example", kind="dir")

    assert set(uploaded_paths) == {".DIFY-SKILL-FULL.zip", "node_modules/module.js"}
    assert {item.key for item in response.items} == {
        "skills/example/.DIFY-SKILL-FULL.zip",
        "skills/example/node_modules/module.js",
    }

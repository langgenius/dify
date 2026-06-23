"""Unit tests for Skill standardization into the agent drive (ENG-594)."""

from __future__ import annotations

import io
import zipfile
from types import SimpleNamespace
from unittest.mock import MagicMock

from services.agent.skill_standardize_service import SkillStandardizeService, slugify_skill_name

_SKILL_MD = b"""---
name: PDF Toolkit
description: Work with PDFs.
---

# PDF Toolkit
"""


def _zip(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def test_slugify_skill_name():
    assert slugify_skill_name("PDF Toolkit") == "pdf-toolkit"
    assert slugify_skill_name("  Weird/Name!! ") == "weird-name"
    assert slugify_skill_name("") == "skill"


def test_standardize_creates_drive_owned_toolfiles_and_commits_archive_members():
    content = _zip({"SKILL.md": _SKILL_MD, "scripts/run.py": b"print('x')\n"})

    tool_files = MagicMock()
    tool_files.create_file_by_raw.side_effect = [
        SimpleNamespace(id="md-tool-file"),
        SimpleNamespace(id="zip-tool-file"),
        SimpleNamespace(id="script-tool-file"),
    ]
    drive = MagicMock()
    drive.commit.return_value = []

    service = SkillStandardizeService(tool_file_manager=tool_files, drive_service=drive)
    result = service.standardize(
        content=content,
        filename="skill.zip",
        tenant_id="tenant-1",
        user_id="user-1",
        agent_id="agent-1",
    )

    # ToolFiles: SKILL.md, full archive, and each inspectable package member.
    assert tool_files.create_file_by_raw.call_count == 3
    md_call, zip_call, script_call = tool_files.create_file_by_raw.call_args_list
    assert md_call.kwargs["mimetype"] == "text/markdown"
    assert md_call.kwargs["file_binary"] == _SKILL_MD
    assert zip_call.kwargs["mimetype"] == "application/zip"
    assert zip_call.kwargs["file_binary"] == content
    assert script_call.kwargs["mimetype"] in {"text/x-python", "text/plain", "application/octet-stream"}
    assert script_call.kwargs["file_binary"] == b"print('x')\n"
    assert script_call.kwargs["filename"] == "run.py"

    # Committed as drive-owned with the standardized keys.
    commit_kwargs = drive.commit.call_args.kwargs
    assert commit_kwargs["agent_id"] == "agent-1"
    items = commit_kwargs["items"]
    assert [item.key for item in items] == [
        "pdf-toolkit/SKILL.md",
        "pdf-toolkit/.DIFY-SKILL-FULL.zip",
        "pdf-toolkit/scripts/run.py",
    ]
    assert all(item.value_owned_by_drive for item in items)
    assert [item.file_ref.id for item in items] == ["md-tool-file", "zip-tool-file", "script-tool-file"]
    assert items[0].is_skill is True
    assert items[0].skill_metadata.name == "PDF Toolkit"
    assert items[0].skill_metadata.manifest_files == ["SKILL.md", "scripts/run.py"]
    assert items[1].is_skill is False
    assert items[2].is_skill is False

    # The returned skill ref carries stable drive paths + file ids.
    skill = result["skill"]
    assert skill["path"] == "pdf-toolkit"
    assert skill["name"] == "PDF Toolkit"
    assert skill["full_archive_file_id"] == "zip-tool-file"
    assert skill["skill_md_file_id"] == "md-tool-file"
    assert skill["skill_md_key"] == "pdf-toolkit/SKILL.md"
    # ENG-371: zip member listing persisted for infer-tools signals
    assert "SKILL.md" in skill["manifest_files"]
    assert "scripts/run.py" in skill["manifest_files"]

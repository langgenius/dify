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


def test_standardize_creates_drive_owned_toolfiles_and_commits_archive_manifest():
    content = _zip({"SKILL.md": _SKILL_MD, "scripts/run.py": b"print('x')\n"})

    tool_files = MagicMock()
    tool_files.create_file_by_raw.side_effect = [
        SimpleNamespace(id="md-tool-file"),
        SimpleNamespace(id="zip-tool-file"),
    ]
    drive = MagicMock()
    drive.commit.return_value = []
    drive.list_skills.return_value = [
        {
            "path": "pdf-toolkit",
            "skill_md_key": "pdf-toolkit/SKILL.md",
            "archive_key": "pdf-toolkit/.DIFY-SKILL-FULL.zip",
            "name": "PDF Toolkit",
            "description": "Work with PDFs.",
            "size": len(_SKILL_MD),
            "mime_type": "text/markdown",
            "hash": None,
            "created_at": None,
        },
    ]

    service = SkillStandardizeService(tool_file_manager=tool_files, drive_service=drive)
    result = service.standardize(
        content=content,
        filename="skill.zip",
        tenant_id="tenant-1",
        user_id="user-1",
        agent_id="agent-1",
    )
    assert service.last_committed_items == []

    # ToolFiles: SKILL.md and the full archive. Archive members stay lazy.
    assert tool_files.create_file_by_raw.call_count == 2
    md_call, zip_call = tool_files.create_file_by_raw.call_args_list
    assert md_call.kwargs["mimetype"] == "text/markdown"
    assert md_call.kwargs["file_binary"] == _SKILL_MD
    assert zip_call.kwargs["mimetype"] == "application/zip"
    assert zip_call.kwargs["file_binary"] == content

    # Committed as drive-owned with the standardized keys. Member paths are
    # carried in metadata for inspect/preview/runtime lazy resolution.
    commit_kwargs = drive.commit.call_args.kwargs
    assert commit_kwargs["agent_id"] == "agent-1"
    items = commit_kwargs["items"]
    assert [item.key for item in items] == [
        "pdf-toolkit/SKILL.md",
        "pdf-toolkit/.DIFY-SKILL-FULL.zip",
    ]
    assert all(item.value_owned_by_drive for item in items)
    assert [item.file_ref.id for item in items] == ["md-tool-file", "zip-tool-file"]
    assert items[0].is_skill is True
    assert items[0].skill_metadata is not None
    assert items[0].skill_metadata.name == "PDF Toolkit"
    assert items[0].skill_metadata.manifest_files == ["SKILL.md", "scripts/run.py"]
    assert items[1].is_skill is False

    # The returned upload response carries only the drive-derived fields the UI needs.
    skill = result["skill"]
    assert skill["path"] == "pdf-toolkit"
    assert skill["name"] == "PDF Toolkit"
    assert skill["archive_key"] == "pdf-toolkit/.DIFY-SKILL-FULL.zip"
    assert skill["skill_md_key"] == "pdf-toolkit/SKILL.md"
    assert result["manifest"]["files"] == ["SKILL.md", "scripts/run.py"]
    assert "_committed_items" not in result

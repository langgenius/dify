"""Unit tests for Skill standardization into the agent drive (ENG-594)."""

from __future__ import annotations

import io
import zipfile
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import Agent, AgentDriveFile, AgentDriveFileKind, AgentScope, AgentSource
from models.tools import ToolFile
from services.agent.skill_standardize_service import SkillStandardizeService, slugify_skill_name
from services.agent_drive_service import DriveSkillMetadata

_TENANT_ID = "11111111-1111-1111-1111-111111111111"
_AGENT_ID = "22222222-2222-2222-2222-222222222222"
_USER_ID = "33333333-3333-3333-3333-333333333333"

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


@pytest.mark.parametrize("sqlite_session", [(Agent, ToolFile, AgentDriveFile)], indirect=True)
def test_standardize_creates_drive_owned_toolfiles_and_commits_archive_manifest(sqlite_session: Session):
    content = _zip({"pdf-toolkit/SKILL.md": _SKILL_MD, "pdf-toolkit/scripts/run.py": b"print('x')\n"})

    agent = Agent(
        id=_AGENT_ID,
        tenant_id=_TENANT_ID,
        name="Drive Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
    )
    md_tool_file = ToolFile(
        user_id=_USER_ID,
        tenant_id=_TENANT_ID,
        conversation_id=None,
        file_key="tools/skill-md",
        mimetype="text/markdown",
        name="SKILL.md",
        size=len(_SKILL_MD),
    )
    archive_tool_file = ToolFile(
        user_id=_USER_ID,
        tenant_id=_TENANT_ID,
        conversation_id=None,
        file_key="tools/skill-archive",
        mimetype="application/zip",
        name=".DIFY-SKILL-FULL.zip",
        size=len(content),
    )
    sqlite_session.add_all([agent, md_tool_file, archive_tool_file])
    sqlite_session.commit()

    tool_files = MagicMock()
    tool_files.create_file_by_raw.side_effect = [md_tool_file, archive_tool_file]

    service = SkillStandardizeService(tool_file_manager=tool_files)
    result = service.standardize(
        content=content,
        filename="skill.zip",
        tenant_id=_TENANT_ID,
        user_id=_USER_ID,
        agent_id=_AGENT_ID,
        session=sqlite_session,
    )
    assert not sqlite_session.in_transaction()

    # ToolFiles: SKILL.md and the full archive. Archive members stay lazy.
    assert tool_files.create_file_by_raw.call_count == 2
    md_call, zip_call = tool_files.create_file_by_raw.call_args_list
    assert md_call.kwargs["mimetype"] == "text/markdown"
    assert md_call.kwargs["file_binary"] == _SKILL_MD
    assert zip_call.kwargs["mimetype"] == "application/zip"
    assert zip_call.kwargs["file_binary"] != content
    with zipfile.ZipFile(io.BytesIO(zip_call.kwargs["file_binary"])) as archive:
        assert sorted(info.filename for info in archive.infolist() if not info.is_dir()) == [
            "SKILL.md",
            "scripts/run.py",
        ]

    # Committed as drive-owned with the standardized keys. Member paths are
    # carried in metadata for inspect/preview/runtime lazy resolution.
    rows = {
        row.key: row
        for row in sqlite_session.scalars(
            select(AgentDriveFile).where(
                AgentDriveFile.tenant_id == _TENANT_ID,
                AgentDriveFile.agent_id == _AGENT_ID,
            )
        )
    }
    assert set(rows) == {"pdf-toolkit/SKILL.md", "pdf-toolkit/.DIFY-SKILL-FULL.zip"}
    skill_row = rows["pdf-toolkit/SKILL.md"]
    archive_row = rows["pdf-toolkit/.DIFY-SKILL-FULL.zip"]
    assert skill_row.file_kind == AgentDriveFileKind.TOOL_FILE
    assert skill_row.file_id == md_tool_file.id
    assert skill_row.value_owned_by_drive is True
    assert skill_row.is_skill is True
    assert skill_row.skill_metadata is not None
    skill_metadata = DriveSkillMetadata.model_validate_json(skill_row.skill_metadata)
    assert skill_metadata.name == "PDF Toolkit"
    assert skill_metadata.manifest_files == ["SKILL.md", "scripts/run.py"]
    assert archive_row.file_kind == AgentDriveFileKind.TOOL_FILE
    assert archive_row.file_id == archive_tool_file.id
    assert archive_row.value_owned_by_drive is True
    assert archive_row.is_skill is False
    assert len(service.last_committed_items) == 2

    # The returned upload response carries only the drive-derived fields the UI needs.
    skill = result["skill"]
    assert skill["path"] == "pdf-toolkit"
    assert skill["name"] == "PDF Toolkit"
    assert skill["archive_key"] == "pdf-toolkit/.DIFY-SKILL-FULL.zip"
    assert skill["skill_md_key"] == "pdf-toolkit/SKILL.md"
    assert result["manifest"]["entry_path"] == "SKILL.md"
    assert result["manifest"]["files"] == ["SKILL.md", "scripts/run.py"]
    assert "_committed_items" not in result

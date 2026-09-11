"""Tests for reference-aware Agent config ToolFile collection."""

from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from models.agent import AgentConfigDraft, AgentConfigDraftType, AgentConfigSnapshot
from models.agent_config_entities import AgentConfigFileRefConfig, AgentConfigSkillRefConfig, AgentSoulConfig
from models.skill import (
    Skill,
    SkillDraftFile,
    SkillFileKind,
    SkillFileStorage,
    SkillVersion,
    SkillVersionManifest,
)
from models.tools import ToolFile
from services.agent.config_tool_file_collection_service import AgentConfigToolFileCollectionService

TENANT_ID = "11111111-1111-1111-1111-111111111111"
AGENT_ID = "22222222-2222-2222-2222-222222222222"
CANDIDATE_ID = "33333333-3333-3333-3333-333333333333"
UNREFERENCED_ID = "44444444-4444-4444-4444-444444444444"
SKILL_ID = "55555555-5555-5555-5555-555555555555"

TABLES = (AgentConfigDraft, AgentConfigSnapshot, Skill, SkillDraftFile, SkillVersion, ToolFile)


def _tool_file(file_id: str) -> ToolFile:
    tool_file = ToolFile(
        user_id="66666666-6666-6666-6666-666666666666",
        tenant_id=TENANT_ID,
        conversation_id=None,
        file_key=f"tools/{TENANT_ID}/{file_id}.zip",
        mimetype="application/zip",
        name="skill.zip",
        size=10,
    )
    tool_file.id = file_id
    return tool_file


def _soul(*, reference_kind: str) -> AgentSoulConfig:
    if reference_kind == "snapshot":
        return AgentSoulConfig(config_skills=[AgentConfigSkillRefConfig(name="alpha", file_id=CANDIDATE_ID)])
    return AgentSoulConfig(
        config_files=[AgentConfigFileRefConfig(name="guide.txt", file_kind="tool_file", file_id=CANDIDATE_ID)]
    )


def _add_reference(session: Session, reference_kind: str) -> None:
    if reference_kind == "snapshot":
        session.add(
            AgentConfigSnapshot(
                tenant_id=TENANT_ID,
                agent_id=AGENT_ID,
                version=1,
                config_snapshot=_soul(reference_kind=reference_kind),
            )
        )
        return
    if reference_kind == "draft":
        session.add(
            AgentConfigDraft(
                tenant_id=TENANT_ID,
                agent_id=AGENT_ID,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                draft_owner_key="",
                config_snapshot=_soul(reference_kind=reference_kind),
            )
        )
        return

    skill = Skill(
        id=SKILL_ID,
        tenant_id=TENANT_ID,
        name="alpha",
        display_name="Alpha",
    )
    session.add(skill)
    if reference_kind == "skill_draft":
        session.add(
            SkillDraftFile(
                skill_id=SKILL_ID,
                path="assets/reference.pdf",
                kind=SkillFileKind.FILE,
                storage=SkillFileStorage.TOOL_FILE,
                tool_file_id=CANDIDATE_ID,
            )
        )
        return
    session.add(
        SkillVersion(
            skill_id=SKILL_ID,
            version_number=1,
            manifest=SkillVersionManifest(files=[]),
            archive_tool_file_id=CANDIDATE_ID,
            hash_code="hash",
            archive_size=10,
        )
    )


@pytest.mark.parametrize("reference_kind", ["snapshot", "draft", "skill_draft", "skill_version"])
@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_collection_keeps_every_supported_reference_and_deletes_only_orphans(
    sqlite_session: Session,
    reference_kind: str,
) -> None:
    sqlite_session.add_all([_tool_file(CANDIDATE_ID), _tool_file(UNREFERENCED_ID)])
    _add_reference(sqlite_session, reference_kind)
    sqlite_session.commit()

    with patch("services.agent.config_tool_file_collection_service.storage.delete") as storage_delete:
        deleted_ids = AgentConfigToolFileCollectionService.collect_unreferenced(
            tenant_id=TENANT_ID,
            candidate_ids=[CANDIDATE_ID, UNREFERENCED_ID],
            session=sqlite_session,
        )
        sqlite_session.commit()

    assert deleted_ids == [UNREFERENCED_ID]
    assert sqlite_session.get(ToolFile, CANDIDATE_ID) is not None
    assert sqlite_session.get(ToolFile, UNREFERENCED_ID) is None
    storage_delete.assert_called_once_with(f"tools/{TENANT_ID}/{UNREFERENCED_ID}.zip")


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
def test_collection_is_idempotent_when_storage_object_is_already_absent(sqlite_session: Session) -> None:
    sqlite_session.add(_tool_file(UNREFERENCED_ID))
    sqlite_session.commit()

    with (
        patch("services.agent.config_tool_file_collection_service.storage.delete", side_effect=OSError("missing")),
        patch("services.agent.config_tool_file_collection_service.storage.exists", return_value=False),
    ):
        deleted_ids = AgentConfigToolFileCollectionService.collect_unreferenced(
            tenant_id=TENANT_ID,
            candidate_ids=[UNREFERENCED_ID],
            session=sqlite_session,
        )
        sqlite_session.commit()

    assert deleted_ids == [UNREFERENCED_ID]
    assert sqlite_session.get(ToolFile, UNREFERENCED_ID) is None

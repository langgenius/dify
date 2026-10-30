"""Safety boundaries for maintenance-only storage orphan deletion."""

import json
from dataclasses import dataclass, field
from unittest.mock import patch

import pytest
from click.testing import CliRunner
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from commands import storage as storage_commands
from core.workflow.file_reference import build_file_reference
from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from models.enums import ExecutionOffLoadType
from models.model import UploadFile
from models.skill import AgentSkillBinding, Skill, SkillVersion, SkillVersionManifest
from models.tools import ToolFile
from models.workflow import Workflow, WorkflowNodeExecutionOffload, WorkflowType
from tests.unit_tests.model_factories import make_upload_file


@dataclass
class _Storage:
    scan_results: list[list[str]]
    deleted: list[str] = field(default_factory=list)

    def scan(self, *, path: str, files: bool, directories: bool) -> list[str]:
        del path, files, directories
        return self.scan_results.pop(0)

    def delete(self, key: str) -> None:
        self.deleted.append(key)


def test_storage_orphan_cleanup_requires_stopped_writers() -> None:
    result = CliRunner().invoke(storage_commands.remove_orphaned_files_on_storage, ["--force"])

    assert result.exit_code == 2
    assert "all file writers are stopped and drained" in result.output


def test_storage_orphan_cleanup_rechecks_current_database_owners() -> None:
    fake_storage = _Storage([[], [], ["upload_files/new", "upload_files/orphan"]])

    with (
        patch.object(storage_commands, "storage", fake_storage),
        patch.object(
            storage_commands,
            "_registered_storage_keys",
            side_effect=[set(), {"upload_files/new"}],
        ),
    ):
        result = CliRunner().invoke(
            storage_commands.remove_orphaned_files_on_storage,
            ["--force", "--writers-stopped"],
        )

    assert result.exit_code == 0
    assert "Keeping 1 files that gained a database owner" in result.output
    assert fake_storage.deleted == ["upload_files/orphan"]


def test_clear_orphaned_file_records_uses_registered_upload_owners(
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    direct_upload = make_upload_file(file_id="direct-upload", tenant_id="tenant-1", key="uploads/direct.json")
    canonical_upload = make_upload_file(
        file_id="canonical-upload",
        tenant_id="tenant-1",
        key="uploads/canonical.json",
    )
    orphaned_upload = make_upload_file(file_id="orphaned-upload", tenant_id="tenant-1", key="uploads/orphan.txt")
    tool_file = ToolFile(
        user_id="account-1",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tools/agent-skill.zip",
        mimetype="application/zip",
        name="agent-skill.zip",
        size=7,
    )
    tool_file.id = "11111111-1111-4111-8111-111111111111"
    skill = Skill(
        tenant_id="tenant-1",
        name="research",
        display_name="Research",
        description="Research skill",
        created_by="account-1",
        updated_by="account-1",
    )
    skill.id = "22222222-2222-4222-8222-222222222222"
    skill_version = SkillVersion(
        skill_id=skill.id,
        version_number=1,
        version_name="1.0",
        publish_note="",
        manifest=SkillVersionManifest(files=[]),
        archive_tool_file_id=tool_file.id,
        hash_code="skill-hash",
        archive_size=tool_file.size,
        published_by="account-1",
    )
    skill_version.id = "33333333-3333-4333-8333-333333333333"
    skill.latest_published_version_id = skill_version.id
    agent = Agent(
        tenant_id="tenant-1",
        name="Research Agent",
        description="",
        role="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
        status=AgentStatus.ACTIVE,
        created_by="account-1",
        updated_by="account-1",
    )
    agent.id = "44444444-4444-4444-8444-444444444444"
    agent_skill = AgentSkillBinding(
        tenant_id="tenant-1",
        agent_id=agent.id,
        skill_id=skill.id,
        priority=0,
        created_by="account-1",
    )
    workflow = Workflow.new(
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW.value,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"file": {"reference": build_file_reference(record_id=canonical_upload.id)}}),
        features="{}",
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    sqlite_session.add_all(
        [
            direct_upload,
            canonical_upload,
            orphaned_upload,
            tool_file,
            skill,
            skill_version,
            agent,
            agent_skill,
            workflow,
            WorkflowNodeExecutionOffload(
                tenant_id="tenant-1",
                app_id="app-1",
                node_execution_id=None,
                type_=ExecutionOffLoadType.OUTPUTS,
                file_id=direct_upload.id,
            ),
        ]
    )
    sqlite_session.commit()
    direct_upload_id = direct_upload.id
    canonical_upload_id = canonical_upload.id
    orphaned_upload_id = orphaned_upload.id
    tool_file_id = tool_file.id
    monkeypatch.setattr(type(storage_commands.db), "engine", property(lambda _db: sqlite_engine))

    result = CliRunner().invoke(storage_commands.clear_orphaned_file_records, ["--force"])

    assert result.exit_code == 0, result.output
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, direct_upload_id) is not None
    assert sqlite_session.get(UploadFile, canonical_upload_id) is not None
    assert sqlite_session.get(UploadFile, orphaned_upload_id) is None
    assert sqlite_session.get(ToolFile, tool_file_id) is not None


def test_storage_orphan_cleanup_keeps_registered_tool_file(
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tool_file = ToolFile(
        user_id="account-1",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tools/active-agent-skill.zip",
        mimetype="application/zip",
        name="active-agent-skill.zip",
        size=7,
    )
    sqlite_session.add(tool_file)
    sqlite_session.commit()
    fake_storage = _Storage([[], [tool_file.file_key, "tools/orphan.zip"], []])
    monkeypatch.setattr(type(storage_commands.db), "engine", property(lambda _db: sqlite_engine))
    monkeypatch.setattr(storage_commands, "storage", fake_storage)

    result = CliRunner().invoke(
        storage_commands.remove_orphaned_files_on_storage,
        ["--force", "--writers-stopped"],
    )

    assert result.exit_code == 0, result.output
    assert fake_storage.deleted == ["tools/orphan.zip"]

"""Focused tests for workspace-level Skill Management."""

from __future__ import annotations

import io
import zipfile
from collections.abc import Generator
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select

from core.db.session_factory import session_factory
from models.account import Account
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentConfigSkillRefConfig, AgentSoulConfig
from models.model import App, AppMode, IconType, Tag, TagBinding
from models.skill import AgentSkillBinding, Skill, SkillDraftFile, SkillVersion
from models.tools import ToolFile
from services.skill_management_service import (
    SkillAssistAttachmentPayload,
    SkillCreatePayload,
    SkillDraftFileOperationPayload,
    SkillDraftTreePayload,
    SkillImportPayload,
    SkillManagementService,
    SkillManagementServiceError,
    SkillMetadataPayload,
    SkillPublishPayload,
    SkillRestorePayload,
    SkillVersionUpdatePayload,
    normalize_skill_file_path,
    validate_skill_name,
)

TENANT = "11111111-1111-1111-1111-111111111111"
AGENT = "22222222-2222-2222-2222-222222222222"
USER = "33333333-3333-3333-3333-333333333333"


class _FakeToolFileManager:
    def create_file_by_raw(self, **kwargs):
        tool_file = ToolFile(
            user_id=kwargs["user_id"],
            tenant_id=kwargs["tenant_id"],
            conversation_id=kwargs["conversation_id"],
            file_key=f"tools/{uuid4().hex}",
            mimetype=kwargs["mimetype"],
            original_url=None,
            name=kwargs.get("filename") or "file.bin",
            size=len(kwargs["file_binary"]),
        )
        tool_file.id = str(uuid4())
        with session_factory.create_session() as session:
            session.add(tool_file)
            session.commit()
        return SimpleNamespace(
            id=tool_file.id,
            size=len(kwargs["file_binary"]),
            mimetype=kwargs["mimetype"],
        )


@pytest.fixture(autouse=True)
def _tables() -> Generator[None, None, None]:
    engine = session_factory.get_session_maker().kw["bind"]
    models = (
        Account,
        App,
        Agent,
        AgentConfigSnapshot,
        AgentConfigDraft,
        AgentConfigRevision,
        ToolFile,
        Tag,
        TagBinding,
        Skill,
        SkillDraftFile,
        SkillVersion,
        AgentSkillBinding,
        WorkflowAgentNodeBinding,
    )
    for model in models:
        model.__table__.create(bind=engine, checkfirst=True)
    _seed_agent()
    yield
    with session_factory.create_session() as session:
        session.execute(delete(AgentSkillBinding))
        session.execute(delete(SkillVersion))
        session.execute(delete(SkillDraftFile))
        session.execute(delete(Skill))
        session.execute(delete(TagBinding))
        session.execute(delete(Tag))
        session.execute(delete(ToolFile))
        session.execute(delete(WorkflowAgentNodeBinding))
        session.execute(delete(AgentConfigRevision))
        session.execute(delete(AgentConfigDraft))
        session.execute(delete(AgentConfigSnapshot))
        session.execute(delete(Agent))
        session.execute(delete(App))
        session.execute(delete(Account))
        session.commit()


def _seed_agent() -> None:
    with session_factory.create_session() as session:
        account = Account(name="Li Wei", email="li.wei@example.com")
        account.id = USER
        session.add(account)
        session.add(
            App(
                id="66666666-6666-6666-6666-666666666666",
                tenant_id=TENANT,
                name="workflow1",
                mode=AppMode.WORKFLOW,
                icon="🪣",
                icon_background="#FFF4ED",
                icon_type=IconType.EMOJI,
                enable_site=False,
                enable_api=False,
                created_by=USER,
                updated_by=USER,
            )
        )
        session.add(
            Agent(
                id=AGENT,
                tenant_id=TENANT,
                name="Skill Agent",
                icon="🤖",
                icon_background="#EEF4FF",
                icon_type="emoji",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
            )
        )
        session.commit()


def _skill_md(name: str = "finance-sop", description: str = "Finance SOP", body: str = "# Finance") -> str:
    return f"---\nname: {name}\ndescription: {description}\n---\n{body}"


def test_validate_skill_name_rejects_underscores_and_double_hyphens() -> None:
    assert validate_skill_name("finance-sop") == "finance-sop"
    for bad in ["finance_sop", "finance--sop", "-finance", "finance-"]:
        with pytest.raises(ValueError):
            validate_skill_name(bad)


def test_normalize_skill_file_path_rejects_escape_paths() -> None:
    assert normalize_skill_file_path("references//guide.md") == "references/guide.md"
    for bad in ["", "../x", "/etc/passwd", "a/\x00b"]:
        with pytest.raises(ValueError):
            normalize_skill_file_path(bad)


def test_create_skill_without_name_initializes_untitled_draft() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())

    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())

    assert created["name"].startswith("untitled-skill-")
    assert created["display_name"] == "Untitled skill"
    assert created["description"] == "Describe what this Skill does and when an Agent should use it."
    assert created["created_by_name"] == "Li Wei"
    assert created["updated_by_name"] == "Li Wei"
    assert created["latest_published_version_id"] is None
    assert len(created["files"]) == 1
    skill_md = created["files"][0]
    assert skill_md["path"] == "SKILL.md"
    assert skill_md["kind"] == "file"
    assert skill_md["storage"] == "text"
    assert f"name: {created['name']}" in skill_md["content"]
    assert "description: Describe what this Skill does and when an Agent should use it." in skill_md["content"]
    assert "# Untitled skill" in skill_md["content"]
    assert service.list_versions(tenant_id=TENANT, skill_id=created["id"]) == {"data": []}


def test_list_tags_returns_distinct_tags_with_counts() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop", tags=["Finance", "audit"]),
    )
    service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="legal-sop", tags=["finance", "legal"]),
    )
    service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="empty-tags"),
    )

    result = service.list_tags(tenant_id=TENANT)

    assert result == {
        "data": [
            {"tag": "Finance", "count": 2},
            {"tag": "audit", "count": 1},
            {"tag": "legal", "count": 1},
        ]
    }

    filtered = service.list_skills(tenant_id=TENANT, tags=["finance"])
    assert [item["name"] for item in filtered["data"]] == ["legal-sop", "finance-sop"]


def test_list_skills_keyword_matches_display_name() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(
            name="employee-onboarding",
            display_name="Employee onboarding",
            description="Guide new employees.",
        ),
    )

    result = service.list_skills(tenant_id=TENANT, keyword="onboarding")

    assert [item["name"] for item in result["data"]] == ["employee-onboarding"]


def test_list_skills_returns_pagination_metadata() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    for name in ["alpha-skill", "beta-skill", "gamma-skill"]:
        service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name=name))

    first_page = service.list_skills(tenant_id=TENANT, page=1, limit=2)
    second_page = service.list_skills(tenant_id=TENANT, page=2, limit=2)

    assert first_page["page"] == 1
    assert first_page["limit"] == 2
    assert first_page["total"] == 3
    assert first_page["has_more"] is True
    assert len(first_page["data"]) == 2
    assert second_page["page"] == 2
    assert second_page["total"] == 3
    assert second_page["has_more"] is False
    assert len(second_page["data"]) == 1


def test_create_assistant_stream_uses_default_model_and_keeps_draft_read_only() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop", description="Handle finance requests."),
    )
    model = SimpleNamespace(
        invoke_llm=lambda **_kwargs: iter(
            [SimpleNamespace(delta=SimpleNamespace(message=SimpleNamespace(get_text_content=lambda: "# Draft")))]
        )
    )
    manager = SimpleNamespace(get_default_model_instance=lambda **_kwargs: model)

    with patch("services.skill_management_service.ModelManager.for_tenant", return_value=manager):
        response = list(
            service.create_assistant_stream(
                tenant_id=TENANT,
                skill_id=created["id"],
                message="Create an approval checklist.",
            )
        )

    assert response == ["# Draft"]
    draft = service.get_skill(tenant_id=TENANT, skill_id=created["id"])
    assert draft["files"][0]["content"] == created["files"][0]["content"]


def test_update_display_name_auto_syncs_name_for_unpublished_placeholder() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())

    updated = service.update_metadata(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillMetadataPayload(display_name="Finance Audit"),
    )

    assert updated["display_name"] == "Finance Audit"
    assert updated["name"] == "finance-audit"
    assert updated["name_manually_edited"] is False
    skill_md = next(item for item in service.get_skill(tenant_id=TENANT, skill_id=created["id"])["files"])
    assert "name: finance-audit" in skill_md["content"]
    assert "display-name: Finance Audit" in skill_md["content"]


def test_frontmatter_name_change_marks_manual_takeover_and_stops_display_name_sync() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())

    manually_named = service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(
            operation="upsert_text",
            path="SKILL.md",
            content=_skill_md(name="manual-name", body="# Body"),
        ),
    )
    assert manually_named["name"] == "manual-name"
    assert manually_named["name_manually_edited"] is True

    updated = service.update_metadata(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillMetadataPayload(display_name="Finance Audit"),
    )

    assert updated["name"] == "manual-name"
    assert updated["display_name"] == "Finance Audit"
    skill_md = next(item for item in service.get_skill(tenant_id=TENANT, skill_id=created["id"])["files"])
    assert "name: manual-name" in skill_md["content"]
    assert "display-name: Finance Audit" in skill_md["content"]


def test_delete_unreferenced_placeholder_skill_deletes_initial_draft() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())

    deleted = service.delete_skill(tenant_id=TENANT, skill_id=created["id"])

    assert deleted == {"id": created["id"], "deleted": True}
    assert service.list_skills(tenant_id=TENANT)["data"] == []


def test_delete_unreferenced_modified_placeholder_skill() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())
    service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(
            operation="upsert_text",
            path="references/policy.md",
            content="Policy",
        ),
    )

    deleted = service.delete_skill(tenant_id=TENANT, skill_id=created["id"])

    assert deleted == {"id": created["id"], "deleted": True}
    assert service.list_skills(tenant_id=TENANT)["data"] == []


def test_create_update_publish_and_bind_skill() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop", display_name="Finance SOP", description="Handle finance."),
    )

    draft = service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[
                {
                    "path": "SKILL.md",
                    "kind": "file",
                    "storage": "text",
                    "content": _skill_md(description="Handle finance.", body="# Finance\nFollow the policy."),
                },
                {"path": "references", "kind": "directory"},
                {
                    "path": "references/policy.md",
                    "kind": "file",
                    "storage": "text",
                    "content": "Policy text.",
                },
            ]
        ),
    )
    file = next(item for item in draft["files"] if item["path"] == "SKILL.md")
    assert file["path"] == "SKILL.md"
    assert "name: finance-sop" in file["content"]
    assert [item["path"] for item in draft["files"]] == ["SKILL.md", "references", "references/policy.md"]

    version = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillPublishPayload(publish_note="initial"),
    )
    assert version["version_number"] == 1

    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])
    bindings = service.list_agent_bindings(tenant_id=TENANT, agent_id=AGENT)
    assert bindings["agent_id"] == AGENT
    assert bindings["skill_ids"] == [created["id"]]
    assert bindings["data"][0] == {
        "id": created["id"],
        "priority": 0,
        "name": "finance-sop",
        "display_name": "Finance SOP",
        "icon": "📄",
        "description": "Handle finance.",
        "tags": [],
        "status": "published",
        "file_count": 2,
        "latest_published_version_id": version["id"],
        "latest_published_at": version["created_at"],
        "updated_at": bindings["data"][0]["updated_at"],
    }

    skills = service.list_skills(tenant_id=TENANT)["data"]
    assert skills[0]["reference_count"] == 1


def test_get_skill_includes_agent_binding_reference_count() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])

    detail = service.get_skill(tenant_id=TENANT, skill_id=created["id"])
    assert detail["reference_count"] == 1


def test_list_agent_bindings_returns_draft_skill_card_data() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])

    bindings = service.list_agent_bindings(tenant_id=TENANT, agent_id=AGENT)
    assert bindings["skill_ids"] == [created["id"]]
    assert bindings["data"][0]["id"] == created["id"]
    assert bindings["data"][0]["priority"] == 0
    assert bindings["data"][0]["name"] == "finance-sop"
    assert bindings["data"][0]["display_name"] == "finance-sop"
    assert bindings["data"][0]["status"] == "draft"
    assert bindings["data"][0]["file_count"] == 1
    assert bindings["data"][0]["latest_published_version_id"] is None
    assert bindings["data"][0]["latest_published_at"] is None


def test_list_skill_references_resolves_agent_apps_and_inline_workflow_nodes() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop"),
    )
    inline_agent_id = "77777777-7777-7777-7777-777777777777"
    with session_factory.create_session() as session:
        session.add(
            Agent(
                id=inline_agent_id,
                tenant_id=TENANT,
                name="Agent 内嵌节点 C",
                icon="✨",
                icon_background="#EEF4FF",
                icon_type="emoji",
                scope=AgentScope.WORKFLOW_ONLY,
                source=AgentSource.WORKFLOW,
                app_id="66666666-6666-6666-6666-666666666666",
                workflow_id="88888888-8888-8888-8888-888888888888",
                workflow_node_id="node-c",
            )
        )
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=TENANT,
                app_id="66666666-6666-6666-6666-666666666666",
                workflow_id="88888888-8888-8888-8888-888888888888",
                workflow_version="draft",
                node_id="node-c",
                binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                agent_id=inline_agent_id,
                current_snapshot_id=None,
                node_job_config={},
            )
        )
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=TENANT,
                app_id="66666666-6666-6666-6666-666666666666",
                workflow_id="88888888-8888-8888-8888-888888888888",
                workflow_version="draft",
                node_id="node-c-copy",
                binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                agent_id=inline_agent_id,
                current_snapshot_id=None,
                node_job_config={},
            )
        )
        session.commit()

    service.replace_agent_bindings(
        tenant_id=TENANT,
        user_id=USER,
        agent_id=AGENT,
        skill_ids=[created["id"]],
    )
    service.replace_agent_bindings(
        tenant_id=TENANT,
        user_id=USER,
        agent_id=inline_agent_id,
        skill_ids=[created["id"]],
    )

    references = service.list_skill_references(tenant_id=TENANT, skill_id=created["id"])["data"]

    assert len(references) == 2
    assert references == [
        {
            "type": "agent",
            "agent_id": AGENT,
            "agent_icon": "🤖",
            "agent_icon_background": "#EEF4FF",
            "agent_icon_type": "emoji",
            "name": "Skill Agent",
            "display_name": "Skill Agent",
        },
        {
            "type": "workflow_agent_node",
            "agent_id": inline_agent_id,
            "agent_icon": "✨",
            "agent_icon_background": "#EEF4FF",
            "agent_icon_type": "emoji",
            "app_id": "66666666-6666-6666-6666-666666666666",
            "name": "Agent 内嵌节点 C",
            "display_name": "Agent 内嵌节点 C (workflow1)",
            "workflow_id": "88888888-8888-8888-8888-888888888888",
            "workflow_name": "workflow1",
            "workflow_icon": "🪣",
            "workflow_icon_background": "#FFF4ED",
            "workflow_icon_type": "emoji",
            "workflow_version": "draft",
            "node_id": "node-c",
            "node_name": "Agent 内嵌节点 C",
        },
    ]


def test_list_skill_references_includes_roster_agent_nodes_after_workflow_app() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop"),
    )
    with session_factory.create_session() as session:
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=TENANT,
                app_id="66666666-6666-6666-6666-666666666666",
                workflow_id="88888888-8888-8888-8888-888888888888",
                workflow_version="draft",
                node_id="node-roster-agent",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                agent_id=AGENT,
                current_snapshot_id=None,
                node_job_config={},
            )
        )
        session.commit()

    service.replace_agent_bindings(
        tenant_id=TENANT,
        user_id=USER,
        agent_id=AGENT,
        skill_ids=[created["id"]],
    )

    references = service.list_skill_references(tenant_id=TENANT, skill_id=created["id"])["data"]

    assert references == [
        {
            "type": "agent",
            "agent_id": AGENT,
            "agent_icon": "🤖",
            "agent_icon_background": "#EEF4FF",
            "agent_icon_type": "emoji",
            "name": "Skill Agent",
            "display_name": "Skill Agent",
        },
        {
            "type": "workflow_agent_node",
            "agent_id": AGENT,
            "agent_icon": "🤖",
            "agent_icon_background": "#EEF4FF",
            "agent_icon_type": "emoji",
            "app_id": "66666666-6666-6666-6666-666666666666",
            "name": "Skill Agent",
            "display_name": "Skill Agent (workflow1)",
            "workflow_id": "88888888-8888-8888-8888-888888888888",
            "workflow_name": "workflow1",
            "workflow_icon": "🪣",
            "workflow_icon_background": "#FFF4ED",
            "workflow_icon_type": "emoji",
            "workflow_version": "draft",
            "node_id": "node-roster-agent",
            "node_name": "Skill Agent",
        },
    ]


def test_publish_updates_referenced_agent_config_skill_archives() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop"),
    )
    inline_agent_id = "77777777-7777-7777-7777-777777777777"
    with session_factory.create_session() as session:
        agent_snapshot = AgentConfigSnapshot(
            tenant_id=TENANT,
            agent_id=AGENT,
            version=1,
            config_snapshot=AgentSoulConfig(
                config_skills=[
                    AgentConfigSkillRefConfig(
                        name="finance-sop",
                        description="old",
                        file_id="old-skill-file",
                        size=1,
                        hash="old-hash",
                    )
                ]
            ),
            created_by=USER,
        )
        session.add(agent_snapshot)
        session.flush()
        agent = session.get(Agent, AGENT)
        assert agent is not None
        agent.active_config_snapshot_id = agent_snapshot.id
        session.add(
            AgentConfigDraft(
                tenant_id=TENANT,
                agent_id=AGENT,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                draft_owner_key="",
                base_snapshot_id=agent_snapshot.id,
                config_snapshot=AgentSoulConfig(
                    config_skills=[
                        AgentConfigSkillRefConfig(
                            name="finance-sop",
                            description="old draft",
                            file_id="old-draft-skill-file",
                            size=1,
                            hash="old-draft-hash",
                        )
                    ]
                ),
                created_by=USER,
                updated_by=USER,
            )
        )
        session.add(
            Agent(
                id=inline_agent_id,
                tenant_id=TENANT,
                name="Agent 内嵌节点 C",
                scope=AgentScope.WORKFLOW_ONLY,
                source=AgentSource.WORKFLOW,
                app_id="66666666-6666-6666-6666-666666666666",
                workflow_id="88888888-8888-8888-8888-888888888888",
                workflow_node_id="node-c",
            )
        )
        inline_snapshot = AgentConfigSnapshot(
            tenant_id=TENANT,
            agent_id=inline_agent_id,
            version=1,
            config_snapshot=AgentSoulConfig(
                config_skills=[
                    AgentConfigSkillRefConfig(
                        name="finance-sop",
                        description="old inline",
                        file_id="old-inline-skill-file",
                        size=1,
                        hash="old-inline-hash",
                    )
                ]
            ),
            created_by=USER,
        )
        session.add(inline_snapshot)
        session.flush()
        inline_agent = session.get(Agent, inline_agent_id)
        assert inline_agent is not None
        inline_agent.active_config_snapshot_id = inline_snapshot.id
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=TENANT,
                app_id="66666666-6666-6666-6666-666666666666",
                workflow_id="88888888-8888-8888-8888-888888888888",
                workflow_version="draft",
                node_id="node-c",
                binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                agent_id=inline_agent_id,
                current_snapshot_id=inline_snapshot.id,
                node_job_config={},
            )
        )
        session.commit()

    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])
    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=inline_agent_id, skill_ids=[created["id"]])
    service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())

    with session_factory.create_session() as session:
        agent = session.get(Agent, AGENT)
        inline_agent = session.get(Agent, inline_agent_id)
        workflow_binding = session.scalar(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.agent_id == inline_agent_id)
        )
        latest_skill_version = session.scalar(select(SkillVersion).where(SkillVersion.skill_id == created["id"]))
        agent_snapshot = session.get(AgentConfigSnapshot, agent.active_config_snapshot_id) if agent else None
        inline_snapshot = (
            session.get(AgentConfigSnapshot, inline_agent.active_config_snapshot_id) if inline_agent else None
        )
        agent_draft = session.scalar(
            select(AgentConfigDraft).where(
                AgentConfigDraft.agent_id == AGENT,
                AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
            )
        )

    assert agent is not None
    assert inline_agent is not None
    assert workflow_binding is not None
    assert latest_skill_version is not None
    assert agent_snapshot is not None
    assert inline_snapshot is not None
    assert agent_draft is not None
    assert agent.updated_by == USER
    assert inline_agent.updated_by == USER
    assert workflow_binding.updated_by == USER
    assert workflow_binding.current_snapshot_id == inline_agent.active_config_snapshot_id
    assert agent_snapshot.version == 2
    assert inline_snapshot.version == 2
    agent_skill_ref = AgentSoulConfig.model_validate(agent_snapshot.config_snapshot_dict).config_skills[0]
    inline_skill_ref = AgentSoulConfig.model_validate(inline_snapshot.config_snapshot_dict).config_skills[0]
    draft_skill_ref = AgentSoulConfig.model_validate(agent_draft.config_snapshot_dict).config_skills[0]
    assert agent_skill_ref.file_id == latest_skill_version.archive_tool_file_id
    assert inline_skill_ref.file_id == latest_skill_version.archive_tool_file_id
    assert draft_skill_ref.file_id == latest_skill_version.archive_tool_file_id
    assert agent_skill_ref.hash == latest_skill_version.hash_code


def test_replace_draft_tree_is_full_snapshot_and_autofills_parent_directories() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop"),
    )

    first = service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[
                {"path": "SKILL.md", "content": _skill_md(body="# Finance")},
                {"path": "references/policy.md", "content": "Policy text."},
            ]
        ),
    )
    assert [item["path"] for item in first["files"]] == ["SKILL.md", "references", "references/policy.md"]

    second = service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(files=[{"path": "SKILL.md", "content": _skill_md(body="# Finance only")}]),
    )
    assert [item["path"] for item in second["files"]] == ["SKILL.md"]


def test_publish_requires_skill_md() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop"),
    )
    with session_factory.create_session() as session:
        session.execute(delete(SkillDraftFile))
        session.commit()

    with pytest.raises(SkillManagementServiceError, match="skill must contain SKILL.md"):
        service.publish_skill(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillPublishPayload(),
        )


def test_publish_archive_contains_synced_skill_md() -> None:
    captured: dict[str, bytes] = {}

    class CapturingToolFileManager(_FakeToolFileManager):
        def create_file_by_raw(self, **kwargs):
            captured["archive"] = kwargs["file_binary"]
            return super().create_file_by_raw(**kwargs)

    service = SkillManagementService(tool_file_manager=CapturingToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop", description="Handle finance."),
    )
    service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())

    with zipfile.ZipFile(io.BytesIO(captured["archive"])) as archive:
        skill_md = archive.read("SKILL.md").decode("utf-8")

    assert "name: finance-sop" in skill_md
    assert "description: Handle finance." in skill_md
    assert "metadata:" in skill_md
    assert "display-name: finance-sop" in skill_md


def test_list_versions_includes_publisher_name_and_version_detail_files() -> None:
    captured: dict[str, bytes] = {}

    class CapturingToolFileManager(_FakeToolFileManager):
        def create_file_by_raw(self, **kwargs):
            captured["archive"] = kwargs["file_binary"]
            return super().create_file_by_raw(**kwargs)

    service = SkillManagementService(tool_file_manager=CapturingToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop", description="Handle finance."),
    )
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(files=[{"path": "SKILL.md", "content": _skill_md(body="# Published body")}]),
    )
    version = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillPublishPayload(publish_note="Updated approval threshold"),
    )

    versions = service.list_versions(tenant_id=TENANT, skill_id=created["id"])
    with patch("services.skill_management_service.storage.load_once", return_value=captured["archive"]):
        detail = service.get_version(tenant_id=TENANT, skill_id=created["id"], version_id=version["id"])

    assert versions["data"][0]["published_by_name"] == "Li Wei"
    assert versions["data"][0]["version_name"] == "Updated approval threshold"
    assert versions["data"][0]["is_latest"] is True
    assert detail["published_by_name"] == "Li Wei"
    assert detail["publish_note"] == "Updated approval threshold"
    skill_md = next(file for file in detail["files"] if file["path"] == "SKILL.md")
    assert skill_md["storage"] == "text"
    assert "# Published body" in skill_md["content"]


def test_update_version_renames_version() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    version = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillPublishPayload(),
    )

    updated = service.update_version(
        tenant_id=TENANT,
        skill_id=created["id"],
        version_id=version["id"],
        payload=SkillVersionUpdatePayload(version_name="Approval threshold"),
    )

    assert updated["version_name"] == "Approval threshold"
    assert updated["is_latest"] is True


def test_delete_latest_version_promotes_next_latest_then_clears_when_empty() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    first = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillPublishPayload(),
    )
    second = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillPublishPayload(),
    )

    deleted_latest = service.delete_version(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        version_id=second["id"],
    )
    versions_after_latest_delete = service.list_versions(tenant_id=TENANT, skill_id=created["id"])

    assert deleted_latest == {"id": second["id"], "deleted": True, "latest_published_version_id": first["id"]}
    assert versions_after_latest_delete["data"] == [
        {
            **versions_after_latest_delete["data"][0],
            "id": first["id"],
            "is_latest": True,
        }
    ]

    deleted_last = service.delete_version(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        version_id=first["id"],
    )

    assert deleted_last == {"id": first["id"], "deleted": True, "latest_published_version_id": None}
    assert service.get_skill(tenant_id=TENANT, skill_id=created["id"])["latest_published_version_id"] is None


def test_replace_draft_tree_syncs_frontmatter_name_to_db() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    updated = service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[
                {
                    "path": "SKILL.md",
                    "content": _skill_md(name="finance-rules", description="Rules from frontmatter", body="# Body"),
                }
            ]
        ),
    )

    assert updated["name"] == "finance-rules"
    assert updated["description"] == "Rules from frontmatter"
    skill_md = next(item for item in updated["files"] if item["path"] == "SKILL.md")
    assert "name: finance-rules" in skill_md["content"]
    assert "description: Rules from frontmatter" in skill_md["content"]


def test_apply_draft_file_operation_syncs_frontmatter_display_name_to_db() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())

    updated = service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(
            operation="upsert_text",
            path="SKILL.md",
            content=(
                "---\n"
                "name: refund-approval\n"
                "description: Handle refund approvals.\n"
                "metadata:\n"
                "  display-name: Refund Approval\n"
                "---\n"
                "# Refund Approval"
            ),
        ),
    )

    assert updated["name"] == "refund-approval"
    assert updated["display_name"] == "Refund Approval"
    assert updated["description"] == "Handle refund approvals."


def test_publish_syncs_frontmatter_display_name_from_existing_draft() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())
    with session_factory.create_session() as session:
        skill_md = session.scalar(
            select(SkillDraftFile).where(
                SkillDraftFile.skill_id == created["id"],
                SkillDraftFile.path == "SKILL.md",
            )
        )
        assert skill_md is not None
        skill_md.content_text = (
            "---\n"
            "name: refund-approval\n"
            "description: Handle refund approvals.\n"
            "metadata:\n"
            "  display-name: Refund Approval\n"
            "---\n"
            "# Refund Approval"
        )
        session.commit()

    service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())

    detail = service.get_skill(tenant_id=TENANT, skill_id=created["id"])
    assert detail["name"] == "refund-approval"
    assert detail["display_name"] == "Refund Approval"
    assert detail["description"] == "Handle refund approvals."


def test_replace_draft_tree_rejects_missing_frontmatter_name() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.replace_draft_tree(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillDraftTreePayload(files=[{"path": "SKILL.md", "content": "# Missing frontmatter"}]),
        )

    assert exc_info.value.code == "missing_skill_name"
    assert exc_info.value.details == {"path": "SKILL.md", "field": "name", "line": 2}


def test_replace_draft_tree_rejects_missing_frontmatter_description() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.replace_draft_tree(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillDraftTreePayload(
                files=[{"path": "SKILL.md", "content": "---\nname: finance-sop\n---\n# Missing description"}]
            ),
        )

    assert exc_info.value.code == "missing_skill_description"
    assert exc_info.value.details == {"path": "SKILL.md", "field": "description", "line": 2}


def test_replace_draft_tree_rejects_blank_frontmatter_description() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.replace_draft_tree(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillDraftTreePayload(
                files=[{"path": "SKILL.md", "content": "---\nname: finance-sop\ndescription: ''\n---\n# Blank"}]
            ),
        )

    assert exc_info.value.code == "missing_skill_description"
    assert exc_info.value.details == {"path": "SKILL.md", "field": "description", "line": 3}


def test_replace_draft_tree_reports_actual_frontmatter_name_line() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.replace_draft_tree(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillDraftTreePayload(
                files=[
                    {
                        "path": "SKILL.md",
                        "content": "---\ndescription: x\nmetadata:\nname: bad_name\n---\n# Body",
                    }
                ]
            ),
        )

    assert exc_info.value.code == "invalid_skill_name"
    assert exc_info.value.details == {"path": "SKILL.md", "field": "name", "line": 4}


def test_apply_draft_file_operation_upserts_renames_and_deletes_files() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    upserted = service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(
            operation="upsert_text",
            path="references/policy.md",
            content="Policy text.",
        ),
    )
    assert [item["path"] for item in upserted["files"]] == ["SKILL.md", "references", "references/policy.md"]

    renamed = service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(
            operation="rename",
            path="references/policy.md",
            target_path="references/finance-policy.md",
        ),
    )
    assert [item["path"] for item in renamed["files"]] == ["SKILL.md", "references", "references/finance-policy.md"]

    deleted = service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(operation="delete", path="references"),
    )
    assert [item["path"] for item in deleted["files"]] == ["SKILL.md"]


def test_apply_draft_file_operation_rejects_duplicate_folder_name() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(operation="mkdir", path="references"),
    )

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.apply_draft_file_operation(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillDraftFileOperationPayload(operation="mkdir", path="references"),
        )

    assert exc_info.value.code == "file_path_conflict"


def test_apply_draft_file_operation_updates_skill_md_frontmatter() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    updated = service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(
            operation="upsert_text",
            path="SKILL.md",
            content=_skill_md(name="finance-rules", description="Rules", body="# Rules"),
        ),
    )

    assert updated["name"] == "finance-rules"
    assert updated["description"] == "Rules"


def test_apply_draft_file_operation_cannot_delete_required_skill_md() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.apply_draft_file_operation(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillDraftFileOperationPayload(operation="delete", path="SKILL.md"),
        )

    assert exc_info.value.code == "missing_skill_md"


def test_update_metadata_rejects_stale_baseline() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.update_metadata(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillMetadataPayload(display_name="New", expected_updated_at=0),
        )

    assert exc_info.value.code == "skill_conflict"
    assert exc_info.value.status_code == 409


def test_duplicate_skill_copies_latest_published_content_without_history() -> None:
    captured: dict[str, bytes] = {}

    class CapturingToolFileManager(_FakeToolFileManager):
        def create_file_by_raw(self, **kwargs):
            captured["archive"] = kwargs["file_binary"]
            return super().create_file_by_raw(**kwargs)

    service = SkillManagementService(tool_file_manager=CapturingToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(
            name="finance-sop",
            display_name="Finance SOP",
            description="Handle finance.",
            tags=["Finance"],
        ),
    )
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(files=[{"path": "SKILL.md", "content": _skill_md(body="# Published body")}]),
    )
    service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())

    with patch("services.skill_management_service.storage.load_once", return_value=captured["archive"]):
        duplicated = service.duplicate_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"])

    assert duplicated["name"] == "finance-sop-copy"
    assert duplicated["display_name"] == "Finance SOP (copy)"
    assert duplicated["tags"] == ["Finance"]
    assert duplicated["latest_published_version_id"] is None
    assert "name: finance-sop-copy" in duplicated["files"][0]["content"]
    assert "# Published body" in duplicated["files"][0]["content"]
    assert service.list_versions(tenant_id=TENANT, skill_id=duplicated["id"]) == {"data": []}


def test_duplicate_skill_does_not_copy_agent_references() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop"),
    )
    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])

    duplicated = service.duplicate_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"])

    assert duplicated["reference_count"] == 0
    assert service.list_skill_references(tenant_id=TENANT, skill_id=duplicated["id"]) == {"data": []}
    assert service.list_agent_bindings(tenant_id=TENANT, agent_id=AGENT)["skill_ids"] == [created["id"]]
    listed = service.list_skills(tenant_id=TENANT, keyword=None, tags=[], page=1, limit=10)
    ref_counts_by_name = {skill["name"]: skill["reference_count"] for skill in listed["data"]}
    assert ref_counts_by_name == {
        "finance-sop": 1,
        "finance-sop-copy": 0,
    }


def test_duplicate_unpublished_skill_copies_current_draft() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(files=[{"path": "SKILL.md", "content": _skill_md(body="# Draft body")}]),
    )

    duplicated = service.duplicate_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"])

    assert duplicated["name"] == "finance-sop-copy"
    assert duplicated["latest_published_version_id"] is None
    assert "# Draft body" in duplicated["files"][0]["content"]


def test_delete_skill_requires_confirmation_when_referenced() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.delete_skill(tenant_id=TENANT, skill_id=created["id"])
    assert exc_info.value.code == "skill_delete_confirmation_required"

    deleted = service.delete_skill(tenant_id=TENANT, skill_id=created["id"], confirmation_name="finance-sop")
    assert deleted == {"id": created["id"], "deleted": True}
    assert service.list_skills(tenant_id=TENANT)["data"] == []


def test_delete_skill_removes_synced_agent_config_skill_refs() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    with session_factory.create_session() as session:
        agent_snapshot = AgentConfigSnapshot(
            tenant_id=TENANT,
            agent_id=AGENT,
            version=1,
            config_snapshot=AgentSoulConfig(
                config_skills=[
                    AgentConfigSkillRefConfig(
                        name="finance-sop",
                        description="Finance SOP",
                        file_id="workspace-skill-file",
                        size=1,
                        hash="workspace-skill-hash",
                    ),
                    AgentConfigSkillRefConfig(
                        name="inline-helper",
                        description="Inline helper",
                        file_id="inline-skill-file",
                        size=1,
                        hash="inline-skill-hash",
                    ),
                ]
            ),
            created_by=USER,
        )
        session.add(agent_snapshot)
        session.flush()
        agent = session.get(Agent, AGENT)
        assert agent is not None
        agent.active_config_snapshot_id = agent_snapshot.id
        session.add(
            AgentConfigDraft(
                tenant_id=TENANT,
                agent_id=AGENT,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                draft_owner_key="",
                base_snapshot_id=agent_snapshot.id,
                config_snapshot=AgentSoulConfig(
                    config_skills=[
                        AgentConfigSkillRefConfig(
                            name="finance-sop",
                            description="Finance SOP",
                            file_id="workspace-skill-file",
                            size=1,
                            hash="workspace-skill-hash",
                        )
                    ]
                ),
                created_by=USER,
                updated_by=USER,
            )
        )
        session.commit()

    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])

    deleted = service.delete_skill(tenant_id=TENANT, skill_id=created["id"], confirmation_name="finance-sop")

    with session_factory.create_session() as session:
        agent = session.get(Agent, AGENT)
        assert agent is not None
        active_snapshot = session.get(AgentConfigSnapshot, agent.active_config_snapshot_id)
        draft = session.scalar(
            select(AgentConfigDraft).where(
                AgentConfigDraft.agent_id == AGENT,
                AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
            )
        )
        binding_count = session.scalar(select(func.count()).select_from(AgentSkillBinding))

    assert deleted == {"id": created["id"], "deleted": True}
    assert active_snapshot is not None
    assert draft is not None
    assert binding_count == 0
    assert active_snapshot.version == 2
    active_skill_names = [
        item.name for item in AgentSoulConfig.model_validate(active_snapshot.config_snapshot_dict).config_skills
    ]
    draft_skill_names = [item.name for item in AgentSoulConfig.model_validate(draft.config_snapshot_dict).config_skills]
    assert active_skill_names == ["inline-helper"]
    assert draft_skill_names == []
    assert draft.base_snapshot_id == active_snapshot.id


def test_import_skill_package_creates_draft_and_rejects_name_conflicts() -> None:
    package = io.BytesIO()
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr(
            "expense-sop/SKILL.md",
            "---\nname: expense-sop\ndescription: Expenses\nmetadata:\n  display-name: Expense SOP\n---\n# Expenses",
        )
        archive.writestr("expense-sop/references/policy.md", "Policy")

    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    imported = service.import_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillImportPayload(content=package.getvalue(), filename="expense-sop.zip"),
    )

    assert imported["name"] == "expense-sop"
    assert imported["display_name"] == "Expense SOP"
    assert imported["description"] == "Expenses"
    assert [item["path"] for item in imported["files"]] == ["SKILL.md", "references", "references/policy.md"]

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.import_skill(
            tenant_id=TENANT,
            user_id=USER,
            payload=SkillImportPayload(content=package.getvalue(), filename="expense-sop.zip"),
        )
    assert exc_info.value.code == "skill_name_conflict"


def test_import_skill_package_rejects_missing_frontmatter_description() -> None:
    package = io.BytesIO()
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("expense-sop/SKILL.md", "---\nname: expense-sop\n---\n# Expenses")

    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.import_skill(
            tenant_id=TENANT,
            user_id=USER,
            payload=SkillImportPayload(content=package.getvalue(), filename="expense-sop.zip"),
        )

    assert exc_info.value.code == "missing_skill_description"
    assert exc_info.value.details == {"path": "SKILL.md", "field": "description", "line": 2}


def test_publish_and_export_include_binary_tool_files() -> None:
    captured: dict[str, bytes] = {}

    class CapturingToolFileManager(_FakeToolFileManager):
        def create_file_by_raw(self, **kwargs):
            captured["archive"] = kwargs["file_binary"]
            return super().create_file_by_raw(**kwargs)

    service = SkillManagementService(tool_file_manager=CapturingToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    with session_factory.create_session() as session:
        tool_file = ToolFile(
            user_id=USER,
            tenant_id=TENANT,
            conversation_id=None,
            file_key="tools/blob.pdf",
            mimetype="application/pdf",
            name="policy.pdf",
            size=7,
            original_url=None,
        )
        tool_file.id = "55555555-5555-5555-5555-555555555555"
        session.add(tool_file)
        session.commit()
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[
                {"path": "SKILL.md", "content": _skill_md(body="# Finance")},
                {
                    "path": "assets/policy.pdf",
                    "storage": "tool_file",
                    "tool_file_id": "55555555-5555-5555-5555-555555555555",
                    "mime_type": "application/pdf",
                    "size": 7,
                },
            ]
        ),
    )

    with patch("services.skill_management_service.storage.load_once", return_value=b"pdfblob"):
        service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())

    with zipfile.ZipFile(io.BytesIO(captured["archive"])) as archive:
        assert archive.read("assets/policy.pdf") == b"pdfblob"


def test_restore_version_replaces_draft_and_creates_new_published_version() -> None:
    captured: list[bytes] = []

    class CapturingToolFileManager(_FakeToolFileManager):
        def create_file_by_raw(self, **kwargs):
            captured.append(kwargs["file_binary"])
            return super().create_file_by_raw(**kwargs)

    service = SkillManagementService(tool_file_manager=CapturingToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(files=[{"path": "SKILL.md", "content": _skill_md(body="# First")}]),
    )
    first = service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(files=[{"path": "SKILL.md", "content": _skill_md(body="# Second")}]),
    )
    service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())

    with patch("services.skill_management_service.storage.load_once", return_value=captured[0]):
        restored = service.restore_version(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillRestorePayload(version_id=first["id"], publish_note="restore first"),
        )

    assert restored["version_number"] == 3
    files = service.get_skill(tenant_id=TENANT, skill_id=created["id"])["files"]
    assert "# First" in files[0]["content"]


def test_publish_hash_code_identifies_each_version_even_when_content_matches() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    first = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillPublishPayload(),
    )
    second = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillPublishPayload(),
    )

    assert first["hash_code"]
    assert second["hash_code"]
    assert first["hash_code"] != second["hash_code"]


def test_build_assistant_attachment_context_includes_text_and_marks_binary() -> None:
    attachments = [
        SkillAssistAttachmentPayload(
            tool_file_id="text-file-1",
            name="brief.md",
            mime_type="text/markdown",
            size=13,
        ),
        SkillAssistAttachmentPayload(
            tool_file_id="binary-file-1",
            name="voice.mp3",
            mime_type="audio/mpeg",
            size=4,
        ),
    ]

    with patch(
        "services.skill_management_service.SkillManagementService._load_assistant_tool_file_bytes",
        side_effect=[b"# Brief\nUse this.", b"ID3\x00"],
    ):
        context = SkillManagementService._build_assistant_attachment_context(
            tenant_id=TENANT,
            attachments=attachments,
        )

    assert "--- brief.md (text/markdown, 13 bytes) ---" in context
    assert "# Brief\nUse this." in context
    assert "--- voice.mp3 (audio/mpeg, 4 bytes) ---" in context
    assert "[Binary attachment available as uploaded file metadata only.]" in context

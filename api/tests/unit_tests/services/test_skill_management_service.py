"""Focused tests for workspace-level Skill Management."""

from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Generator
from types import SimpleNamespace
from typing import cast, override
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import Table, delete, func, select
from sqlalchemy.exc import IntegrityError

from core.credit_usage import CreditUsageCreatedBy
from core.db.session_factory import session_factory
from core.tools.tool_file_manager import ToolFileManager
from models.account import Account
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import (
    AgentConfigSkillRefConfig,
    AgentSoulConfig,
    AgentSoulModelConfig,
    AgentSoulModelSettings,
)
from models.enums import TagType
from models.model import App, AppMode, IconType, Tag, TagBinding
from models.skill import AgentSkillBinding, Skill, SkillDraftFile, SkillVersion, SkillVersionManifest
from models.tools import ToolFile
from services.skill_management_service import (
    SkillAssistAttachmentPayload,
    SkillAssistDraftOperationPayload,
    SkillAssistHistoryMessagePayload,
    SkillAssistModelPayload,
    SkillCreatePayload,
    SkillDraftFileCheckPayload,
    SkillDraftFileOperation,
    SkillDraftFileOperationPayload,
    SkillDraftTreeItemPayload,
    SkillDraftTreePayload,
    SkillImportPayload,
    SkillManagementService,
    SkillManagementServiceError,
    SkillMetadataPayload,
    SkillPublishPayload,
    SkillRestorePayload,
    SkillVersionUpdatePayload,
    normalize_skill_file_path,
    validate_skill_description,
    validate_skill_name,
)

TENANT = "11111111-1111-1111-1111-111111111111"
AGENT = "22222222-2222-2222-2222-222222222222"
USER = "33333333-3333-3333-3333-333333333333"


class _FakeToolFileManager(ToolFileManager):
    @override
    def create_file_by_raw(
        self,
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        file_binary: bytes,
        mimetype: str,
        filename: str | None = None,
    ) -> ToolFile:
        tool_file = ToolFile(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            file_key=f"tools/{uuid4().hex}",
            mimetype=mimetype,
            original_url=None,
            name=filename or "file.bin",
            size=len(file_binary),
        )
        tool_file.id = str(uuid4())
        with session_factory.create_session() as session:
            session.add(tool_file)
            session.commit()
        return tool_file


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
        table = cast(Table, model.__table__)
        table.create(bind=engine, checkfirst=True)
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
    for bad in ["finance_sop", "finance--sop", "-finance", "finance-", "Finance", "x" * 65]:
        with pytest.raises(ValueError):
            validate_skill_name(bad)


def test_validate_skill_description_rejects_blank_and_long_values() -> None:
    assert validate_skill_description(" Finance SOP ") == "Finance SOP"
    for bad in ["", "   ", "x" * 1025]:
        with pytest.raises(ValueError):
            validate_skill_description(bad)


def test_normalize_skill_file_path_rejects_escape_paths() -> None:
    assert normalize_skill_file_path("references//guide.md") == "references/guide.md"
    for bad in ["", "../x", "/etc/passwd", "a/\x00b"]:
        with pytest.raises(ValueError):
            normalize_skill_file_path(bad)


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"path": "SKILL.md", "content": None}, "text file content is required"),
        (
            {"path": "SKILL.md", "storage": "text", "content": "Body", "tool_file_id": "tool-file-1"},
            "text file must not include tool_file_id",
        ),
        (
            {"path": "assets/logo.png", "storage": "tool_file"},
            "tool_file draft file requires tool_file_id",
        ),
        (
            {
                "path": "assets/logo.png",
                "storage": "tool_file",
                "tool_file_id": "tool-file-1",
                "content": "inline",
            },
            "tool_file draft file must not include inline content",
        ),
    ],
)
def test_skill_draft_tree_item_payload_rejects_inconsistent_file_storage(
    payload: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        SkillDraftTreeItemPayload.model_validate(payload)


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"operation": "upsert_text", "path": "SKILL.md"}, "content is required for upsert_text"),
        (
            {"operation": "upsert_tool_file", "path": "assets/logo.png"},
            "tool_file_id is required for upsert_tool_file",
        ),
        ({"operation": "rename", "path": "a.md"}, "target_path is required for rename"),
        (
            {"operation": "rename", "path": "a.md", "target_path": "a.md"},
            "target_path must be different from path",
        ),
    ],
)
def test_skill_draft_file_operation_payload_rejects_invalid_operations(
    payload: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        SkillDraftFileOperationPayload.model_validate(payload)


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"operation": "upsert_text", "path": "notes.md", "content": "x"}, "outside the assistant writable area"),
        ({"operation": "upsert_text", "path": "references/policy.md"}, "content is required for upsert_text"),
        ({"operation": "delete", "path": "SKILL.md"}, "SKILL.md cannot be deleted by the assistant"),
    ],
)
def test_skill_assist_draft_operation_payload_rejects_unsafe_operations(
    payload: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        SkillAssistDraftOperationPayload.model_validate(payload)


def test_skill_draft_file_operation_payload_normalizes_target_path() -> None:
    payload = SkillDraftFileOperationPayload(
        operation=SkillDraftFileOperation.RENAME,
        path="./references/old.md",
        target_path="./references/new.md",
    )

    assert payload.path == "references/old.md"
    assert payload.target_path == "references/new.md"


def test_create_skill_without_name_initializes_untitled_draft() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())

    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())

    assert created["name"].startswith("untitled-skill-")
    assert created["display_name"] == "Untitled skill"
    assert created["description"] == ""
    assert created["created_by_name"] == "Li Wei"
    assert created["updated_by_name"] == "Li Wei"
    assert created["latest_published_version_id"] is None
    assert len(created["files"]) == 1
    skill_md = created["files"][0]
    assert skill_md["path"] == "SKILL.md"
    assert skill_md["kind"] == "file"
    assert skill_md["storage"] == "text"
    assert skill_md["content"] == "<!-- dify-skill-empty-draft -->\n"
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
    with session_factory.create_session() as session:
        session.add(Tag(tenant_id=TENANT, type=TagType.SKILL, name="unbound", created_by=USER))
        session.commit()

    result = service.list_tags(tenant_id=TENANT)

    assert result == {
        "data": [
            {"tag": "Finance", "count": 2},
            {"tag": "audit", "count": 1},
            {"tag": "legal", "count": 1},
            {"tag": "unbound", "count": 0},
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

    with patch("services.skill_management_service.ModelManager.for_tenant", return_value=manager) as for_tenant:
        response = list(
            service.create_assistant_stream(
                tenant_id=TENANT,
                skill_id=created["id"],
                message="Create an approval checklist.",
            )
        )

    for_tenant.assert_called_once_with(
        tenant_id=TENANT,
        request_metadata={"created_by": CreditUsageCreatedBy.SKILL_BUILDER},
    )
    assert response == ["# Draft"]
    draft = service.get_skill(tenant_id=TENANT, skill_id=created["id"])
    assert draft["files"][0]["content"] == created["files"][0]["content"]


def test_create_assistant_action_stream_applies_file_operations_and_returns_detail_event() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="refund-sop", description="Handle refund requests."),
    )
    model_output = json.dumps(
        {
            "reply": "Created the refund policy reference.",
            "suggestions": ["Add escalation rules", "Include refund examples"],
            "operations": [
                {
                    "operation": "upsert_text",
                    "path": "references/refund-policy.md",
                    "mime_type": "text/markdown",
                    "content": "# Refund Policy\n",
                }
            ],
        }
    )
    model = SimpleNamespace(
        invoke_llm=lambda **_kwargs: SimpleNamespace(
            message=SimpleNamespace(get_text_content=lambda: model_output),
        )
    )
    manager = SimpleNamespace(get_default_model_instance=lambda **_kwargs: model)

    with patch("services.skill_management_service.ModelManager.for_tenant", return_value=manager) as for_tenant:
        response = list(
            service.create_assistant_action_stream(
                tenant_id=TENANT,
                user_id=USER,
                skill_id=created["id"],
                message="新建 references/refund-policy.md",
                target_path="SKILL.md",
            )
        )

    for_tenant.assert_called_once_with(
        tenant_id=TENANT,
        request_metadata={"created_by": CreditUsageCreatedBy.SKILL_BUILDER},
    )
    events = [json.loads(chunk.removeprefix("data: ").strip()) for chunk in response]
    assert [event["event"] for event in events] == [
        "skill_assistant_progress",
        "skill_assistant_progress",
        "message",
        "skill_assistant_suggestions",
        "skill_assistant_progress",
        "skill_assistant_progress",
        "skill_detail_updated",
        "message_end",
    ]
    assert events[2]["answer"] == "Created the refund policy reference."
    assert events[3]["suggestions"] == ["Add escalation rules", "Include refund examples"]
    assert events[6]["operations"] == [{"operation": "upsert_text", "path": "references/refund-policy.md"}]
    assert any(file["path"] == "references/refund-policy.md" for file in events[6]["detail"]["files"])

    draft = service.get_skill(tenant_id=TENANT, skill_id=created["id"])
    reference = next(file for file in draft["files"] if file["path"] == "references/refund-policy.md")
    assert reference["content"] == "# Refund Policy\n"


def test_new_skill_builder_stays_in_scenario_stage_on_first_turn() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())
    model_output = json.dumps(
        {
            "reply": "Created a complete Customer Issue Triage skill.",
            "suggested_name": "customer-issue-triage",
            "suggested_display_name": "Customer Issue Triage",
            "suggestions": ["Describe the customer issue trigger"],
            "operations": [
                {
                    "operation": "upsert_text",
                    "path": "SKILL.md",
                    "mime_type": "text/markdown",
                    "content": (
                        "---\n"
                        "name: customer-issue-triage\n"
                        "description: Classify customer feedback into P0-P3 priorities.\n"
                        "metadata:\n"
                        "  display-name: Customer Issue Triage\n"
                        "---\n"
                        "# Customer Issue Triage\n\n"
                        "Invented escalation rules and routing thresholds.\n"
                    ),
                },
                {
                    "operation": "upsert_text",
                    "path": "references/example.md",
                    "mime_type": "text/markdown",
                    "content": "# Example\n",
                },
            ],
        }
    )
    model = SimpleNamespace(
        invoke_llm=lambda **_kwargs: SimpleNamespace(
            message=SimpleNamespace(get_text_content=lambda: model_output),
        )
    )
    manager = SimpleNamespace(get_model_instance=lambda **_kwargs: model)

    with patch("services.skill_management_service.ModelManager.for_tenant", return_value=manager):
        events = [
            json.loads(chunk.removeprefix("data: ").strip())
            for chunk in service.create_assistant_action_stream(
                tenant_id=TENANT,
                user_id=USER,
                skill_id=created["id"],
                message="Customer issue triage",
                model_payload=SkillAssistModelPayload(provider="test", model="test"),
            )
        ]

    detail = next(event["detail"] for event in events if event["event"] == "skill_detail_updated")
    skill_md = next(file for file in detail["files"] if file["path"] == "SKILL.md")
    assert detail["name"] == "customer-issue-triage"
    assert detail["display_name"] == "Customer Issue Triage"
    assert detail["description"] == "Classify customer feedback into P0-P3 priorities."
    assert "Invented escalation rules" not in skill_md["content"]
    assert not any(file["path"] == "references/example.md" for file in detail["files"])


def test_skill_builder_reuses_previous_name_suggestion_when_final_response_omits_it() -> None:
    history = [
        SkillAssistHistoryMessagePayload(
            role="assistant",
            content="I suggest Customer Issue Triage.",
            suggested_name="customer-issue-triage",
            suggested_display_name="Customer Issue Triage",
        ),
        SkillAssistHistoryMessagePayload(role="user", content="Proceed to finalize the Skill."),
    ]

    assert SkillManagementService._latest_assistant_suggested_identity(history) == (
        "customer-issue-triage",
        "Customer Issue Triage",
    )


def test_skill_builder_stays_progressive_after_auto_generated_name() -> None:
    skill = cast(
        Skill,
        SimpleNamespace(
            display_name="Sales Lead Follow-Up Strategy",
            name_manually_edited=False,
            latest_published_version_id=None,
            description="Automate sales lead follow-up.",
        ),
    )
    files = cast(
        list[SkillDraftFile],
        [
            SimpleNamespace(
                path="SKILL.md",
                content_text=(
                    "---\n"
                    "name: sales-lead-follow-up-strategy\n"
                    "description: Automate sales lead follow-up.\n"
                    "metadata:\n"
                    "  display-name: Sales Lead Follow-Up Strategy\n"
                    "---\n"
                    "# Sales Lead Follow-Up Strategy\n\n"
                    "Workflow body.\n"
                ),
            ),
        ],
    )

    assert SkillManagementService._assistant_authoring_stage(skill=skill, files=files) == "resources"


def test_create_assistant_action_stream_strips_skill_frontmatter_from_reference_files() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="refund-sop", description="Handle refund requests."),
    )
    model_output = json.dumps(
        {
            "reply": "Created the refund policy reference.",
            "operations": [
                {
                    "operation": "upsert_text",
                    "path": "references/refund-policy.md",
                    "mime_type": "text/markdown",
                    "content": (
                        "---\n"
                        "name: refund-policy\n"
                        "description: Refund policy reference.\n"
                        "metadata:\n"
                        "  display-name: Refund Policy\n"
                        "---\n"
                        "# Refund Policy\n"
                    ),
                }
            ],
        }
    )
    model = SimpleNamespace(
        invoke_llm=lambda **_kwargs: SimpleNamespace(
            message=SimpleNamespace(get_text_content=lambda: model_output),
        )
    )
    manager = SimpleNamespace(get_default_model_instance=lambda **_kwargs: model)

    with patch("services.skill_management_service.ModelManager.for_tenant", return_value=manager):
        list(
            service.create_assistant_action_stream(
                tenant_id=TENANT,
                user_id=USER,
                skill_id=created["id"],
                message="新建 references/refund-policy.md",
            )
        )

    draft = service.get_skill(tenant_id=TENANT, skill_id=created["id"])
    reference = next(file for file in draft["files"] if file["path"] == "references/refund-policy.md")
    assert reference["content"] == "# Refund Policy\n"


def test_create_assistant_action_stream_generates_missing_suggestions() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="refund-sop", description="Handle refund requests."),
    )
    model_outputs = [
        json.dumps(
            {
                "reply": "Created the refund policy reference.",
                "operations": [
                    {
                        "operation": "upsert_text",
                        "path": "references/refund-policy.md",
                        "mime_type": "text/markdown",
                        "content": "# Refund Policy\n",
                    }
                ],
            }
        ),
        json.dumps({"follow_up_suggestions": ["Add SLA tiers", "Include refund denial templates"]}),
    ]

    def invoke_llm(**_kwargs) -> SimpleNamespace:
        return SimpleNamespace(
            message=SimpleNamespace(get_text_content=lambda: model_outputs.pop(0)),
        )

    model = SimpleNamespace(invoke_llm=invoke_llm)
    manager = SimpleNamespace(get_default_model_instance=lambda **_kwargs: model)

    with patch("services.skill_management_service.ModelManager.for_tenant", return_value=manager):
        response = list(
            service.create_assistant_action_stream(
                tenant_id=TENANT,
                user_id=USER,
                skill_id=created["id"],
                message="新建 references/refund-policy.md",
            )
        )

    events = [json.loads(chunk.removeprefix("data: ").strip()) for chunk in response]
    assert [event["event"] for event in events] == [
        "skill_assistant_progress",
        "skill_assistant_progress",
        "message",
        "skill_assistant_suggestions",
        "skill_assistant_progress",
        "skill_assistant_progress",
        "skill_detail_updated",
        "message_end",
    ]
    assert events[3]["suggestions"] == ["Add SLA tiers", "Include refund denial templates"]


def test_create_assistant_action_stream_reports_skill_name_database_conflict() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="untitled-skill-1", description="Draft skill."),
    )
    model_output = json.dumps(
        {
            "reply": "已创建用于客户问题分级处理的 skill 草案",
            "operations": [
                {
                    "operation": "upsert_text",
                    "path": "SKILL.md",
                    "mime_type": "text/markdown",
                    "content": (
                        "---\n"
                        "name: customer-issue-triage\n"
                        "description: Customer issue triage.\n"
                        "metadata:\n"
                        "  display-name: Customer Issue Triage\n"
                        "---\n"
                        "# Customer Issue Triage\n"
                    ),
                }
            ],
        }
    )
    model = SimpleNamespace(
        invoke_llm=lambda **_kwargs: SimpleNamespace(
            message=SimpleNamespace(get_text_content=lambda: model_output),
        )
    )
    manager = SimpleNamespace(get_default_model_instance=lambda **_kwargs: model)
    integrity_error = IntegrityError(
        "UPDATE skills",
        {},
        Exception(
            'duplicate key value violates unique constraint "skill_tenant_name_unique"\n'
            "DETAIL:  Key (tenant_id, name)=(tenant, customer-issue-triage) already exists."
        ),
    )

    with (
        patch("services.skill_management_service.ModelManager.for_tenant", return_value=manager),
        patch.object(service, "apply_draft_file_operation", side_effect=integrity_error),
    ):
        response = list(
            service.create_assistant_action_stream(
                tenant_id=TENANT,
                user_id=USER,
                skill_id=created["id"],
                message="创建客户问题分级处理 skill",
            )
        )

    events = [json.loads(chunk.removeprefix("data: ").strip()) for chunk in response]
    assert [event["event"] for event in events] == [
        "skill_assistant_progress",
        "skill_assistant_progress",
        "message",
        "skill_assistant_progress",
        "error",
    ]
    assert events[4]["code"] == "skill_name_conflict"
    assert events[4]["message"] == 'Skill name "customer-issue-triage" already exists. Please choose a different name.'
    assert events[4]["details"] == {"name": "customer-issue-triage"}


def test_sync_assistant_model_config_updates_debugger_draft() -> None:
    openai_model = AgentSoulModelConfig(
        plugin_id="langgenius/openai",
        model_provider="langgenius/openai/openai",
        model="gpt-4o-mini",
        model_settings=AgentSoulModelSettings(temperature=0.2),
    )
    tongyi_model = AgentSoulModelConfig(
        plugin_id="langgenius/tongyi",
        model_provider="langgenius/tongyi/tongyi",
        model="qwen3.7-plus",
        model_settings=AgentSoulModelSettings(temperature=0.2),
    )

    with session_factory.create_session() as session:
        agent = Agent(
            tenant_id=TENANT,
            name="Skill Authoring Assistant",
            role="__skill_authoring_assistant__",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            status=AgentStatus.ACTIVE,
            backing_app_id=str(uuid4()),
            created_by=USER,
            updated_by=USER,
        )
        session.add(agent)
        session.flush()
        snapshot = AgentConfigSnapshot(
            tenant_id=TENANT,
            agent_id=agent.id,
            version=1,
            config_snapshot=AgentSoulConfig(model=tongyi_model),
            created_by=USER,
        )
        session.add(snapshot)
        session.flush()
        agent.active_config_snapshot_id = snapshot.id
        draft = AgentConfigDraft(
            tenant_id=TENANT,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            draft_owner_key="",
            base_snapshot_id=snapshot.id,
            config_snapshot=AgentSoulConfig(model=openai_model),
            created_by=USER,
            updated_by=USER,
        )
        session.add(draft)
        session.flush()

        SkillManagementService._sync_assistant_model_config(
            session,
            assistant=agent,
            model_config=tongyi_model,
        )
        session.flush()

        updated_draft = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
        assert updated_draft.model is not None
        assert updated_draft.model.model_provider == "langgenius/tongyi/tongyi"
        assert updated_draft.model.model == "qwen3.7-plus"


def test_sync_assistant_model_config_updates_draft_without_active_snapshot() -> None:
    openai_model = AgentSoulModelConfig(
        plugin_id="langgenius/openai",
        model_provider="langgenius/openai/openai",
        model="gpt-4o-mini",
        model_settings=AgentSoulModelSettings(temperature=0.2),
    )
    tongyi_model = AgentSoulModelConfig(
        plugin_id="langgenius/tongyi",
        model_provider="langgenius/tongyi/tongyi",
        model="qwen3.7-plus",
        model_settings=AgentSoulModelSettings(temperature=0.2),
    )

    with session_factory.create_session() as session:
        agent = Agent(
            tenant_id=TENANT,
            name="Skill Authoring Assistant",
            role="__skill_authoring_assistant__",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            status=AgentStatus.ACTIVE,
            backing_app_id=str(uuid4()),
            created_by=USER,
            updated_by=USER,
        )
        session.add(agent)
        session.flush()
        draft = AgentConfigDraft(
            tenant_id=TENANT,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            draft_owner_key="",
            config_snapshot=AgentSoulConfig(model=openai_model),
            created_by=USER,
            updated_by=USER,
        )
        session.add(draft)
        session.flush()

        SkillManagementService._sync_assistant_model_config(
            session,
            assistant=agent,
            model_config=tongyi_model,
        )
        session.flush()

        updated_draft = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
        assert updated_draft.model is not None
        assert updated_draft.model.model_provider == "langgenius/tongyi/tongyi"
        assert agent.active_config_has_model is True


def test_update_display_name_keeps_name_and_draft_content_unchanged() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())
    original_skill_md = next(item for item in service.get_skill(tenant_id=TENANT, skill_id=created["id"])["files"])

    updated = service.update_metadata(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillMetadataPayload(display_name="Finance Audit"),
    )

    assert updated["display_name"] == "Finance Audit"
    assert updated["name"] == created["name"]
    assert updated["name_manually_edited"] is False
    skill_md = next(item for item in service.get_skill(tenant_id=TENANT, skill_id=created["id"])["files"])
    assert skill_md["content"] == original_skill_md["content"]


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
    assert "display-name: Finance Audit" not in skill_md["content"]


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


def test_list_agent_bindings_uses_latest_published_metadata_when_draft_changes() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(
            name="finance-sop",
            display_name="Finance SOP",
            description="Published finance workflow.",
        ),
    )
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[
                {
                    "path": "SKILL.md",
                    "kind": "file",
                    "storage": "text",
                    "content": _skill_md(
                        name="finance-sop",
                        description="Published finance workflow.",
                        body="# Finance",
                    ),
                }
            ]
        ),
    )
    service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillPublishPayload(),
    )
    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])

    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[
                {
                    "path": "SKILL.md",
                    "kind": "file",
                    "storage": "text",
                    "content": _skill_md(
                        name="finance-sop-draft",
                        description="Unpublished finance workflow.",
                        body="# Draft Finance",
                    ),
                }
            ]
        ),
    )

    binding = service.list_agent_bindings(tenant_id=TENANT, agent_id=AGENT)["data"][0]
    assert binding["name"] == "finance-sop"
    assert binding["display_name"] == "Finance SOP"
    assert binding["description"] == "Published finance workflow."
    assert binding["status"] == "draft"


def test_replace_agent_bindings_rejects_skill_name_conflict_with_agent_config_skill() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    with session_factory.create_session() as session:
        snapshot = AgentConfigSnapshot(
            tenant_id=TENANT,
            agent_id=AGENT,
            version=1,
            config_snapshot=AgentSoulConfig(
                config_skills=[
                    AgentConfigSkillRefConfig(
                        name="finance-sop",
                        description="Existing uploaded config skill.",
                        file_id="tool-file-1",
                    )
                ]
            ),
            created_by=USER,
        )
        session.add(snapshot)
        session.flush()
        agent = session.get(Agent, AGENT)
        assert agent is not None
        agent.active_config_snapshot_id = snapshot.id
        session.commit()

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])

    assert exc_info.value.code == "agent_skill_name_conflict"
    assert exc_info.value.details == {"names": ["finance-sop"]}


def test_replace_agent_bindings_allows_existing_bound_workspace_skill_name_in_agent_config() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])
    with session_factory.create_session() as session:
        snapshot = AgentConfigSnapshot(
            tenant_id=TENANT,
            agent_id=AGENT,
            version=1,
            config_snapshot=AgentSoulConfig(
                config_skills=[
                    AgentConfigSkillRefConfig(
                        name="finance-sop",
                        description="Synced workspace skill.",
                        file_id="tool-file-1",
                    )
                ]
            ),
            created_by=USER,
        )
        session.add(snapshot)
        session.flush()
        agent = session.get(Agent, AGENT)
        assert agent is not None
        agent.active_config_snapshot_id = snapshot.id
        session.commit()

    result = service.replace_agent_bindings(
        tenant_id=TENANT,
        user_id=USER,
        agent_id=AGENT,
        skill_ids=[created["id"]],
    )

    assert result["skill_ids"] == [created["id"]]


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


def test_publish_does_not_write_referenced_agent_config_skills() -> None:
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
                scope=AgentScope.WORKFLOW_ONLY,
                source=AgentSource.WORKFLOW,
                app_id="66666666-6666-6666-6666-666666666666",
                workflow_id="88888888-8888-8888-8888-888888888888",
                workflow_node_id="node-c",
            )
        )
        session.commit()

    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])
    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=inline_agent_id, skill_ids=[created["id"]])

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
        agent_snapshot_id = agent_snapshot.id
        inline_snapshot_id = inline_snapshot.id
        session.commit()

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
    assert agent.active_config_snapshot_id == agent_snapshot_id
    assert inline_agent.active_config_snapshot_id == inline_snapshot_id
    assert workflow_binding.current_snapshot_id == inline_snapshot_id
    assert agent_snapshot.version == 1
    assert inline_snapshot.version == 1
    agent_skill_ref = AgentSoulConfig.model_validate(agent_snapshot.config_snapshot_dict).config_skills[0]
    inline_skill_ref = AgentSoulConfig.model_validate(inline_snapshot.config_snapshot_dict).config_skills[0]
    draft_skill_ref = AgentSoulConfig.model_validate(agent_draft.config_snapshot_dict).config_skills[0]
    assert agent_skill_ref.file_id == "old-skill-file"
    assert inline_skill_ref.file_id == "old-inline-skill-file"
    assert draft_skill_ref.file_id == "old-draft-skill-file"
    assert agent_skill_ref.hash == "old-hash"


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
        @override
        def create_file_by_raw(
            self,
            *,
            user_id: str,
            tenant_id: str,
            conversation_id: str | None,
            file_binary: bytes,
            mimetype: str,
            filename: str | None = None,
        ) -> ToolFile:
            captured["archive"] = file_binary
            return super().create_file_by_raw(
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                file_binary=file_binary,
                mimetype=mimetype,
                filename=filename,
            )

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
        @override
        def create_file_by_raw(
            self,
            *,
            user_id: str,
            tenant_id: str,
            conversation_id: str | None,
            file_binary: bytes,
            mimetype: str,
            filename: str | None = None,
        ) -> ToolFile:
            captured["archive"] = file_binary
            return super().create_file_by_raw(
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                file_binary=file_binary,
                mimetype=mimetype,
                filename=filename,
            )

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
        payload=SkillDraftTreePayload(
            files=[
                {"path": "SKILL.md", "content": _skill_md(body="# Published body")},
                {"path": "references", "kind": "directory"},
                {"path": "references/policy.md", "content": "Policy text."},
            ]
        ),
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
    assert versions["data"][0]["version_name"] == ""
    assert versions["data"][0]["version_number"] == 1
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


def test_publish_version_numbers_are_scoped_to_each_skill() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    first_skill = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    second_skill = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="support-sop"))

    first_skill_version = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=first_skill["id"],
        payload=SkillPublishPayload(version_name="Finance v1"),
    )
    service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=first_skill["id"],
        payload=SkillPublishPayload(version_name="Finance v2"),
    )
    second_skill_version = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=second_skill["id"],
        payload=SkillPublishPayload(version_name="Support v1"),
    )

    assert first_skill_version["version_number"] == 1
    assert second_skill_version["version_number"] == 1


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


def test_delete_latest_version_does_not_write_referenced_agent_config_skills() -> None:
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
    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])

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
        agent_snapshot_id = agent_snapshot.id
        session.commit()

    deleted = service.delete_version(tenant_id=TENANT, user_id=USER, skill_id=created["id"], version_id=second["id"])

    with session_factory.create_session() as session:
        skill = session.get(Skill, created["id"])
        agent = session.get(Agent, AGENT)
        assert agent is not None
        active_snapshot = session.get(AgentConfigSnapshot, agent.active_config_snapshot_id)
        draft = session.scalar(
            select(AgentConfigDraft).where(
                AgentConfigDraft.agent_id == AGENT,
                AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
            )
        )
        snapshot_count = session.scalar(
            select(func.count()).select_from(AgentConfigSnapshot).where(AgentConfigSnapshot.agent_id == AGENT)
        )

    assert deleted == {"id": second["id"], "deleted": True, "latest_published_version_id": first["id"]}
    assert skill is not None
    assert skill.latest_published_version_id == first["id"]
    assert agent.active_config_snapshot_id == agent_snapshot_id
    assert active_snapshot is not None
    assert draft is not None
    assert snapshot_count == 1
    active_skill_ref = AgentSoulConfig.model_validate(active_snapshot.config_snapshot_dict).config_skills[0]
    draft_skill_ref = AgentSoulConfig.model_validate(draft.config_snapshot_dict).config_skills[0]
    assert active_skill_ref.file_id == "old-skill-file"
    assert active_skill_ref.hash == "old-hash"
    assert draft_skill_ref.file_id == "old-draft-skill-file"


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


def test_apply_draft_file_operation_generates_name_for_builder_created_skill() -> None:
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
                f"name: {created['name']}\n"
                "description: Classify and route customer issues.\n"
                "metadata:\n"
                "  display-name: Customer Issue Tiered Handling\n"
                "---\n"
                "# Customer Issue Tiered Handling\n"
            ),
        ),
    )

    skill_md = next(item for item in updated["files"] if item["path"] == "SKILL.md")
    assert updated["name"] == "customer-issue-tiered-handling"
    assert updated["display_name"] == "Customer Issue Tiered Handling"
    assert updated["name_manually_edited"] is False
    assert "name: customer-issue-tiered-handling" in skill_md["content"]
    assert f"name: {created['name']}" not in skill_md["content"]


def test_apply_draft_file_operation_prefers_builder_display_name_for_generated_name() -> None:
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
                "name: customer-issue-triage\n"
                "description: Classify and route customer issues.\n"
                "metadata:\n"
                "  display-name: Customer Issue Tiered Handling\n"
                "---\n"
                "# Customer Issue Tiered Handling\n"
            ),
        ),
    )

    skill_md = next(item for item in updated["files"] if item["path"] == "SKILL.md")
    assert updated["name"] == "customer-issue-tiered-handling"
    assert updated["display_name"] == "Customer Issue Tiered Handling"
    assert updated["name_manually_edited"] is False
    assert "name: customer-issue-tiered-handling" in skill_md["content"]
    assert "name: customer-issue-triage" not in skill_md["content"]


def test_apply_draft_file_operation_uses_builder_heading_when_display_name_is_placeholder() -> None:
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
                f"name: {created['name']}\n"
                "description: Classify and route customer issues.\n"
                "metadata:\n"
                "  display-name: Untitled skill\n"
                "---\n"
                "# Customer Issue Tiered Handling\n"
            ),
        ),
    )

    skill_md = next(item for item in updated["files"] if item["path"] == "SKILL.md")
    assert updated["name"] == "customer-issue-tiered-handling"
    assert updated["display_name"] == "Customer Issue Tiered Handling"
    assert updated["name_manually_edited"] is False
    assert "name: customer-issue-tiered-handling" in skill_md["content"]
    assert "display-name: Customer Issue Tiered Handling" in skill_md["content"]
    assert f"name: {created['name']}" not in skill_md["content"]


def test_apply_draft_file_operation_keeps_auto_generated_name_in_sync_with_builder_display_name() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())
    first_update = service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(
            operation="upsert_text",
            path="SKILL.md",
            content=(
                "---\n"
                "name: customer-issue-triage\n"
                "description: Classify customer issues.\n"
                "metadata:\n"
                "  display-name: Customer Issue Triage\n"
                "---\n"
                "# Customer Issue Triage\n"
            ),
        ),
    )
    assert first_update["name"] == "customer-issue-triage"
    assert first_update["name_manually_edited"] is False

    updated = service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(
            operation="upsert_text",
            path="SKILL.md",
            content=(
                "---\n"
                "name: customer-issue-triage\n"
                "description: Classify and route customer issues.\n"
                "metadata:\n"
                "  display-name: Customer Issue Tiered Handling\n"
                "---\n"
                "# Customer Issue Tiered Handling\n"
            ),
        ),
    )

    skill_md = next(item for item in updated["files"] if item["path"] == "SKILL.md")
    assert updated["name"] == "customer-issue-tiered-handling"
    assert updated["display_name"] == "Customer Issue Tiered Handling"
    assert updated["name_manually_edited"] is False
    assert "name: customer-issue-tiered-handling" in skill_md["content"]
    assert "name: customer-issue-triage" not in skill_md["content"]


def test_assistant_name_suggestion_materializes_empty_skill_draft() -> None:
    skill = cast(
        Skill,
        SimpleNamespace(
            name="untitled-skill-699bed24",
            description="",
        ),
    )

    content = SkillManagementService._apply_assistant_suggested_identity(
        skill=skill,
        content="<!-- dify-skill-empty-draft -->\n",
        suggested_name="sales-lead-follow-up-strategy",
        suggested_display_name="Sales Lead Follow-Up Strategy",
    )

    assert "name: sales-lead-follow-up-strategy" in content
    assert "display-name: Sales Lead Follow-Up Strategy" in content


def test_apply_draft_file_operation_reports_builder_generated_name_conflict() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="customer-issue-tiered-handling"),
    )
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload())

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.apply_draft_file_operation(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillDraftFileOperationPayload(
                operation="upsert_text",
                path="SKILL.md",
                content=(
                    "---\n"
                    "name: customer-issue-triage\n"
                    "description: Classify and route customer issues.\n"
                    "metadata:\n"
                    "  display-name: Customer Issue Tiered Handling\n"
                    "---\n"
                    "# Customer Issue Tiered Handling\n"
                ),
            ),
        )

    assert exc_info.value.code == "skill_name_conflict"
    assert exc_info.value.details == {"name": "customer-issue-tiered-handling"}
    assert exc_info.value.message == (
        'Skill name "customer-issue-tiered-handling" already exists. Please choose a different name.'
    )


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


def test_replace_draft_tree_allows_missing_frontmatter_name_until_publish() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    draft = service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(files=[{"path": "SKILL.md", "content": "# Missing frontmatter"}]),
    )

    assert draft["name"] == "finance-sop"
    assert next(item for item in draft["files"] if item["path"] == "SKILL.md")["content"] == "# Missing frontmatter"

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())
    assert exc_info.value.code == "missing_skill_name"
    assert exc_info.value.details == {"path": "SKILL.md", "field": "name", "line": 2}


def test_replace_draft_tree_allows_missing_frontmatter_description_until_publish() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    draft = service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[{"path": "SKILL.md", "content": "---\nname: finance-sop\n---\n# Missing description"}]
        ),
    )

    assert draft["description"] == "Describe what this Skill does and when an Agent should use it."
    assert "description:" not in next(item for item in draft["files"] if item["path"] == "SKILL.md")["content"]

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())
    assert exc_info.value.code == "missing_skill_description"
    assert exc_info.value.details == {"path": "SKILL.md", "field": "description", "line": 2}


def test_replace_draft_tree_allows_blank_frontmatter_description_until_publish() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    draft = service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[{"path": "SKILL.md", "content": "---\nname: finance-sop\ndescription: ''\n---\n# Blank"}]
        ),
    )

    assert draft["description"] == "Describe what this Skill does and when an Agent should use it."
    assert "description: ''" in next(item for item in draft["files"] if item["path"] == "SKILL.md")["content"]

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())
    assert exc_info.value.code == "missing_skill_description"
    assert exc_info.value.details == {"path": "SKILL.md", "field": "description", "line": 3}


def test_publish_rejects_too_long_frontmatter_description() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[{"path": "SKILL.md", "content": _skill_md(description="x" * 1025, body="# Too long")}]
        ),
    )

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())
    assert exc_info.value.code == "invalid_skill_description"
    assert exc_info.value.details == {"path": "SKILL.md", "field": "description", "line": 3}


def test_publish_reports_actual_frontmatter_name_line() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))

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

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())
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


def test_check_draft_files_reports_batch_validation_results() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    service.apply_draft_file_operation(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftFileOperationPayload(
            operation="upsert_text",
            path="references/policy.md",
            content="Policy text.",
        ),
    )

    result = service.check_draft_files(
        tenant_id=TENANT,
        skill_id=created["id"],
        payload=SkillDraftFileCheckPayload(
            files=[
                {"filename": "guide.md", "path": "references/guide.md", "size": 10},
                {"filename": "policy.md", "path": "references/policy.md", "size": 10},
                {"filename": "guide-copy.md", "path": "references/guide.md", "size": 10},
                {"filename": "README", "path": "references/README", "size": 10},
                {"filename": "big.md", "path": "references/big.md", "size": 512 * 1024 + 1},
                {"filename": "escape.md", "path": "../escape.md", "size": 10},
            ]
        ),
    )

    assert set(result) == {"data"}
    first_guide = result["data"]["guide.md"]
    second_guide = result["data"]["guide-copy.md"]
    assert first_guide["path"] == "references/guide.md"
    assert first_guide["errors"] == []
    assert second_guide["path"] == "references/guide.md"
    assert [error["code"] for error in second_guide["errors"]] == ["duplicate_file_path"]
    assert [error["code"] for error in result["data"]["policy.md"]["errors"]] == ["file_already_exists"]
    assert [error["code"] for error in result["data"]["README"]["errors"]] == ["missing_file_extension"]
    assert result["data"]["big.md"]["errors"] == []
    assert [error["code"] for error in result["data"]["escape.md"]["errors"]] == ["invalid_file_path"]


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
    assert exc_info.value.details["expected_updated_at"] == 0
    assert exc_info.value.details["current_updated_at"] == created["updated_at"]


def test_apply_draft_file_operation_conflict_includes_current_file_version() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    skill_md = next(file for file in created["files"] if file["path"] == "SKILL.md")

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.apply_draft_file_operation(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillDraftFileOperationPayload(
                operation="upsert_text",
                path="SKILL.md",
                content=skill_md["content"],
                expected_updated_at=0,
            ),
        )

    assert exc_info.value.code == "skill_conflict"
    assert exc_info.value.status_code == 409
    assert exc_info.value.details["expected_updated_at"] == 0
    assert exc_info.value.details["current_updated_at"] == created["updated_at"]
    assert exc_info.value.details["current_file_path"] == "SKILL.md"
    assert exc_info.value.details["current_file_hash"] == skill_md["hash"]
    assert exc_info.value.details["current_file_content"] == skill_md["content"]


def test_duplicate_skill_copies_latest_published_content_without_history() -> None:
    captured: dict[str, bytes] = {}

    class CapturingToolFileManager(_FakeToolFileManager):
        @override
        def create_file_by_raw(
            self,
            *,
            user_id: str,
            tenant_id: str,
            conversation_id: str | None,
            file_binary: bytes,
            mimetype: str,
            filename: str | None = None,
        ) -> ToolFile:
            captured["archive"] = file_binary
            return super().create_file_by_raw(
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                file_binary=file_binary,
                mimetype=mimetype,
                filename=filename,
            )

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
        payload=SkillDraftTreePayload(
            files=[
                {"path": "SKILL.md", "content": _skill_md(body="# Published body")},
                {"path": "references", "kind": "directory"},
                {"path": "references/policy.md", "content": "Policy text."},
            ]
        ),
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
    references = next(file for file in duplicated["files"] if file["path"] == "references")
    assert references["kind"] == "directory"
    assert any(file["path"] == "references/policy.md" for file in duplicated["files"])
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

    deleted = service.delete_skill(
        tenant_id=TENANT,
        skill_id=created["id"],
        confirmation_name=created["display_name"],
    )
    assert deleted == {"id": created["id"], "deleted": True}
    assert service.list_skills(tenant_id=TENANT)["data"] == []


def test_delete_skill_removes_bindings_without_writing_agent_config_skill_refs() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])
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
        agent_snapshot_id = agent_snapshot.id
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

    deleted = service.delete_skill(
        tenant_id=TENANT,
        skill_id=created["id"],
        confirmation_name=created["display_name"],
    )

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
    assert agent.active_config_snapshot_id == agent_snapshot_id
    assert active_snapshot is not None
    assert draft is not None
    assert binding_count == 0
    assert active_snapshot.version == 1
    active_skill_names = [
        item.name for item in AgentSoulConfig.model_validate(active_snapshot.config_snapshot_dict).config_skills
    ]
    draft_skill_names = [item.name for item in AgentSoulConfig.model_validate(draft.config_snapshot_dict).config_skills]
    assert active_skill_names == ["finance-sop", "inline-helper"]
    assert draft_skill_names == ["finance-sop"]
    assert draft.base_snapshot_id == agent_snapshot_id


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


def test_import_skill_package_rejects_archive_larger_than_upload_skill_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.skill_management_service.dify_config.UPLOAD_SKILL_FILE_SIZE_LIMIT", 0)

    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service.import_skill(
            tenant_id=TENANT,
            user_id=USER,
            payload=SkillImportPayload(content=b"not-empty", filename="expense-sop.zip"),
        )

    assert exc_info.value.code == "archive_too_large"


def test_import_skill_package_rejects_zip_bomb_before_reading_members() -> None:
    package = io.BytesIO()
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("payload.bin", b"\x00" * (8 * 1024 * 1024))

    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())

    with pytest.raises(SkillManagementServiceError) as exc_info:
        service._draft_payload_from_zip(
            tenant_id=TENANT,
            user_id=USER,
            archive_bytes=package.getvalue(),
        )

    assert exc_info.value.code == "invalid_skill_package"


def test_publish_and_export_include_binary_tool_files() -> None:
    captured: dict[str, bytes] = {}

    class CapturingToolFileManager(_FakeToolFileManager):
        @override
        def create_file_by_raw(
            self,
            *,
            user_id: str,
            tenant_id: str,
            conversation_id: str | None,
            file_binary: bytes,
            mimetype: str,
            filename: str | None = None,
        ) -> ToolFile:
            captured["archive"] = file_binary
            return super().create_file_by_raw(
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                file_binary=file_binary,
                mimetype=mimetype,
                filename=filename,
            )

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


def test_restore_version_replaces_draft_without_publishing() -> None:
    captured: list[bytes] = []

    class CapturingToolFileManager(_FakeToolFileManager):
        @override
        def create_file_by_raw(
            self,
            *,
            user_id: str,
            tenant_id: str,
            conversation_id: str | None,
            file_binary: bytes,
            mimetype: str,
            filename: str | None = None,
        ) -> ToolFile:
            captured.append(file_binary)
            return super().create_file_by_raw(
                user_id=user_id,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                file_binary=file_binary,
                mimetype=mimetype,
                filename=filename,
            )

    service = SkillManagementService(tool_file_manager=CapturingToolFileManager())
    created = service.create_skill(tenant_id=TENANT, user_id=USER, payload=SkillCreatePayload(name="finance-sop"))
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[
                {
                    "path": "SKILL.md",
                    "content": _skill_md(
                        name="finance-sop-v1",
                        description="Finance SOP version one",
                        body="# First",
                    ),
                }
            ]
        ),
    )
    first = service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(
            files=[
                {
                    "path": "SKILL.md",
                    "content": _skill_md(
                        name="finance-sop-v2",
                        description="Finance SOP version two",
                        body="# Second",
                    ),
                }
            ]
        ),
    )
    second = service.publish_skill(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillPublishPayload(),
    )

    with patch("services.skill_management_service.storage.load_once", return_value=captured[0]):
        restored = service.restore_version(
            tenant_id=TENANT,
            user_id=USER,
            skill_id=created["id"],
            payload=SkillRestorePayload(version_id=first["id"], publish_note="restore first"),
        )

    assert restored["latest_published_version_id"] == second["id"]
    assert restored["latest_published_version_number"] == 2
    files = restored["files"]
    assert "# First" in files[0]["content"]
    assert restored["name"] == "finance-sop-v1"
    assert restored["description"] == "Finance SOP version one"

    versions = service.list_versions(tenant_id=TENANT, skill_id=created["id"])
    assert [version["version_number"] for version in versions["data"]] == [2, 1]


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


def test_build_assistant_attachment_context_includes_extractable_pdf_text() -> None:
    attachment = SkillAssistAttachmentPayload(
        tool_file_id="resume-file-1",
        name="resume.pdf",
        mime_type="application/pdf",
        size=166035,
    )

    with (
        patch(
            "services.skill_management_service.SkillManagementService._load_assistant_tool_file_bytes",
            return_value=b"pdf bytes",
        ),
        patch(
            "services.skill_management_service.SkillManagementService._extract_pdf_text",
            return_value="Wang Lei\nAlgorithm Engineer",
        ),
    ):
        context = SkillManagementService._build_assistant_attachment_context(
            tenant_id=TENANT,
            attachments=[attachment],
        )

    assert "--- resume.pdf (application/pdf, 166035 bytes) ---" in context
    assert "Wang Lei\nAlgorithm Engineer" in context
    assert "Binary attachment available" not in context


def _zip_payload(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return buffer.getvalue()


def test_build_assistant_attachment_context_extracts_docx_text() -> None:
    attachment = SkillAssistAttachmentPayload(
        tool_file_id="docx-file-1",
        name="guide.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size=123,
    )
    payload = _zip_payload(
        {
            "word/document.xml": (
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body><w:p><w:r><w:t>Escalate urgent tickets</w:t></w:r></w:p></w:body>"
                "</w:document>"
            )
        }
    )

    with patch(
        "services.skill_management_service.SkillManagementService._load_assistant_tool_file_bytes",
        return_value=payload,
    ):
        context = SkillManagementService._build_assistant_attachment_context(
            tenant_id=TENANT,
            attachments=[attachment],
        )

    assert "--- guide.docx" in context
    assert "Escalate urgent tickets" in context
    assert "Binary attachment available" not in context


def test_build_assistant_attachment_context_extracts_xlsx_text() -> None:
    attachment = SkillAssistAttachmentPayload(
        tool_file_id="xlsx-file-1",
        name="forecast.xlsx",
        mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size=456,
    )
    payload = _zip_payload(
        {
            "xl/sharedStrings.xml": (
                '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                "<si><t>Forecast Q1</t></si>"
                "</sst>"
            ),
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row><c t="s"><v>0</v></c><c><v>42</v></c></row></sheetData>'
                "</worksheet>"
            ),
        }
    )

    with patch(
        "services.skill_management_service.SkillManagementService._load_assistant_tool_file_bytes",
        return_value=payload,
    ):
        context = SkillManagementService._build_assistant_attachment_context(
            tenant_id=TENANT,
            attachments=[attachment],
        )

    assert "--- forecast.xlsx" in context
    assert "Forecast Q1" in context
    assert "42" in context
    assert "Binary attachment available" not in context


def test_build_assistant_attachment_context_extracts_pptx_text() -> None:
    attachment = SkillAssistAttachmentPayload(
        tool_file_id="pptx-file-1",
        name="playbook.pptx",
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size=789,
    )
    payload = _zip_payload(
        {
            "ppt/slides/slide1.xml": (
                '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
                'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                "<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Quarterly enablement plan</a:t>"
                "</a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
            )
        }
    )

    with patch(
        "services.skill_management_service.SkillManagementService._load_assistant_tool_file_bytes",
        return_value=payload,
    ):
        context = SkillManagementService._build_assistant_attachment_context(
            tenant_id=TENANT,
            attachments=[attachment],
        )

    assert "--- playbook.pptx" in context
    assert "Quarterly enablement plan" in context
    assert "Binary attachment available" not in context


def test_build_assistant_attachment_context_extracts_rtf_text() -> None:
    attachment = SkillAssistAttachmentPayload(
        tool_file_id="rtf-file-1",
        name="notes.rtf",
        mime_type="application/rtf",
        size=74,
    )

    with patch(
        "services.skill_management_service.SkillManagementService._load_assistant_tool_file_bytes",
        return_value=b"{\\rtf1\\ansi Skill Builder\\par reads RTF notes.}",
    ):
        context = SkillManagementService._build_assistant_attachment_context(
            tenant_id=TENANT,
            attachments=[attachment],
        )

    assert "--- notes.rtf" in context
    assert "Skill Builder" in context
    assert "reads RTF notes." in context
    assert "Binary attachment available" not in context


def test_build_assistant_image_contents_encodes_images_for_vision_models() -> None:
    attachments = [
        SkillAssistAttachmentPayload(
            tool_file_id="image-file-1",
            name="logo.png",
            mime_type="image/png",
            size=4,
        ),
        SkillAssistAttachmentPayload(
            tool_file_id="brief.md",
            name="brief.md",
            mime_type="text/markdown",
            size=5,
        ),
    ]

    with patch(
        "services.skill_management_service.SkillManagementService._load_assistant_tool_file_bytes",
        return_value=b"PNG!",
    ):
        contents = SkillManagementService._build_assistant_image_contents(
            tenant_id=TENANT,
            attachments=attachments,
        )

    assert len(contents) == 1
    assert contents[0].format == "png"
    assert contents[0].mime_type == "image/png"
    assert contents[0].filename == "logo.png"
    assert contents[0].base64_data == "UE5HIQ=="

    with patch(
        "services.skill_management_service.SkillManagementService._load_assistant_tool_file_bytes",
        return_value=b"PNG!",
    ):
        context = SkillManagementService._build_assistant_attachment_context(
            tenant_id=TENANT,
            attachments=attachments[:1],
            vision_enabled=True,
        )

    assert "Image attachment is provided separately as multimodal content." in context


def test_assistant_error_message_exposes_provider_description_without_prefix() -> None:
    error = RuntimeError("[models] Bad Request Error, You have no credits remaining.")

    assert (
        SkillManagementService._assistant_error_message(error, fallback="fallback")
        == "Bad Request Error, You have no credits remaining."
    )


def test_runtime_agent_skills_use_published_identity_when_draft_metadata_changed() -> None:
    skill = SimpleNamespace(
        id="skill-1",
        tenant_id=TENANT,
        name="jietouanhao-peidui2",
        description="draft description",
    )
    version = SimpleNamespace(
        archive_tool_file_id="archive-1",
        archive_size=10,
        hash_code="hash-1",
        manifest=SkillVersionManifest(
            files=[],
            name="jietouanhao-peidui",
            display_name="Jietouanhao Peidui",
            description="published description",
        ),
    )
    session = MagicMock()
    session.execute.return_value = [(SimpleNamespace(), skill, version)]

    with patch("services.skill_management_service.session_factory.create_session") as create_session:
        create_session.return_value.__enter__.return_value = session
        result = SkillManagementService().list_runtime_agent_skills(tenant_id=TENANT, agent_id=AGENT)

    assert result == [
        {
            "id": "skill-1",
            "name": "jietouanhao-peidui",
            "file_id": "archive-1",
            "description": "published description",
            "size": 10,
            "hash": "hash-1",
            "mime_type": "application/zip",
        }
    ]


def test_agent_skill_binding_changes_require_agent_publish_before_runtime_load() -> None:
    service = SkillManagementService(tool_file_manager=_FakeToolFileManager())
    created = service.create_skill(
        tenant_id=TENANT,
        user_id=USER,
        payload=SkillCreatePayload(name="finance-sop", description="Finance SOP"),
    )
    service.replace_draft_tree(
        tenant_id=TENANT,
        user_id=USER,
        skill_id=created["id"],
        payload=SkillDraftTreePayload(files=[{"path": "SKILL.md", "content": _skill_md()}]),
    )
    service.publish_skill(tenant_id=TENANT, user_id=USER, skill_id=created["id"], payload=SkillPublishPayload())
    with session_factory.create_session() as session:
        agent = session.get(Agent, AGENT)
        assert agent is not None
        snapshot = AgentConfigSnapshot(
            tenant_id=TENANT,
            agent_id=AGENT,
            version=1,
            config_snapshot=AgentSoulConfig(),
            created_by=USER,
        )
        session.add(snapshot)
        session.flush()
        agent.active_config_snapshot_id = snapshot.id
        agent.active_config_is_published = True
        session.commit()

    service.replace_agent_bindings(tenant_id=TENANT, user_id=USER, agent_id=AGENT, skill_ids=[created["id"]])
    with session_factory.create_session() as session:
        agent = session.get(Agent, AGENT)
        assert agent is not None
        assert agent.active_config_is_published is False

    assert service.list_runtime_agent_skills(tenant_id=TENANT, agent_id=AGENT) == []

    with session_factory.create_session() as session:
        agent = session.get(Agent, AGENT)
        assert agent is not None
        agent.active_config_is_published = True
        snapshot_id = agent.active_config_snapshot_id
        assert snapshot_id is not None
        session.commit()

    service.publish_agent_bindings(
        tenant_id=TENANT,
        agent_id=AGENT,
        snapshot_id=snapshot_id,
        user_id=USER,
    )

    assert service.list_runtime_agent_skills(tenant_id=TENANT, agent_id=AGENT)[0]["name"] == "finance-sop"


def test_runtime_agent_skill_pull_normalizes_archive_identity_to_published_metadata() -> None:
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w") as archive:
        archive.writestr("SKILL.md", _skill_md(name="draft-name", description="Draft description"))
        archive.writestr("references/example.md", "Example")

    normalized = SkillManagementService._normalize_published_archive_identity(
        archive_buffer.getvalue(),
        name="published-name",
        display_name="Published Name",
        description="Published description",
    )

    with zipfile.ZipFile(io.BytesIO(normalized)) as archive:
        skill_md = archive.read("SKILL.md").decode("utf-8")
        assert "name: published-name" in skill_md
        assert "description: Published description" in skill_md
        assert "display-name: Published Name" in skill_md
        assert archive.read("references/example.md") == b"Example"

from __future__ import annotations

from inspect import unwrap
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.workspace.skills import (
    WorkspaceAgentSkillBindingsApi,
    WorkspaceSkillAssistMessageApi,
    WorkspaceSkillFilesApi,
    WorkspaceSkillsApi,
    WorkspaceSkillTagsApi,
    WorkspaceSkillVersionApi,
)
from models.account import Account
from services.skill_management_service import SkillAssistAttachmentPayload, SkillManagementServiceError


@pytest.fixture
def app() -> Flask:
    flask_app = Flask("test_workspace_skills")
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def current_user() -> Account:
    user = Account(name="Test User", email="test@example.com")
    user.id = "user-1"
    return user


def _skill_detail() -> dict:
    return {
        "id": "skill-1",
        "name": "finance-sop",
        "display_name": "Finance SOP",
        "icon": "📄",
        "description": "",
        "tags": [],
        "name_manually_edited": False,
        "visibility": "workspace",
        "latest_published_version_id": None,
        "reference_count": 0,
        "created_by": "user-1",
        "created_by_name": "Test User",
        "updated_by": "user-1",
        "updated_by_name": "Test User",
        "created_at": 1,
        "updated_at": 1,
        "files": [
            {
                "id": "file-1",
                "path": "SKILL.md",
                "kind": "file",
                "storage": "text",
                "mime_type": "text/markdown",
                "content": "---\nname: finance-sop\n---\n# Body",
                "tool_file_id": None,
                "size": 32,
                "hash": "hash",
            }
        ],
    }


def test_create_skill_validates_payload_and_returns_detail(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.create_skill.return_value = _skill_detail()

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user)

    assert status == 201
    assert payload["id"] == "skill-1"
    assert payload["files"][0]["path"] == "SKILL.md"
    service.create_skill.assert_called_once()
    assert service.create_skill.call_args.kwargs["tenant_id"] == "tenant-1"
    assert service.create_skill.call_args.kwargs["user_id"] == "user-1"


def test_list_skills_uses_default_pagination_when_query_omits_page_and_limit(app: Flask) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.list_skills.return_value = {
        "data": [],
        "has_more": False,
        "limit": 20,
        "page": 1,
        "total": 0,
    }

    with (
        app.test_request_context("/?keyword=finance&tag=ops&tag=", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1")

    assert payload == {
        "data": [],
        "has_more": False,
        "limit": 20,
        "page": 1,
        "total": 0,
    }
    service.list_skills.assert_called_once_with(
        tenant_id="tenant-1",
        keyword="finance",
        page=1,
        limit=20,
        tags=["ops"],
    )


def test_get_agent_skill_bindings_returns_card_data(app: Flask) -> None:
    api = WorkspaceAgentSkillBindingsApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.list_agent_bindings.return_value = {
        "agent_id": "agent-1",
        "skill_ids": ["skill-1"],
        "data": [
            {
                "id": "skill-1",
                "priority": 0,
                "name": "finance-sop",
                "display_name": "Finance SOP",
                "icon": "📄",
                "description": "Handle finance.",
                "tags": ["Finance"],
                "status": "published",
                "file_count": 2,
                "latest_published_version_id": "version-1",
                "latest_published_at": 123,
                "updated_at": 124,
            }
        ],
    }

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", "agent-1")

    assert payload["skill_ids"] == ["skill-1"]
    assert payload["data"][0]["display_name"] == "Finance SOP"
    assert payload["data"][0]["file_count"] == 2
    service.list_agent_bindings.assert_called_once_with(tenant_id="tenant-1", agent_id="agent-1")


def test_patch_skill_file_operation_validates_payload_and_returns_detail(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillFilesApi()
    method = unwrap(api.patch)
    service = MagicMock()
    service.apply_draft_file_operation.return_value = _skill_detail()
    request_payload = {
        "operation": "upsert_text",
        "path": "references/policy.md",
        "content": "Policy",
    }

    with (
        app.test_request_context("/", method="PATCH"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=request_payload),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", current_user, "skill-1")

    assert payload["id"] == "skill-1"
    service.apply_draft_file_operation.assert_called_once()
    call = service.apply_draft_file_operation.call_args.kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].operation == "upsert_text"


def test_patch_skill_file_operation_returns_error_details(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillFilesApi()
    method = unwrap(api.patch)
    service = MagicMock()
    service.apply_draft_file_operation.side_effect = SkillManagementServiceError(
        "missing_skill_name",
        "SKILL.md frontmatter name is required",
        details={"path": "SKILL.md", "field": "name", "line": 2},
    )

    with (
        app.test_request_context("/", method="PATCH"),
        patch.object(
            type(console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value={"operation": "delete", "path": "SKILL.md"},
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 400
    assert payload == {
        "code": "missing_skill_name",
        "message": "SKILL.md frontmatter name is required",
        "details": {"path": "SKILL.md", "field": "name", "line": 2},
    }


def test_list_skill_tags_returns_filter_options(app: Flask) -> None:
    api = WorkspaceSkillTagsApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.list_tags.return_value = {"data": [{"tag": "finance", "count": 2}]}

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1")

    assert payload == {"data": [{"tag": "finance", "count": 2}]}
    service.list_tags.assert_called_once_with(tenant_id="tenant-1")


def test_get_skill_version_returns_version_detail(app: Flask) -> None:
    api = WorkspaceSkillVersionApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.get_version.return_value = {
        "id": "version-1",
        "skill_id": "skill-1",
        "version_number": 1,
        "version_name": "Initial finance policy",
        "publish_note": "Initial finance policy",
        "hash_code": "hash-code",
        "archive_size": 123,
        "published_by": "user-1",
        "published_by_name": "Li Wei",
        "is_latest": True,
        "created_at": 1,
        "files": [
            {
                "id": None,
                "path": "SKILL.md",
                "kind": "file",
                "storage": "text",
                "mime_type": "text/markdown",
                "content": "# Version",
                "tool_file_id": None,
                "size": 9,
                "hash": "file-hash",
            }
        ],
    }

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", "skill-1", "version-1")

    assert payload["files"][0]["content"] == "# Version"
    service.get_version.assert_called_once_with(
        tenant_id="tenant-1",
        skill_id="skill-1",
        version_id="version-1",
    )


def test_patch_skill_version_renames_version(app: Flask) -> None:
    api = WorkspaceSkillVersionApi()
    method = unwrap(api.patch)
    service = MagicMock()
    service.update_version.return_value = {
        "id": "version-1",
        "skill_id": "skill-1",
        "version_number": 1,
        "version_name": "Approval threshold",
        "publish_note": "",
        "hash_code": "hash-code",
        "archive_size": 123,
        "published_by": "user-1",
        "published_by_name": "Li Wei",
        "is_latest": True,
        "created_at": 1,
    }

    with (
        app.test_request_context("/", method="PATCH"),
        patch.object(
            type(console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value={"version_name": "Approval threshold"},
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", "skill-1", "version-1")

    assert payload["version_name"] == "Approval threshold"
    service.update_version.assert_called_once()
    assert service.update_version.call_args.kwargs["payload"].version_name == "Approval threshold"


def test_delete_skill_version_returns_new_latest(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillVersionApi()
    method = unwrap(api.delete)
    service = MagicMock()
    service.delete_version.return_value = {
        "id": "version-2",
        "deleted": True,
        "latest_published_version_id": "version-1",
    }

    with (
        app.test_request_context("/", method="DELETE"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", current_user, "skill-1", "version-2")

    assert payload == {"id": "version-2", "deleted": True, "latest_published_version_id": "version-1"}
    service.delete_version.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        skill_id="skill-1",
        version_id="version-2",
    )


def test_skill_assistant_runs_agent_app_stream(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillAssistMessageApi()
    method = unwrap(api.post)
    service = MagicMock()
    assistant_app = MagicMock()
    assistant_app.id = "assistant-app-1"
    service.get_or_create_assistant_app.return_value = (assistant_app, "<skill_draft>draft</skill_draft>")
    app_model = MagicMock()
    app_response = MagicMock()
    compact_response = MagicMock()

    with (
        app.test_request_context("/", method="POST"),
        patch.object(
            type(console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value={
                "attachments": [
                    {
                        "tool_file_id": "tool-file-1",
                        "name": "requirements.md",
                        "mime_type": "text/markdown",
                        "size": 128,
                    }
                ],
                "message": "Create an approval checklist.",
            },
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
        patch(
            "controllers.console.workspace.skills.db.session",
            return_value=MagicMock(get=MagicMock(return_value=app_model)),
        ),
        patch("controllers.console.workspace.skills.AppGenerateService.generate", return_value=app_response),
        patch("controllers.console.workspace.skills.helper.compact_generate_response", return_value=compact_response),
    ):
        response = method(api, "tenant-1", current_user, "skill-1")

    assert response is compact_response
    service.get_or_create_assistant_app.assert_called_once_with(
        tenant_id="tenant-1",
        skill_id="skill-1",
        user_id="user-1",
        attachments=[
            SkillAssistAttachmentPayload(
                tool_file_id="tool-file-1",
                name="requirements.md",
                mime_type="text/markdown",
                size=128,
            )
        ],
        message="Create an approval checklist.",
        model_payload=None,
    )

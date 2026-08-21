from __future__ import annotations

import io
from inspect import signature
from inspect import unwrap as inspect_unwrap
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.workspace.skills import (
    WorkspaceAgentSkillBindingsApi,
    WorkspaceSkillApi,
    WorkspaceSkillAssistMessageApi,
    WorkspaceSkillDuplicateApi,
    WorkspaceSkillExportApi,
    WorkspaceSkillFileContentApi,
    WorkspaceSkillFilePreviewApi,
    WorkspaceSkillFilesApi,
    WorkspaceSkillFilesCheckApi,
    WorkspaceSkillFileUploadApi,
    WorkspaceSkillImportApi,
    WorkspaceSkillPublishApi,
    WorkspaceSkillReferencesApi,
    WorkspaceSkillRestoreApi,
    WorkspaceSkillsApi,
    WorkspaceSkillTagsApi,
    WorkspaceSkillVersionApi,
    WorkspaceSkillVersionsApi,
)
from controllers.inner_api.plugin.skills import PublishedSkillPullApi
from models.account import Account
from services.skill_management_service import SkillAssistAttachmentPayload, SkillManagementServiceError


def unwrap(func):
    """Keep direct controller tests compatible with the session-injected methods."""
    unwrapped = inspect_unwrap(func)
    parameters = list(signature(unwrapped).parameters.values())
    if len(parameters) > 1 and parameters[1].name == "session":

        def invoke(*args: object, **kwargs: object):
            return unwrapped(args[0], MagicMock(), *args[1:], **kwargs)

        return invoke
    return unwrapped


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


def _skill_detail() -> dict[str, object]:
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


@pytest.mark.parametrize("side_effect", [ValueError("bad payload"), SkillManagementServiceError("skill_error", "bad")])
def test_create_skill_maps_validation_and_service_errors(
    app: Flask,
    current_user: Account,
    side_effect: Exception,
) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.create_skill.side_effect = side_effect

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"name": "finance-sop"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user)

    assert status == 400
    assert payload["code"] in {"invalid_request", "skill_error"}


def test_create_skill_rejects_extra_payload(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"unknown": "field"}),
    ):
        payload, status = method(api, "tenant-1", current_user)

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_list_skills_uses_default_pagination_when_query_omits_page_and_limit(app: Flask) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.get)
    service = MagicMock()
    list_response: dict[str, object] = {
        "data": [],
        "has_more": False,
        "limit": 20,
        "page": 1,
        "total": 0,
    }
    service.list_skills.return_value = list_response

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


def test_list_skills_passes_explicit_pagination(app: Flask) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.get)
    service = MagicMock()
    list_response: dict[str, object] = {"data": [], "has_more": False, "limit": 10, "page": 2, "total": 0}
    service.list_skills.return_value = list_response

    with (
        app.test_request_context("/?limit=10&page=2", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1")

    assert payload["limit"] == 10
    assert payload["page"] == 2
    service.list_skills.assert_called_once_with(tenant_id="tenant-1", keyword=None, page=2, limit=10, tags=[])


def test_upload_skill_file_returns_tool_file_metadata(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillFileUploadApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.upload_file.return_value = {
        "id": "tool-file-1",
        "name": "policy.md",
        "mime_type": "text/markdown",
        "size": 12,
        "hash": "hash",
    }

    with (
        app.test_request_context(
            "/",
            method="POST",
            data={"file": (io.BytesIO(b"Policy text."), "policy.md")},
            content_type="multipart/form-data",
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user)

    assert status == 201
    assert payload["id"] == "tool-file-1"
    service.upload_file.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        filename="policy.md",
        content=b"Policy text.",
        mime_type="text/markdown",
    )


def test_upload_skill_file_requires_file(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillFileUploadApi()
    method = unwrap(api.post)

    with app.test_request_context("/", method="POST", data={}, content_type="multipart/form-data"):
        payload, status = method(api, "tenant-1", current_user)

    assert status == 400
    assert payload == {"code": "no_file_uploaded", "message": "no file uploaded"}


def test_upload_skill_file_requires_filename(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillFileUploadApi()
    method = unwrap(api.post)

    with app.test_request_context(
        "/",
        method="POST",
        data={"file": (io.BytesIO(b"payload"), "")},
        content_type="multipart/form-data",
    ):
        payload, status = method(api, "tenant-1", current_user)

    assert status == 400
    assert payload == {"code": "filename_missing", "message": "filename is required"}


def test_import_skill_uploads_zip(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillImportApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.import_skill.return_value = _skill_detail()

    with (
        app.test_request_context(
            "/",
            method="POST",
            data={"file": (io.BytesIO(b"zip-bytes"), "skill.zip")},
            content_type="multipart/form-data",
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user)

    assert status == 201
    assert payload["id"] == "skill-1"
    call = service.import_skill.call_args.kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["payload"].content == b"zip-bytes"
    assert call["payload"].filename == "skill.zip"


def test_import_skill_requires_file(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillImportApi()
    method = unwrap(api.post)

    with app.test_request_context("/", method="POST", data={}, content_type="multipart/form-data"):
        payload, status = method(api, "tenant-1", current_user)

    assert status == 400
    assert payload == {"code": "invalid_request", "message": "file is required"}


def test_import_skill_maps_service_error(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillImportApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.import_skill.side_effect = SkillManagementServiceError("invalid_skill_archive", "invalid archive")

    with (
        app.test_request_context(
            "/",
            method="POST",
            data={"file": (io.BytesIO(b"bad"), "skill.zip")},
            content_type="multipart/form-data",
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user)

    assert status == 400
    assert payload == {"code": "invalid_skill_archive", "message": "invalid archive"}


def test_get_skill_detail_returns_files(app: Flask) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.get_skill.return_value = _skill_detail()

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", "skill-1")

    assert payload["id"] == "skill-1"
    assert payload["files"][0]["path"] == "SKILL.md"
    service.get_skill.assert_called_once_with(tenant_id="tenant-1", skill_id="skill-1")


def test_get_skill_detail_maps_service_error(app: Flask) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.get_skill.side_effect = SkillManagementServiceError("skill_not_found", "skill not found", status_code=404)

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", "skill-1")

    assert status == 404
    assert payload == {"code": "skill_not_found", "message": "skill not found"}


def test_update_skill_metadata_validates_payload(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.patch)
    service = MagicMock()
    service.update_metadata.return_value = {key: value for key, value in _skill_detail().items() if key != "files"}

    with (
        app.test_request_context("/", method="PATCH"),
        patch.object(
            type(console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value={"display_name": "Finance SOP", "icon": "📘", "tags": ["finance"]},
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", current_user, "skill-1")

    assert payload["display_name"] == "Finance SOP"
    call = service.update_metadata.call_args.kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].tags == ["finance"]


@pytest.mark.parametrize(
    "side_effect",
    [ValueError("bad metadata"), SkillManagementServiceError("skill_conflict", "conflict", status_code=409)],
)
def test_update_skill_metadata_maps_service_errors(
    app: Flask,
    current_user: Account,
    side_effect: Exception,
) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.patch)
    service = MagicMock()
    service.update_metadata.side_effect = side_effect

    with (
        app.test_request_context("/", method="PATCH"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"display_name": "Finance"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status in {400, 409}
    assert payload["code"] in {"invalid_request", "skill_conflict"}


def test_delete_skill_passes_confirmation_name(app: Flask) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.delete)
    service = MagicMock()
    service.delete_skill.return_value = {"id": "skill-1", "deleted": True}

    with (
        app.test_request_context("/", method="DELETE"),
        patch.object(
            type(console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value={"confirmation_name": "finance-sop"},
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", "skill-1")

    assert payload == {"id": "skill-1", "deleted": True}
    service.delete_skill.assert_called_once_with(
        tenant_id="tenant-1",
        skill_id="skill-1",
        confirmation_name="finance-sop",
    )


def test_delete_skill_maps_service_error(app: Flask) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.delete)
    service = MagicMock()
    service.delete_skill.side_effect = SkillManagementServiceError(
        "skill_referenced",
        "skill is referenced",
        status_code=409,
    )

    with (
        app.test_request_context("/", method="DELETE"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", "skill-1")

    assert status == 409
    assert payload == {"code": "skill_referenced", "message": "skill is referenced"}


def test_duplicate_skill_returns_new_detail(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillDuplicateApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.duplicate_skill.return_value = _skill_detail()

    with (
        app.test_request_context("/", method="POST"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 201
    assert payload["id"] == "skill-1"
    service.duplicate_skill.assert_called_once_with(tenant_id="tenant-1", user_id="user-1", skill_id="skill-1")


def test_duplicate_skill_maps_service_error(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillDuplicateApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.duplicate_skill.side_effect = SkillManagementServiceError(
        "skill_not_found",
        "skill not found",
        status_code=404,
    )

    with (
        app.test_request_context("/", method="POST"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 404
    assert payload == {"code": "skill_not_found", "message": "skill not found"}


def test_export_skill_returns_archive_response(app: Flask) -> None:
    api = WorkspaceSkillExportApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.pull_published_archive.return_value = MagicMock(
        payload=b"zip-bytes",
        mime_type="application/zip",
        filename="finance-sop.zip",
    )

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        response = method(api, "tenant-1", "skill-1")

    assert response.status_code == 200
    assert response.mimetype == "application/zip"
    assert response.headers["Content-Disposition"].startswith("attachment;")
    response.direct_passthrough = False
    assert response.get_data() == b"zip-bytes"
    service.pull_published_archive.assert_called_once_with(tenant_id="tenant-1", skill_id="skill-1")


def test_export_skill_maps_service_error(app: Flask) -> None:
    api = WorkspaceSkillExportApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.pull_published_archive.side_effect = SkillManagementServiceError(
        "skill_not_published",
        "skill not published",
        status_code=409,
    )

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", "skill-1")

    assert status == 409
    assert payload == {"code": "skill_not_published", "message": "skill not published"}


def test_inner_api_pulls_published_skill_archive(app: Flask) -> None:
    api = PublishedSkillPullApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.pull_published_archive.return_value = MagicMock(
        payload=b"zip-bytes",
        mime_type="application/zip",
        filename="finance-sop.zip",
    )

    with (
        app.test_request_context("/?tenant_id=tenant-1", method="GET"),
        patch("controllers.inner_api.plugin.skills.SkillManagementService", return_value=service),
    ):
        response = method(api, "skill-1")

    assert response.status_code == 200
    assert response.mimetype == "application/zip"
    response.direct_passthrough = False
    assert response.get_data() == b"zip-bytes"
    service.pull_published_archive.assert_called_once_with(tenant_id="tenant-1", skill_id="skill-1")


def test_inner_api_pull_maps_missing_tenant_to_invalid_request(app: Flask) -> None:
    api = PublishedSkillPullApi()
    method = unwrap(api.get)

    with app.test_request_context("/", method="GET"):
        payload, status = method(api, "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


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


def test_check_skill_files_validates_payload_and_returns_results(app: Flask) -> None:
    api = WorkspaceSkillFilesCheckApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.check_draft_files.return_value = {
        "data": {
            "policy.md": {
                "path": "references/policy.md",
                "filename": "policy.md",
                "extension": ".md",
                "mime_type": "text/markdown",
                "size": 12,
                "errors": list[dict[str, str]](),
            }
        },
    }

    with (
        app.test_request_context("/", method="POST"),
        patch.object(
            type(console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value={"files": [{"filename": "policy.md", "path": "references/policy.md", "size": 12}]},
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", "skill-1")

    assert payload["data"]["policy.md"]["path"] == "references/policy.md"
    assert payload["data"]["policy.md"]["errors"] == []
    service.check_draft_files.assert_called_once()
    call = service.check_draft_files.call_args.kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].files[0].filename == "policy.md"


def test_replace_skill_draft_tree_validates_payload_and_returns_detail(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillFilesApi()
    method = unwrap(api.put)
    service = MagicMock()
    service.replace_draft_tree.return_value = _skill_detail()

    with (
        app.test_request_context("/", method="PUT"),
        patch.object(
            type(console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value={"files": [{"path": "SKILL.md", "content": "# Body"}]},
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", current_user, "skill-1")

    assert payload["id"] == "skill-1"
    call = service.replace_draft_tree.call_args.kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].files[0].path == "SKILL.md"


def test_preview_skill_file_validates_query(app: Flask) -> None:
    api = WorkspaceSkillFilePreviewApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.preview_file.return_value = {
        "path": "SKILL.md",
        "mime_type": "text/markdown",
        "content": "# Body",
        "size": 6,
        "hash": "hash",
    }

    with (
        app.test_request_context("/?path=SKILL.md&version_id=version-1", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", "skill-1")

    assert payload["content"] == "# Body"
    service.preview_file.assert_called_once_with(
        tenant_id="tenant-1",
        skill_id="skill-1",
        path="SKILL.md",
        version_id="version-1",
    )


def test_pull_skill_file_content_returns_download(app: Flask) -> None:
    api = WorkspaceSkillFileContentApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.pull_file.return_value = MagicMock(
        payload=b"# Body",
        mime_type="text/markdown",
        filename="SKILL.md",
    )

    with (
        app.test_request_context("/?path=SKILL.md&download=1", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        response = method(api, "tenant-1", "skill-1")

    assert response.status_code == 200
    assert response.mimetype == "text/markdown"
    assert response.headers["Content-Disposition"].startswith("attachment;")
    response.direct_passthrough = False
    assert response.get_data() == b"# Body"
    service.pull_file.assert_called_once_with(
        tenant_id="tenant-1",
        skill_id="skill-1",
        path="SKILL.md",
        version_id=None,
    )


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


def test_publish_skill_validates_payload(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillPublishApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.publish_skill.return_value = {
        "id": "version-1",
        "skill_id": "skill-1",
        "version_number": 1,
        "version_name": "Initial",
        "publish_note": "Initial",
        "hash_code": "hash-code",
        "archive_size": 123,
        "published_by": "user-1",
        "published_by_name": "Li Wei",
        "is_latest": True,
        "created_at": 1,
    }

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"publish_note": "Initial"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", current_user, "skill-1")

    assert payload["id"] == "version-1"
    call = service.publish_skill.call_args.kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].publish_note == "Initial"


def test_restore_skill_version_validates_payload(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillRestoreApi()
    method = unwrap(api.post)
    service = MagicMock()
    empty_tags: list[object] = []
    empty_files: list[object] = []
    restored_skill: dict[str, object] = {
        "id": "skill-1",
        "name": "finance-sop",
        "display_name": "Finance SOP",
        "icon": "📄",
        "description": "Finance procedures",
        "tags": empty_tags,
        "name_manually_edited": False,
        "visibility": "workspace",
        "latest_published_version_id": "version-1",
        "latest_published_version_number": 1,
        "latest_published_at": 1,
        "reference_count": 0,
        "created_by": "user-1",
        "created_by_name": "Li Wei",
        "updated_by": "user-1",
        "updated_by_name": "Li Wei",
        "created_at": 1,
        "updated_at": 2,
        "files": empty_files,
    }
    service.restore_version.return_value = restored_skill

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"version_id": "version-1"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", current_user, "skill-1")

    assert payload["latest_published_version_id"] == "version-1"
    call = service.restore_version.call_args.kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].version_id == "version-1"


def test_list_skill_references_returns_reference_data(app: Flask) -> None:
    api = WorkspaceSkillReferencesApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.list_skill_references.return_value = {
        "data": [
            {
                "type": "agent",
                "agent_id": "agent-1",
                "name": "Agent",
                "display_name": "Agent",
            }
        ],
    }

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", "skill-1")

    assert payload["data"][0]["agent_id"] == "agent-1"
    service.list_skill_references.assert_called_once_with(tenant_id="tenant-1", skill_id="skill-1")


def test_list_skill_versions_returns_version_page(app: Flask) -> None:
    api = WorkspaceSkillVersionsApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.list_versions.return_value = {
        "data": [
            {
                "id": "version-1",
                "skill_id": "skill-1",
                "version_number": 1,
                "version_name": "Initial",
                "publish_note": "Initial",
                "hash_code": "hash-code",
                "archive_size": 123,
                "published_by": "user-1",
                "published_by_name": "Li Wei",
                "is_latest": True,
                "created_at": 1,
            }
        ],
    }

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", "skill-1")

    assert payload["data"][0]["id"] == "version-1"
    service.list_versions.assert_called_once_with(tenant_id="tenant-1", skill_id="skill-1")


def test_get_skill_version_returns_version_detail(app: Flask) -> None:
    api = WorkspaceSkillVersionApi()
    method = unwrap(api.get)
    service = MagicMock()
    version_response: dict[str, object] = {
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
    service.get_version.return_value = version_response

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
    action_stream = MagicMock()
    service.create_assistant_action_stream.return_value = action_stream
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
            "controllers.console.workspace.skills.helper.compact_generate_response",
            return_value=compact_response,
        ) as compact_generate_response,
    ):
        response = method(api, "tenant-1", current_user, "skill-1")

    assert response is compact_response
    service.create_assistant_action_stream.assert_called_once_with(
        tenant_id="tenant-1",
        skill_id="skill-1",
        user_id="user-1",
        message="Create an approval checklist.",
        attachments=[
            SkillAssistAttachmentPayload(
                tool_file_id="tool-file-1",
                name="requirements.md",
                mime_type="text/markdown",
                size=128,
            )
        ],
        history=[],
        model_payload=None,
        target_path=None,
    )
    compact_generate_response.assert_called_once_with(action_stream)


@pytest.mark.parametrize("payload", [{}, {"message": "x", "unknown": True}])
def test_skill_assistant_rejects_invalid_payload(
    app: Flask,
    current_user: Account,
    payload: dict[str, object],
) -> None:
    api = WorkspaceSkillAssistMessageApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
    ):
        response_body, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 400
    assert response_body["code"] == "invalid_request"


def test_skill_assistant_maps_service_error(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillAssistMessageApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.create_assistant_action_stream.side_effect = SkillManagementServiceError(
        "model_provider_not_configured",
        "model provider not configured",
    )

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"message": "help"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 400
    assert payload == {"code": "model_provider_not_configured", "message": "model provider not configured"}


@pytest.mark.parametrize(
    ("method_name", "payload"),
    [
        ("patch", {"operation": "upsert_text", "path": "SKILL.md", "content": "x"}),
        ("put", {"files": [{"path": "SKILL.md", "content": "# Body"}]}),
    ],
)
def test_skill_file_write_methods_map_conflicts(
    app: Flask,
    current_user: Account,
    method_name: str,
    payload: dict[str, object],
) -> None:
    api = WorkspaceSkillFilesApi()
    service = MagicMock()
    conflict = SkillManagementServiceError(
        "skill_conflict",
        "skill has been modified by another user",
        status_code=409,
    )
    if method_name == "patch":
        method = unwrap(api.patch)
        service.apply_draft_file_operation.side_effect = conflict
    else:
        method = unwrap(api.put)
        service.replace_draft_tree.side_effect = conflict

    with (
        app.test_request_context("/", method=method_name.upper()),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        response_body, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 409
    assert response_body["code"] == "skill_conflict"


def test_replace_skill_draft_tree_maps_value_error(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillFilesApi()
    method = unwrap(api.put)
    service = MagicMock()
    service.replace_draft_tree.side_effect = ValueError("bad path")

    with (
        app.test_request_context("/", method="PUT"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"files": []}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 400
    assert payload == {"code": "invalid_request", "message": "bad path"}


@pytest.mark.parametrize("query_string", ["", "?path=../secret.md"])
def test_preview_skill_file_rejects_invalid_query(app: Flask, query_string: str) -> None:
    api = WorkspaceSkillFilePreviewApi()
    method = unwrap(api.get)

    with app.test_request_context(f"/{query_string}", method="GET"):
        payload, status = method(api, "tenant-1", "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_preview_skill_file_maps_service_error(app: Flask) -> None:
    api = WorkspaceSkillFilePreviewApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.preview_file.side_effect = SkillManagementServiceError("file_not_found", "file not found", status_code=404)

    with (
        app.test_request_context("/?path=SKILL.md", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", "skill-1")

    assert status == 404
    assert payload == {"code": "file_not_found", "message": "file not found"}


@pytest.mark.parametrize("query_string", ["", "?path=../secret.md"])
def test_pull_skill_file_content_rejects_invalid_query(app: Flask, query_string: str) -> None:
    api = WorkspaceSkillFileContentApi()
    method = unwrap(api.get)

    with app.test_request_context(f"/{query_string}", method="GET"):
        payload, status = method(api, "tenant-1", "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_pull_skill_file_content_maps_service_error(app: Flask) -> None:
    api = WorkspaceSkillFileContentApi()
    method = unwrap(api.get)
    service = MagicMock()
    service.pull_file.side_effect = SkillManagementServiceError("file_not_found", "file not found", status_code=404)

    with (
        app.test_request_context("/?path=SKILL.md", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", "skill-1")

    assert status == 404
    assert payload == {"code": "file_not_found", "message": "file not found"}


def test_publish_skill_rejects_invalid_payload(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillPublishApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"publish_note": "x" * 1025}),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_publish_skill_maps_service_error(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillPublishApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.publish_skill.side_effect = SkillManagementServiceError("missing_skill_name", "name required")

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 400
    assert payload == {"code": "missing_skill_name", "message": "name required"}


def test_restore_skill_version_rejects_invalid_payload(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillRestoreApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={}),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_restore_skill_version_maps_service_error(app: Flask, current_user: Account) -> None:
    api = WorkspaceSkillRestoreApi()
    method = unwrap(api.post)
    service = MagicMock()
    service.restore_version.side_effect = SkillManagementServiceError(
        "version_not_found",
        "version not found",
        status_code=404,
    )

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"version_id": "version-1"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, "tenant-1", current_user, "skill-1")

    assert status == 404
    assert payload == {"code": "version_not_found", "message": "version not found"}


def test_agent_skill_bindings_replaces_bound_skills(app: Flask, current_user: Account) -> None:
    api = WorkspaceAgentSkillBindingsApi()
    method = unwrap(api.put)
    service = MagicMock()
    bindings_response: dict[str, object] = {"agent_id": "agent-1", "skill_ids": ["skill-1"], "data": []}
    service.replace_agent_bindings.return_value = bindings_response

    with (
        app.test_request_context("/", method="PUT"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"skill_ids": ["skill-1"]}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, "tenant-1", current_user, "agent-1")

    assert payload["skill_ids"] == ["skill-1"]
    service.replace_agent_bindings.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        agent_id="agent-1",
        skill_ids=["skill-1"],
    )


def test_agent_skill_bindings_rejects_invalid_payload(app: Flask, current_user: Account) -> None:
    api = WorkspaceAgentSkillBindingsApi()
    method = unwrap(api.put)

    with (
        app.test_request_context("/", method="PUT"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"skill_ids": "skill-1"}),
    ):
        payload, status = method(api, "tenant-1", current_user, "agent-1")

    assert status == 400
    assert payload["code"] == "invalid_request"

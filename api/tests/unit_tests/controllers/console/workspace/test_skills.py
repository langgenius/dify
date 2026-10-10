from __future__ import annotations

import io
from collections.abc import Callable
from dataclasses import dataclass, field
from inspect import signature
from inspect import unwrap as inspect_unwrap
from typing import cast
from unittest.mock import PropertyMock, patch

import pytest
from flask import Flask, Response
from sqlalchemy.orm import Session

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
from machinery.context import RequestContext
from services.skill_management_service import (
    DraftSkillArchive,
    PublishedSkillArchive,
    SkillAssistAttachmentPayload,
    SkillFileContent,
    SkillManagementService,
    SkillManagementServiceError,
)


@dataclass(frozen=True)
class RecordedCall:
    args: tuple[object, ...]
    kwargs: dict[str, object]


@dataclass
class CallRecorder:
    result: object = None
    error: Exception | None = None
    calls: list[RecordedCall] = field(default_factory=list)

    def __call__(self, *args: object, **kwargs: object) -> object:
        self.calls.append(RecordedCall(args=args, kwargs=kwargs))
        if self.error is not None:
            raise self.error
        return self.result


def _recording_service(
    method_name: str,
    *,
    result: object = None,
    error: Exception | None = None,
) -> tuple[SkillManagementService, CallRecorder]:
    service = SkillManagementService(session=Session())
    recorder = CallRecorder(result=result, error=error)
    setattr(service, method_name, recorder)
    return service, recorder


def unwrap[ReturnT](func: Callable[..., ReturnT]) -> Callable[..., ReturnT]:
    """Keep direct controller tests compatible with the session-injected methods."""
    unwrapped = cast(Callable[..., ReturnT], inspect_unwrap(func))
    parameters = list(signature(unwrapped).parameters.values())
    if len(parameters) > 1 and parameters[1].name == "session":

        def invoke(*args: object, **kwargs: object) -> ReturnT:
            with Session() as session:
                return unwrapped(args[0], session, *args[1:], **kwargs)

        return invoke
    return unwrapped


@pytest.fixture
def app() -> Flask:
    flask_app = Flask("test_workspace_skills")
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="user-1",
        active_workspace_id="tenant-1",
    )


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


def test_create_skill_validates_payload_and_returns_detail(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.post)
    service, create_skill = _recording_service("create_skill", result=_skill_detail())

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context)

    assert status == 201
    assert payload["id"] == "skill-1"
    assert payload["files"][0]["path"] == "SKILL.md"
    assert len(create_skill.calls) == 1
    assert create_skill.calls[0].kwargs["tenant_id"] == "tenant-1"
    assert create_skill.calls[0].kwargs["user_id"] == "user-1"


@pytest.mark.parametrize("side_effect", [ValueError("bad payload"), SkillManagementServiceError("skill_error", "bad")])
def test_create_skill_maps_validation_and_service_errors(
    app: Flask,
    request_context: RequestContext,
    side_effect: Exception,
) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.post)
    service, _ = _recording_service("create_skill", error=side_effect)

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"name": "finance-sop"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context)

    assert status == 400
    assert payload["code"] in {"invalid_request", "skill_error"}


def test_create_skill_rejects_extra_payload(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"unknown": "field"}),
    ):
        payload, status = method(api, request_context)

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_list_skills_uses_default_pagination_when_query_omits_page_and_limit(
    app: Flask, request_context: RequestContext
) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.get)
    service, list_skills = _recording_service("list_skills")
    list_response: dict[str, object] = {
        "data": [],
        "has_more": False,
        "limit": 20,
        "page": 1,
        "total": 0,
    }
    list_skills.result = list_response

    with (
        app.test_request_context("/?keyword=finance&tag=ops&tag=", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context)

    assert payload == {
        "data": [],
        "has_more": False,
        "limit": 20,
        "page": 1,
        "total": 0,
    }
    assert list_skills.calls == [
        RecordedCall(
            args=(),
            kwargs={"tenant_id": "tenant-1", "keyword": "finance", "page": 1, "limit": 20, "tags": ["ops"]},
        )
    ]


def test_list_skills_passes_explicit_pagination(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillsApi()
    method = unwrap(api.get)
    service, list_skills = _recording_service("list_skills")
    list_response: dict[str, object] = {"data": [], "has_more": False, "limit": 10, "page": 2, "total": 0}
    list_skills.result = list_response

    with (
        app.test_request_context("/?limit=10&page=2", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context)

    assert payload["limit"] == 10
    assert payload["page"] == 2
    assert list_skills.calls == [
        RecordedCall(
            args=(),
            kwargs={"tenant_id": "tenant-1", "keyword": None, "page": 2, "limit": 10, "tags": []},
        )
    ]


def test_upload_skill_file_returns_tool_file_metadata(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFileUploadApi()
    method = unwrap(api.post)
    service, upload_file = _recording_service(
        "upload_file",
        result={
            "id": "tool-file-1",
            "name": "policy.md",
            "mime_type": "text/markdown",
            "size": 12,
            "hash": "hash",
        },
    )

    with (
        app.test_request_context(
            "/",
            method="POST",
            data={"file": (io.BytesIO(b"Policy text."), "policy.md")},
            content_type="multipart/form-data",
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context)

    assert status == 201
    assert payload["id"] == "tool-file-1"
    assert upload_file.calls == [
        RecordedCall(
            args=(),
            kwargs={
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "filename": "policy.md",
                "content": b"Policy text.",
                "mime_type": "text/markdown",
            },
        )
    ]


def test_upload_skill_file_requires_file(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFileUploadApi()
    method = unwrap(api.post)

    with app.test_request_context("/", method="POST", data={}, content_type="multipart/form-data"):
        payload, status = method(api, request_context)

    assert status == 400
    assert payload == {"code": "no_file_uploaded", "message": "no file uploaded"}


def test_upload_skill_file_requires_filename(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFileUploadApi()
    method = unwrap(api.post)

    with app.test_request_context(
        "/",
        method="POST",
        data={"file": (io.BytesIO(b"payload"), "")},
        content_type="multipart/form-data",
    ):
        payload, status = method(api, request_context)

    assert status == 400
    assert payload == {"code": "filename_missing", "message": "filename is required"}


def test_import_skill_uploads_zip(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillImportApi()
    method = unwrap(api.post)
    service, import_skill = _recording_service("import_skill", result=_skill_detail())

    with (
        app.test_request_context(
            "/",
            method="POST",
            data={"file": (io.BytesIO(b"zip-bytes"), "skill.zip")},
            content_type="multipart/form-data",
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context)

    assert status == 201
    assert payload["id"] == "skill-1"
    call = import_skill.calls[0].kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["payload"].content == b"zip-bytes"
    assert call["payload"].filename == "skill.zip"


def test_import_skill_requires_file(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillImportApi()
    method = unwrap(api.post)

    with app.test_request_context("/", method="POST", data={}, content_type="multipart/form-data"):
        payload, status = method(api, request_context)

    assert status == 400
    assert payload == {"code": "invalid_request", "message": "file is required"}


def test_import_skill_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillImportApi()
    method = unwrap(api.post)
    service, _ = _recording_service(
        "import_skill", error=SkillManagementServiceError("invalid_skill_archive", "invalid archive")
    )

    with (
        app.test_request_context(
            "/",
            method="POST",
            data={"file": (io.BytesIO(b"bad"), "skill.zip")},
            content_type="multipart/form-data",
        ),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context)

    assert status == 400
    assert payload == {"code": "invalid_skill_archive", "message": "invalid archive"}


def test_get_skill_detail_returns_files(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.get)
    service, get_skill = _recording_service("get_skill", result=_skill_detail())

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "skill-1")

    assert payload["id"] == "skill-1"
    assert payload["files"][0]["path"] == "SKILL.md"
    assert get_skill.calls == [RecordedCall(args=(), kwargs={"tenant_id": "tenant-1", "skill_id": "skill-1"})]


def test_get_skill_detail_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.get)
    service, _ = _recording_service(
        "get_skill", error=SkillManagementServiceError("skill_not_found", "skill not found", status_code=404)
    )

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 404
    assert payload == {"code": "skill_not_found", "message": "skill not found"}


def test_update_skill_metadata_validates_payload(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.patch)
    service, update_metadata = _recording_service(
        "update_metadata", result={key: value for key, value in _skill_detail().items() if key != "files"}
    )

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
        payload = method(api, request_context, "skill-1")

    assert payload["display_name"] == "Finance SOP"
    call = update_metadata.calls[0].kwargs
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
    request_context: RequestContext,
    side_effect: Exception,
) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.patch)
    service, _ = _recording_service("update_metadata", error=side_effect)

    with (
        app.test_request_context("/", method="PATCH"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"display_name": "Finance"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status in {400, 409}
    assert payload["code"] in {"invalid_request", "skill_conflict"}


def test_delete_skill_passes_confirmation_name(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.delete)
    service, delete_skill = _recording_service("delete_skill", result={"id": "skill-1", "deleted": True})

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
        payload = method(api, request_context, "skill-1")

    assert payload == {"id": "skill-1", "deleted": True}
    assert delete_skill.calls == [
        RecordedCall(
            args=(),
            kwargs={"tenant_id": "tenant-1", "skill_id": "skill-1", "confirmation_name": "finance-sop"},
        )
    ]


def test_delete_skill_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillApi()
    method = unwrap(api.delete)
    service, _ = _recording_service(
        "delete_skill",
        error=SkillManagementServiceError(
            "skill_referenced",
            "skill is referenced",
            status_code=409,
        ),
    )

    with (
        app.test_request_context("/", method="DELETE"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 409
    assert payload == {"code": "skill_referenced", "message": "skill is referenced"}


def test_duplicate_skill_returns_new_detail(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillDuplicateApi()
    method = unwrap(api.post)
    service, duplicate_skill = _recording_service("duplicate_skill", result=_skill_detail())

    with (
        app.test_request_context("/", method="POST"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 201
    assert payload["id"] == "skill-1"
    assert duplicate_skill.calls == [
        RecordedCall(args=(), kwargs={"tenant_id": "tenant-1", "user_id": "user-1", "skill_id": "skill-1"})
    ]


def test_duplicate_skill_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillDuplicateApi()
    method = unwrap(api.post)
    service, _ = _recording_service(
        "duplicate_skill",
        error=SkillManagementServiceError(
            "skill_not_found",
            "skill not found",
            status_code=404,
        ),
    )

    with (
        app.test_request_context("/", method="POST"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 404
    assert payload == {"code": "skill_not_found", "message": "skill not found"}


def test_export_skill_returns_archive_response(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillExportApi()
    method = unwrap(api.get)
    service, export_draft_archive = _recording_service(
        "export_draft_archive",
        result=DraftSkillArchive(
            payload=b"zip-bytes",
            mime_type="application/zip",
            filename="finance-sop.zip",
        ),
    )

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        response = method(api, request_context, "skill-1")

    assert response.status_code == 200
    assert response.mimetype == "application/zip"
    assert response.headers["Content-Disposition"].startswith("attachment;")
    response.direct_passthrough = False
    assert response.get_data() == b"zip-bytes"
    assert export_draft_archive.calls == [
        RecordedCall(args=(), kwargs={"tenant_id": "tenant-1", "skill_id": "skill-1"})
    ]


def test_export_skill_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillExportApi()
    method = unwrap(api.get)
    service, _ = _recording_service(
        "export_draft_archive",
        error=SkillManagementServiceError(
            "skill_not_found",
            "skill not found",
            status_code=404,
        ),
    )

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 404
    assert payload == {"code": "skill_not_found", "message": "skill not found"}


def test_inner_api_pulls_published_skill_archive(app: Flask) -> None:
    api = PublishedSkillPullApi()
    method = unwrap(api.get)
    service, pull_published_archive = _recording_service(
        "pull_published_archive",
        result=PublishedSkillArchive(
            payload=b"zip-bytes",
            mime_type="application/zip",
            filename="finance-sop.zip",
        ),
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
    assert pull_published_archive.calls == [
        RecordedCall(args=(), kwargs={"tenant_id": "tenant-1", "skill_id": "skill-1"})
    ]


def test_inner_api_pull_maps_missing_tenant_to_invalid_request(app: Flask) -> None:
    api = PublishedSkillPullApi()
    method = unwrap(api.get)

    with app.test_request_context("/", method="GET"):
        payload, status = method(api, "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_get_agent_skill_bindings_returns_card_data(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceAgentSkillBindingsApi()
    method = unwrap(api.get)
    service, list_agent_bindings = _recording_service(
        "list_agent_bindings",
        result={
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
        },
    )

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "agent-1")

    assert payload["skill_ids"] == ["skill-1"]
    assert payload["data"][0]["display_name"] == "Finance SOP"
    assert payload["data"][0]["file_count"] == 2
    assert list_agent_bindings.calls == [RecordedCall(args=(), kwargs={"tenant_id": "tenant-1", "agent_id": "agent-1"})]


def test_patch_skill_file_operation_validates_payload_and_returns_detail(
    app: Flask, request_context: RequestContext
) -> None:
    api = WorkspaceSkillFilesApi()
    method = unwrap(api.patch)
    service, apply_draft_file_operation = _recording_service("apply_draft_file_operation", result=_skill_detail())
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
        payload = method(api, request_context, "skill-1")

    assert payload["id"] == "skill-1"
    assert len(apply_draft_file_operation.calls) == 1
    call = apply_draft_file_operation.calls[0].kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].operation == "upsert_text"


def test_patch_skill_file_operation_returns_error_details(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFilesApi()
    method = unwrap(api.patch)
    service, _ = _recording_service(
        "apply_draft_file_operation",
        error=SkillManagementServiceError(
            "missing_skill_name",
            "SKILL.md frontmatter name is required",
            details={"path": "SKILL.md", "field": "name", "line": 2},
        ),
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
        payload, status = method(api, request_context, "skill-1")

    assert status == 400
    assert payload == {
        "code": "missing_skill_name",
        "message": "SKILL.md frontmatter name is required",
        "details": {"path": "SKILL.md", "field": "name", "line": 2},
    }


def test_check_skill_files_validates_payload_and_returns_results(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFilesCheckApi()
    method = unwrap(api.post)
    service, check_draft_files = _recording_service(
        "check_draft_files",
        result={
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
        },
    )

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
        payload = method(api, request_context, "skill-1")

    assert payload["data"]["policy.md"]["path"] == "references/policy.md"
    assert payload["data"]["policy.md"]["errors"] == []
    assert len(check_draft_files.calls) == 1
    call = check_draft_files.calls[0].kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].files[0].filename == "policy.md"


def test_replace_skill_draft_tree_validates_payload_and_returns_detail(
    app: Flask, request_context: RequestContext
) -> None:
    api = WorkspaceSkillFilesApi()
    method = unwrap(api.put)
    service, replace_draft_tree = _recording_service("replace_draft_tree", result=_skill_detail())

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
        payload = method(api, request_context, "skill-1")

    assert payload["id"] == "skill-1"
    call = replace_draft_tree.calls[0].kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].files[0].path == "SKILL.md"


def test_preview_skill_file_validates_query(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFilePreviewApi()
    method = unwrap(api.get)
    service, preview_file = _recording_service(
        "preview_file",
        result={
            "path": "SKILL.md",
            "mime_type": "text/markdown",
            "content": "# Body",
            "size": 6,
            "hash": "hash",
        },
    )

    with (
        app.test_request_context("/?path=SKILL.md&version_id=version-1", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "skill-1")

    assert payload["content"] == "# Body"
    assert preview_file.calls == [
        RecordedCall(
            args=(),
            kwargs={
                "tenant_id": "tenant-1",
                "skill_id": "skill-1",
                "path": "SKILL.md",
                "version_id": "version-1",
            },
        )
    ]


def test_pull_skill_file_content_returns_download(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFileContentApi()
    method = unwrap(api.get)
    service, pull_file = _recording_service(
        "pull_file",
        result=SkillFileContent(
            filename="SKILL.md",
            path="SKILL.md",
            mime_type="text/markdown",
            payload=b"# Body",
            content="# Body",
            size=6,
            hash="hash",
        ),
    )

    with (
        app.test_request_context("/?path=SKILL.md&download=1", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        response = method(api, request_context, "skill-1")

    assert response.status_code == 200
    assert response.mimetype == "text/markdown"
    assert response.headers["Content-Disposition"].startswith("attachment;")
    response.direct_passthrough = False
    assert response.get_data() == b"# Body"
    assert pull_file.calls == [
        RecordedCall(
            args=(),
            kwargs={"tenant_id": "tenant-1", "skill_id": "skill-1", "path": "SKILL.md", "version_id": None},
        )
    ]


def test_list_skill_tags_returns_filter_options(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillTagsApi()
    method = unwrap(api.get)
    service, list_tags = _recording_service("list_tags", result={"data": [{"tag": "finance", "count": 2}]})

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context)

    assert payload == {"data": [{"tag": "finance", "count": 2}]}
    assert list_tags.calls == [RecordedCall(args=(), kwargs={"tenant_id": "tenant-1"})]


def test_publish_skill_validates_payload(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillPublishApi()
    method = unwrap(api.post)
    service, publish_skill = _recording_service(
        "publish_skill",
        result={
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
        },
    )

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"publish_note": "Initial"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "skill-1")

    assert payload["id"] == "version-1"
    call = publish_skill.calls[0].kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].publish_note == "Initial"


def test_restore_skill_version_validates_payload(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillRestoreApi()
    method = unwrap(api.post)
    service, restore_version = _recording_service("restore_version")
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
    restore_version.result = restored_skill

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"version_id": "version-1"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "skill-1")

    assert payload["latest_published_version_id"] == "version-1"
    call = restore_version.calls[0].kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["user_id"] == "user-1"
    assert call["skill_id"] == "skill-1"
    assert call["payload"].version_id == "version-1"


def test_list_skill_references_returns_reference_data(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillReferencesApi()
    method = unwrap(api.get)
    service, list_skill_references = _recording_service(
        "list_skill_references",
        result={
            "data": [
                {
                    "type": "agent",
                    "agent_id": "agent-1",
                    "name": "Agent",
                    "display_name": "Agent",
                }
            ],
        },
    )

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "skill-1")

    assert payload["data"][0]["agent_id"] == "agent-1"
    assert list_skill_references.calls == [
        RecordedCall(args=(), kwargs={"tenant_id": "tenant-1", "skill_id": "skill-1"})
    ]


def test_list_skill_versions_returns_version_page(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillVersionsApi()
    method = unwrap(api.get)
    service, list_versions = _recording_service(
        "list_versions",
        result={
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
        },
    )

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "skill-1")

    assert payload["data"][0]["id"] == "version-1"
    assert list_versions.calls == [RecordedCall(args=(), kwargs={"tenant_id": "tenant-1", "skill_id": "skill-1"})]


def test_get_skill_version_returns_version_detail(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillVersionApi()
    method = unwrap(api.get)
    service, get_version = _recording_service("get_version")
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
    get_version.result = version_response

    with (
        app.test_request_context("/", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "skill-1", "version-1")

    assert payload["files"][0]["content"] == "# Version"
    assert get_version.calls == [
        RecordedCall(args=(), kwargs={"tenant_id": "tenant-1", "skill_id": "skill-1", "version_id": "version-1"})
    ]


def test_patch_skill_version_renames_version(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillVersionApi()
    method = unwrap(api.patch)
    service, update_version = _recording_service(
        "update_version",
        result={
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
        },
    )

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
        payload = method(api, request_context, "skill-1", "version-1")

    assert payload["version_name"] == "Approval threshold"
    assert len(update_version.calls) == 1
    assert update_version.calls[0].kwargs["payload"].version_name == "Approval threshold"


def test_delete_skill_version_returns_new_latest(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillVersionApi()
    method = unwrap(api.delete)
    service, delete_version = _recording_service(
        "delete_version",
        result={
            "id": "version-2",
            "deleted": True,
            "latest_published_version_id": "version-1",
        },
    )

    with (
        app.test_request_context("/", method="DELETE"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "skill-1", "version-2")

    assert payload == {"id": "version-2", "deleted": True, "latest_published_version_id": "version-1"}
    assert delete_version.calls == [
        RecordedCall(
            args=(),
            kwargs={
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "skill_id": "skill-1",
                "version_id": "version-2",
            },
        )
    ]


def test_skill_assistant_runs_agent_app_stream(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillAssistMessageApi()
    method = unwrap(api.post)
    action_stream = iter([{"event": "done"}])
    service, create_assistant_action_stream = _recording_service("create_assistant_action_stream", result=action_stream)
    compact_response = Response("compact")
    compact_generate_response = CallRecorder(result=compact_response)

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
        patch("controllers.console.workspace.skills.helper.compact_generate_response", new=compact_generate_response),
    ):
        response = method(api, request_context, "skill-1")

    assert response is compact_response
    assert create_assistant_action_stream.calls == [
        RecordedCall(
            args=(),
            kwargs={
                "tenant_id": "tenant-1",
                "skill_id": "skill-1",
                "user_id": "user-1",
                "message": "Create an approval checklist.",
                "attachments": [
                    SkillAssistAttachmentPayload(
                        tool_file_id="tool-file-1",
                        name="requirements.md",
                        mime_type="text/markdown",
                        size=128,
                    )
                ],
                "history": [],
                "model_payload": None,
                "target_path": None,
            },
        )
    ]
    assert compact_generate_response.calls == [RecordedCall(args=(action_stream,), kwargs={})]


@pytest.mark.parametrize("payload", [{}, {"message": "x", "unknown": True}])
def test_skill_assistant_rejects_invalid_payload(
    app: Flask,
    request_context: RequestContext,
    payload: dict[str, object],
) -> None:
    api = WorkspaceSkillAssistMessageApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
    ):
        response_body, status = method(api, request_context, "skill-1")

    assert status == 400
    assert response_body["code"] == "invalid_request"


def test_skill_assistant_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillAssistMessageApi()
    method = unwrap(api.post)
    service, _ = _recording_service(
        "create_assistant_action_stream",
        error=SkillManagementServiceError(
            "model_provider_not_configured",
            "model provider not configured",
        ),
    )

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"message": "help"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

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
    request_context: RequestContext,
    method_name: str,
    payload: dict[str, object],
) -> None:
    api = WorkspaceSkillFilesApi()
    conflict = SkillManagementServiceError(
        "skill_conflict",
        "skill has been modified by another user",
        status_code=409,
    )
    if method_name == "patch":
        method = unwrap(api.patch)
        service, _ = _recording_service("apply_draft_file_operation", error=conflict)
    else:
        method = unwrap(api.put)
        service, _ = _recording_service("replace_draft_tree", error=conflict)

    with (
        app.test_request_context("/", method=method_name.upper()),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        response_body, status = method(api, request_context, "skill-1")

    assert status == 409
    assert response_body["code"] == "skill_conflict"


def test_replace_skill_draft_tree_maps_value_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFilesApi()
    method = unwrap(api.put)
    service, _ = _recording_service("replace_draft_tree", error=ValueError("bad path"))

    with (
        app.test_request_context("/", method="PUT"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"files": []}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 400
    assert payload == {"code": "invalid_request", "message": "bad path"}


@pytest.mark.parametrize("query_string", ["", "?path=../secret.md"])
def test_preview_skill_file_rejects_invalid_query(
    app: Flask, request_context: RequestContext, query_string: str
) -> None:
    api = WorkspaceSkillFilePreviewApi()
    method = unwrap(api.get)

    with app.test_request_context(f"/{query_string}", method="GET"):
        payload, status = method(api, request_context, "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_preview_skill_file_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFilePreviewApi()
    method = unwrap(api.get)
    service, _ = _recording_service(
        "preview_file", error=SkillManagementServiceError("file_not_found", "file not found", status_code=404)
    )

    with (
        app.test_request_context("/?path=SKILL.md", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 404
    assert payload == {"code": "file_not_found", "message": "file not found"}


@pytest.mark.parametrize("query_string", ["", "?path=../secret.md"])
def test_pull_skill_file_content_rejects_invalid_query(
    app: Flask, request_context: RequestContext, query_string: str
) -> None:
    api = WorkspaceSkillFileContentApi()
    method = unwrap(api.get)

    with app.test_request_context(f"/{query_string}", method="GET"):
        payload, status = method(api, request_context, "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_pull_skill_file_content_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillFileContentApi()
    method = unwrap(api.get)
    service, _ = _recording_service(
        "pull_file", error=SkillManagementServiceError("file_not_found", "file not found", status_code=404)
    )

    with (
        app.test_request_context("/?path=SKILL.md", method="GET"),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 404
    assert payload == {"code": "file_not_found", "message": "file not found"}


def test_publish_skill_rejects_invalid_payload(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillPublishApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"publish_note": "x" * 1025}),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_publish_skill_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillPublishApi()
    method = unwrap(api.post)
    service, _ = _recording_service(
        "publish_skill", error=SkillManagementServiceError("missing_skill_name", "name required")
    )

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 400
    assert payload == {"code": "missing_skill_name", "message": "name required"}


def test_restore_skill_version_rejects_invalid_payload(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillRestoreApi()
    method = unwrap(api.post)

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={}),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 400
    assert payload["code"] == "invalid_request"


def test_restore_skill_version_maps_service_error(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceSkillRestoreApi()
    method = unwrap(api.post)
    service, _ = _recording_service(
        "restore_version",
        error=SkillManagementServiceError(
            "version_not_found",
            "version not found",
            status_code=404,
        ),
    )

    with (
        app.test_request_context("/", method="POST"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"version_id": "version-1"}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload, status = method(api, request_context, "skill-1")

    assert status == 404
    assert payload == {"code": "version_not_found", "message": "version not found"}


def test_agent_skill_bindings_replaces_bound_skills(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceAgentSkillBindingsApi()
    method = unwrap(api.put)
    service, replace_agent_bindings = _recording_service("replace_agent_bindings")
    bindings_response: dict[str, object] = {"agent_id": "agent-1", "skill_ids": ["skill-1"], "data": []}
    replace_agent_bindings.result = bindings_response

    with (
        app.test_request_context("/", method="PUT"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"skill_ids": ["skill-1"]}),
        patch("controllers.console.workspace.skills.SkillManagementService", return_value=service),
    ):
        payload = method(api, request_context, "agent-1")

    assert payload["skill_ids"] == ["skill-1"]
    assert replace_agent_bindings.calls == [
        RecordedCall(
            args=(),
            kwargs={
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "agent_id": "agent-1",
                "skill_ids": ["skill-1"],
            },
        )
    ]


def test_agent_skill_bindings_rejects_invalid_payload(app: Flask, request_context: RequestContext) -> None:
    api = WorkspaceAgentSkillBindingsApi()
    method = unwrap(api.put)

    with (
        app.test_request_context("/", method="PUT"),
        patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value={"skill_ids": "skill-1"}),
    ):
        payload, status = method(api, request_context, "agent-1")

    assert status == 400
    assert payload["code"] == "invalid_request"

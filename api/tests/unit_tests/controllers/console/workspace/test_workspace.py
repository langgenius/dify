"""Controller contracts: parsing, delegation, serialization and HTTP errors."""

from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from inspect import unwrap
from io import BytesIO
from unittest.mock import Mock

import pytest
from flask import Flask
from flask_restx import Resource
from werkzeug.exceptions import NotFound

from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.console import console_ns
from controllers.console.error import AccountNotLinkTenantError
from controllers.console.workspace import workspace as controller
from controllers.console.workspace.error import CurrentWorkspaceArchivedError
from enums import CloudPlan
from machinery.context import RequestContext
from services.errors import file as file_errors
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError, WorkspaceNotLinkedError
from services.workspace.contracts import (
    WorkspaceCustomConfig,
    WorkspaceCustomConfigChanges,
    WorkspacePage,
    WorkspacePermission,
    WorkspaceSnapshot,
    WorkspaceSummary,
)
from services.workspace.provisioning_service import WorkspaceProvisioningService
from services.workspace.service import WorkspaceQueryService, WorkspaceService

CONTEXT = RequestContext("request-1", "trace-1", "account-1", "workspace-1")
NOW = datetime(2026, 1, 1)


@dataclass
class WorkspaceMocks:
    management: Mock
    queries: Mock
    provisioning: Mock


@dataclass
class Services:
    workspaces: WorkspaceMocks


@pytest.fixture
def workspaces(monkeypatch: pytest.MonkeyPatch) -> WorkspaceMocks:
    services = WorkspaceMocks(
        management=Mock(spec=WorkspaceService),
        queries=Mock(spec=WorkspaceQueryService),
        provisioning=Mock(spec=WorkspaceProvisioningService),
    )
    monkeypatch.setattr(controller, "application_services", lambda: Services(services))
    return services


def test_workspace_list_serialization(workspaces: WorkspaceMocks) -> None:
    workspaces.queries.list_for_account.return_value = (
        WorkspaceSummary("workspace-1", "Test", "team", "normal", NOW, None, True),
    )
    body, status = unwrap(controller.TenantListApi.get)(controller.TenantListApi(), CONTEXT)
    assert status == HTTPStatus.OK
    assert body["workspaces"] == [
        {
            "id": "workspace-1",
            "name": "Test",
            "plan": "team",
            "status": "normal",
            "created_at": int(NOW.timestamp()),
            "last_opened_at": None,
            "current": True,
        }
    ]
    workspaces.queries.list_for_account.assert_called_once_with(CONTEXT)


def test_admin_pagination(app: Flask, workspaces: WorkspaceMocks) -> None:
    workspaces.management.list_all.return_value = WorkspacePage(
        (WorkspaceSnapshot("w1", "Test", "archive", NOW),), 5, 2, 2, True
    )
    with app.test_request_context("/all-workspaces?page=2&limit=2"):
        body, status = unwrap(controller.WorkspaceListApi.get)(controller.WorkspaceListApi())
    assert status == 200
    assert body == {
        "data": [{"id": "w1", "name": "Test", "status": "archive", "created_at": int(NOW.timestamp())}],
        "total": 5,
        "page": 2,
        "limit": 2,
        "has_more": True,
    }
    workspaces.management.list_all.assert_called_once_with(page=2, limit=2)


def test_summary(workspaces: WorkspaceMocks) -> None:
    workspaces.management.current_summary.return_value = {
        "id": "w1",
        "name": "Test",
        "role": "owner",
        "plan": CloudPlan.TEAM,
        "credits": -1,
    }
    body, status = unwrap(controller.CurrentWorkspaceSummaryApi.get)(controller.CurrentWorkspaceSummaryApi(), CONTEXT)
    assert status == 200
    assert body["credits"] == -1
    workspaces.management.current_summary.assert_called_once_with(CONTEXT)


@pytest.mark.parametrize(
    ("error", "http_error"),
    [(WorkspaceArchivedError(), CurrentWorkspaceArchivedError), (WorkspaceNotFoundError(), NotFound)],
)
def test_summary_errors(workspaces: WorkspaceMocks, error: Exception, http_error: type[Exception]) -> None:
    workspaces.management.current_summary.side_effect = error
    with pytest.raises(http_error):
        unwrap(controller.CurrentWorkspaceSummaryApi.get)(controller.CurrentWorkspaceSummaryApi(), CONTEXT)


def test_switch_and_rename(app: Flask, workspaces: WorkspaceMocks) -> None:
    workspaces.management.switch.return_value = {"id": "target", "name": "Switched"}
    workspaces.management.rename.return_value = {"id": "workspace-1", "name": "Renamed"}
    with app.test_request_context(json={"tenant_id": "target"}):
        body = unwrap(controller.SwitchWorkspaceApi.post)(controller.SwitchWorkspaceApi(), CONTEXT)
    assert body["new_tenant"]["id"] == "target"
    workspaces.management.switch.assert_called_once_with(CONTEXT, "target")
    with app.test_request_context(json={"name": "Renamed"}):
        body = unwrap(controller.WorkspaceInfoApi.post)(controller.WorkspaceInfoApi(), CONTEXT)
    assert body["tenant"]["name"] == "Renamed"
    workspaces.management.rename.assert_called_once_with(CONTEXT, "Renamed")


def test_switch_not_linked(app: Flask, workspaces: WorkspaceMocks) -> None:
    workspaces.management.switch.side_effect = WorkspaceNotLinkedError()
    with app.test_request_context(json={"tenant_id": "target"}), pytest.raises(AccountNotLinkTenantError):
        unwrap(controller.SwitchWorkspaceApi.post)(controller.SwitchWorkspaceApi(), CONTEXT)


def test_config_response_and_partial_update(app: Flask, workspaces: WorkspaceMocks) -> None:
    workspaces.management.custom_config.return_value = WorkspaceCustomConfig(True, "https://files/logo")
    assert unwrap(controller.CustomConfigWorkspaceApi.get)(controller.CustomConfigWorkspaceApi(), CONTEXT) == {
        "remove_webapp_brand": True,
        "replace_webapp_logo": "https://files/logo",
    }
    workspaces.management.update_custom_config.return_value = {"id": "workspace-1"}
    with app.test_request_context(json={"remove_webapp_brand": False}):
        body = unwrap(controller.CustomConfigWorkspaceApi.post)(controller.CustomConfigWorkspaceApi(), CONTEXT)
    assert body["result"] == "success"
    workspaces.management.update_custom_config.assert_called_once_with(
        CONTEXT, WorkspaceCustomConfigChanges(False, None)
    )


@pytest.mark.parametrize(
    ("resource", "method", "payload", "service_method"),
    [
        (controller.CustomConfigWorkspaceApi, "get", {}, "custom_config"),
        (controller.CustomConfigWorkspaceApi, "post", {}, "update_custom_config"),
        (controller.WorkspaceInfoApi, "post", {"name": "New"}, "rename"),
    ],
)
def test_missing_workspace(
    app: Flask,
    workspaces: WorkspaceMocks,
    resource: type[Resource],
    method: str,
    payload: dict[str, object],
    service_method: str,
) -> None:
    getattr(workspaces.management, service_method).side_effect = WorkspaceNotFoundError()
    with app.test_request_context(json=payload), pytest.raises(NotFound):
        unwrap(getattr(resource, method))(resource(), CONTEXT)


@pytest.mark.parametrize(
    ("files", "error"),
    [
        ({}, NoFileUploadedError),
        ({"file": (BytesIO(b"x"), "a.png"), "extra": (BytesIO(b"x"), "b.png")}, TooManyFilesError),
        ({"file": (BytesIO(b"x"), "")}, FilenameNotExistsError),
    ],
)
def test_upload_form_errors(
    app: Flask, workspaces: WorkspaceMocks, files: dict[str, tuple[BytesIO, str]], error: type[Exception]
) -> None:
    with app.test_request_context(method="POST", data=files), pytest.raises(error):
        unwrap(controller.WebappLogoWorkspaceApi.post)(controller.WebappLogoWorkspaceApi(), CONTEXT)
    workspaces.management.upload_logo.assert_not_called()


def test_upload(app: Flask, workspaces: WorkspaceMocks) -> None:
    workspaces.management.upload_logo.return_value = "upload-1"
    with app.test_request_context(method="POST", data={"file": (BytesIO(b"image"), "logo.PNG")}):
        result = unwrap(controller.WebappLogoWorkspaceApi.post)(controller.WebappLogoWorkspaceApi(), CONTEXT)
    assert result == ({"id": "upload-1"}, HTTPStatus.CREATED)
    workspaces.management.upload_logo.assert_called_once_with(
        CONTEXT, filename="logo.PNG", content=b"image", mimetype="image/png"
    )


@pytest.mark.parametrize(
    ("error", "http_error"),
    [
        (file_errors.FileTooLargeError(), FileTooLargeError),
        (file_errors.UnsupportedFileTypeError(), UnsupportedFileTypeError),
    ],
)
def test_upload_service_errors(
    app: Flask, workspaces: WorkspaceMocks, error: Exception, http_error: type[Exception]
) -> None:
    workspaces.management.upload_logo.side_effect = error
    with app.test_request_context(method="POST", data={"file": (BytesIO(b"x"), "logo.png")}), pytest.raises(http_error):
        unwrap(controller.WebappLogoWorkspaceApi.post)(controller.WebappLogoWorkspaceApi(), CONTEXT)


def test_permissions(workspaces: WorkspaceMocks) -> None:
    workspaces.management.permission.return_value = WorkspacePermission("workspace-1", True, False)
    body, status = unwrap(controller.WorkspacePermissionApi.get)(controller.WorkspacePermissionApi(), CONTEXT)
    assert status == 200
    assert body == {"workspace_id": "workspace-1", "allow_member_invite": True, "allow_owner_transfer": False}
    workspaces.management.permission.assert_called_once_with(CONTEXT)


def test_removed_current_workspace_routes_stay_unregistered() -> None:
    urls = {url for resource in console_ns.resources for url in resource.urls}
    assert "/workspaces/current" not in urls
    assert "/workspaces/current/tool-provider" not in urls

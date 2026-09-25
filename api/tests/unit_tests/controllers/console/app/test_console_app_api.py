"""Transport contracts for the Console app application boundary."""

import inspect
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime
from io import BytesIO
from typing import cast
from uuid import UUID

import pytest
from flask import Flask, Response
from flask_restx import Resource
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.console import flask_admission
from controllers.console.app import app as controller
from controllers.console.app.error import AppNotFoundError
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, TenantAccountRole
from models.enums import CustomizeTokenStrategy
from services.agent.roster_package_entities import RosterAgentPackageExport
from services.app.console_service import (
    AppExportPaidPlanRequiredError,
    ConsoleAppNotFoundError,
    CreatorsPlatformDisabledError,
    InvalidAppExportError,
)
from services.entities.app_entities import (
    AppExportOptions,
    AppListParams,
    AppPage,
    AppRecord,
    AppTraceSettings,
    CopyAppParams,
    CreateAppParams,
    StarredAppListParams,
    UpdateAppParams,
)
from services.entities.dsl_entities import Import, ImportStatus
from tests.unit_tests.config_override import apply_config_overrides

APP_ID = UUID("11111111-1111-1111-1111-111111111111")
CONTEXT = RequestContext("request", "trace", "actor", "workspace")
RECORD = AppRecord(
    str(APP_ID), "Example", "chat", description="", created_at=datetime(2024, 1, 1), updated_at=datetime(2024, 1, 1)
)
SITE = {
    "code": "site",
    "title": "Example",
    "icon_type": None,
    "icon": None,
    "icon_background": None,
    "description": None,
    "default_language": "en-US",
    "chat_color_theme": None,
    "chat_color_theme_inverted": False,
    "customize_domain": None,
    "copyright": None,
    "privacy_policy": None,
    "input_placeholder": None,
    "custom_disclaimer": "",
    "customize_token_strategy": CustomizeTokenStrategy.NOT_ALLOW,
    "prompt_public": False,
    "show_workflow_steps": False,
    "use_icon_as_answer_icon": False,
    "created_by": None,
    "created_at": datetime(2024, 1, 1),
    "updated_by": None,
    "updated_at": datetime(2024, 1, 1),
}


@dataclass
class AppBoundary:
    calls: list[tuple[object, ...]] = field(default_factory=list)
    status: ImportStatus = ImportStatus.COMPLETED
    exported: str | RosterAgentPackageExport = "dsl"
    record: AppRecord = RECORD

    def list_apps(self, context: RequestContext, params: AppListParams | StarredAppListParams) -> AppPage:
        self.calls.append(("list", context, params))
        return AppPage(params.page, params.limit, 1, False, [RECORD])

    def create(self, context: RequestContext, params: CreateAppParams) -> AppRecord:
        self.calls.append(("create", context, params))
        return RECORD

    def get(self, context: RequestContext, app_id: str) -> AppRecord:
        self.calls.append(("get", context, app_id))
        return self.record

    def update(self, context: RequestContext, app_id: str, params: UpdateAppParams) -> AppRecord:
        self.calls.append(("update", context, app_id, params))
        return RECORD

    def update_icon(self, context: RequestContext, app_id: str, **kwargs: object) -> AppRecord:
        self.calls.append(("icon", context, app_id, kwargs))
        return RECORD

    def copy(self, context: RequestContext, app_id: str, params: CopyAppParams) -> tuple[Import, AppRecord | None]:
        self.calls.append(("copy", context, app_id, params))
        return Import(id="import", status=self.status), RECORD

    def export(self, context: RequestContext, app_id: str, options: AppExportOptions) -> str | RosterAgentPackageExport:
        self.calls.append(("export", context, app_id, options))
        return self.exported

    def publish(self, context: RequestContext, app_id: str) -> str:
        self.calls.append(("publish", context, app_id))
        return "https://creators.example.com"

    def delete(self, context: RequestContext, app_id: str) -> None:
        self.calls.append(("delete", context, app_id))

    def set_trace(self, context: RequestContext, app_id: str, settings: AppTraceSettings) -> None:
        self.calls.append(("trace", context, app_id, settings))


@dataclass
class AppServices:
    console: AppBoundary


@dataclass
class Services:
    apps: AppServices


@pytest.fixture
def boundary(monkeypatch: pytest.MonkeyPatch) -> AppBoundary:
    boundary = AppBoundary()
    monkeypatch.setattr(controller, "application_services", lambda: Services(AppServices(boundary)))
    return boundary


def invoke(resource: type[Resource], method: Callable[..., object], **kwargs: object) -> object:
    return inspect.unwrap(method)(resource(), CONTEXT, **kwargs)


def test_list_parses_repeated_filters_and_serializes_materialized_page(app: Flask, boundary: AppBoundary) -> None:
    tag = str(APP_ID)
    with app.test_request_context(f"/?page=2&limit=5&tag_ids={tag}&is_created_by_me=true"):
        data, status = cast(tuple[dict[str, object], int], invoke(controller.AppListApi, controller.AppListApi.get))
    assert status == 200
    assert data["page"] == 2
    assert data["limit"] == 5
    assert boundary.calls[0][1] is CONTEXT
    params = boundary.calls[0][2]
    assert isinstance(params, AppListParams)
    assert params.tag_ids == [tag]
    assert params.is_created_by_me is True


@pytest.mark.parametrize("configured", [True, False])
def test_detail_resolves_urls_at_the_http_boundary(
    app: Flask, boundary: AppBoundary, config_overrides: Callable[..., None], configured: bool
) -> None:
    config_overrides(
        SERVICE_API_URL="https://api.example.com" if configured else "",
        APP_WEB_URL="https://apps.example.com" if configured else "",
    )
    boundary.record = replace(RECORD, site=SITE)
    with app.test_request_context("/", base_url="https://console.example.com/"):
        response = cast(dict[str, object], invoke(controller.AppApi, controller.AppApi.get, app_id=APP_ID))
    assert response["api_base_url"] == (
        "https://api.example.com/v1" if configured else "https://console.example.com/v1"
    )
    site = response["site"]
    assert isinstance(site, dict)
    assert site["app_base_url"] == ("https://apps.example.com" if configured else "https://console.example.com")


@pytest.mark.parametrize("icon_type", [None, "image"])
def test_update_preserves_icon_type_omission_and_forwards_explicit_identity(
    app: Flask, boundary: AppBoundary, icon_type: str | None
) -> None:
    payload = {"name": "Updated", "icon": "image-id"}
    if icon_type is not None:
        payload["icon_type"] = icon_type
    with app.test_request_context("/", method="POST", json=payload):
        data = cast(dict[str, object], invoke(controller.AppApi, controller.AppApi.put, app_id=APP_ID))
    assert data["id"] == str(APP_ID)
    assert boundary.calls[0][1:3] == (CONTEXT, str(APP_ID))
    params = boundary.calls[0][3]
    assert isinstance(params, UpdateAppParams)
    assert params.icon_type == icon_type


def test_icon_body_and_trace_body_are_parsed(app: Flask, boundary: AppBoundary) -> None:
    with app.test_request_context("/", method="POST", json={"icon_type": "image", "icon": "image-id"}):
        invoke(controller.AppIconApi, controller.AppIconApi.post, app_id=APP_ID)
    assert boundary.calls[-1][-1] == {"icon_type": "image", "icon": "image-id", "icon_background": ""}
    with app.test_request_context("/", method="POST", json={"enabled": True, "tracing_provider": "langfuse"}):
        assert invoke(controller.AppTraceApi, controller.AppTraceApi.post, app_id=APP_ID) == {"result": "success"}
    assert boundary.calls[-1] == ("trace", CONTEXT, str(APP_ID), AppTraceSettings(True, "langfuse"))


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (ImportStatus.FAILED, 400),
        (ImportStatus.PENDING, 202),
        (ImportStatus.COMPLETED, 201),
        (ImportStatus.COMPLETED_WITH_WARNINGS, 201),
    ],
)
def test_copy_preserves_import_status_responses(
    app: Flask, boundary: AppBoundary, status: ImportStatus, expected: int
) -> None:
    boundary.status = status
    with app.test_request_context("/", method="POST", json={"name": "Copy"}):
        data, code = cast(
            tuple[dict[str, object], int], invoke(controller.AppCopyApi, controller.AppCopyApi.post, app_id=APP_ID)
        )
    assert code == expected
    assert data["id"] == ("import" if expected != 201 else str(APP_ID))


def test_export_serializes_yaml_and_closes_archive_on_response_close(app: Flask, boundary: AppBoundary) -> None:
    with app.test_request_context("/?format=yaml&include_secret=true"):
        assert invoke(controller.AppExportApi, controller.AppExportApi.get, app_id=APP_ID) == {"data": "dsl"}
    options = boundary.calls[-1][-1]
    assert isinstance(options, AppExportOptions)
    assert options.include_secret is True
    archive = BytesIO(b"zip")
    boundary.exported = RosterAgentPackageExport(archive=archive, filename="example.ifpkg", size=3)
    with app.test_request_context("/"):
        response = invoke(controller.AppExportApi, controller.AppExportApi.get, app_id=APP_ID)
        assert isinstance(response, Response)
        assert response.mimetype == "application/zip"
        assert "example.ifpkg" in response.headers["Content-Disposition"]
        response.close()
    assert archive.closed


def test_export_closes_archive_when_send_file_fails(
    app: Flask, boundary: AppBoundary, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive = BytesIO(b"zip")
    boundary.exported = RosterAgentPackageExport(archive=archive, filename="example.ifpkg", size=3)

    def fail(*_args: object, **_kwargs: object) -> None:
        raise OSError("delivery failed")

    monkeypatch.setattr(controller, "send_file", fail)
    with app.test_request_context("/"), pytest.raises(OSError):
        invoke(controller.AppExportApi, controller.AppExportApi.get, app_id=APP_ID)
    assert archive.closed


def test_publish_delegates_and_delete_has_no_body(app: Flask, boundary: AppBoundary) -> None:
    with app.test_request_context("/"):
        assert invoke(
            controller.AppPublishToCreatorsPlatformApi, controller.AppPublishToCreatorsPlatformApi.post, app_id=APP_ID
        ) == {
            "redirect_url": "https://creators.example.com",
        }
        assert invoke(controller.AppApi, controller.AppApi.delete, app_id=APP_ID) == ("", 204)
    assert boundary.calls == [("publish", CONTEXT, str(APP_ID)), ("delete", CONTEXT, str(APP_ID))]


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (ConsoleAppNotFoundError(), AppNotFoundError),
        (InvalidAppExportError("invalid version"), BadRequest),
        (AppExportPaidPlanRequiredError("paid plan required"), Forbidden),
    ],
)
def test_application_errors_are_translated_at_transport_boundary(
    monkeypatch: pytest.MonkeyPatch, error: Exception, expected: type[Exception]
) -> None:
    def fail(*_args: object, **_kwargs: object) -> None:
        raise error

    monkeypatch.setattr(Resource, "dispatch_request", fail)
    with pytest.raises(expected):
        controller.AppResource().dispatch_request()


def test_disabled_creators_preserves_error_body(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_args: object, **_kwargs: object) -> None:
        raise CreatorsPlatformDisabledError("Creators Platform features are not enabled")

    monkeypatch.setattr(Resource, "dispatch_request", fail)
    assert controller.AppResource().dispatch_request() == ({"error": "Creators Platform features are not enabled"}, 403)


@pytest.mark.parametrize(
    "method",
    [
        controller.AppApi.put,
        controller.AppApi.delete,
        controller.AppCopyApi.post,
        controller.AppExportApi.get,
        controller.AppNameApi.post,
        controller.AppIconApi.post,
        controller.AppSiteStatus.post,
        controller.AppApiStatus.post,
        controller.AppTraceApi.post,
    ],
)
def test_mutations_reject_read_only_role_at_admission(
    app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object]
) -> None:
    account = Account(name="Reader", email="reader@example.com")
    account.role = TenantAccountRole.NORMAL
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(
        flask_admission,
        "current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id="workspace"),
    )
    injector = inspect.unwrap(method, stop=lambda f: "allowed_roles" in inspect.getclosurevars(f).nonlocals)
    with app.test_request_context(), pytest.raises(Forbidden):
        injector(None, app_id=APP_ID)


def test_create_quota_is_part_of_admission_and_precedes_application_call(
    app: Flask, boundary: AppBoundary, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.entities.feature_entities import FeatureModel, LimitationModel

    account = Account(name="Editor", email="editor@example.com")
    account.role = TenantAccountRole.EDITOR
    account.id = CONTEXT.account_id
    identity = AccountWithTenant(account=account, tenant_id=CONTEXT.active_workspace_id)
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION="CLOUD", RBAC_ENABLED=False)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", lambda **_kwargs: None)
    monkeypatch.setattr(
        "controllers.console.wraps.FeatureService.get_features",
        lambda *_args, **_kwargs: FeatureModel(apps=LimitationModel(size=1, limit=1)),
    )
    injector = inspect.unwrap(
        controller.AppListApi.post, stop=lambda f: "allowed_roles" in inspect.getclosurevars(f).nonlocals
    )
    with app.test_request_context(method="POST", json={"name": "Example", "mode": "chat"}), pytest.raises(Forbidden):
        injector(controller.AppListApi())
    assert boundary.calls == []


def test_request_validation_retains_422_and_redacts_submitted_values(app: Flask, boundary: AppBoundary) -> None:
    from werkzeug.exceptions import UnprocessableEntity

    with app.test_request_context(method="PUT", json={"name": "", "icon": "private-input"}):
        with pytest.raises(UnprocessableEntity) as error:
            invoke(controller.AppApi, controller.AppApi.put, app_id=APP_ID)
    assert "private-input" not in (error.value.description or "")
    assert boundary.calls == []

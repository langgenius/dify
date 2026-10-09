"""Reads and writes shared by the per-mode app-settings routes."""

from __future__ import annotations

from dataclasses import asdict
from enum import StrEnum
from typing import Final

from flask import request
from pydantic import BaseModel
from werkzeug.exceptions import NotFound

from configs import dify_config
from controllers.common.rbac.locators import agent_binding
from controllers.openapi._errors import WebAppAccessModeConsoleOnly, WebAppAccessUnavailable
from controllers.openapi._models import WebAppAccess, WebAppAccessPayload, WebAppToken
from controllers.openapi.auth.context import Context
from enums import WebAppAccessMode
from extensions.ext_application_services import application_services
from libs.url_utils import normalize_api_base_url
from services.app_site_service import AppSiteAppNotFoundError, AppSiteChanges, AppSiteNotFoundError
from services.entities.app_entities import AppRecord, UpdateAppParams
from services.webapp_access_query_service import WebAppAccessUnavailableError

_SETTABLE_ACCESS_MODES: Final = frozenset(
    {WebAppAccessMode.PUBLIC, WebAppAccessMode.PRIVATE_ALL, WebAppAccessMode.SSO_VERIFIED}
)


class WebAppPath(StrEnum):
    """The web app's URL segment per app mode, as the console builds the share link."""

    CHAT = "chat"
    COMPLETION = "completion"
    WORKFLOW = "workflow"
    AGENT = "agent"

    def url(self, base_url: str, code: str | None) -> str | None:
        return f"{base_url}/{self}/{code}" if code else None


def app_base_url() -> str:
    return dify_config.APP_WEB_URL or request.url_root.rstrip("/")


def _info_from_record[T: BaseModel](ctx: Context, record: AppRecord, model: type[T], role: str | None) -> T:
    data = asdict(record)
    if "role" in model.model_fields:
        if role is None:
            agent = agent_binding(ctx.workspace.id, ctx.app.id)
            role = agent.role if agent is not None else None
        data["role"] = role
    return model.model_validate(data)


def app_info[T: BaseModel](ctx: Context, model: type[T]) -> T:
    record = application_services().apps.console.get(ctx.request_context, ctx.app.id)
    return _info_from_record(ctx, record, model, None)


def update_app_info[T: BaseModel](ctx: Context, patch: BaseModel, model: type[T]) -> T:
    console = application_services().apps.console
    current = console.get(ctx.request_context, ctx.app.id)
    changes = patch.model_dump(exclude_unset=True, exclude_none=True)
    record = console.update(
        ctx.request_context,
        ctx.app.id,
        UpdateAppParams(
            name=changes.get("name", current.name),
            description=changes.get("description", current.description or ""),
            icon_type=changes.get("icon_type", current.icon_type),
            icon=changes.get("icon", current.icon or ""),
            icon_background=changes.get("icon_background", current.icon_background or ""),
            use_icon_as_answer_icon=changes.get("use_icon_as_answer_icon", current.use_icon_as_answer_icon),
            max_active_requests=changes.get("max_active_requests", current.max_active_requests or 0),
            role=changes.get("role"),
        ),
    )
    return _info_from_record(ctx, record, model, changes.get("role"))


def _access_ready(ctx: Context) -> bool:
    return application_services().apps.console.access_ready(ctx.request_context, ctx.app.id)


def _service_api[T: BaseModel](ctx: Context, model: type[T], enabled: bool) -> T:
    base_url = normalize_api_base_url(dify_config.SERVICE_API_URL or request.host_url.rstrip("/"))
    data: dict[str, object] = {"enabled": enabled, "base_url": base_url}
    if "access_ready" in model.model_fields:
        ready = _access_ready(ctx)
        data |= {
            "enabled": enabled and ready,
            "access_ready": ready,
            "api_rpm": ctx.app.api_rpm or 0,
            "api_rph": ctx.app.api_rph or 0,
        }
    return model.model_validate(data)


def service_api[T: BaseModel](ctx: Context, model: type[T]) -> T:
    return _service_api(ctx, model, ctx.app.enable_api)


def update_service_api[T: BaseModel](ctx: Context, enabled: bool, model: type[T]) -> T:
    record = application_services().apps.console.set_api_enabled(ctx.request_context, ctx.app.id, enabled)
    return _service_api(ctx, model, record.enable_api)


def webapp[T: BaseModel](ctx: Context, model: type[T], path: WebAppPath) -> T:
    app = application_services().apps.console.get(ctx.request_context, ctx.app.id)
    site = app.site or {}
    base_url = app_base_url()
    data = {
        **site,
        "enabled": app.enable_site,
        "access_token": site.get("code"),
        "app_base_url": base_url,
        "url": path.url(base_url, site.get("code")),
    }
    if "access_ready" in model.model_fields:
        ready = _access_ready(ctx)
        data |= {"enabled": app.enable_site and ready, "access_ready": ready}
    return model.model_validate(data)


def update_webapp[T: BaseModel](ctx: Context, patch: BaseModel, model: type[T], path: WebAppPath) -> T:
    changes = patch.model_dump(exclude_unset=True, exclude_none=True)
    enabled = changes.pop("enabled", None)
    try:
        if changes:
            application_services().app_sites.update(ctx.request_context, ctx.app.id, AppSiteChanges(**changes))
    except (AppSiteNotFoundError, AppSiteAppNotFoundError) as error:
        raise NotFound(str(error)) from error
    if enabled is not None:
        application_services().apps.console.set_site_enabled(ctx.request_context, ctx.app.id, enabled)
    return webapp(ctx, model, path)


def reset_webapp(ctx: Context, path: WebAppPath) -> WebAppToken:
    try:
        site = application_services().app_sites.reset_access_token(ctx.request_context, ctx.app.id)
    except (AppSiteNotFoundError, AppSiteAppNotFoundError) as error:
        raise NotFound(str(error)) from error
    base_url = app_base_url()
    return WebAppToken(access_token=site.code, app_base_url=base_url, url=path.url(base_url, site.code))


def webapp_access(ctx: Context) -> WebAppAccess:
    try:
        access_mode = application_services().webapp_access.get_access_mode(app_id=ctx.app.id, app_code=None)
    except WebAppAccessUnavailableError as error:
        raise WebAppAccessUnavailable() from error
    return WebAppAccess(access_mode=access_mode)


def update_webapp_access(ctx: Context, body: WebAppAccessPayload) -> WebAppAccess:
    if body.access_mode not in _SETTABLE_ACCESS_MODES:
        raise WebAppAccessModeConsoleOnly()
    try:
        application_services().apps.console.update_access(ctx.app.id, body.access_mode)
    except WebAppAccessUnavailableError as error:
        raise WebAppAccessUnavailable() from error
    return WebAppAccess(access_mode=body.access_mode)

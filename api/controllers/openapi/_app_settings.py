"""Reads and writes shared by the per-mode app-settings routes. Agent apps get their own
builders: their cards add the bound agent's role and whether a published version can serve."""

from __future__ import annotations

from dataclasses import asdict
from enum import StrEnum
from typing import Any, Final

from flask import request
from pydantic import BaseModel
from werkzeug.exceptions import NotFound

from configs import dify_config
from controllers.common.rbac.locators import agent_binding
from controllers.openapi._errors import WebAppAccessModeConsoleOnly, WebAppAccessUnavailable
from controllers.openapi._models import (
    AgentAppInfo,
    AgentAppInfoPatch,
    AgentServiceApi,
    AgentWebApp,
    WebAppAccess,
    WebAppAccessPayload,
    WebAppToken,
)
from controllers.openapi.auth.context import Context
from enums import WebAppAccessMode
from extensions.ext_application_services import application_services
from models import AppMode
from services.app_site_service import AppSiteAppNotFoundError, AppSiteChanges, AppSiteNotFoundError
from services.entities.app_entities import AppRecord
from services.webapp_access_query_service import WebAppAccessUnavailableError

REGULAR_MODES: Final = (
    AppMode.WORKFLOW,
    AppMode.ADVANCED_CHAT,
    AppMode.CHAT,
    AppMode.AGENT_CHAT,
    AppMode.COMPLETION,
)

_SETTABLE_ACCESS_MODES: Final = frozenset(
    {WebAppAccessMode.PUBLIC, WebAppAccessMode.PRIVATE_ALL, WebAppAccessMode.SSO_VERIFIED}
)


class WebAppPath(StrEnum):
    """The web app's URL segment and the app modes served under it, as the console builds the share link."""

    modes: frozenset[AppMode]

    CHAT = "chat", (AppMode.CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT_CHAT)
    COMPLETION = "completion", (AppMode.COMPLETION,)
    WORKFLOW = "workflow", (AppMode.WORKFLOW,)
    AGENT = "agent", (AppMode.AGENT,)

    def __new__(cls, segment: str, modes: tuple[AppMode, ...]) -> WebAppPath:
        member = str.__new__(cls, segment)
        member._value_ = segment
        member.modes = frozenset(modes)
        return member

    @classmethod
    def of(cls, mode: str) -> WebAppPath:
        for path in cls:
            if mode in path.modes:
                return path
        raise ValueError(f"No web app path for app mode {mode!r}")

    def url(self, base_url: str, code: str | None) -> str | None:
        return f"{base_url}/{self}/{code}" if code else None


def app_base_url() -> str:
    return dify_config.APP_WEB_URL or request.url_root.rstrip("/")


def app_info[T: BaseModel](ctx: Context, model: type[T]) -> T:
    return model.model_validate(asdict(application_services().apps.console.get(ctx.request_context, ctx.app.id)))


def update_app_info[T: BaseModel](ctx: Context, patch: BaseModel, model: type[T]) -> T:
    return model.model_validate(asdict(_update_app_info(ctx, patch.model_dump(exclude_unset=True, exclude_none=True))))


def _agent_app_info(ctx: Context, record: AppRecord, role: str | None) -> AgentAppInfo:
    if role is None:
        agent = agent_binding(ctx.workspace.id, ctx.app.id)
        role = agent.role if agent is not None else None
    return AgentAppInfo.model_validate({**asdict(record), "role": role})


def agent_app_info(ctx: Context) -> AgentAppInfo:
    record = application_services().apps.console.get(ctx.request_context, ctx.app.id)
    return _agent_app_info(ctx, record, None)


def update_agent_app_info(ctx: Context, patch: AgentAppInfoPatch) -> AgentAppInfo:
    changes = patch.model_dump(exclude_unset=True, exclude_none=True)
    return _agent_app_info(ctx, _update_app_info(ctx, changes), changes.get("role"))


def _update_app_info(ctx: Context, changes: dict[str, Any]) -> AppRecord:
    return application_services().apps.console.update_fields(ctx.request_context, ctx.app.id, changes)


def _access_ready(ctx: Context) -> bool:
    return application_services().apps.console.access_ready(ctx.request_context, ctx.app.id)


def _service_api(ctx: Context, enabled: bool) -> dict[str, Any]:
    return {"enabled": enabled, "base_url": ctx.app.api_base_url}


def service_api[T: BaseModel](ctx: Context, model: type[T]) -> T:
    return model.model_validate(_service_api(ctx, ctx.app.enable_api))


def update_service_api[T: BaseModel](ctx: Context, enabled: bool, model: type[T]) -> T:
    record = application_services().apps.console.set_api_enabled(ctx.request_context, ctx.app.id, enabled)
    return model.model_validate(_service_api(ctx, record.enable_api))


def _agent_service_api(ctx: Context, enabled: bool) -> AgentServiceApi:
    ready = _access_ready(ctx)
    return AgentServiceApi(
        **_service_api(ctx, enabled and ready),
        access_ready=ready,
        api_rpm=ctx.app.api_rpm or 0,
        api_rph=ctx.app.api_rph or 0,
    )


def agent_service_api(ctx: Context) -> AgentServiceApi:
    return _agent_service_api(ctx, ctx.app.enable_api)


def update_agent_service_api(ctx: Context, enabled: bool) -> AgentServiceApi:
    record = application_services().apps.console.set_api_enabled(ctx.request_context, ctx.app.id, enabled)
    return _agent_service_api(ctx, record.enable_api)


def _webapp(ctx: Context) -> dict[str, Any]:
    app = application_services().apps.console.get(ctx.request_context, ctx.app.id)
    site = app.site or {}
    base_url = app_base_url()
    return {
        **site,
        "enabled": app.enable_site,
        "access_token": site.get("code"),
        "app_base_url": base_url,
        "url": WebAppPath.of(ctx.app.mode).url(base_url, site.get("code")),
    }


def webapp[T: BaseModel](ctx: Context, model: type[T]) -> T:
    return model.model_validate(_webapp(ctx))


def agent_webapp(ctx: Context) -> AgentWebApp:
    data = _webapp(ctx)
    ready = _access_ready(ctx)
    return AgentWebApp.model_validate({**data, "enabled": data["enabled"] and ready, "access_ready": ready})


def _update_site(ctx: Context, patch: BaseModel) -> None:
    changes = patch.model_dump(exclude_unset=True, exclude_none=True)
    enabled = changes.pop("enabled", None)
    try:
        if changes:
            application_services().app_sites.update(ctx.request_context, ctx.app.id, AppSiteChanges(**changes))
    except (AppSiteNotFoundError, AppSiteAppNotFoundError) as error:
        raise NotFound(str(error)) from error
    if enabled is not None:
        application_services().apps.console.set_site_enabled(ctx.request_context, ctx.app.id, enabled)


def update_webapp[T: BaseModel](ctx: Context, patch: BaseModel, model: type[T]) -> T:
    _update_site(ctx, patch)
    return webapp(ctx, model)


def update_agent_webapp(ctx: Context, patch: BaseModel) -> AgentWebApp:
    _update_site(ctx, patch)
    return agent_webapp(ctx)


def reset_webapp(ctx: Context) -> WebAppToken:
    try:
        site = application_services().app_sites.reset_access_token(ctx.request_context, ctx.app.id)
    except (AppSiteNotFoundError, AppSiteAppNotFoundError) as error:
        raise NotFound(str(error)) from error
    base_url = app_base_url()
    return WebAppToken(
        access_token=site.code, app_base_url=base_url, url=WebAppPath.of(ctx.app.mode).url(base_url, site.code)
    )


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
        application_services().webapp_access.update_access_mode(app_id=ctx.app.id, access_mode=body.access_mode)
    except WebAppAccessUnavailableError as error:
        raise WebAppAccessUnavailable() from error
    return WebAppAccess(access_mode=body.access_mode)

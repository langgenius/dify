"""GET /openapi/v1/apps and per-app reads.

Decorator order: `method_decorators` is innermost-first. `validate_bearer`
is last → outermost → sets `g.auth_ctx` before `require_scope` reads it.
"""

from __future__ import annotations

import uuid as _uuid
from typing import Any

import sqlalchemy as sa
from flask import g, request
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import Conflict, NotFound, UnprocessableEntity

from controllers.common.fields import Parameters
from controllers.common.schema import query_params_from_model
from controllers.openapi import openapi_ns
from controllers.openapi._input_schema import EMPTY_INPUT_SCHEMA, build_input_schema, resolve_app_config
from controllers.openapi._models import (
    AppDescribeInfo,
    AppDescribeQuery,
    AppDescribeResponse,
    AppListQuery,
    AppListResponse,
    AppListRow,
    TagItem,
)
from controllers.openapi.auth.surface_gate import accept_subjects
from controllers.service_api.app.error import AppUnavailableError
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from extensions.ext_database import db
from libs.oauth_bearer import (
    ACCEPT_USER_ANY,
    AuthContext,
    Scope,
    SubjectType,
    require_scope,
    require_workspace_member,
    validate_bearer,
)
from models import App, Tenant
from services.app_service import AppListParams, AppService
from services.openapi.visibility import apply_openapi_gate, is_openapi_visible
from services.tag_service import TagService

# method_decorators applies left-to-right innermost-first; flask_restx wraps
# in order, so the LAST entry is the outermost. Execution flows
# validate_bearer → accept_subjects → require_scope → handler.
_APPS_READ_DECORATORS = [
    require_scope(Scope.APPS_READ),
    accept_subjects(SubjectType.ACCOUNT),
    validate_bearer(accept=ACCEPT_USER_ANY),
]

_ALLOWED_DESCRIBE_FIELDS: frozenset[str] = frozenset({"info", "parameters", "input_schema"})


_EMPTY_PARAMETERS: dict[str, Any] = {
    "opening_statement": None,
    "suggested_questions": [],
    "user_input_form": [],
    "file_upload": None,
    "system_parameters": {},
}


class AppReadResource(Resource):
    """Base for per-app read endpoints; subclasses call `_load()` for SSO/membership/exists checks."""

    method_decorators = _APPS_READ_DECORATORS

    def _load(self, app_id: str, workspace_id: str | None = None) -> tuple[App, AuthContext]:
        ctx: AuthContext = g.auth_ctx

        try:
            parsed_uuid = _uuid.UUID(app_id)
            is_uuid = True
        except ValueError:
            parsed_uuid = None
            is_uuid = False

        if is_uuid:
            app = db.session.get(App, str(parsed_uuid))  # normalised dashed form
            if not app or app.status != "normal" or not is_openapi_visible(app):
                raise NotFound("app not found")
        else:
            if not workspace_id:
                raise UnprocessableEntity("workspace_id is required for name-based lookup")
            matches = list(
                db.session.execute(
                    apply_openapi_gate(
                        sa.select(App).where(
                            App.name == app_id,
                            App.tenant_id == workspace_id,
                            App.status == "normal",
                        )
                    )
                ).scalars()
            )
            if len(matches) == 0:
                raise NotFound("app not found")
            if len(matches) > 1:
                lines = [f"app name {app_id!r} is ambiguous — re-run with a UUID:\n\n"]
                lines.append(f"  {'ID':<36}  {'MODE':<12}  NAME\n")
                for m in matches:
                    lines.append(f"  {str(m.id):<36}  {str(m.mode.value):<12}  {m.name}\n")
                raise Conflict("".join(lines))
            app = matches[0]

        require_workspace_member(ctx, str(app.tenant_id))
        return app, ctx


def parameters_payload(app: App) -> dict:
    """Mirrors service_api/app/app.py::AppParameterApi response body."""
    features_dict, user_input_form = resolve_app_config(app)
    parameters = get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)
    return Parameters.model_validate(parameters).model_dump(mode="json")


@openapi_ns.route("/apps/<string:app_id>/describe")
class AppDescribeApi(AppReadResource):
    @openapi_ns.doc(params=query_params_from_model(AppDescribeQuery))
    @openapi_ns.response(200, "App description", openapi_ns.models[AppDescribeResponse.__name__])
    def get(self, app_id: str):
        try:
            query = AppDescribeQuery.model_validate(request.args.to_dict(flat=True))
        except ValidationError as exc:
            raise UnprocessableEntity(exc.json())

        app, _ = self._load(app_id, workspace_id=query.workspace_id)

        requested = query.fields
        want_info = requested is None or "info" in requested
        want_params = requested is None or "parameters" in requested
        want_schema = requested is None or "input_schema" in requested

        info = (
            AppDescribeInfo(
                id=str(app.id),
                name=app.name,
                mode=app.mode,
                description=app.description,
                tags=[TagItem(name=t.name) for t in app.tags],
                author=app.author_name,
                updated_at=app.updated_at.isoformat() if app.updated_at else None,
                service_api_enabled=bool(app.enable_api),
                is_agent=app.mode in ("agent-chat", "advanced-chat"),
            )
            if want_info
            else None
        )

        parameters: dict[str, Any] | None = None
        input_schema: dict[str, Any] | None = None
        if want_params:
            try:
                parameters = parameters_payload(app)
            except AppUnavailableError:
                parameters = dict(_EMPTY_PARAMETERS)
        if want_schema:
            try:
                input_schema = build_input_schema(app)
            except AppUnavailableError:
                input_schema = dict(EMPTY_INPUT_SCHEMA)

        return (
            AppDescribeResponse(
                info=info,
                parameters=parameters,
                input_schema=input_schema,
            ).model_dump(mode="json", exclude_none=False),
            200,
        )


@openapi_ns.route("/apps")
class AppListApi(Resource):
    method_decorators = _APPS_READ_DECORATORS

    @openapi_ns.doc(params=query_params_from_model(AppListQuery))
    @openapi_ns.response(200, "App list", openapi_ns.models[AppListResponse.__name__])
    def get(self):
        ctx: AuthContext = g.auth_ctx

        try:
            query = AppListQuery.model_validate(request.args.to_dict(flat=True))
        except ValidationError as exc:
            raise UnprocessableEntity(exc.json())

        workspace_id = query.workspace_id
        require_workspace_member(ctx, workspace_id)

        empty = (
            AppListResponse(page=query.page, limit=query.limit, total=0, has_more=False, data=[]).model_dump(
                mode="json"
            ),
            200,
        )

        if query.name:
            try:
                parsed_uuid = _uuid.UUID(query.name)
            except ValueError:
                parsed_uuid = None
        else:
            parsed_uuid = None

        if parsed_uuid is not None:
            app: App = db.session.get(App, str(parsed_uuid))
            if not app or app.status != "normal" or str(app.tenant_id) != workspace_id or not is_openapi_visible(app):
                return empty
            tenant_name = db.session.execute(
                sa.select(Tenant.name).where(Tenant.id == workspace_id)
            ).scalar_one_or_none()
            item = AppListRow(
                id=str(app.id),
                name=app.name,
                description=app.description,
                mode=app.mode,
                tags=[TagItem(name=t.name) for t in app.tags],
                updated_at=app.updated_at.isoformat() if app.updated_at else None,
                created_by_name=getattr(app, "author_name", None),
                workspace_id=str(workspace_id),
                workspace_name=tenant_name,
            )
            env = AppListResponse(page=1, limit=1, total=1, has_more=False, data=[item])
            return env.model_dump(mode="json"), 200

        tag_ids: list[str] | None = None
        if query.tag:
            tags = TagService.get_tag_by_tag_name("app", workspace_id, query.tag)
            if not tags:
                return empty
            tag_ids = [tag.id for tag in tags]

        params = AppListParams(
            page=query.page,
            limit=query.limit,
            mode=query.mode.value if query.mode else "all",
            name=query.name,
            tag_ids=tag_ids,
            status="normal",
            # Visibility gate pushed into the query — pagination.total stays
            # consistent across pages because invisible rows never count.
            openapi_visible=True,
        )

        pagination = AppService().get_paginate_apps(ctx.account_id, workspace_id, params)
        if pagination is None:
            return empty

        tenant_name: str | None = None
        if pagination.items:
            tenant_name = db.session.execute(
                sa.select(Tenant.name).where(Tenant.id == workspace_id)
            ).scalar_one_or_none()

        items = [
            AppListRow(
                id=str(r.id),
                name=r.name,
                description=r.description,
                mode=r.mode,
                tags=[TagItem(name=t.name) for t in r.tags],
                updated_at=r.updated_at.isoformat() if r.updated_at else None,
                created_by_name=getattr(r, "author_name", None),
                workspace_id=str(workspace_id),
                workspace_name=tenant_name,
            )
            for r in pagination.items
        ]
        env = AppListResponse(
            page=query.page,
            limit=query.limit,
            total=int(pagination.total),
            has_more=query.page * query.limit < int(pagination.total),
            data=items,
        )
        return env.model_dump(mode="json"), 200

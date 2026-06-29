"""Console API for Agent Soul-backed config assets."""

from __future__ import annotations

import inspect
import io
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from flask import Response, request, send_file
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.agent.app_helpers import resolve_agent_runtime_app_model
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from fields.base import ResponseModel
from libs.login import login_required
from models.account import Account
from models.model import App, AppMode
from services.agent.composer_service import AgentComposerService
from services.agent.errors import AgentVersionNotFoundError
from services.agent_config_service import (
    AgentConfigService,
    AgentConfigServiceError,
    AgentConfigVersionKind,
    ConfigPushPayload,
)


class AgentConfigQuery(BaseModel):
    node_id: str | None = Field(default=None, description="Workflow node ID (workflow composer variant)")
    version_id: str | None = Field(default=None, description="Published snapshot ID for read-only version view")
    draft_type: Literal["draft", "debug_build"] | None = Field(
        default=None,
        description="Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft",
    )


class AgentConfigByAgentQuery(BaseModel):
    version_id: str | None = Field(default=None, description="Published snapshot ID for read-only version view")
    draft_type: Literal["draft", "debug_build"] | None = Field(
        default=None,
        description="Editable draft surface: omit or 'draft' for normal draft, 'debug_build' for build draft",
    )


class AgentConfigFileUploadPayload(BaseModel):
    upload_file_id: str = Field(..., description="UploadFile UUID from POST /console/api/files/upload")


class AgentConfigManifestResponse(ResponseModel):
    agent_id: str
    config_version: dict[str, Any]
    skills: list[dict[str, Any]] = Field(default_factory=list)
    files: list[dict[str, Any]] = Field(default_factory=list)
    env_keys: list[str] = Field(default_factory=list)
    note: str = ""


class AgentConfigSkillInspectResponse(ResponseModel):
    name: str
    description: str = ""
    files: list[str] = Field(default_factory=list)
    skill_md: str


class AgentConfigPreviewResponse(ResponseModel):
    key: str
    size: int | None = None
    truncated: bool
    binary: bool
    text: str | None = None


register_schema_models(console_ns, AgentConfigFileUploadPayload)
register_response_schema_models(
    console_ns,
    AgentConfigManifestResponse,
    AgentConfigPreviewResponse,
    AgentConfigSkillInspectResponse,
)


@dataclass(frozen=True, slots=True)
class _ResolvedConsoleTarget:
    tenant_id: str
    agent_id: str
    account_id: str
    version_id: str
    version_kind: AgentConfigVersionKind


_WORKFLOW_APP_MODES = [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT]


def _service() -> AgentConfigService:
    return AgentConfigService()


def _resolve_agent_id(app_model: App, node_id: str | None) -> str | None:
    if node_id:
        return AgentComposerService.resolve_workflow_node_agent_id(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            node_id=node_id,
        )
    return app_model.bound_agent_id


def _agent_not_bound() -> tuple[dict[str, object], int]:
    return {"code": "agent_not_bound", "message": "no agent is bound for this app/node"}, 400


def _handle(exc: AgentConfigServiceError) -> tuple[dict[str, object], int]:
    return {"code": exc.code, "message": exc.message}, exc.status_code


def _json_response(data: Mapping[str, Any]) -> Response:
    return Response(
        response=json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        content_type="application/json; charset=utf-8",
    )


def _resolve_console_version(
    *,
    tenant_id: str,
    agent_id: str,
    account_id: str,
    version_id: str | None,
    draft_type: str | None,
) -> tuple[str, AgentConfigVersionKind]:
    if version_id:
        return version_id, AgentConfigVersionKind.SNAPSHOT
    try:
        if draft_type == "debug_build":
            state = AgentComposerService.load_agent_app_build_draft(
                tenant_id=tenant_id,
                agent_id=agent_id,
                account_id=account_id,
            )
            draft = state.get("draft") or {}
            draft_id = draft.get("id")
            if isinstance(draft_id, str) and draft_id:
                return draft_id, AgentConfigVersionKind.BUILD_DRAFT
        else:
            state = AgentComposerService.load_agent_composer(tenant_id=tenant_id, agent_id=agent_id)
            draft = state.get("draft") or {}
            draft_id = draft.get("id")
            if isinstance(draft_id, str) and draft_id:
                return draft_id, AgentConfigVersionKind.DRAFT
    except AgentVersionNotFoundError as exc:
        raise AgentConfigServiceError(
            "config_version_not_found",
            "agent config version was not found",
            status_code=404,
        ) from exc
    raise AgentConfigServiceError(
        "config_version_not_found",
        "agent config version was not found",
        status_code=404,
    )


def _resolve_target(
    *,
    tenant_id: str,
    agent_id: str,
    account_id: str,
    version_id: str | None,
    draft_type: str | None,
) -> _ResolvedConsoleTarget:
    resolved_version_id, version_kind = _resolve_console_version(
        tenant_id=tenant_id,
        agent_id=agent_id,
        account_id=account_id,
        version_id=version_id,
        draft_type=draft_type,
    )
    return _ResolvedConsoleTarget(
        tenant_id=tenant_id,
        agent_id=agent_id,
        account_id=account_id,
        version_id=resolved_version_id,
        version_kind=version_kind,
    )


def _resolve_agent_route_target(
    *,
    tenant_id: str,
    agent_id: UUID,
    current_user: Account,
    query: AgentConfigByAgentQuery,
) -> _ResolvedConsoleTarget:
    resolve_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
    return _resolve_target(
        tenant_id=tenant_id,
        agent_id=str(agent_id),
        account_id=current_user.id,
        version_id=query.version_id,
        draft_type=query.draft_type,
    )


def _resolve_app_route_target(
    *,
    app_model: App,
    current_user: Account,
    query: AgentConfigQuery,
) -> _ResolvedConsoleTarget | tuple[dict[str, object], int]:
    agent_id = _resolve_agent_id(app_model, query.node_id)
    if not agent_id:
        return _agent_not_bound()
    return _resolve_target(
        tenant_id=app_model.tenant_id,
        agent_id=agent_id,
        account_id=current_user.id,
        version_id=query.version_id,
        draft_type=query.draft_type,
    )


def _with_agent_route_target(
    *,
    tenant_id: str,
    agent_id: UUID,
    current_user: Account,
    action: Callable[[_ResolvedConsoleTarget], Any],
) -> Any:
    query = query_params_from_request(AgentConfigByAgentQuery)
    try:
        target = _resolve_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            query=query,
        )
        return action(target)
    except AgentConfigServiceError as exc:
        return _handle(exc)


def _with_app_route_target(
    *,
    app_model: App,
    current_user: Account,
    action: Callable[[_ResolvedConsoleTarget], Any],
) -> Any:
    query = query_params_from_request(AgentConfigQuery)
    try:
        target = _resolve_app_route_target(app_model=app_model, current_user=current_user, query=query)
        if isinstance(target, tuple):
            return target
        return action(target)
    except AgentConfigServiceError as exc:
        return _handle(exc)


def _manifest_response(target: _ResolvedConsoleTarget) -> dict[str, object]:
    return _service().manifest(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        user_id=target.account_id,
    )


def _read_single_upload() -> tuple[bytes, str]:
    if "file" not in request.files:
        raise AgentConfigServiceError("no_file", "no skill file uploaded", status_code=400)
    if len(request.files) > 1:
        raise AgentConfigServiceError("too_many_files", "only one skill file is allowed", status_code=400)
    upload = request.files["file"]
    return upload.stream.read(), upload.filename or ""


def _skill_upload_response(target: _ResolvedConsoleTarget) -> tuple[dict[str, object], int]:
    return _upload_skill_for_target(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        user_id=target.account_id,
        version_id=target.version_id,
        version_kind=target.version_kind,
    )


def _upload_skill_for_target(
    *,
    tenant_id: str,
    agent_id: str,
    user_id: str,
    version_id: str,
    version_kind: AgentConfigVersionKind,
    content: bytes | None = None,
    filename: str = "",
) -> tuple[dict[str, object], int]:
    if content is None:
        content, filename = _read_single_upload()
    manifest = _service().upload_skill_for_console(
        tenant_id=tenant_id,
        agent_id=agent_id,
        user_id=user_id,
        config_version_id=version_id,
        config_version_kind=version_kind,
        content=content,
        filename=filename,
    )
    return manifest, 201


def _file_upload_response(
    target: _ResolvedConsoleTarget, payload: AgentConfigFileUploadPayload
) -> tuple[dict[str, object], int]:
    manifest = _service().push_file_for_console(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        user_id=target.account_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        upload_file_id=payload.upload_file_id,
    )
    return manifest, 201


def _skill_inspect_response(target: _ResolvedConsoleTarget, name: str) -> Response:
    return _json_response(
        _service().inspect_skill(
            tenant_id=target.tenant_id,
            agent_id=target.agent_id,
            config_version_id=target.version_id,
            config_version_kind=target.version_kind,
            name=name,
            user_id=target.account_id,
        )
    )


def _skill_download_response(target: _ResolvedConsoleTarget, name: str) -> Response:
    download = _service().pull_skill(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        name=name,
        user_id=target.account_id,
    )
    return send_file(
        io.BytesIO(download.payload),
        mimetype=download.mime_type,
        as_attachment=True,
        download_name=download.filename,
    )


def _skill_delete_response(target: _ResolvedConsoleTarget, name: str) -> dict[str, object]:
    return _service().push_for_console(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        user_id=target.account_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        payload=ConfigPushPayload(skills=[{"name": name, "file_ref": None}]),
    )


def _file_preview_response(target: _ResolvedConsoleTarget, name: str) -> dict[str, object]:
    return _service().preview_file(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        name=name,
        user_id=target.account_id,
    )


def _file_download_response(target: _ResolvedConsoleTarget, name: str) -> Response:
    download = _service().pull_file(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        name=name,
        user_id=target.account_id,
    )
    return send_file(
        io.BytesIO(download.payload),
        mimetype=download.mime_type,
        as_attachment=True,
        download_name=download.filename,
    )


def _file_delete_response(target: _ResolvedConsoleTarget, name: str) -> dict[str, object]:
    return _service().push_for_console(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        user_id=target.account_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        payload=ConfigPushPayload(files=[{"name": name, "file_ref": None}]),
    )


@console_ns.route("/agent/<uuid:agent_id>/config/manifest")
class AgentConfigManifestByAgentApi(Resource):
    @console_ns.doc("get_agent_config_manifest_by_agent")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentConfigByAgentQuery)})
    @console_ns.response(200, "Agent config manifest", console_ns.models[AgentConfigManifestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID):
        return _with_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            action=_manifest_response,
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/manifest")
class AgentConfigManifestApi(Resource):
    @console_ns.doc("get_agent_config_manifest")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentConfigQuery)})
    @console_ns.response(200, "Agent config manifest", console_ns.models[AgentConfigManifestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    @with_current_user
    def get(self, current_user: Account, app_model: App):
        return _with_app_route_target(app_model=app_model, current_user=current_user, action=_manifest_response)


@console_ns.route("/agent/<uuid:agent_id>/config/skills/upload")
class AgentConfigSkillUploadByAgentApi(Resource):
    @console_ns.doc("upload_agent_config_skill_by_agent")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentConfigByAgentQuery)})
    @console_ns.response(201, "Updated config manifest", console_ns.models[AgentConfigManifestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account, agent_id: UUID):
        return _with_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            action=_skill_upload_response,
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/upload")
class AgentConfigSkillUploadApi(Resource):
    @console_ns.doc("upload_agent_config_skill")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentConfigQuery)})
    @console_ns.response(201, "Updated config manifest", console_ns.models[AgentConfigManifestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    @with_current_user
    def post(self, current_user: Account, app_model: App):
        return _with_app_route_target(app_model=app_model, current_user=current_user, action=_skill_upload_response)


@console_ns.route("/agent/<uuid:agent_id>/config/files")
class AgentConfigFilesByAgentApi(Resource):
    @console_ns.doc("upload_agent_config_file_by_agent")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentConfigByAgentQuery)})
    @console_ns.expect(console_ns.models[AgentConfigFileUploadPayload.__name__])
    @console_ns.response(201, "Updated config manifest", console_ns.models[AgentConfigManifestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account, agent_id: UUID):
        payload = AgentConfigFileUploadPayload.model_validate(console_ns.payload or {})
        return _with_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            action=lambda target: _file_upload_response(target, payload),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/files")
class AgentConfigFilesApi(Resource):
    @console_ns.doc("upload_agent_config_file")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentConfigQuery)})
    @console_ns.expect(console_ns.models[AgentConfigFileUploadPayload.__name__])
    @console_ns.response(201, "Updated config manifest", console_ns.models[AgentConfigManifestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    @with_current_user
    def post(self, current_user: Account, app_model: App):
        payload = AgentConfigFileUploadPayload.model_validate(console_ns.payload or {})
        return _with_app_route_target(
            app_model=app_model,
            current_user=current_user,
            action=lambda target: _file_upload_response(target, payload),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/skills/<string:name>/inspect")
class AgentConfigSkillInspectByAgentApi(Resource):
    @console_ns.doc("inspect_agent_config_skill_by_agent")
    @console_ns.doc(
        params={"agent_id": "Agent ID", "name": "Config skill name", **query_params_from_model(AgentConfigByAgentQuery)}
    )
    @console_ns.response(200, "Config skill inspect view", console_ns.models[AgentConfigSkillInspectResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID, name: str):
        return _with_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            action=lambda target: _skill_inspect_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/<string:name>/inspect")
class AgentConfigSkillInspectApi(Resource):
    @console_ns.doc("inspect_agent_config_skill")
    @console_ns.doc(
        params={"app_id": "Application ID", "name": "Config skill name", **query_params_from_model(AgentConfigQuery)}
    )
    @console_ns.response(200, "Config skill inspect view", console_ns.models[AgentConfigSkillInspectResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    @with_current_user
    def get(self, current_user: Account, app_model: App, name: str):
        return _with_app_route_target(
            app_model=app_model,
            current_user=current_user,
            action=lambda target: _skill_inspect_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/skills/<string:name>/download")
class AgentConfigSkillDownloadByAgentApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID, name: str):
        return _with_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            action=lambda target: _skill_download_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/<string:name>/download")
class AgentConfigSkillDownloadApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    @with_current_user
    def get(self, current_user: Account, app_model: App, name: str):
        return _with_app_route_target(
            app_model=app_model,
            current_user=current_user,
            action=lambda target: _skill_download_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/skills/<string:name>")
class AgentConfigSkillByAgentApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def delete(self, tenant_id: str, current_user: Account, agent_id: UUID, name: str):
        return _with_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            action=lambda target: _skill_delete_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/<string:name>")
class AgentConfigSkillApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    @with_current_user
    def delete(self, current_user: Account, app_model: App, name: str):
        return _with_app_route_target(
            app_model=app_model,
            current_user=current_user,
            action=lambda target: _skill_delete_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/files/<string:name>/preview")
class AgentConfigFilePreviewByAgentApi(Resource):
    @console_ns.response(200, "Preview", console_ns.models[AgentConfigPreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID, name: str):
        return _with_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            action=lambda target: _file_preview_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/files/<string:name>/preview")
class AgentConfigFilePreviewApi(Resource):
    @console_ns.response(200, "Preview", console_ns.models[AgentConfigPreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    @with_current_user
    def get(self, current_user: Account, app_model: App, name: str):
        return _with_app_route_target(
            app_model=app_model,
            current_user=current_user,
            action=lambda target: _file_preview_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/files/<string:name>/download")
class AgentConfigFileDownloadByAgentApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID, name: str):
        return _with_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            action=lambda target: _file_download_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/files/<string:name>/download")
class AgentConfigFileDownloadApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    @with_current_user
    def get(self, current_user: Account, app_model: App, name: str):
        return _with_app_route_target(
            app_model=app_model,
            current_user=current_user,
            action=lambda target: _file_download_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/files/<string:name>")
class AgentConfigFileByAgentApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def delete(self, tenant_id: str, current_user: Account, agent_id: UUID, name: str):
        return _with_agent_route_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            current_user=current_user,
            action=lambda target: _file_delete_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/files/<string:name>")
class AgentConfigFileApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    @with_current_user
    def delete(self, current_user: Account, app_model: App, name: str):
        return _with_app_route_target(
            app_model=app_model,
            current_user=current_user,
            action=lambda target: _file_delete_response(target, name),
        )


__all__ = [name for name, value in globals().items() if inspect.isclass(value) and issubclass(value, Resource)]

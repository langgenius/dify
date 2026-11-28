"""Console API for Agent Soul-backed config assets."""

from __future__ import annotations

import inspect
import io
import json
from collections.abc import Callable, Mapping
from functools import wraps
from http import HTTPStatus
from typing import Any, Concatenate, Literal, NoReturn
from uuid import UUID

from flask import Response, after_this_request, make_response, request, send_file, url_for
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field

from controllers.common.fields import BinaryFileResponse
from controllers.common.rbac import AgentId, PlainApp, RBACCheck
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.error import AgentNotBoundError, AppNotFoundError, AppUnavailableError
from controllers.console.app.preview_admission import get_preview_app
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.agent_fields import AgentAppComposerResponse
from fields.base import ResponseModel
from libs.exception import RelayedHTTPError
from libs.external_api import document_errors, error_responses
from libs.flask_restx_compat import BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.agent.agent_config_contracts import (
    AgentConfigNodeUnboundError,
    AgentConfigRuntimeMissingError,
    AgentConfigSelection,
    AgentConfigVersionKind,
    AgentConfigVersionMissingError,
    AgentConfigWorkflowMissingError,
)
from services.agent.config_service import (
    AgentConfigServiceError,
    ConfigPushFileItem,
    ConfigPushPayload,
    ConfigPushSkillItem,
)
from services.agent.errors import AgentNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_preview_query_service import AppPreviewRef


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


class AgentConfigFilesUploadPayload(BaseModel):
    upload_file_ids: list[UUID] = Field(
        ..., min_length=1, description="UploadFile UUIDs from POST /console/api/files/upload, in replacement order"
    )


_AGENT_CONFIG_SKILL_UPLOAD_PARAMS = {
    "file": {
        "in": "formData",
        "type": "file",
        "required": True,
        "description": "Skill package (.zip or .skill).",
    }
}


class AgentConfigSkillFileQuery(AgentConfigQuery):
    path: str = Field(..., description="Normalized zip member path inside the skill package")


class AgentConfigSkillFileByAgentQuery(AgentConfigByAgentQuery):
    path: str = Field(..., description="Normalized zip member path inside the skill package")


class AgentConfigVersionResponse(ResponseModel):
    id: str
    kind: Literal["snapshot", "draft", "build_draft"]
    writable: bool


class AgentConfigSkillItemResponse(ResponseModel):
    id: str
    name: str
    file_id: str | None = None
    is_missing: bool = False
    description: str = ""
    size: int | None = None
    mime_type: str | None = None
    hash: str | None = None


class AgentConfigFileItemResponse(ResponseModel):
    id: str
    name: str
    file_id: str | None = None
    is_missing: bool = False
    size: int | None = None
    mime_type: str | None = None
    hash: str | None = None


class AgentConfigSkillItemsResponse(ResponseModel):
    items: list[AgentConfigSkillItemResponse] = Field(default_factory=list)


class AgentConfigFileItemsResponse(ResponseModel):
    items: list[AgentConfigFileItemResponse] = Field(default_factory=list)


class AgentConfigSkillUploadResponse(ResponseModel):
    skill: AgentConfigSkillItemResponse
    config_version: AgentConfigVersionResponse


class AgentConfigFileUploadResponse(ResponseModel):
    file: AgentConfigFileItemResponse
    config_version: AgentConfigVersionResponse


class AgentConfigFilesUploadResponse(ResponseModel):
    files: list[AgentConfigFileItemResponse]
    config_version: AgentConfigVersionResponse


class AgentConfigManifestResponse(ResponseModel):
    agent_id: str
    config_version: AgentConfigVersionResponse
    skills: AgentConfigSkillItemsResponse = Field(default_factory=AgentConfigSkillItemsResponse)
    files: AgentConfigFileItemsResponse = Field(default_factory=AgentConfigFileItemsResponse)
    env_keys: list[str] = Field(default_factory=list)
    note: str = ""


class AgentConfigSkillListResponse(ResponseModel):
    agent_id: str
    config_version: AgentConfigVersionResponse
    items: list[AgentConfigSkillItemResponse] = Field(default_factory=list)


class AgentConfigFileListResponse(ResponseModel):
    agent_id: str
    config_version: AgentConfigVersionResponse
    items: list[AgentConfigFileItemResponse] = Field(default_factory=list)


class AgentConfigSkillFileResponse(ResponseModel):
    path: str
    name: str
    type: Literal["file", "directory"]
    previewable: bool
    downloadable: bool


class AgentConfigSkillMarkdownResponse(ResponseModel):
    path: Literal["SKILL.md"]
    size: int | None = None
    truncated: bool
    binary: Literal[False]
    text: str


class AgentConfigSkillInspectResponse(ResponseModel):
    id: str
    name: str
    description: str = ""
    size: int | None = None
    mime_type: str | None = None
    hash: str | None = None
    source: Literal["config_skill_zip"]
    files: list[AgentConfigSkillFileResponse] = Field(default_factory=list)
    file_tree: list[dict[str, Any]] | None = None
    skill_md: AgentConfigSkillMarkdownResponse
    warnings: list[str] = Field(default_factory=list)


class AgentConfigFilePreviewResponse(ResponseModel):
    name: str
    size: int | None = None
    truncated: bool
    binary: bool
    text: str | None = None


class AgentConfigSkillFilePreviewResponse(ResponseModel):
    path: str
    size: int | None = None
    truncated: bool
    binary: bool
    text: str | None = None


class AgentConfigDownloadResponse(ResponseModel):
    url: str


class AgentConfigDeleteResponse(ResponseModel):
    result: Literal["success"]
    removed_names: list[str] = Field(default_factory=list)


register_schema_models(console_ns, AgentConfigFileUploadPayload, AgentConfigFilesUploadPayload)
register_response_schema_models(
    console_ns,
    BinaryFileResponse,
    AgentConfigDeleteResponse,
    AgentConfigDownloadResponse,
    AgentConfigFileItemResponse,
    AgentConfigFileItemsResponse,
    AgentConfigFileListResponse,
    AgentConfigFilePreviewResponse,
    AgentConfigFileUploadResponse,
    AgentConfigFilesUploadResponse,
    AgentConfigManifestResponse,
    AgentConfigSkillFilePreviewResponse,
    AgentConfigSkillFileResponse,
    AgentConfigSkillInspectResponse,
    AgentConfigSkillItemResponse,
    AgentConfigSkillItemsResponse,
    AgentConfigSkillListResponse,
    AgentConfigSkillMarkdownResponse,
    AgentConfigSkillUploadResponse,
    AgentConfigVersionResponse,
)


_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})


class TrialAgentConfigQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_id: UUID | None = Field(default=None, description="Must match the current published template snapshot")


class TrialAgentSkillFileQuery(TrialAgentConfigQuery):
    path: str = Field(description="Normalized member path inside the published Skill package")


register_schema_models(console_ns, TrialAgentConfigQuery, TrialAgentSkillFileQuery)


def _with_trial_config[T, Q: TrialAgentConfigQuery, **P](
    view: Callable[Concatenate[T, AgentConfigSelection, Q, P], Response | dict[str, object]],
) -> Callable[Concatenate[T, Q, AppPreviewRef, P], Response]:
    @wraps(view)
    def decorated(self: T, query: Q, app: AppPreviewRef, /, *args: P.args, **kwargs: P.kwargs) -> Response:
        @after_this_request
        def _no_store(response: Response) -> Response:
            # Published template assets and their errors are never cached by the browser.
            response.headers["Cache-Control"] = "no-store"
            return response

        try:
            state = AgentAppComposerResponse.model_validate(
                application_services().app_previews.get_agent_composer(app=app)
            )
            snapshot = state.active_config_snapshot
            if snapshot is None or (query.version_id is not None and str(query.version_id) != snapshot.id):
                raise AgentConfigServiceError(
                    "config_version_not_found", "published template version is unavailable", status_code=404
                )
            target = AgentConfigSelection(
                tenant_id=app.tenant_id,
                agent_id=state.agent.id,
                account_id=None,
                version_id=snapshot.id,
                version_kind=AgentConfigVersionKind.SNAPSHOT,
            )
            return make_response(view(self, target, query, *args, **kwargs))
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None
        except AgentConfigServiceError as exc:
            # Raised, not returned, so the surface's error handler builds the body.
            raise _relayed_error(exc) from exc

    return document_errors(decorated, AppUnavailableError, RelayedHTTPError)


def _relayed_error(exc: AgentConfigServiceError) -> RelayedHTTPError:
    return RelayedHTTPError(status=exc.status_code, error_code=exc.code, message=exc.message)


def _handle(exc: AgentConfigServiceError) -> NoReturn:
    raise _relayed_error(exc) from exc


def _json_response(data: Mapping[str, Any]) -> Response:
    return Response(
        response=json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        content_type="application/json; charset=utf-8",
    )


def _resolve_agent_route_target(
    *, context: RequestContext, agent_id: UUID, query: AgentConfigByAgentQuery
) -> AgentConfigSelection:
    """Select the Agent asset version and release its session before asset operations."""
    try:
        return application_services().agent_apps.access.resolve_config_selection(
            context,
            str(agent_id),
            version_id=query.version_id,
            build=query.draft_type == "debug_build",
            for_write=request.method in {"POST", "PUT", "PATCH", "DELETE"},
        )
    except AgentConfigRuntimeMissingError as exc:
        raise AgentNotFoundError from exc
    except AgentConfigVersionMissingError as exc:
        raise AgentConfigServiceError(
            "config_version_not_found", "agent config version was not found", status_code=HTTPStatus.NOT_FOUND
        ) from exc


def _resolve_app_route_target(
    *, context: RequestContext, app_id: UUID, query: AgentConfigQuery
) -> AgentConfigSelection:
    """Select a Workflow node's config in the admitted workspace."""
    try:
        return application_services().agent_apps.access.resolve_workflow_config_selection(
            context,
            str(app_id),
            node_id=query.node_id,
            version_id=query.version_id,
            build=query.draft_type == "debug_build",
            for_write=request.method in {"POST", "PUT", "PATCH", "DELETE"},
        )
    except AgentConfigWorkflowMissingError as exc:
        raise AppNotFoundError(*exc.args) from exc
    except AgentConfigNodeUnboundError as exc:
        raise AgentNotBoundError from exc
    except AgentConfigRuntimeMissingError as exc:
        raise AgentNotFoundError from exc
    except AgentConfigVersionMissingError as exc:
        raise AgentConfigServiceError(
            "config_version_not_found", "agent config version was not found", status_code=HTTPStatus.NOT_FOUND
        ) from exc


def _with_agent_route_target[T](
    *, context: RequestContext, agent_id: UUID, action: Callable[[AgentConfigSelection], T]
) -> T:
    """Resolve an admitted Agent configuration, then run the transport renderer."""
    query = query_params_from_request(AgentConfigByAgentQuery)
    try:
        return action(_resolve_agent_route_target(context=context, agent_id=agent_id, query=query))
    except AgentConfigServiceError as exc:
        _handle(exc)


def _with_app_route_target[T](
    *, context: RequestContext, app_id: UUID, action: Callable[[AgentConfigSelection], T]
) -> T:
    """Resolve the workflow config before executing the selected asset action."""
    query = query_params_from_request(AgentConfigQuery)
    try:
        return action(_resolve_app_route_target(context=context, app_id=app_id, query=query))
    except AgentConfigServiceError as exc:
        _handle(exc)


def _manifest_response(target: AgentConfigSelection) -> dict[str, object]:
    return application_services().agent_apps.config_assets.manifest(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        user_id=target.account_id,
    )


def _skill_list_response(target: AgentConfigSelection) -> dict[str, object]:
    return application_services().agent_apps.config_assets.list_skills(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        user_id=target.account_id,
    )


def _file_list_response(target: AgentConfigSelection) -> dict[str, object]:
    return application_services().agent_apps.config_assets.list_files(
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


def _skill_upload_response(target: AgentConfigSelection) -> tuple[dict[str, object], int]:
    assert target.account_id is not None
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
    manifest = application_services().agent_apps.config_assets.upload_skill_for_console(
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
    target: AgentConfigSelection, payload: AgentConfigFileUploadPayload
) -> tuple[dict[str, object], int]:
    assert target.account_id is not None
    manifest = application_services().agent_apps.config_assets.push_file_for_console(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        user_id=target.account_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        upload_file_id=payload.upload_file_id,
    )
    return manifest, 201


def _files_upload_response(
    target: AgentConfigSelection, payload: AgentConfigFilesUploadPayload
) -> tuple[dict[str, Any], int]:
    assert target.account_id is not None
    result = application_services().agent_apps.config_assets.push_files_for_console(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        user_id=target.account_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        upload_file_ids=[str(file_id) for file_id in payload.upload_file_ids],
    )
    return dump_response(AgentConfigFilesUploadResponse, result), 201


def _skill_inspect_response(target: AgentConfigSelection, name: str) -> Response:
    return _json_response(
        application_services().agent_apps.config_assets.inspect_skill(
            tenant_id=target.tenant_id,
            agent_id=target.agent_id,
            config_version_id=target.version_id,
            config_version_kind=target.version_kind,
            name=name,
            user_id=target.account_id,
        )
    )


def _skill_download_response(target: AgentConfigSelection, name: str) -> Response:
    return _json_response(
        {
            "url": application_services().agent_apps.config_assets.download_skill_url(
                tenant_id=target.tenant_id,
                agent_id=target.agent_id,
                config_version_id=target.version_id,
                config_version_kind=target.version_kind,
                name=name,
                user_id=target.account_id,
            )
        }
    )


def _skill_file_preview_response(target: AgentConfigSelection, name: str, path: str) -> dict[str, object]:
    return application_services().agent_apps.config_assets.preview_skill_file(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        name=name,
        path=path,
        user_id=target.account_id,
    )


def _skill_file_download_response(
    target: AgentConfigSelection,
    *,
    name: str,
    path: str,
    raw_endpoint: str,
    route_params: dict[str, str],
    extra_query_params: dict[str, str] | None = None,
) -> Response:
    member_path = application_services().agent_apps.config_assets.resolve_skill_file_member_path(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        name=name,
        path=path,
        user_id=target.account_id,
    )
    query_args: dict[str, str] = {"path": member_path}
    if extra_query_params:
        query_args.update(extra_query_params)
    if target.version_kind == AgentConfigVersionKind.SNAPSHOT:
        query_args["version_id"] = target.version_id
    elif target.version_kind == AgentConfigVersionKind.BUILD_DRAFT:
        query_args["draft_type"] = "debug_build"
    url = url_for(raw_endpoint, _external=False, name=name, **route_params, **query_args)
    return _json_response({"url": url})


def _skill_file_raw_download_response(target: AgentConfigSelection, name: str, path: str) -> Response:
    download = application_services().agent_apps.config_assets.pull_skill_file(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        name=name,
        path=path,
        user_id=target.account_id,
    )
    return send_file(
        io.BytesIO(download.payload),
        mimetype=download.mime_type,
        as_attachment=True,
        download_name=download.filename,
    )


def _skill_delete_response(target: AgentConfigSelection, name: str) -> dict[str, object]:
    assert target.account_id is not None
    application_services().agent_apps.config_assets.push_for_console(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        user_id=target.account_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        payload=ConfigPushPayload(skills=[ConfigPushSkillItem(name=name)]),
    )
    return {"result": "success", "removed_names": [name]}


def _file_preview_response(target: AgentConfigSelection, name: str) -> dict[str, object]:
    return application_services().agent_apps.config_assets.preview_file(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        name=name,
        user_id=target.account_id,
    )


def _file_download_response(target: AgentConfigSelection, name: str) -> Response:
    return _json_response(
        {
            "url": application_services().agent_apps.config_assets.download_file_url(
                tenant_id=target.tenant_id,
                agent_id=target.agent_id,
                config_version_id=target.version_id,
                config_version_kind=target.version_kind,
                name=name,
                user_id=target.account_id,
            )
        }
    )


def _file_delete_response(target: AgentConfigSelection, name: str) -> dict[str, object]:
    assert target.account_id is not None
    application_services().agent_apps.config_assets.push_for_console(
        tenant_id=target.tenant_id,
        agent_id=target.agent_id,
        user_id=target.account_id,
        config_version_id=target.version_id,
        config_version_kind=target.version_kind,
        payload=ConfigPushPayload(files=[ConfigPushFileItem(name=name)]),
    )
    return {"result": "success", "removed_names": [name]}


@console_ns.route("/agent/<uuid:agent_id>/config/manifest")
class AgentConfigManifestByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("get_agent_config_manifest_by_agent")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentConfigByAgentQuery)})
    @console_ns.response(
        HTTPStatus.OK, "Agent config manifest", console_ns.models[AgentConfigManifestResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Get the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=_manifest_response,
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/manifest")
class AgentConfigManifestApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("get_agent_config_manifest")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentConfigQuery)})
    @console_ns.response(
        HTTPStatus.OK, "Agent config manifest", console_ns.models[AgentConfigManifestResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Get the selected workflow Agent configuration asset."""
        return _with_app_route_target(context=context, app_id=app_id, action=_manifest_response)


@console_ns.route("/agent/<uuid:agent_id>/config/skills/upload")
class AgentConfigSkillUploadByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("upload_agent_config_skill_by_agent")
    @console_ns.doc(
        consumes=["multipart/form-data"],
        params={
            "agent_id": "Agent ID",
            **query_params_from_model(AgentConfigByAgentQuery),
            **_AGENT_CONFIG_SKILL_UPLOAD_PARAMS,
        },
    )
    @console_ns.response(
        HTTPStatus.CREATED, "Uploaded config skill", console_ns.models[AgentConfigSkillUploadResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    def post(self, context: RequestContext, agent_id: UUID) -> tuple[dict[str, object], int]:
        """Post the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=_skill_upload_response,
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/upload")
class AgentConfigSkillUploadApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("upload_agent_config_skill")
    @console_ns.doc(
        consumes=["multipart/form-data"],
        params={
            "app_id": "Application ID",
            **query_params_from_model(AgentConfigQuery),
            **_AGENT_CONFIG_SKILL_UPLOAD_PARAMS,
        },
    )
    @console_ns.response(
        HTTPStatus.CREATED, "Uploaded config skill", console_ns.models[AgentConfigSkillUploadResponse.__name__]
    )
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())])
    def post(self, context: RequestContext, app_id: UUID) -> tuple[dict[str, object], int]:
        """Post the selected workflow Agent configuration asset."""
        return _with_app_route_target(context=context, app_id=app_id, action=_skill_upload_response)


@console_ns.route("/agent/<uuid:agent_id>/config/skills")
class AgentConfigSkillsByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("get_agent_config_skills_by_agent")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentConfigByAgentQuery)})
    @console_ns.response(HTTPStatus.OK, "Config skills", console_ns.models[AgentConfigSkillListResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Get the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=_skill_list_response,
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills")
class AgentConfigSkillsApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("get_agent_config_skills")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentConfigQuery)})
    @console_ns.response(HTTPStatus.OK, "Config skills", console_ns.models[AgentConfigSkillListResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Get the selected workflow Agent configuration asset."""
        return _with_app_route_target(context=context, app_id=app_id, action=_skill_list_response)


@console_ns.route("/agent/<uuid:agent_id>/config/files")
class AgentConfigFilesByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("get_agent_config_files_by_agent")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentConfigByAgentQuery)})
    @console_ns.response(HTTPStatus.OK, "Config files", console_ns.models[AgentConfigFileListResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Get the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=_file_list_response,
        )

    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("upload_agent_config_file_by_agent")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentConfigByAgentQuery)})
    @console_ns.expect(console_ns.models[AgentConfigFileUploadPayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED, "Uploaded config file", console_ns.models[AgentConfigFileUploadResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    @model_validate(AgentConfigFileUploadPayload)
    def post(
        self,
        req_data: AgentConfigFileUploadPayload,
        context: RequestContext,
        agent_id: UUID,
    ) -> tuple[dict[str, object], int]:
        """Post the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=lambda target: _file_upload_response(target, req_data),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/files")
class AgentConfigFilesApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("get_agent_config_files")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentConfigQuery)})
    @console_ns.response(HTTPStatus.OK, "Config files", console_ns.models[AgentConfigFileListResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Get the selected workflow Agent configuration asset."""
        return _with_app_route_target(context=context, app_id=app_id, action=_file_list_response)

    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("upload_agent_config_file")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentConfigQuery)})
    @console_ns.expect(console_ns.models[AgentConfigFileUploadPayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED, "Uploaded config file", console_ns.models[AgentConfigFileUploadResponse.__name__]
    )
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())])
    @model_validate(AgentConfigFileUploadPayload)
    def post(
        self, req_data: AgentConfigFileUploadPayload, context: RequestContext, app_id: UUID
    ) -> tuple[dict[str, object], int]:
        """Post the selected workflow Agent configuration asset."""
        return _with_app_route_target(
            context=context,
            app_id=app_id,
            action=lambda target: _file_upload_response(target, req_data),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/files/batch")
class AgentConfigFilesUploadByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("upload_agent_config_files_by_agent")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentConfigByAgentQuery)})
    @console_ns.expect(console_ns.models[AgentConfigFilesUploadPayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED, "Bound config files", console_ns.models[AgentConfigFilesUploadResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    @model_validate(AgentConfigFilesUploadPayload)
    def post(
        self,
        req_data: AgentConfigFilesUploadPayload,
        context: RequestContext,
        agent_id: UUID,
    ) -> tuple[dict[str, object], int]:
        """Post the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=lambda target: _files_upload_response(target, req_data),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/files/batch")
class AgentConfigFilesUploadApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("upload_agent_config_files")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentConfigQuery)})
    @console_ns.expect(console_ns.models[AgentConfigFilesUploadPayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED, "Bound config files", console_ns.models[AgentConfigFilesUploadResponse.__name__]
    )
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())])
    @model_validate(AgentConfigFilesUploadPayload)
    def post(
        self, req_data: AgentConfigFilesUploadPayload, context: RequestContext, app_id: UUID
    ) -> tuple[dict[str, object], int]:
        """Post the selected workflow Agent configuration asset."""
        return _with_app_route_target(
            context=context,
            app_id=app_id,
            action=lambda target: _files_upload_response(target, req_data),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/skills/<string:name>/inspect")
class AgentConfigSkillInspectByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("inspect_agent_config_skill_by_agent")
    @console_ns.doc(
        params={"agent_id": "Agent ID", "name": "Config skill name", **query_params_from_model(AgentConfigByAgentQuery)}
    )
    @console_ns.response(
        HTTPStatus.OK, "Config skill inspect view", console_ns.models[AgentConfigSkillInspectResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, name: str) -> Response:
        """Get the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=lambda target: _skill_inspect_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/<string:name>/inspect")
class AgentConfigSkillInspectApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("inspect_agent_config_skill")
    @console_ns.doc(
        params={"app_id": "Application ID", "name": "Config skill name", **query_params_from_model(AgentConfigQuery)}
    )
    @console_ns.response(
        HTTPStatus.OK, "Config skill inspect view", console_ns.models[AgentConfigSkillInspectResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID, name: str) -> Response:
        """Get the selected workflow Agent configuration asset."""
        return _with_app_route_target(
            context=context,
            app_id=app_id,
            action=lambda target: _skill_inspect_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/skills/<string:name>/files/preview")
class AgentConfigSkillFilePreviewByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("preview_agent_config_skill_file_by_agent")
    @console_ns.doc(
        params={
            "agent_id": "Agent ID",
            "name": "Config skill name",
            **query_params_from_model(AgentConfigSkillFileByAgentQuery),
        }
    )
    @console_ns.response(
        HTTPStatus.OK, "Config skill file preview", console_ns.models[AgentConfigSkillFilePreviewResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, name: str) -> dict[str, object]:
        """Get the selected Agent configuration asset for the admitted account."""
        query = query_params_from_request(AgentConfigSkillFileByAgentQuery)
        try:
            target = _resolve_agent_route_target(
                context=context,
                agent_id=agent_id,
                query=query,
            )
            return _skill_file_preview_response(target, name, query.path)
        except AgentConfigServiceError as exc:
            _handle(exc)


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/<string:name>/files/preview")
class AgentConfigSkillFilePreviewApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("preview_agent_config_skill_file")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "name": "Config skill name",
            **query_params_from_model(AgentConfigSkillFileQuery),
        }
    )
    @console_ns.response(
        HTTPStatus.OK, "Config skill file preview", console_ns.models[AgentConfigSkillFilePreviewResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID, name: str) -> dict[str, object]:
        """Get the selected workflow Agent configuration asset."""
        query = query_params_from_request(AgentConfigSkillFileQuery)
        try:
            target = _resolve_app_route_target(context=context, app_id=app_id, query=query)
            return _skill_file_preview_response(target, name, query.path)
        except AgentConfigServiceError as exc:
            _handle(exc)


@console_ns.route("/agent/<uuid:agent_id>/config/skills/<string:name>/download")
class AgentConfigSkillDownloadByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("download_agent_config_skill_by_agent")
    @console_ns.doc(
        params={"agent_id": "Agent ID", "name": "Config skill name", **query_params_from_model(AgentConfigByAgentQuery)}
    )
    @console_ns.response(
        HTTPStatus.OK, "Config skill download URL", console_ns.models[AgentConfigDownloadResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, name: str) -> Response:
        """Get the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=lambda target: _skill_download_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/<string:name>/download")
class AgentConfigSkillDownloadApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("download_agent_config_skill")
    @console_ns.doc(
        params={"app_id": "Application ID", "name": "Config skill name", **query_params_from_model(AgentConfigQuery)}
    )
    @console_ns.response(
        HTTPStatus.OK, "Config skill download URL", console_ns.models[AgentConfigDownloadResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID, name: str) -> Response:
        """Get the selected workflow Agent configuration asset."""
        return _with_app_route_target(
            context=context,
            app_id=app_id,
            action=lambda target: _skill_download_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/skills/<string:name>/files/download")
class AgentConfigSkillFileDownloadByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("download_agent_config_skill_file_by_agent")
    @console_ns.doc(
        params={
            "agent_id": "Agent ID",
            "name": "Config skill name",
            **query_params_from_model(AgentConfigSkillFileByAgentQuery),
        }
    )
    @console_ns.response(
        HTTPStatus.OK, "Config skill file download URL", console_ns.models[AgentConfigDownloadResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, name: str) -> Response:
        """Get the selected Agent configuration asset for the admitted account."""
        query = query_params_from_request(AgentConfigSkillFileByAgentQuery)
        try:
            target = _resolve_agent_route_target(
                context=context,
                agent_id=agent_id,
                query=query,
            )
            return _skill_file_download_response(
                target,
                name=name,
                path=query.path,
                raw_endpoint="console.agent_config_skill_file_download_content_by_agent_api",
                route_params={"agent_id": str(agent_id)},
            )
        except AgentConfigServiceError as exc:
            _handle(exc)


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/<string:name>/files/download")
class AgentConfigSkillFileDownloadApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("download_agent_config_skill_file")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "name": "Config skill name",
            **query_params_from_model(AgentConfigSkillFileQuery),
        }
    )
    @console_ns.response(
        HTTPStatus.OK, "Config skill file download URL", console_ns.models[AgentConfigDownloadResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID, name: str) -> Response:
        """Get the selected workflow Agent configuration asset."""
        query = query_params_from_request(AgentConfigSkillFileQuery)
        try:
            target = _resolve_app_route_target(context=context, app_id=app_id, query=query)
            return _skill_file_download_response(
                target,
                name=name,
                path=query.path,
                raw_endpoint="console.agent_config_skill_file_download_content_api",
                route_params={"app_id": str(app_id)},
                extra_query_params={"node_id": query.node_id} if query.node_id else None,
            )
        except AgentConfigServiceError as exc:
            _handle(exc)


@console_ns.route(
    "/agent/<uuid:agent_id>/config/skills/<string:name>/files/content",
    endpoint="agent_config_skill_file_download_content_by_agent_api",
)
class AgentConfigSkillFileDownloadContentByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, name: str) -> Response:
        """Get the selected Agent configuration asset for the admitted account."""
        query = query_params_from_request(AgentConfigSkillFileByAgentQuery)
        try:
            target = _resolve_agent_route_target(
                context=context,
                agent_id=agent_id,
                query=query,
            )
            return _skill_file_raw_download_response(target, name, query.path)
        except AgentConfigServiceError as exc:
            _handle(exc)


@console_ns.route(
    "/apps/<uuid:app_id>/agent/config/skills/<string:name>/files/content",
    endpoint="agent_config_skill_file_download_content_api",
)
class AgentConfigSkillFileDownloadContentApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID, name: str) -> Response:
        """Get the selected workflow Agent configuration asset."""
        query = query_params_from_request(AgentConfigSkillFileQuery)
        try:
            target = _resolve_app_route_target(context=context, app_id=app_id, query=query)
            return _skill_file_raw_download_response(target, name, query.path)
        except AgentConfigServiceError as exc:
            _handle(exc)


@console_ns.route("/agent/<uuid:agent_id>/config/skills/<string:name>")
class AgentConfigSkillByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("delete_agent_config_skill_by_agent")
    @console_ns.doc(
        params={"agent_id": "Agent ID", "name": "Config skill name", **query_params_from_model(AgentConfigByAgentQuery)}
    )
    @console_ns.response(HTTPStatus.OK, "Config skill deleted", console_ns.models[AgentConfigDeleteResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    def delete(self, context: RequestContext, agent_id: UUID, name: str) -> dict[str, object]:
        """Delete the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=lambda target: _skill_delete_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/skills/<string:name>")
class AgentConfigSkillApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("delete_agent_config_skill")
    @console_ns.doc(
        params={"app_id": "Application ID", "name": "Config skill name", **query_params_from_model(AgentConfigQuery)}
    )
    @console_ns.response(HTTPStatus.OK, "Config skill deleted", console_ns.models[AgentConfigDeleteResponse.__name__])
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())])
    def delete(self, context: RequestContext, app_id: UUID, name: str) -> dict[str, object]:
        """Delete the selected workflow Agent configuration asset."""
        return _with_app_route_target(
            context=context,
            app_id=app_id,
            action=lambda target: _skill_delete_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/files/<string:name>/preview")
class AgentConfigFilePreviewByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("preview_agent_config_file_by_agent")
    @console_ns.doc(
        params={"agent_id": "Agent ID", "name": "Config file name", **query_params_from_model(AgentConfigByAgentQuery)}
    )
    @console_ns.response(HTTPStatus.OK, "Preview", console_ns.models[AgentConfigFilePreviewResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, name: str) -> dict[str, object]:
        """Get the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=lambda target: _file_preview_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/files/<string:name>/preview")
class AgentConfigFilePreviewApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("preview_agent_config_file")
    @console_ns.doc(
        params={"app_id": "Application ID", "name": "Config file name", **query_params_from_model(AgentConfigQuery)}
    )
    @console_ns.response(HTTPStatus.OK, "Preview", console_ns.models[AgentConfigFilePreviewResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID, name: str) -> dict[str, object]:
        """Get the selected workflow Agent configuration asset."""
        return _with_app_route_target(
            context=context,
            app_id=app_id,
            action=lambda target: _file_preview_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/files/<string:name>/download")
class AgentConfigFileDownloadByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("download_agent_config_file_by_agent")
    @console_ns.doc(
        params={"agent_id": "Agent ID", "name": "Config file name", **query_params_from_model(AgentConfigByAgentQuery)}
    )
    @console_ns.response(
        HTTPStatus.OK, "Config file download URL", console_ns.models[AgentConfigDownloadResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, name: str) -> Response:
        """Get the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=lambda target: _file_download_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/files/<string:name>/download")
class AgentConfigFileDownloadApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("download_agent_config_file")
    @console_ns.doc(
        params={"app_id": "Application ID", "name": "Config file name", **query_params_from_model(AgentConfigQuery)}
    )
    @console_ns.response(
        HTTPStatus.OK, "Config file download URL", console_ns.models[AgentConfigDownloadResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID, name: str) -> Response:
        """Get the selected workflow Agent configuration asset."""
        return _with_app_route_target(
            context=context,
            app_id=app_id,
            action=lambda target: _file_download_response(target, name),
        )


@console_ns.route("/agent/<uuid:agent_id>/config/files/<string:name>")
class AgentConfigFileByAgentApi(Resource):
    @error_responses(AgentNotFoundError, RelayedHTTPError)
    @console_ns.doc("delete_agent_config_file_by_agent")
    @console_ns.doc(
        params={"agent_id": "Agent ID", "name": "Config file name", **query_params_from_model(AgentConfigByAgentQuery)}
    )
    @console_ns.response(HTTPStatus.OK, "Config file deleted", console_ns.models[AgentConfigDeleteResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    def delete(self, context: RequestContext, agent_id: UUID, name: str) -> dict[str, object]:
        """Delete the selected Agent configuration asset for the admitted account."""
        return _with_agent_route_target(
            context=context,
            agent_id=agent_id,
            action=lambda target: _file_delete_response(target, name),
        )


@console_ns.route("/apps/<uuid:app_id>/agent/config/files/<string:name>")
class AgentConfigFileApi(Resource):
    @error_responses(AgentNotBoundError, AgentNotFoundError, AppNotFoundError, RelayedHTTPError)
    @console_ns.doc("delete_agent_config_file")
    @console_ns.doc(
        params={"app_id": "Application ID", "name": "Config file name", **query_params_from_model(AgentConfigQuery)}
    )
    @console_ns.response(HTTPStatus.OK, "Config file deleted", console_ns.models[AgentConfigDeleteResponse.__name__])
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())])
    def delete(self, context: RequestContext, app_id: UUID, name: str) -> dict[str, object]:
        """Delete the selected workflow Agent configuration asset."""
        return _with_app_route_target(
            context=context,
            app_id=app_id,
            action=lambda target: _file_delete_response(target, name),
        )


@console_ns.route("/trial-apps/<uuid:app_id>/agent/config/skills")
class TrialAgentConfigSkillsApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialAgentConfigQuery))
    @console_ns.response(200, "Published template resource", console_ns.models[AgentConfigSkillListResponse.__name__])
    @get_preview_app
    @model_validate(TrialAgentConfigQuery)
    @_with_trial_config
    def get(self, target: AgentConfigSelection, _query: TrialAgentConfigQuery) -> dict[str, object]:
        return dump_response(AgentConfigSkillListResponse, _skill_list_response(target))


@console_ns.route("/trial-apps/<uuid:app_id>/agent/config/files")
class TrialAgentConfigFilesApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialAgentConfigQuery))
    @console_ns.response(200, "Published template resource", console_ns.models[AgentConfigFileListResponse.__name__])
    @get_preview_app
    @model_validate(TrialAgentConfigQuery)
    @_with_trial_config
    def get(self, target: AgentConfigSelection, _query: TrialAgentConfigQuery) -> dict[str, object]:
        return dump_response(AgentConfigFileListResponse, _file_list_response(target))


@console_ns.route("/trial-apps/<uuid:app_id>/agent/config/skills/<string:name>/inspect")
class TrialAgentConfigSkillInspectApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialAgentConfigQuery))
    @console_ns.response(
        200, "Published template resource", console_ns.models[AgentConfigSkillInspectResponse.__name__]
    )
    @get_preview_app
    @model_validate(TrialAgentConfigQuery)
    @_with_trial_config
    def get(self, target: AgentConfigSelection, _query: TrialAgentConfigQuery, name: str) -> Response:
        return _skill_inspect_response(target, name)


@console_ns.route("/trial-apps/<uuid:app_id>/agent/config/skills/<string:name>/download")
class TrialAgentConfigSkillDownloadApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialAgentConfigQuery))
    @console_ns.response(200, "Published template resource", console_ns.models[AgentConfigDownloadResponse.__name__])
    @get_preview_app
    @model_validate(TrialAgentConfigQuery)
    @_with_trial_config
    def get(self, target: AgentConfigSelection, _query: TrialAgentConfigQuery, name: str) -> Response:
        return _skill_download_response(target, name)


@console_ns.route("/trial-apps/<uuid:app_id>/agent/config/skills/<string:name>/files/preview")
class TrialAgentConfigSkillFilePreviewApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialAgentSkillFileQuery))
    @console_ns.response(
        200, "Published template resource", console_ns.models[AgentConfigSkillFilePreviewResponse.__name__]
    )
    @get_preview_app
    @model_validate(TrialAgentSkillFileQuery)
    @_with_trial_config
    def get(self, target: AgentConfigSelection, query: TrialAgentSkillFileQuery, name: str) -> dict[str, object]:
        return dump_response(
            AgentConfigSkillFilePreviewResponse, _skill_file_preview_response(target, name, query.path)
        )


@console_ns.route("/trial-apps/<uuid:app_id>/agent/config/skills/<string:name>/files/download")
class TrialAgentConfigSkillFileDownloadApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialAgentSkillFileQuery))
    @console_ns.response(200, "Published template resource", console_ns.models[AgentConfigDownloadResponse.__name__])
    @get_preview_app
    @model_validate(TrialAgentSkillFileQuery)
    @_with_trial_config
    def get(self, target: AgentConfigSelection, query: TrialAgentSkillFileQuery, name: str) -> Response:
        assert request.view_args is not None
        return _skill_file_download_response(
            target,
            name=name,
            path=query.path,
            raw_endpoint="console.trial_agent_config_skill_file_content",
            route_params={"app_id": str(request.view_args["app_id"])},
        )


@console_ns.route(
    "/trial-apps/<uuid:app_id>/agent/config/skills/<string:name>/files/content",
    endpoint="trial_agent_config_skill_file_content",
)
class TrialAgentConfigSkillFileContentApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialAgentSkillFileQuery))
    @console_ns.doc(
        produces=["application/octet-stream"],
        vendor={BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY: ["application/octet-stream"]},
    )
    @console_ns.response(200, "Published template resource", console_ns.models[BinaryFileResponse.__name__])
    @get_preview_app
    @model_validate(TrialAgentSkillFileQuery)
    @_with_trial_config
    def get(self, target: AgentConfigSelection, query: TrialAgentSkillFileQuery, name: str) -> Response:
        return _skill_file_raw_download_response(target, name, query.path)


@console_ns.route("/trial-apps/<uuid:app_id>/agent/config/files/<string:name>/preview")
class TrialAgentConfigFilePreviewApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialAgentConfigQuery))
    @console_ns.response(200, "Published template resource", console_ns.models[AgentConfigFilePreviewResponse.__name__])
    @get_preview_app
    @model_validate(TrialAgentConfigQuery)
    @_with_trial_config
    def get(self, target: AgentConfigSelection, _query: TrialAgentConfigQuery, name: str) -> dict[str, object]:
        return dump_response(AgentConfigFilePreviewResponse, _file_preview_response(target, name))


@console_ns.route("/trial-apps/<uuid:app_id>/agent/config/files/<string:name>/download")
class TrialAgentConfigFileDownloadApi(Resource):
    @console_ns.doc(params=query_params_from_model(TrialAgentConfigQuery))
    @console_ns.response(200, "Published template resource", console_ns.models[AgentConfigDownloadResponse.__name__])
    @get_preview_app
    @model_validate(TrialAgentConfigQuery)
    @_with_trial_config
    def get(self, target: AgentConfigSelection, _query: TrialAgentConfigQuery, name: str) -> Response:
        return _file_download_response(target, name)


# pyrefly: ignore [unresolvable-dunder-all]
__all__ = [name for name, value in globals().items() if inspect.isclass(value) and issubclass(value, Resource)]

from typing import Any
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

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
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import uuid_value
from libs.login import login_required
from models import Account
from models.model import App, AppMode, UploadFile
from services.agent.composer_service import AgentComposerService
from services.agent.skill_package_service import SkillManifest, SkillPackageError
from services.agent.skill_standardize_service import SkillStandardizeService
from services.agent.skill_tool_inference_service import (
    SkillToolInferenceError,
    SkillToolInferenceResult,
    SkillToolInferenceService,
)
from services.agent_drive_service import (
    AgentDriveError,
    AgentDriveService,
    DriveCommitItem,
    DriveFileRef,
    normalize_drive_key,
)
from services.agent_service import AgentService

_WORKFLOW_AGENT_DRIVE_APP_MODES = [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT]
_AGENT_SKILL_UPLOAD_PARAMS = {
    "file": {
        "in": "formData",
        "type": "file",
        "required": True,
        "description": "Skill package (.zip or .skill).",
    }
}


class AgentLogQuery(BaseModel):
    message_id: str = Field(..., description="Message UUID")
    conversation_id: str = Field(..., description="Conversation UUID")

    @field_validator("message_id", "conversation_id")
    @classmethod
    def validate_uuid(cls, value: str) -> str:
        return uuid_value(value)


class AgentDriveFilePayload(BaseModel):
    upload_file_id: str = Field(..., description="UploadFile UUID from POST /console/api/files/upload")

    @field_validator("upload_file_id")
    @classmethod
    def validate_upload_file_id(cls, value: str) -> str:
        return uuid_value(value)


class AgentDriveMutationQuery(BaseModel):
    node_id: str | None = Field(default=None, description="Workflow node ID (workflow composer variant)")


class AgentDriveDeleteFileQuery(AgentDriveMutationQuery):
    key: str = Field(min_length=1, description="Drive key, e.g. files/sample.pdf")


class AgentDriveDeleteFileByAgentQuery(BaseModel):
    key: str = Field(min_length=1, description="Drive key, e.g. files/sample.pdf")


class AgentLogMetaResponse(ResponseModel):
    status: str
    executor: str
    start_time: str
    elapsed_time: float | None = None
    total_tokens: int
    agent_mode: str
    iterations: int


class AgentToolCallResponse(ResponseModel):
    status: str
    error: str | None = None
    time_cost: float | int
    tool_name: str
    tool_label: str
    tool_input: dict[str, Any]
    tool_output: dict[str, Any]
    tool_parameters: dict[str, Any]
    tool_icon: Any = Field(default=None)


class AgentIterationLogResponse(ResponseModel):
    tokens: int
    tool_calls: list[AgentToolCallResponse]
    tool_raw: dict[str, Any]
    thought: str | None = None
    created_at: str
    files: list[Any] = Field(default_factory=list)


class AgentLogResponse(ResponseModel):
    meta: AgentLogMetaResponse
    iterations: list[AgentIterationLogResponse]
    files: list[Any] = Field(default_factory=list)


class AgentUploadedSkillResponse(ResponseModel):
    name: str
    description: str
    path: str
    skill_md_key: str
    archive_key: str | None = None


class AgentSkillUploadResponse(ResponseModel):
    skill: AgentUploadedSkillResponse
    manifest: SkillManifest


class AgentDriveFileResponse(ResponseModel):
    name: str
    drive_key: str
    file_id: str
    size: int | None = None
    mime_type: str | None = None


class AgentDriveFileCommitResponse(ResponseModel):
    file: AgentDriveFileResponse


class AgentDriveDeleteResponse(ResponseModel):
    result: str
    removed_keys: list[str] = Field(default_factory=list)


register_schema_models(console_ns, AgentLogQuery, AgentDriveFilePayload, AgentDriveDeleteFileByAgentQuery)
register_response_schema_models(
    console_ns,
    AgentDriveDeleteResponse,
    AgentDriveFileCommitResponse,
    AgentDriveFileResponse,
    AgentLogResponse,
    AgentUploadedSkillResponse,
    AgentSkillUploadResponse,
    SkillToolInferenceResult,
)


def _resolve_agent_id(app_model: App, node_id: str | None) -> str | None:
    if node_id and app_model.mode != AppMode.AGENT:
        return AgentComposerService.resolve_workflow_node_agent_id(
            tenant_id=app_model.tenant_id, app_id=app_model.id, node_id=node_id, session=db.session()
        )
    return app_model.bound_agent_id


def _agent_not_bound() -> tuple[dict[str, str], int]:
    return {"code": "agent_not_bound", "message": "no agent is bound for this app/node"}, 400


def _upload_skill_for_app(*, current_user: Account, app_model: App):
    """Upload one skill package and commit its normalized files into the agent drive."""

    query = query_params_from_request(AgentDriveMutationQuery)
    agent_id = _resolve_agent_id(app_model, query.node_id)
    if not agent_id:
        return _agent_not_bound()
    if "file" not in request.files:
        return {"code": "no_file", "message": "no skill file uploaded"}, 400
    if len(request.files) > 1:
        return {"code": "too_many_files", "message": "only one skill file is allowed"}, 400

    upload = request.files["file"]
    content = upload.stream.read()
    try:
        result = SkillStandardizeService().standardize(
            content=content,
            filename=upload.filename or "",
            tenant_id=app_model.tenant_id,
            user_id=current_user.id,
            agent_id=agent_id,
            session=db.session(),
        )
    except (SkillPackageError, AgentDriveError) as exc:
        return {"code": exc.code, "message": exc.message}, exc.status_code
    return result, 201


def _commit_drive_file_for_app(*, current_user: Account, app_model: App, allow_node_id: bool = True):
    query = query_params_from_request(AgentDriveMutationQuery)
    node_id = query.node_id if allow_node_id else None
    agent_id = _resolve_agent_id(app_model, node_id)
    if not agent_id:
        return _agent_not_bound()
    payload = AgentDriveFilePayload.model_validate(console_ns.payload or {})

    upload_file = db.session.scalar(
        select(UploadFile).where(
            UploadFile.id == payload.upload_file_id,
            UploadFile.tenant_id == app_model.tenant_id,
        )
    )
    if upload_file is None:
        return {"code": "upload_file_not_found", "message": "upload file not found in this workspace"}, 404

    try:
        key = normalize_drive_key(f"files/{upload_file.name}")
        committed = AgentDriveService().commit(
            tenant_id=app_model.tenant_id,
            user_id=current_user.id,
            agent_id=agent_id,
            items=[
                DriveCommitItem(
                    key=key,
                    file_ref=DriveFileRef(kind="upload_file", id=upload_file.id),
                    # ADD FILE uploads exist solely to live in the drive, so the
                    # drive owns (and physically cleans) the value on delete.
                    value_owned_by_drive=True,
                )
            ],
            session=db.session(),
        )
    except AgentDriveError as exc:
        return {"code": exc.code, "message": exc.message}, exc.status_code

    row = committed[0]
    return {
        "file": {
            "name": upload_file.name,
            "drive_key": row["key"],
            "file_id": upload_file.id,
            "size": row.get("size"),
            "mime_type": row.get("mime_type"),
        },
    }, 201


def _delete_drive_file_for_app(*, current_user: Account, app_model: App, allow_node_id: bool = True):
    query = query_params_from_request(AgentDriveDeleteFileQuery)
    node_id = query.node_id if allow_node_id else None
    agent_id = _resolve_agent_id(app_model, node_id)
    if not agent_id:
        return _agent_not_bound()
    try:
        key = normalize_drive_key(query.key)
    except AgentDriveError as exc:
        return {"code": exc.code, "message": exc.message}, exc.status_code

    try:
        result = AgentDriveService().commit(
            tenant_id=app_model.tenant_id,
            user_id=current_user.id,
            agent_id=agent_id,
            items=[DriveCommitItem(key=key, file_ref=None)],
            session=db.session(),
        )
    except AgentDriveError as exc:
        return {"code": exc.code, "message": exc.message}, exc.status_code
    removed_keys = [item["key"] for item in result if item.get("removed")]
    return {"result": "success", "removed_keys": removed_keys}


def _delete_skill_for_app(*, current_user: Account, app_model: App, slug: str, allow_node_id: bool = True):
    query = query_params_from_request(AgentDriveMutationQuery)
    node_id = query.node_id if allow_node_id else None
    agent_id = _resolve_agent_id(app_model, node_id)
    if not agent_id:
        return _agent_not_bound()
    if "/" in slug or not slug.strip():
        return {"code": "drive_key_invalid", "message": "skill slug must be a single path segment"}, 400

    try:
        result = AgentDriveService().commit(
            tenant_id=app_model.tenant_id,
            user_id=current_user.id,
            agent_id=agent_id,
            items=[
                DriveCommitItem(key=f"{slug}/SKILL.md", file_ref=None),
                DriveCommitItem(key=f"{slug}/.DIFY-SKILL-FULL.zip", file_ref=None),
            ],
            session=db.session(),
        )
    except AgentDriveError as exc:
        return {"code": exc.code, "message": exc.message}, exc.status_code
    removed_keys = [item["key"] for item in result if item.get("removed")]
    return {"result": "success", "removed_keys": removed_keys}


def _infer_skill_tools_for_app(*, app_model: App, slug: str):
    query = query_params_from_request(AgentDriveMutationQuery)
    agent_id = _resolve_agent_id(app_model, query.node_id)
    if not agent_id:
        return _agent_not_bound()
    if "/" in slug or not slug.strip():
        return {"code": "drive_key_invalid", "message": "skill slug must be a single path segment"}, 400
    try:
        return SkillToolInferenceService().infer(
            tenant_id=app_model.tenant_id, agent_id=agent_id, slug=slug, session=db.session()
        )
    except SkillToolInferenceError as exc:
        return {"code": exc.code, "message": exc.message}, exc.status_code


@console_ns.route("/apps/<uuid:app_id>/agent/logs")
class AgentLogApi(Resource):
    @console_ns.doc("get_agent_logs")
    @console_ns.doc(description="Get agent execution logs for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(AgentLogQuery))
    @console_ns.response(200, "Agent logs retrieved successfully", console_ns.models[AgentLogResponse.__name__])
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    def get(self, app_model: App):
        """Get agent logs"""
        args = AgentLogQuery.model_validate(request.args.to_dict(flat=True))

        return AgentService.get_agent_logs(app_model, args.conversation_id, args.message_id, db.session())


@console_ns.route("/agent/<uuid:agent_id>/skills/upload")
class AgentSkillUploadByAgentApi(Resource):
    @console_ns.doc("upload_agent_skill_by_agent")
    @console_ns.doc(description="Upload + standardize a Skill into an Agent App drive")
    @console_ns.doc(consumes=["multipart/form-data"], params={"agent_id": "Agent ID", **_AGENT_SKILL_UPLOAD_PARAMS})
    @console_ns.response(201, "Skill uploaded into drive", console_ns.models[AgentSkillUploadResponse.__name__])
    @console_ns.response(400, "Invalid skill package or no bound agent")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = resolve_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
        return _upload_skill_for_app(current_user=current_user, app_model=app_model)


@console_ns.route("/apps/<uuid:app_id>/agent/skills/upload")
class AgentSkillUploadApi(Resource):
    @console_ns.doc("upload_agent_skill")
    @console_ns.doc(description="Upload + standardize a Skill into the agent drive")
    @console_ns.doc(
        consumes=["multipart/form-data"],
        params={
            "app_id": "Application ID",
            **query_params_from_model(AgentDriveMutationQuery),
            **_AGENT_SKILL_UPLOAD_PARAMS,
        },
    )
    @console_ns.response(201, "Skill uploaded into drive", console_ns.models[AgentSkillUploadResponse.__name__])
    @console_ns.response(400, "Invalid skill package or no bound agent")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_AGENT_DRIVE_APP_MODES)
    @with_current_user
    def post(self, current_user: Account, app_model: App):
        """Upload a Skill, validate it, and commit drive-backed skill files."""
        return _upload_skill_for_app(current_user=current_user, app_model=app_model)


@console_ns.route("/agent/<uuid:agent_id>/files")
class AgentDriveFilesByAgentApi(Resource):
    @console_ns.doc("commit_agent_drive_file_by_agent")
    @console_ns.doc(description="Commit an uploaded file into the Agent App drive under files/<name>")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.expect(console_ns.models[AgentDriveFilePayload.__name__])
    @console_ns.response(
        201, "File committed into the agent drive", console_ns.models[AgentDriveFileCommitResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = resolve_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
        return _commit_drive_file_for_app(current_user=current_user, app_model=app_model, allow_node_id=False)

    @console_ns.doc("delete_agent_drive_file_by_agent")
    @console_ns.doc(description="Delete one Agent App drive file by key")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentDriveDeleteFileByAgentQuery)})
    @console_ns.response(200, "File removed", console_ns.models[AgentDriveDeleteResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def delete(self, tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = resolve_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
        return _delete_drive_file_for_app(current_user=current_user, app_model=app_model, allow_node_id=False)


@console_ns.route("/apps/<uuid:app_id>/agent/files")
class AgentDriveFilesApi(Resource):
    @console_ns.doc("commit_agent_drive_file")
    @console_ns.doc(description="Commit an uploaded file into the agent drive under files/<name> (ENG-625 D3)")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentDriveMutationQuery)})
    @console_ns.expect(console_ns.models[AgentDriveFilePayload.__name__])
    @console_ns.response(
        201, "File committed into the agent drive", console_ns.models[AgentDriveFileCommitResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_AGENT_DRIVE_APP_MODES)
    @with_current_user
    def post(self, current_user: Account, app_model: App):
        """ADD FILE: commit one uploaded file into the bound agent's drive."""
        return _commit_drive_file_for_app(current_user=current_user, app_model=app_model)

    @console_ns.doc("delete_agent_drive_file")
    @console_ns.doc(description="Delete one drive file by key via drive commit-null semantics")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentDriveDeleteFileQuery)})
    @console_ns.response(200, "File removed", console_ns.models[AgentDriveDeleteResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_AGENT_DRIVE_APP_MODES)
    @with_current_user
    def delete(self, current_user: Account, app_model: App):
        return _delete_drive_file_for_app(current_user=current_user, app_model=app_model)


@console_ns.route("/agent/<uuid:agent_id>/skills/<string:slug>")
class AgentSkillByAgentApi(Resource):
    @console_ns.doc("delete_agent_skill_by_agent")
    @console_ns.doc(description="Delete a standardized skill from an Agent App drive")
    @console_ns.doc(params={"agent_id": "Agent ID", "slug": "Skill slug (single path segment)"})
    @console_ns.response(200, "Skill removed", console_ns.models[AgentDriveDeleteResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def delete(self, tenant_id: str, current_user: Account, agent_id: UUID, slug: str):
        app_model = resolve_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
        return _delete_skill_for_app(current_user=current_user, app_model=app_model, slug=slug, allow_node_id=False)


@console_ns.route("/apps/<uuid:app_id>/agent/skills/<string:slug>")
class AgentSkillApi(Resource):
    @console_ns.doc("delete_agent_skill")
    @console_ns.doc(description="Delete a standardized skill by removing its known drive keys via commit-null")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "slug": "Skill slug (single path segment)",
            **query_params_from_model(AgentDriveMutationQuery),
        }
    )
    @console_ns.response(200, "Skill removed", console_ns.models[AgentDriveDeleteResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_AGENT_DRIVE_APP_MODES)
    @with_current_user
    def delete(self, current_user: Account, app_model: App, slug: str):
        return _delete_skill_for_app(current_user=current_user, app_model=app_model, slug=slug)


@console_ns.route("/agent/<uuid:agent_id>/skills/<string:slug>/infer-tools")
class AgentSkillInferToolsByAgentApi(Resource):
    @console_ns.doc("infer_agent_skill_tools_by_agent")
    @console_ns.doc(description="Infer CLI tool + ENV suggestions from a standardized Agent App skill")
    @console_ns.doc(params={"agent_id": "Agent ID", "slug": "Skill slug (single path segment)"})
    @console_ns.response(
        200,
        "Inference result (draft suggestions, nothing persisted)",
        console_ns.models[SkillToolInferenceResult.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, agent_id: UUID, slug: str):
        app_model = resolve_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
        return _infer_skill_tools_for_app(app_model=app_model, slug=slug)


@console_ns.route("/apps/<uuid:app_id>/agent/skills/<string:slug>/infer-tools")
class AgentSkillInferToolsApi(Resource):
    @console_ns.doc("infer_agent_skill_tools")
    @console_ns.doc(
        description="Infer CLI tool + ENV suggestions from a standardized skill's SKILL.md (draft only, ENG-371)"
    )
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "slug": "Skill slug (single path segment)",
            **query_params_from_model(AgentDriveMutationQuery),
        }
    )
    @console_ns.response(
        200,
        "Inference result (draft suggestions, nothing persisted)",
        console_ns.models[SkillToolInferenceResult.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_AGENT_DRIVE_APP_MODES)
    def post(self, app_model: App, slug: str):
        """Suggest CLI tools/env for a skill. Saving still goes through composer validation."""
        return _infer_skill_tools_for_app(app_model=app_model, slug=slug)

from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel, field_validator

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required, with_current_user
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import uuid_value
from libs.login import login_required
from models import Account
from models.model import App, AppMode
from services.agent.skill_package_service import SkillPackageError, SkillPackageService
from services.agent.skill_standardize_service import SkillStandardizeService
from services.agent_drive_service import AgentDriveError
from services.agent_service import AgentService
from services.file_service import FileService


class AgentLogQuery(BaseModel):
    message_id: str = Field(..., description="Message UUID")
    conversation_id: str = Field(..., description="Conversation UUID")

    @field_validator("message_id", "conversation_id")
    @classmethod
    def validate_uuid(cls, value: str) -> str:
        return uuid_value(value)


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


class AgentSkillUploadResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]


class AgentSkillStandardizeResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]


register_schema_models(console_ns, AgentLogQuery)
register_response_schema_models(console_ns, AgentLogResponse, AgentSkillUploadResponse, AgentSkillStandardizeResponse)


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
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    def get(self, app_model: App):
        """Get agent logs"""
        args = AgentLogQuery.model_validate(request.args.to_dict(flat=True))

        return AgentService.get_agent_logs(app_model, args.conversation_id, args.message_id)


@console_ns.route("/apps/<uuid:app_id>/agent/skills/upload")
class AgentSkillUploadApi(Resource):
    @console_ns.doc("upload_agent_skill")
    @console_ns.doc(description="Upload + validate a Skill package (.zip/.skill) and extract its manifest")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(201, "Skill validated", console_ns.models[AgentSkillUploadResponse.__name__])
    @console_ns.response(400, "Invalid skill package")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    @with_current_user
    def post(self, current_user: Account, app_model: App):
        """Validate an uploaded Skill package and persist the archive.

        Returns a validated skill ref (to bind into the Agent soul config on save)
        plus its manifest. Standardizing into the agent drive is ENG-594.
        """
        if "file" not in request.files:
            return {"code": "no_file", "message": "no skill file uploaded"}, 400
        if len(request.files) > 1:
            return {"code": "too_many_files", "message": "only one skill file is allowed"}, 400

        upload = request.files["file"]
        content = upload.stream.read()
        try:
            manifest = SkillPackageService().validate_and_extract(content=content, filename=upload.filename or "")
        except SkillPackageError as exc:
            return {"code": exc.code, "message": exc.message}, exc.status_code

        upload_file = FileService(db.engine).upload_file(
            filename=upload.filename or "skill.zip",
            content=content,
            mimetype=upload.mimetype or "application/zip",
            user=current_user,
        )
        skill_ref = manifest.to_skill_ref(file_id=upload_file.id)
        return {"skill": skill_ref.model_dump(exclude_none=True), "manifest": manifest.model_dump()}, 201


@console_ns.route("/apps/<uuid:app_id>/agent/skills/standardize")
class AgentSkillStandardizeApi(Resource):
    @console_ns.doc("standardize_agent_skill")
    @console_ns.doc(description="Validate + standardize a Skill into the agent drive (ENG-594)")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        201,
        "Skill standardized into drive",
        console_ns.models[AgentSkillStandardizeResponse.__name__],
    )
    @console_ns.response(400, "Invalid skill package or no bound agent")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    @with_current_user
    def post(self, current_user: Account, app_model: App):
        """Upload a Skill, validate it, and standardize it into the app agent's drive."""
        agent_id = app_model.bound_agent_id
        if not agent_id:
            return {"code": "no_bound_agent", "message": "app has no bound agent"}, 400
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
            )
        except (SkillPackageError, AgentDriveError) as exc:
            return {"code": exc.code, "message": exc.message}, exc.status_code
        return result, 201

import logging

from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required, with_current_user
from extensions.ext_database import db
from libs.helper import uuid_value
from libs.login import login_required
from models import Account
from models.model import App, AppMode, UploadFile
from services.agent.composer_service import AgentComposerService
from services.agent.skill_package_service import SkillPackageError, SkillPackageService
from services.agent.skill_standardize_service import SkillStandardizeService
from services.agent.skill_tool_inference_service import SkillToolInferenceError, SkillToolInferenceService
from services.agent_drive_service import (
    AgentDriveError,
    AgentDriveService,
    DriveCommitItem,
    DriveFileRef,
    normalize_drive_key,
)
from services.agent_service import AgentService
from services.file_service import FileService

logger = logging.getLogger(__name__)


class AgentLogQuery(BaseModel):
    message_id: str = Field(..., description="Message UUID")
    conversation_id: str = Field(..., description="Conversation UUID")

    @field_validator("message_id", "conversation_id")
    @classmethod
    def validate_uuid(cls, value: str) -> str:
        return uuid_value(value)


register_schema_models(console_ns, AgentLogQuery)


@console_ns.route("/apps/<uuid:app_id>/agent/logs")
class AgentLogApi(Resource):
    @console_ns.doc("get_agent_logs")
    @console_ns.doc(description="Get agent execution logs for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AgentLogQuery.__name__])
    @console_ns.response(
        200, "Agent logs retrieved successfully", fields.List(fields.Raw(description="Agent log entries"))
    )
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
    @console_ns.response(201, "Skill validated")
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
    @console_ns.response(201, "Skill standardized into drive")
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


class AgentDriveFilePayload(BaseModel):
    upload_file_id: str = Field(..., description="UploadFile UUID from POST /console/api/files/upload")

    @field_validator("upload_file_id")
    @classmethod
    def validate_upload_file_id(cls, value: str) -> str:
        return uuid_value(value)


register_schema_models(console_ns, AgentDriveFilePayload)


@console_ns.route("/apps/<uuid:app_id>/agent/files")
class AgentDriveFilesApi(Resource):
    @console_ns.doc("commit_agent_drive_file")
    @console_ns.doc(description="Commit an uploaded file into the agent drive under files/<name> (ENG-625 D3)")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AgentDriveFilePayload.__name__])
    @console_ns.response(201, "File committed into the agent drive")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    @with_current_user
    def post(self, current_user: Account, app_model: App):
        """ADD FILE: commit one uploaded file into the bound agent's drive."""
        agent_id = app_model.bound_agent_id
        if not agent_id:
            return {"code": "agent_not_bound", "message": "app has no bound agent"}, 400
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
            }
        }, 201

    @console_ns.doc("delete_agent_drive_file")
    @console_ns.doc(description="Delete one drive file by key; soul ref first, then the KV row (ENG-625 D5)")
    @console_ns.doc(params={"app_id": "Application ID", "key": "Drive key, e.g. files/sample.pdf"})
    @console_ns.response(200, "File removed")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    @with_current_user
    def delete(self, current_user: Account, app_model: App):
        agent_id = app_model.bound_agent_id
        if not agent_id:
            return {"code": "agent_not_bound", "message": "app has no bound agent"}, 400
        raw_key = request.args.get("key", "")
        try:
            key = normalize_drive_key(raw_key)
        except AgentDriveError as exc:
            return {"code": exc.code, "message": exc.message}, exc.status_code

        config_version_id = AgentComposerService.remove_drive_refs(
            tenant_id=app_model.tenant_id,
            agent_id=agent_id,
            account_id=current_user.id,
            file_key=key,
        )
        removed_keys: list[str] = []
        try:
            removed_keys = AgentDriveService().delete(tenant_id=app_model.tenant_id, agent_id=agent_id, key=key)
        except AgentDriveError as exc:
            return {"code": exc.code, "message": exc.message}, exc.status_code
        except Exception:
            # Soul-first ordering: the ref is already gone; orphan KV rows are
            # harmless and an idempotent DELETE retry cleans them.
            logger.exception("agent drive delete failed for key %s (soul already updated)", key)
        return {"result": "success", "removed_keys": removed_keys, "config_version_id": config_version_id}


@console_ns.route("/apps/<uuid:app_id>/agent/skills/<string:slug>")
class AgentSkillApi(Resource):
    @console_ns.doc("delete_agent_skill")
    @console_ns.doc(
        description="Delete a standardized skill: soul ref first, then the <slug>/ drive prefix (ENG-625 D5)"
    )
    @console_ns.doc(params={"app_id": "Application ID", "slug": "Skill slug (single path segment)"})
    @console_ns.response(200, "Skill removed")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    @with_current_user
    def delete(self, current_user: Account, app_model: App, slug: str):
        agent_id = app_model.bound_agent_id
        if not agent_id:
            return {"code": "agent_not_bound", "message": "app has no bound agent"}, 400
        if "/" in slug or not slug.strip():
            return {"code": "drive_key_invalid", "message": "skill slug must be a single path segment"}, 400

        config_version_id = AgentComposerService.remove_drive_refs(
            tenant_id=app_model.tenant_id,
            agent_id=agent_id,
            account_id=current_user.id,
            skill_slug=slug,
        )
        removed_keys: list[str] = []
        try:
            removed_keys = AgentDriveService().delete(
                tenant_id=app_model.tenant_id, agent_id=agent_id, prefix=f"{slug}/"
            )
        except AgentDriveError as exc:
            return {"code": exc.code, "message": exc.message}, exc.status_code
        except Exception:
            logger.exception("agent drive delete failed for skill %s (soul already updated)", slug)
        return {"result": "success", "removed_keys": removed_keys, "config_version_id": config_version_id}


@console_ns.route("/apps/<uuid:app_id>/agent/skills/<string:slug>/infer-tools")
class AgentSkillInferToolsApi(Resource):
    @console_ns.doc("infer_agent_skill_tools")
    @console_ns.doc(
        description="Infer CLI tool + ENV suggestions from a standardized skill's SKILL.md (draft only, ENG-371)"
    )
    @console_ns.doc(params={"app_id": "Application ID", "slug": "Skill slug (single path segment)"})
    @console_ns.response(200, "Inference result (draft suggestions, nothing persisted)")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    def post(self, app_model: App, slug: str):
        """Suggest CLI tools/env for a skill. Saving still goes through composer validation."""
        agent_id = app_model.bound_agent_id
        if not agent_id:
            return {"code": "agent_not_bound", "message": "app has no bound agent"}, 400
        if "/" in slug or not slug.strip():
            return {"code": "drive_key_invalid", "message": "skill slug must be a single path segment"}, 400
        try:
            return SkillToolInferenceService().infer(tenant_id=app_model.tenant_id, agent_id=agent_id, slug=slug)
        except SkillToolInferenceError as exc:
            return {"code": exc.code, "message": exc.message}, exc.status_code

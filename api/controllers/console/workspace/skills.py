"""Console API for workspace-level Skill Management."""

from __future__ import annotations

import io

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from controllers.common.fields import BinaryFileResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.base import ResponseModel
from libs import helper
from libs.helper import dump_response
from libs.login import login_required
from models.account import Account
from models.model import App
from services.app_generate_service import AppGenerateService
from services.skill_management_service import (
    SkillAssistMessagePayload,
    SkillCreatePayload,
    SkillDraftFileOperationPayload,
    SkillDraftTreePayload,
    SkillImportPayload,
    SkillManagementService,
    SkillManagementServiceError,
    SkillMetadataPayload,
    SkillPublishPayload,
    SkillRestorePayload,
    SkillVersionUpdatePayload,
)

_FILE_UPLOAD_PARAMS = {
    "file": {
        "description": "Skill draft file payload",
        "in": "formData",
        "type": "file",
        "required": True,
    },
}


class WorkspaceSkillsQuery(BaseModel):
    keyword: str | None = Field(default=None, description="Search keyword matching skill name or description.")
    page: int = Field(default=1, ge=1, le=99999, description="Page number.")
    limit: int = Field(default=20, ge=1, le=100, description="Number of items per page.")
    tag: list[str] = Field(
        default_factory=list,
        description="Skill tag filters. Repeat the parameter for multiple tags.",
    )


class SkillDeletePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation_name: str | None = Field(
        default=None,
        description="Required when deleting a referenced Skill. Must match the Skill name.",
    )


class AgentSkillBindingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skill_ids: list[str] = Field(default_factory=list, description="Ordered Skill IDs bound to the Agent.")


class SkillFileQuery(BaseModel):
    path: str = Field(description="Skill file path relative to the Skill root.")
    version_id: str | None = Field(default=None, description="Optional published version ID. Omit for current draft.")


class SkillResponse(ResponseModel):
    id: str
    name: str
    display_name: str
    icon: str
    description: str
    tags: list[str] = Field(default_factory=list)
    name_manually_edited: bool = False
    visibility: str
    latest_published_version_id: str | None = None
    reference_count: int = 0
    created_by: str | None = None
    created_by_name: str | None = None
    updated_by: str | None = None
    updated_by_name: str | None = None
    created_at: int
    updated_at: int


class SkillFileResponse(ResponseModel):
    id: str | None = None
    path: str
    kind: str
    storage: str | None = None
    mime_type: str | None = None
    content: str | None = None
    tool_file_id: str | None = None
    size: int | None = None
    hash: str | None = None


class SkillFilePreviewResponse(ResponseModel):
    path: str
    mime_type: str
    content: str
    size: int
    hash: str


class SkillFileUploadResponse(ResponseModel):
    id: str
    name: str
    mime_type: str
    size: int
    hash: str


class SkillDetailResponse(SkillResponse):
    files: list[SkillFileResponse] = Field(default_factory=list)


class SkillListResponse(ResponseModel):
    data: list[SkillResponse] = Field(default_factory=list)
    has_more: bool = False
    limit: int = 20
    page: int = 1
    total: int = 0


class SkillTagResponse(ResponseModel):
    tag: str
    count: int


class SkillTagListResponse(ResponseModel):
    data: list[SkillTagResponse] = Field(default_factory=list)


class SkillVersionResponse(ResponseModel):
    id: str
    skill_id: str
    version_number: int
    version_name: str
    publish_note: str
    hash_code: str
    archive_size: int
    published_by: str | None = None
    published_by_name: str | None = None
    is_latest: bool = False
    created_at: int


class SkillVersionListResponse(ResponseModel):
    data: list[SkillVersionResponse] = Field(default_factory=list)


class SkillVersionDetailResponse(SkillVersionResponse):
    files: list[SkillFileResponse] = Field(default_factory=list)


class SkillVersionDeleteResponse(ResponseModel):
    id: str
    deleted: bool
    latest_published_version_id: str | None = None


class SkillReferenceResponse(ResponseModel):
    type: str
    agent_id: str
    agent_icon: str | None = None
    agent_icon_background: str | None = None
    agent_icon_type: str | None = None
    app_id: str | None = None
    name: str
    display_name: str
    workflow_id: str | None = None
    workflow_name: str | None = None
    workflow_icon: str | None = None
    workflow_icon_background: str | None = None
    workflow_icon_type: str | None = None
    workflow_version: str | None = None
    node_id: str | None = None
    node_name: str | None = None


class SkillReferenceListResponse(ResponseModel):
    data: list[SkillReferenceResponse] = Field(default_factory=list)


class SkillDeleteResponse(ResponseModel):
    id: str
    deleted: bool


class AgentSkillBindingItemResponse(ResponseModel):
    id: str
    priority: int
    name: str
    display_name: str
    icon: str
    description: str
    tags: list[str] = Field(default_factory=list)
    status: str
    file_count: int
    latest_published_version_id: str | None = None
    latest_published_at: int | None = None
    updated_at: int


class AgentSkillBindingsResponse(ResponseModel):
    agent_id: str
    skill_ids: list[str] = Field(default_factory=list)
    data: list[AgentSkillBindingItemResponse] = Field(default_factory=list)


register_schema_models(
    console_ns,
    WorkspaceSkillsQuery,
    SkillCreatePayload,
    SkillAssistMessagePayload,
    SkillMetadataPayload,
    SkillDraftFileOperationPayload,
    SkillDraftTreePayload,
    SkillPublishPayload,
    SkillRestorePayload,
    SkillVersionUpdatePayload,
    SkillDeletePayload,
    SkillFileQuery,
    AgentSkillBindingsPayload,
)

register_response_schema_models(
    console_ns,
    SkillResponse,
    SkillFileResponse,
    SkillFilePreviewResponse,
    SkillFileUploadResponse,
    SkillDetailResponse,
    SkillListResponse,
    SkillTagResponse,
    SkillTagListResponse,
    SkillVersionResponse,
    SkillVersionListResponse,
    SkillVersionDetailResponse,
    SkillVersionDeleteResponse,
    SkillReferenceResponse,
    SkillReferenceListResponse,
    SkillDeleteResponse,
    AgentSkillBindingItemResponse,
    AgentSkillBindingsResponse,
    BinaryFileResponse,
)


def _error_response(exc: SkillManagementServiceError) -> tuple[dict[str, str], int]:
    body: dict[str, object] = {"code": exc.code, "message": exc.message}
    if exc.details:
        body["details"] = exc.details
    return body, exc.status_code


@console_ns.route("/workspaces/current/skills")
class WorkspaceSkillsApi(Resource):
    @console_ns.doc(params=query_params_from_model(WorkspaceSkillsQuery))
    @console_ns.response(200, "Workspace skills", console_ns.models[SkillListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        query_input: dict[str, object] = {
            "keyword": request.args.get("keyword"),
            "tag": request.args.getlist("tag"),
        }
        if "limit" in request.args:
            query_input["limit"] = request.args.get("limit")
        if "page" in request.args:
            query_input["page"] = request.args.get("page")
        query = WorkspaceSkillsQuery.model_validate(query_input)
        result = SkillManagementService().list_skills(
            tenant_id=current_tenant_id,
            keyword=query.keyword,
            page=query.page,
            limit=query.limit,
            tags=[tag for tag in query.tag if tag],
        )
        return dump_response(SkillListResponse, result)

    @console_ns.expect(console_ns.models[SkillCreatePayload.__name__])
    @console_ns.response(201, "Skill created", console_ns.models[SkillDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        try:
            payload = SkillCreatePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService().create_skill(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                payload=payload,
            )
            return dump_response(SkillDetailResponse, result), 201
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except ValueError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/files/upload")
class WorkspaceSkillFileUploadApi(Resource):
    @console_ns.doc(consumes=["multipart/form-data"], params=_FILE_UPLOAD_PARAMS)
    @console_ns.response(201, "Skill draft file uploaded", console_ns.models[SkillFileUploadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        if "file" not in request.files:
            return {"code": "no_file_uploaded", "message": "no file uploaded"}, 400

        file = request.files["file"]
        if not file.filename:
            return {"code": "filename_missing", "message": "filename is required"}, 400

        result = SkillManagementService().upload_file(
            tenant_id=current_tenant_id,
            user_id=current_user.id,
            filename=file.filename,
            content=file.stream.read(),
            mime_type=file.mimetype,
        )
        return dump_response(SkillFileUploadResponse, result), 201


@console_ns.route("/workspaces/current/skills/tags")
class WorkspaceSkillTagsApi(Resource):
    @console_ns.response(200, "Workspace Skill tags", console_ns.models[SkillTagListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        result = SkillManagementService().list_tags(tenant_id=current_tenant_id)
        return dump_response(SkillTagListResponse, result)


@console_ns.route("/workspaces/current/skills/import")
class WorkspaceSkillImportApi(Resource):
    @console_ns.doc(description="Import a Skill zip package from multipart form field `file`.")
    @console_ns.response(201, "Skill imported", console_ns.models[SkillDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        upload = request.files.get("file")
        if upload is None:
            return {"code": "invalid_request", "message": "file is required"}, 400
        try:
            payload = SkillImportPayload(content=upload.read(), filename=upload.filename or "skill.zip")
            result = SkillManagementService().import_skill(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                payload=payload,
            )
            return dump_response(SkillDetailResponse, result), 201
        except (ValidationError, ValueError) as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>")
class WorkspaceSkillApi(Resource):
    @console_ns.response(200, "Skill detail", console_ns.models[SkillDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, skill_id: str):
        try:
            result = SkillManagementService().get_skill(tenant_id=current_tenant_id, skill_id=skill_id)
            return dump_response(SkillDetailResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)

    @console_ns.expect(console_ns.models[SkillMetadataPayload.__name__])
    @console_ns.response(200, "Skill updated", console_ns.models[SkillResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def patch(self, current_tenant_id: str, current_user: Account, skill_id: str):
        try:
            payload = SkillMetadataPayload.model_validate(console_ns.payload or {})
            result = SkillManagementService().update_metadata(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                skill_id=skill_id,
                payload=payload,
            )
            return dump_response(SkillResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except ValueError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)

    @console_ns.expect(console_ns.models[SkillDeletePayload.__name__])
    @console_ns.response(200, "Skill deleted", console_ns.models[SkillDeleteResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, skill_id: str):
        try:
            payload = SkillDeletePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService().delete_skill(
                tenant_id=current_tenant_id,
                skill_id=skill_id,
                confirmation_name=payload.confirmation_name,
            )
            return dump_response(SkillDeleteResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/duplicate")
class WorkspaceSkillDuplicateApi(Resource):
    @console_ns.response(201, "Skill duplicated", console_ns.models[SkillDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account, skill_id: str):
        try:
            result = SkillManagementService().duplicate_skill(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                skill_id=skill_id,
            )
            return dump_response(SkillDetailResponse, result), 201
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/export")
class WorkspaceSkillExportApi(Resource):
    @console_ns.response(200, "Published Skill zip archive")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, skill_id: str):
        try:
            result = SkillManagementService().pull_published_archive(tenant_id=current_tenant_id, skill_id=skill_id)
            return send_file(
                io.BytesIO(result.payload),
                mimetype=result.mime_type,
                as_attachment=True,
                download_name=result.filename,
            )
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/assist/messages")
class WorkspaceSkillAssistMessageApi(Resource):
    """Stream read-only Skill Authoring suggestions from the default workspace model."""

    @console_ns.expect(console_ns.models[SkillAssistMessagePayload.__name__])
    @console_ns.response(200, "Skill Authoring assistant event stream")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account, skill_id: str):
        try:
            payload = SkillAssistMessagePayload.model_validate(console_ns.payload or {})
            assistant_app, query = SkillManagementService().get_or_create_assistant_app(
                tenant_id=current_tenant_id,
                skill_id=skill_id,
                user_id=current_user.id,
                message=payload.message,
                attachments=payload.attachments,
                model_payload=payload.model,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)
        app_model = db.session().get(App, assistant_app.id)
        if app_model is None:
            return {"code": "skill_assistant_unavailable", "message": "Skill Authoring Agent is unavailable"}, 503
        response = AppGenerateService.generate(
            session=db.session(),
            app_model=app_model,
            user=current_user,
            args={"inputs": {}, "query": query, "auto_generate_name": False},
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
        )
        return helper.compact_generate_response(response)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/files")
class WorkspaceSkillFilesApi(Resource):
    @console_ns.expect(console_ns.models[SkillDraftFileOperationPayload.__name__])
    @console_ns.response(200, "Draft file operation applied", console_ns.models[SkillDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def patch(self, current_tenant_id: str, current_user: Account, skill_id: str):
        try:
            payload = SkillDraftFileOperationPayload.model_validate(console_ns.payload or {})
            result = SkillManagementService().apply_draft_file_operation(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                skill_id=skill_id,
                payload=payload,
            )
            return dump_response(SkillDetailResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except ValueError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)

    @console_ns.expect(console_ns.models[SkillDraftTreePayload.__name__])
    @console_ns.response(200, "Draft files replaced", console_ns.models[SkillDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def put(self, current_tenant_id: str, current_user: Account, skill_id: str):
        try:
            payload = SkillDraftTreePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService().replace_draft_tree(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                skill_id=skill_id,
                payload=payload,
            )
            return dump_response(SkillDetailResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except ValueError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/files/preview")
class WorkspaceSkillFilePreviewApi(Resource):
    @console_ns.doc(params=query_params_from_model(SkillFileQuery))
    @console_ns.response(200, "Skill file text preview", console_ns.models[SkillFilePreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, skill_id: str):
        try:
            query = SkillFileQuery.model_validate(
                {
                    "path": request.args.get("path"),
                    "version_id": request.args.get("version_id"),
                }
            )
            result = SkillManagementService().preview_file(
                tenant_id=current_tenant_id,
                skill_id=skill_id,
                path=query.path,
                version_id=query.version_id,
            )
            return dump_response(SkillFilePreviewResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except ValueError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/files/content")
class WorkspaceSkillFileContentApi(Resource):
    @console_ns.doc(params={**query_params_from_model(SkillFileQuery), "download": "Return as an attachment when 1."})
    @console_ns.response(200, "Skill file content", console_ns.models[BinaryFileResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, skill_id: str):
        try:
            query = SkillFileQuery.model_validate(
                {
                    "path": request.args.get("path"),
                    "version_id": request.args.get("version_id"),
                }
            )
            result = SkillManagementService().pull_file(
                tenant_id=current_tenant_id,
                skill_id=skill_id,
                path=query.path,
                version_id=query.version_id,
            )
            return send_file(
                io.BytesIO(result.payload),
                mimetype=result.mime_type,
                as_attachment=request.args.get("download") == "1",
                download_name=result.filename,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except ValueError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/publish")
class WorkspaceSkillPublishApi(Resource):
    @console_ns.expect(console_ns.models[SkillPublishPayload.__name__])
    @console_ns.response(200, "Skill published", console_ns.models[SkillVersionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account, skill_id: str):
        try:
            payload = SkillPublishPayload.model_validate(console_ns.payload or {})
            result = SkillManagementService().publish_skill(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                skill_id=skill_id,
                payload=payload,
            )
            return dump_response(SkillVersionResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/restore")
class WorkspaceSkillRestoreApi(Resource):
    @console_ns.expect(console_ns.models[SkillRestorePayload.__name__])
    @console_ns.response(200, "Skill version restored", console_ns.models[SkillVersionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account, skill_id: str):
        try:
            payload = SkillRestorePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService().restore_version(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                skill_id=skill_id,
                payload=payload,
            )
            return dump_response(SkillVersionResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/references")
class WorkspaceSkillReferencesApi(Resource):
    @console_ns.response(200, "Skill references", console_ns.models[SkillReferenceListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, skill_id: str):
        try:
            result = SkillManagementService().list_skill_references(tenant_id=current_tenant_id, skill_id=skill_id)
            return dump_response(SkillReferenceListResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/versions")
class WorkspaceSkillVersionsApi(Resource):
    @console_ns.response(200, "Skill versions", console_ns.models[SkillVersionListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, skill_id: str):
        try:
            result = SkillManagementService().list_versions(tenant_id=current_tenant_id, skill_id=skill_id)
            return dump_response(SkillVersionListResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/versions/<string:version_id>")
class WorkspaceSkillVersionApi(Resource):
    @console_ns.response(200, "Skill version detail", console_ns.models[SkillVersionDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, skill_id: str, version_id: str):
        try:
            result = SkillManagementService().get_version(
                tenant_id=current_tenant_id,
                skill_id=skill_id,
                version_id=version_id,
            )
            return dump_response(SkillVersionDetailResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)

    @console_ns.expect(console_ns.models[SkillVersionUpdatePayload.__name__])
    @console_ns.response(200, "Skill version updated", console_ns.models[SkillVersionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_tenant_id
    def patch(self, current_tenant_id: str, skill_id: str, version_id: str):
        try:
            payload = SkillVersionUpdatePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService().update_version(
                tenant_id=current_tenant_id,
                skill_id=skill_id,
                version_id=version_id,
                payload=payload,
            )
            return dump_response(SkillVersionResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)

    @console_ns.response(200, "Skill version deleted", console_ns.models[SkillVersionDeleteResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, current_user: Account, skill_id: str, version_id: str):
        try:
            result = SkillManagementService().delete_version(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                skill_id=skill_id,
                version_id=version_id,
            )
            return dump_response(SkillVersionDeleteResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/agents/<string:agent_id>/skills")
class WorkspaceAgentSkillBindingsApi(Resource):
    @console_ns.response(200, "Agent Skill bindings", console_ns.models[AgentSkillBindingsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, agent_id: str):
        result = SkillManagementService().list_agent_bindings(tenant_id=current_tenant_id, agent_id=agent_id)
        return dump_response(AgentSkillBindingsResponse, result)

    @console_ns.expect(console_ns.models[AgentSkillBindingsPayload.__name__])
    @console_ns.response(200, "Agent Skill bindings replaced", console_ns.models[AgentSkillBindingsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def put(self, current_tenant_id: str, current_user: Account, agent_id: str):
        try:
            payload = AgentSkillBindingsPayload.model_validate(console_ns.payload or {})
            result = SkillManagementService().replace_agent_bindings(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                agent_id=agent_id,
                skill_ids=payload.skill_ids,
            )
            return dump_response(AgentSkillBindingsResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


__all__ = [
    "WorkspaceAgentSkillBindingsApi",
    "WorkspaceSkillApi",
    "WorkspaceSkillDuplicateApi",
    "WorkspaceSkillExportApi",
    "WorkspaceSkillFilesApi",
    "WorkspaceSkillImportApi",
    "WorkspaceSkillPublishApi",
    "WorkspaceSkillReferencesApi",
    "WorkspaceSkillRestoreApi",
    "WorkspaceSkillTagsApi",
    "WorkspaceSkillVersionApi",
    "WorkspaceSkillVersionsApi",
    "WorkspaceSkillsApi",
]

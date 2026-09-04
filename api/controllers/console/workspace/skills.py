"""Console API for workspace-level Skill Management."""

from __future__ import annotations

import io

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from controllers.common.fields import BinaryFileResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    edit_permission_required,
)
from fields.base import ResponseModel
from libs import helper
from libs.helper import dump_response
from machinery.context import RequestContext
from services.skill_management_service import (
    SkillAssistMessagePayload,
    SkillCreatePayload,
    SkillDraftFileCheckPayload,
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
        description="Required when deleting a referenced Skill. Must match the Skill display name.",
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
    latest_published_version_number: int | None = None
    latest_published_at: int | None = None
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


class SkillFileCheckErrorResponse(ResponseModel):
    code: str
    message: str


class SkillFileCheckItemResponse(ResponseModel):
    path: str
    filename: str
    extension: str
    mime_type: str
    size: int
    errors: list[SkillFileCheckErrorResponse] = Field(default_factory=list)


class SkillFileCheckResponse(ResponseModel):
    data: dict[str, SkillFileCheckItemResponse] = Field(default_factory=dict)


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
    SkillDraftFileCheckPayload,
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
    SkillFileCheckErrorResponse,
    SkillFileCheckItemResponse,
    SkillFileCheckResponse,
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


def _error_response(exc: SkillManagementServiceError) -> tuple[dict[str, object], int]:
    body: dict[str, object] = {"code": exc.code, "message": exc.message}
    if exc.details:
        body["details"] = exc.details
    return body, exc.status_code


@console_ns.route("/workspaces/current/skills")
class WorkspaceSkillsApi(Resource):
    @console_ns.doc(params=query_params_from_model(WorkspaceSkillsQuery))
    @console_ns.response(200, "Workspace skills", console_ns.models[SkillListResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_VIEW,
        rbac_resource_required=False,
    )
    @with_session(write=False)
    def get(self, session: Session, request_context: RequestContext):
        query_input: dict[str, object] = {
            "keyword": request.args.get("keyword"),
            "tag": request.args.getlist("tag"),
        }
        if "limit" in request.args:
            query_input["limit"] = request.args.get("limit")
        if "page" in request.args:
            query_input["page"] = request.args.get("page")
        query = WorkspaceSkillsQuery.model_validate(query_input)
        result = SkillManagementService(session=session).list_skills(
            tenant_id=request_context.active_workspace_id,
            keyword=query.keyword,
            page=query.page,
            limit=query.limit,
            tags=[tag for tag in query.tag if tag],
        )
        return dump_response(SkillListResponse, result)

    @console_ns.expect(console_ns.models[SkillCreatePayload.__name__])
    @console_ns.response(201, "Skill created", console_ns.models[SkillDetailResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_EDIT,
        rbac_resource_required=False,
    )
    @edit_permission_required
    @with_session
    def post(self, session: Session, request_context: RequestContext):
        try:
            payload = SkillCreatePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).create_skill(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
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
    @console_account_admission()
    @edit_permission_required
    @with_session
    def post(self, session: Session, request_context: RequestContext):
        if "file" not in request.files:
            return {"code": "no_file_uploaded", "message": "no file uploaded"}, 400

        file = request.files["file"]
        if not file.filename:
            return {"code": "filename_missing", "message": "filename is required"}, 400

        try:
            result = SkillManagementService(session=session).upload_file(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
                filename=file.filename,
                content=file.stream.read(),
                mime_type=file.mimetype,
            )
            return dump_response(SkillFileUploadResponse, result), 201
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/tags")
class WorkspaceSkillTagsApi(Resource):
    @console_ns.response(200, "Workspace Skill tags", console_ns.models[SkillTagListResponse.__name__])
    @console_account_admission()
    @with_session(write=False)
    def get(self, session: Session, request_context: RequestContext):
        result = SkillManagementService(session=session).list_tags(tenant_id=request_context.active_workspace_id)
        return dump_response(SkillTagListResponse, result)


@console_ns.route("/workspaces/current/skills/import")
class WorkspaceSkillImportApi(Resource):
    @console_ns.doc(description="Import a Skill zip package from multipart form field `file`.")
    @console_ns.response(201, "Skill imported", console_ns.models[SkillDetailResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_EDIT,
        rbac_resource_required=False,
    )
    @edit_permission_required
    @with_session
    def post(self, session: Session, request_context: RequestContext):
        upload = request.files.get("file")
        if upload is None:
            return {"code": "invalid_request", "message": "file is required"}, 400
        try:
            payload = SkillImportPayload(content=upload.read(), filename=upload.filename or "skill.zip")
            result = SkillManagementService(session=session).import_skill(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
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
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_VIEW,
        rbac_resource_required=False,
    )
    @with_session(write=False)
    def get(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            result = SkillManagementService(session=session).get_skill(
                tenant_id=request_context.active_workspace_id, skill_id=skill_id
            )
            return dump_response(SkillDetailResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)

    @console_ns.expect(console_ns.models[SkillMetadataPayload.__name__])
    @console_ns.response(200, "Skill updated", console_ns.models[SkillResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_EDIT,
        rbac_resource_required=False,
    )
    @edit_permission_required
    @with_session
    def patch(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            payload = SkillMetadataPayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).update_metadata(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
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
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_DELETE,
        rbac_resource_required=False,
    )
    @edit_permission_required
    @with_session
    def delete(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            payload = SkillDeletePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).delete_skill(
                tenant_id=request_context.active_workspace_id,
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
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_EDIT,
        rbac_resource_required=False,
    )
    @edit_permission_required
    @with_session
    def post(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            result = SkillManagementService(session=session).duplicate_skill(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
                skill_id=skill_id,
            )
            return dump_response(SkillDetailResponse, result), 201
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/export")
class WorkspaceSkillExportApi(Resource):
    @console_ns.response(200, "Published Skill zip archive")
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_VIEW,
        rbac_resource_required=False,
    )
    @with_session(write=False)
    def get(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            result = SkillManagementService(session=session).pull_published_archive(
                tenant_id=request_context.active_workspace_id, skill_id=skill_id
            )
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
    @console_account_admission()
    @with_session
    def post(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            payload = SkillAssistMessagePayload.model_validate(console_ns.payload or {})
            response = SkillManagementService(session=session).create_assistant_action_stream(
                tenant_id=request_context.active_workspace_id,
                skill_id=skill_id,
                user_id=request_context.account_id,
                message=payload.message,
                attachments=payload.attachments,
                history=payload.history,
                model_payload=payload.model,
                target_path=payload.target_path,
            )
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)
        return helper.compact_generate_response(response)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/files/check")
class WorkspaceSkillFilesCheckApi(Resource):
    @console_ns.expect(console_ns.models[SkillDraftFileCheckPayload.__name__])
    @console_ns.response(200, "Draft files checked", console_ns.models[SkillFileCheckResponse.__name__])
    @console_account_admission()
    @edit_permission_required
    @with_session
    def post(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            payload = SkillDraftFileCheckPayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).check_draft_files(
                tenant_id=request_context.active_workspace_id,
                skill_id=skill_id,
                payload=payload,
            )
            return dump_response(SkillFileCheckResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except ValueError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/files")
class WorkspaceSkillFilesApi(Resource):
    @console_ns.expect(console_ns.models[SkillDraftFileOperationPayload.__name__])
    @console_ns.response(200, "Draft file operation applied", console_ns.models[SkillDetailResponse.__name__])
    @console_account_admission()
    @edit_permission_required
    @with_session
    def patch(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            payload = SkillDraftFileOperationPayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).apply_draft_file_operation(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
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
    @console_account_admission()
    @edit_permission_required
    @with_session
    def put(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            payload = SkillDraftTreePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).replace_draft_tree(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
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
    @console_account_admission()
    @with_session
    def get(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            query = SkillFileQuery.model_validate(
                {
                    "path": request.args.get("path"),
                    "version_id": request.args.get("version_id"),
                }
            )
            result = SkillManagementService(session=session).preview_file(
                tenant_id=request_context.active_workspace_id,
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
    @console_account_admission()
    @with_session
    def get(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            query = SkillFileQuery.model_validate(
                {
                    "path": request.args.get("path"),
                    "version_id": request.args.get("version_id"),
                }
            )
            result = SkillManagementService(session=session).pull_file(
                tenant_id=request_context.active_workspace_id,
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
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_PUBLISH,
        rbac_resource_required=False,
    )
    @edit_permission_required
    @with_session
    def post(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            payload = SkillPublishPayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).publish_skill(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
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
    @console_ns.response(200, "Skill version restored to draft", console_ns.models[SkillDetailResponse.__name__])
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.SKILL_PUBLISH,
        rbac_resource_required=False,
    )
    @edit_permission_required
    @with_session
    def post(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            payload = SkillRestorePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).restore_version(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
                skill_id=skill_id,
                payload=payload,
            )
            return dump_response(SkillDetailResponse, result)
        except ValidationError as exc:
            return {"code": "invalid_request", "message": str(exc)}, 400
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/references")
class WorkspaceSkillReferencesApi(Resource):
    @console_ns.response(200, "Skill references", console_ns.models[SkillReferenceListResponse.__name__])
    @console_account_admission()
    @with_session
    def get(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            result = SkillManagementService(session=session).list_skill_references(
                tenant_id=request_context.active_workspace_id, skill_id=skill_id
            )
            return dump_response(SkillReferenceListResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/versions")
class WorkspaceSkillVersionsApi(Resource):
    @console_ns.response(200, "Skill versions", console_ns.models[SkillVersionListResponse.__name__])
    @console_account_admission()
    @with_session
    def get(self, session: Session, request_context: RequestContext, skill_id: str):
        try:
            result = SkillManagementService(session=session).list_versions(
                tenant_id=request_context.active_workspace_id, skill_id=skill_id
            )
            return dump_response(SkillVersionListResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/skills/<string:skill_id>/versions/<string:version_id>")
class WorkspaceSkillVersionApi(Resource):
    @console_ns.response(200, "Skill version detail", console_ns.models[SkillVersionDetailResponse.__name__])
    @console_account_admission()
    @with_session
    def get(self, session: Session, request_context: RequestContext, skill_id: str, version_id: str):
        try:
            result = SkillManagementService(session=session).get_version(
                tenant_id=request_context.active_workspace_id,
                skill_id=skill_id,
                version_id=version_id,
            )
            return dump_response(SkillVersionDetailResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)

    @console_ns.expect(console_ns.models[SkillVersionUpdatePayload.__name__])
    @console_ns.response(200, "Skill version updated", console_ns.models[SkillVersionResponse.__name__])
    @console_account_admission()
    @edit_permission_required
    @with_session
    def patch(self, session: Session, request_context: RequestContext, skill_id: str, version_id: str):
        try:
            payload = SkillVersionUpdatePayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).update_version(
                tenant_id=request_context.active_workspace_id,
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
    @console_account_admission()
    @edit_permission_required
    @with_session
    def delete(self, session: Session, request_context: RequestContext, skill_id: str, version_id: str):
        try:
            result = SkillManagementService(session=session).delete_version(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
                skill_id=skill_id,
                version_id=version_id,
            )
            return dump_response(SkillVersionDeleteResponse, result)
        except SkillManagementServiceError as exc:
            return _error_response(exc)


@console_ns.route("/workspaces/current/agents/<string:agent_id>/skills")
class WorkspaceAgentSkillBindingsApi(Resource):
    @console_ns.response(200, "Agent Skill bindings", console_ns.models[AgentSkillBindingsResponse.__name__])
    @console_account_admission()
    @with_session
    def get(self, session: Session, request_context: RequestContext, agent_id: str):
        result = SkillManagementService(session=session).list_agent_bindings(
            tenant_id=request_context.active_workspace_id, agent_id=agent_id
        )
        return dump_response(AgentSkillBindingsResponse, result)

    @console_ns.expect(console_ns.models[AgentSkillBindingsPayload.__name__])
    @console_ns.response(200, "Agent Skill bindings replaced", console_ns.models[AgentSkillBindingsResponse.__name__])
    @console_account_admission()
    @edit_permission_required
    @with_session
    def put(self, session: Session, request_context: RequestContext, agent_id: str):
        try:
            payload = AgentSkillBindingsPayload.model_validate(console_ns.payload or {})
            result = SkillManagementService(session=session).replace_agent_bindings(
                tenant_id=request_context.active_workspace_id,
                user_id=request_context.account_id,
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

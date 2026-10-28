"""Workspace skills: list, describe, export and publish."""

from __future__ import annotations

from collections.abc import Generator, Mapping
from contextlib import contextmanager
from enum import StrEnum
from http import HTTPStatus
from io import BytesIO
from typing import Any, Final

from flask import send_file
from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from controllers.common.fields import BinaryFileResponse
from controllers.common.rbac import RBACCheck, RBACPermission, Workspace
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._errors import (
    DraftChanged,
    ErrorDetail,
    OpenApiError,
    SkillNameMismatch,
    SkillNameTaken,
    SkillNotFound,
    SkillPackageInvalid,
    SkillRequestRejected,
    SkillVersionNotFound,
)
from controllers.openapi._models import (
    SkillDescribeResponse,
    SkillExportQuery,
    SkillListQuery,
    SkillListResponse,
    SkillPublishPayload,
    SkillPublishResponse,
    SkillRow,
    SkillVersionListQuery,
    SkillVersionListResponse,
    SkillVersionRow,
)
from controllers.openapi.auth.requirements import (
    EDITOR_ROLES,
    WORKSPACE_READ_GUARDS,
    CheckRBACPermission,
    CheckSkillEnabled,
    Requirement,
    workspace_write_guards,
)
from machinery.context import RequestContext
from services.skill_management_service import SkillManagementService, SkillManagementServiceError
from services.skill_management_service import SkillPublishPayload as ServiceSkillPublishPayload


class ServiceCode(StrEnum):
    NOT_FOUND = "skill_not_found"
    VERSION_NOT_FOUND = "skill_version_not_found"
    CONFLICT = "skill_conflict"
    NAME_CONFLICT = "skill_name_conflict"
    NAME_MISMATCH = "skill_name_mismatch"
    MISSING_SKILL_MD = "missing_skill_md"
    INVALID_SKILL_MD = "invalid_skill_md"
    MISSING_SKILL_NAME = "missing_skill_name"
    INVALID_SKILL_NAME = "invalid_skill_name"
    MISSING_SKILL_DESCRIPTION = "missing_skill_description"
    INVALID_SKILL_DESCRIPTION = "invalid_skill_description"
    INVALID_SKILL_PACKAGE = "invalid_skill_package"
    ARCHIVE_TOO_LARGE = "archive_too_large"
    SKILL_TOO_LARGE = "skill_too_large"
    TOO_MANY_FILES = "too_many_files"
    DUPLICATE_FILE_PATH = "duplicate_file_path"
    FILE_PATH_CONFLICT = "file_path_conflict"
    INVALID_SKILL_FILE = "invalid_skill_file"


_PACKAGE_CODES: Final = (
    ServiceCode.MISSING_SKILL_MD,
    ServiceCode.INVALID_SKILL_MD,
    ServiceCode.MISSING_SKILL_NAME,
    ServiceCode.INVALID_SKILL_NAME,
    ServiceCode.MISSING_SKILL_DESCRIPTION,
    ServiceCode.INVALID_SKILL_DESCRIPTION,
    ServiceCode.INVALID_SKILL_PACKAGE,
    ServiceCode.ARCHIVE_TOO_LARGE,
    ServiceCode.SKILL_TOO_LARGE,
    ServiceCode.TOO_MANY_FILES,
    ServiceCode.DUPLICATE_FILE_PATH,
    ServiceCode.FILE_PATH_CONFLICT,
    ServiceCode.INVALID_SKILL_FILE,
)

_REJECTIONS: Final[Mapping[str, type[OpenApiError]]] = {
    ServiceCode.NOT_FOUND: SkillNotFound,
    ServiceCode.VERSION_NOT_FOUND: SkillVersionNotFound,
    ServiceCode.CONFLICT: DraftChanged,
    ServiceCode.NAME_CONFLICT: SkillNameTaken,
    ServiceCode.NAME_MISMATCH: SkillNameMismatch,
    **dict.fromkeys(_PACKAGE_CODES, SkillPackageInvalid),
}

_READ_GUARDS: Final = (
    *WORKSPACE_READ_GUARDS,
    CheckRBACPermission(RBACCheck(RBACPermission.SKILL_VIEW, Workspace())),
    CheckSkillEnabled(),
)


def _edit_guards(permission: RBACPermission) -> tuple[Requirement, ...]:
    return workspace_write_guards(permission, roles=EDITOR_ROLES, extra=(CheckSkillEnabled(),))


def _details(error: SkillManagementServiceError) -> list[ErrorDetail]:
    return [
        ErrorDetail(type=error.code, msg=error.message),
        *(ErrorDetail(type=error.code, loc=[key], msg=str(value)) for key, value in error.details.items()),
    ]


def _rejection(error: SkillManagementServiceError) -> OpenApiError:
    known = _REJECTIONS.get(error.code)
    if known is not None:
        return known(error.message, details=_details(error))
    return SkillRequestRejected(error.message, status_code=error.status_code, details=_details(error))


@contextmanager
def _rejecting() -> Generator[None]:
    try:
        yield
    except SkillManagementServiceError as error:
        raise _rejection(error) from error


def _draft_hash(updated_at_epoch: int) -> str:
    return str(updated_at_epoch)


def _expected_updated_at(draft_hash: str | None) -> int | None:
    if draft_hash is None:
        return None
    try:
        return int(draft_hash)
    except ValueError as error:
        raise BadRequest("draft_hash is not one this server issued") from error


def _version_fields(record: Mapping[str, Any]) -> dict[str, Any]:
    return {**record, "created_by": record["published_by"]}


@openapi_ns.route("/workspaces/<string:workspace_id>/skills")
class SkillListApi(Resource):
    @endpoint(
        context="workspace",
        op="get.skill",
        kind=Kind.LIST,
        summary="Skills in the workspace, newest edit first",
        examples=(
            Example(title="List skills", input={}),
            Example(title="Find skills by words and tag", input={"keyword": "expense", "tag": ["ops"]}),
        ),
        requirements=_READ_GUARDS,
        query=SkillListQuery,
        returns=(HTTPStatus.OK, SkillListResponse, "Skills"),
    )
    def get(self, ctx: RequestContext, workspace_id: str, *, query: SkillListQuery):
        with _rejecting():
            result = SkillManagementService().list_skills(
                tenant_id=ctx.active_workspace_id,
                keyword=query.keyword,
                tags=query.tag,
                page=query.page,
                limit=query.limit,
            )
        return SkillListResponse.build(
            page=query.page,
            limit=query.limit,
            total=result["total"],
            items=[SkillRow.model_validate(record) for record in result["data"]],
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/skills/<string:skill_id>")
class SkillDescribeApi(Resource):
    @endpoint(
        context="workspace",
        op="describe.skill",
        kind=Kind.OBJECT,
        summary="One skill with its draft hash and latest published version",
        examples=(Example(title="Describe a skill", input={"skill_id": "<skill_id>"}),),
        requirements=_READ_GUARDS,
        returns=(HTTPStatus.OK, SkillDescribeResponse, "Skill"),
    )
    def get(self, ctx: RequestContext, workspace_id: str, skill_id: str):
        service = SkillManagementService()
        with _rejecting():
            record = service.get_skill(tenant_id=ctx.active_workspace_id, skill_id=skill_id)
            versions = service.list_versions(tenant_id=ctx.active_workspace_id, skill_id=skill_id)["data"]
        latest = next((version for version in versions if version["is_latest"]), None)
        return SkillDescribeResponse.model_validate(
            {
                **record,
                "draft_hash": _draft_hash(record["updated_at"]),
                "latest_version": SkillVersionRow.model_validate(_version_fields(latest)) if latest else None,
            }
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/skills/<string:skill_id>/versions")
class SkillVersionListApi(Resource):
    @endpoint(
        context="workspace",
        op="get.skill.version",
        kind=Kind.LIST,
        summary="Published versions of a skill, newest first",
        examples=(Example(title="List versions of a skill", input={"skill_id": "<skill_id>"}),),
        requirements=_READ_GUARDS,
        query=SkillVersionListQuery,
        returns=(HTTPStatus.OK, SkillVersionListResponse, "Versions"),
    )
    def get(self, ctx: RequestContext, workspace_id: str, skill_id: str, *, query: SkillVersionListQuery):
        with _rejecting():
            records = SkillManagementService().list_versions(tenant_id=ctx.active_workspace_id, skill_id=skill_id)
        rows = [SkillVersionRow.model_validate(_version_fields(record)) for record in records["data"]]
        return SkillVersionListResponse.page_of(rows, query=query)


@openapi_ns.route("/workspaces/<string:workspace_id>/skills/<string:skill_id>/archive")
class SkillExportApi(Resource):
    @endpoint(
        context="workspace",
        op="export.skill",
        kind=Kind.FILE,
        summary="Download a skill as a zip: its draft, or one published version",
        examples=(
            Example(title="Export the draft", input={"skill_id": "<skill_id>"}),
            Example(title="Export a published version", input={"skill_id": "<skill_id>", "version_id": "<version_id>"}),
        ),
        requirements=_READ_GUARDS,
        query=SkillExportQuery,
        returns=(HTTPStatus.OK, BinaryFileResponse, "Zip archive"),
    )
    def get(self, ctx: RequestContext, workspace_id: str, skill_id: str, *, query: SkillExportQuery):
        service = SkillManagementService()
        with _rejecting():
            if query.version_id is None:
                archive = service.export_draft_archive(tenant_id=ctx.active_workspace_id, skill_id=skill_id)
            else:
                archive = service.export_version_archive(
                    tenant_id=ctx.active_workspace_id, skill_id=skill_id, version_id=query.version_id
                )
        return send_file(
            BytesIO(archive.payload), mimetype=archive.mime_type, as_attachment=True, download_name=archive.filename
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/skills/<string:skill_id>:publish")
class SkillPublishApi(Resource):
    @endpoint(
        context="workspace",
        op="publish.skill",
        kind=Kind.OBJECT,
        summary="Publish the draft as a new version",
        examples=(
            Example(title="Publish the draft", input={"skill_id": "<skill_id>"}),
            Example(
                title="Publish a named version",
                input={"skill_id": "<skill_id>", "version_name": "v2", "publish_note": "Adds a retry rule"},
            ),
        ),
        requirements=_edit_guards(RBACPermission.SKILL_PUBLISH),
        body=SkillPublishPayload,
        returns=(HTTPStatus.OK, SkillPublishResponse, "Published"),
    )
    def post(self, ctx: RequestContext, workspace_id: str, skill_id: str, *, body: SkillPublishPayload):
        with _rejecting():
            record = SkillManagementService().publish_skill(
                tenant_id=ctx.active_workspace_id,
                user_id=ctx.account_id,
                skill_id=skill_id,
                payload=ServiceSkillPublishPayload(version_name=body.version_name, publish_note=body.publish_note),
            )
        return SkillPublishResponse.model_validate(_version_fields(record))

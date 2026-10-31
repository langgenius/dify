"""Workspace skills: list, describe, export, import and publish."""

from __future__ import annotations

from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from enum import StrEnum
from functools import partial
from http import HTTPStatus
from io import BytesIO
from types import MappingProxyType
from typing import Final

from flask import send_file
from flask_restx import Resource

from configs import dify_config
from constants import BYTES_PER_MIB
from controllers.common.fields import BinaryFileResponse
from controllers.common.rbac import RBACCheck, RBACPermission, Workspace
from controllers.openapi import openapi_ns
from controllers.openapi._contract import (
    CapRequestBody,
    Example,
    Kind,
    endpoint,
    multipart_header_allowance,
    op_of,
)
from controllers.openapi._errors import (
    DraftChanged,
    ErrorDetail,
    OpenApiError,
    SkillNameConflict,
    SkillNameMismatch,
    SkillNotFound,
    SkillPackageInvalid,
    SkillPackageTooLarge,
    SkillRequestRejected,
    SkillVersionNotFound,
    require_uuid,
)
from controllers.openapi._models import (
    Hint,
    SkillDescribeResponse,
    SkillExportQuery,
    SkillImportPayload,
    SkillImportResponse,
    SkillListQuery,
    SkillListResponse,
    SkillPublishPayload,
    SkillPublishResponse,
    SkillRow,
    SkillVersionListQuery,
    SkillVersionListResponse,
    SkillVersionRow,
)
from controllers.openapi._multipart import folder_streams
from controllers.openapi._upload import UploadParts, file_fields
from controllers.openapi.auth.requirements import (
    EDITOR_ROLES,
    WORKSPACE_READ_GUARDS,
    CheckRBACPermission,
    CheckSkillEnabled,
    Requirement,
    workspace_write_guards,
)
from libs.archive_writer import (
    ArchiveEmptyError,
    ArchiveError,
    ArchiveLimitKind,
    ArchiveLimits,
    ArchiveOptions,
    ArchivePathError,
    ArchiveTooLargeError,
    StrictPathPolicy,
    entries_from_folder,
    write_archive,
)
from machinery.context import RequestContext
from services.skill_management_service import (
    SkillErrorDetail,
    SkillManagementService,
    SkillManagementServiceError,
    SkillOverwritePayload,
    SkillServiceErrorCode,
    max_skill_archive_bytes,
)
from services.skill_management_service import SkillImportPayload as ServiceSkillImportPayload
from services.skill_management_service import SkillPublishPayload as ServiceSkillPublishPayload


class ServiceRejection(StrEnum):
    """Service error codes this surface answers with its own error; any other code is relayed."""

    error: type[OpenApiError]

    NOT_FOUND = (SkillServiceErrorCode.SKILL_NOT_FOUND, SkillNotFound)
    VERSION_NOT_FOUND = (SkillServiceErrorCode.SKILL_VERSION_NOT_FOUND, SkillVersionNotFound)
    CONFLICT = (SkillServiceErrorCode.SKILL_CONFLICT, DraftChanged)
    NAME_CONFLICT = (SkillServiceErrorCode.SKILL_NAME_CONFLICT, SkillNameConflict)
    NAME_MISMATCH = (SkillServiceErrorCode.SKILL_NAME_MISMATCH, SkillNameMismatch)
    MISSING_SKILL_MD = (SkillServiceErrorCode.MISSING_SKILL_MD, SkillPackageInvalid)
    INVALID_SKILL_MD = (SkillServiceErrorCode.INVALID_SKILL_MD, SkillPackageInvalid)
    MISSING_SKILL_NAME = (SkillServiceErrorCode.MISSING_SKILL_NAME, SkillPackageInvalid)
    INVALID_SKILL_NAME = (SkillServiceErrorCode.INVALID_SKILL_NAME, SkillPackageInvalid)
    MISSING_SKILL_DESCRIPTION = (SkillServiceErrorCode.MISSING_SKILL_DESCRIPTION, SkillPackageInvalid)
    INVALID_SKILL_DESCRIPTION = (SkillServiceErrorCode.INVALID_SKILL_DESCRIPTION, SkillPackageInvalid)
    INVALID_SKILL_PACKAGE = (SkillServiceErrorCode.INVALID_SKILL_PACKAGE, SkillPackageInvalid)
    DUPLICATE_FILE_PATH = (SkillServiceErrorCode.DUPLICATE_FILE_PATH, SkillPackageInvalid)
    FILE_PATH_CONFLICT = (SkillServiceErrorCode.FILE_PATH_CONFLICT, SkillPackageInvalid)
    INVALID_SKILL_FILE = (SkillServiceErrorCode.INVALID_SKILL_FILE, SkillPackageInvalid)
    ARCHIVE_TOO_LARGE = (SkillServiceErrorCode.ARCHIVE_TOO_LARGE, SkillPackageTooLarge)
    SKILL_TOO_LARGE = (SkillServiceErrorCode.SKILL_TOO_LARGE, SkillPackageTooLarge)
    TOO_MANY_FILES = (SkillServiceErrorCode.TOO_MANY_FILES, SkillPackageTooLarge)

    def __new__(cls, value: str, error: type[OpenApiError]) -> ServiceRejection:
        member = str.__new__(cls, value)
        member._value_ = value
        member.error = error
        return member


type HintsFor = Callable[[SkillManagementServiceError], list[Hint]]

_NO_HINTS: Final[Mapping[type[OpenApiError], HintsFor]] = MappingProxyType({})

_IMPORT_FILENAME: Final = "skill.zip"

_LIMIT_MESSAGES: Final[Mapping[ArchiveLimitKind, Callable[[int], str]]] = {
    ArchiveLimitKind.ENTRIES: lambda limit: f"The skill folder has more than {limit} files",
    ArchiveLimitKind.BYTES: lambda limit: f"The skill folder is over {limit // BYTES_PER_MIB} MiB",
}

_READ_GUARDS: Final = (
    CheckSkillEnabled(),
    *WORKSPACE_READ_GUARDS,
    CheckRBACPermission(RBACCheck(RBACPermission.SKILL_VIEW, Workspace())),
)


def _edit_guards(permission: RBACPermission) -> tuple[Requirement, ...]:
    return (CheckSkillEnabled(), *workspace_write_guards(permission, roles=EDITOR_ROLES))


def _details(error: SkillManagementServiceError) -> list[ErrorDetail]:
    return [
        ErrorDetail(type=error.code, msg=error.message),
        *(ErrorDetail(type=error.code, loc=[key], msg=str(value)) for key, value in error.details.items()),
    ]


def _rejection(error: SkillManagementServiceError) -> OpenApiError:
    try:
        known = ServiceRejection(error.code)
    except ValueError:
        return SkillRequestRejected(error.message, status_code=error.status_code, details=_details(error))
    return known.error(error.message, details=_details(error))


@contextmanager
def _relaying_service_errors(*, hints: Mapping[type[OpenApiError], HintsFor] = _NO_HINTS) -> Generator[None]:
    try:
        yield
    except SkillManagementServiceError as error:
        rejection = _rejection(error)
        hints_for = hints.get(type(rejection))
        if hints_for is not None:
            rejection.hints = hints_for(error)
        raise rejection from error


def _name_conflict_hints(error: SkillManagementServiceError, *, workspace_id: str) -> list[Hint]:
    skill_id = error.details.get(SkillErrorDetail.SKILL_ID)
    if skill_id is not None:
        return [
            Hint(
                summary="Overwrite the existing skill instead",
                op=op_of(SkillImportApi.post),
                input={"workspace_id": workspace_id, "skill_id": skill_id, "files": None},
            )
        ]
    name = error.details.get(SkillErrorDetail.NAME)
    if name is not None:
        return [
            Hint(
                summary="Find the skill that has this name",
                op=op_of(SkillListApi.get),
                input={"workspace_id": workspace_id, "keyword": name},
            )
        ]
    return []


def _skill_upload_parts() -> int:
    plain_fields = len(SkillImportPayload.model_fields) - len(file_fields(SkillImportPayload))
    return dify_config.SKILL_PACKAGE_MAX_ENTRIES + plain_fields


_UPLOAD_CAP: Final = CapRequestBody(
    max_bytes=lambda: max_skill_archive_bytes() + multipart_header_allowance(_skill_upload_parts()),
    max_parts=_skill_upload_parts,
)


def _archive_rejection(error: ArchiveError) -> OpenApiError:
    if isinstance(error, ArchiveTooLargeError):
        return SkillPackageTooLarge(_LIMIT_MESSAGES[error.kind](error.limit))
    if isinstance(error, ArchivePathError):
        detail = ErrorDetail(type=error.reason.value, loc=[error.path], msg=error.reason.message)
        return SkillPackageInvalid(str(error), details=[detail])
    if isinstance(error, ArchiveEmptyError):
        return SkillPackageInvalid("The skill folder has no files")
    raise error


def _archive_of(folder: UploadParts) -> bytes:
    options = ArchiveOptions(
        StrictPathPolicy(),
        ArchiveLimits(max_entries=dify_config.SKILL_PACKAGE_MAX_ENTRIES, max_bytes=max_skill_archive_bytes()),
    )
    try:
        result = write_archive(entries_from_folder(folder_streams(folder)), options)
    except ArchiveError as error:
        raise _archive_rejection(error) from error
    try:
        return result.file.read()
    finally:
        result.file.close()


def _draft_hash(updated_at_epoch: int) -> str:
    return str(updated_at_epoch)


def _expected_updated_at(draft_hash: str | None) -> int | None:
    if draft_hash is None:
        return None
    return int(draft_hash)


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
        with _relaying_service_errors():
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
        skill_id = require_uuid(skill_id, not_found=SkillNotFound)
        service = SkillManagementService()
        with _relaying_service_errors():
            record = service.get_skill(tenant_id=ctx.active_workspace_id, skill_id=skill_id)
            versions = service.list_versions(tenant_id=ctx.active_workspace_id, skill_id=skill_id)["data"]
        latest = next((version for version in versions if version["is_latest"]), None)
        return SkillDescribeResponse.model_validate(
            {
                **record,
                "draft_hash": _draft_hash(record["updated_at"]),
                "latest_version": SkillVersionRow.model_validate(latest) if latest else None,
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
        skill_id = require_uuid(skill_id, not_found=SkillNotFound)
        with _relaying_service_errors():
            records = SkillManagementService().list_versions(tenant_id=ctx.active_workspace_id, skill_id=skill_id)
        rows = [SkillVersionRow.model_validate(record) for record in records["data"]]
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
        skill_id = require_uuid(skill_id, not_found=SkillNotFound)
        service = SkillManagementService()
        with _relaying_service_errors():
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
        skill_id = require_uuid(skill_id, not_found=SkillNotFound)
        with _relaying_service_errors():
            record = SkillManagementService().publish_skill(
                tenant_id=ctx.active_workspace_id,
                user_id=ctx.account_id,
                skill_id=skill_id,
                payload=ServiceSkillPublishPayload(version_name=body.version_name, publish_note=body.publish_note),
            )
        return SkillPublishResponse.model_validate(record)


@openapi_ns.route("/workspaces/<string:workspace_id>/skills/imports")
class SkillImportApi(Resource):
    @endpoint(
        context="workspace",
        op="import.skill",
        kind=Kind.OBJECT,
        summary="Create a skill from a folder, or overwrite a skill's draft with one",
        examples=(
            Example(title="Create a skill", input={"files": {"SKILL.md": "./my-skill/SKILL.md"}}),
            Example(
                title="Overwrite a skill's draft",
                input={
                    "files": {"SKILL.md": "./my-skill/SKILL.md"},
                    "skill_id": "<skill_id>",
                    "draft_hash": "1761200000",
                },
            ),
        ),
        requirements=(*_edit_guards(RBACPermission.SKILL_EDIT), _UPLOAD_CAP),
        body=SkillImportPayload,
        returns=(
            (HTTPStatus.CREATED, SkillImportResponse, "Created"),
            (HTTPStatus.OK, SkillImportResponse, "Overwritten"),
        ),
    )
    def post(self, ctx: RequestContext, workspace_id: str, *, body: SkillImportPayload):
        """Import never publishes. ``draft_hash`` is the draft's ``updated_at`` in whole seconds,
        so an edit made in the same second as the export is not detected.
        """
        content = _archive_of(body.files)
        workspace = ctx.active_workspace_id
        name_conflict_hints: Mapping[type[OpenApiError], HintsFor] = {
            SkillNameConflict: partial(_name_conflict_hints, workspace_id=workspace)
        }
        service = SkillManagementService()
        with _relaying_service_errors(hints=name_conflict_hints):
            if body.skill_id is None:
                status = HTTPStatus.CREATED
                record = service.import_skill(
                    tenant_id=workspace,
                    user_id=ctx.account_id,
                    payload=ServiceSkillImportPayload(content=content, filename=_IMPORT_FILENAME),
                )
            else:
                status = HTTPStatus.OK
                record = service.overwrite_skill(
                    tenant_id=workspace,
                    user_id=ctx.account_id,
                    skill_id=body.skill_id,
                    payload=SkillOverwritePayload(
                        content=content, expected_updated_at=_expected_updated_at(body.draft_hash)
                    ),
                )
        return (
            SkillImportResponse(
                id=record["id"],
                name=record["name"],
                draft_hash=_draft_hash(record["updated_at"]),
                file_count=len(record["files"]),
                hints=[
                    Hint(
                        summary="Publish so agents use it",
                        op=op_of(SkillPublishApi.post),
                        input={"workspace_id": workspace, "skill_id": record["id"]},
                    )
                ],
            ),
            status,
        )

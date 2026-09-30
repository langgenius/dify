from http import HTTPStatus
from typing import Annotated, Literal, NoReturn
from urllib import parse
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.common.fields import SimpleResultDataResponse, SimpleResultResponse, VerificationTokenResponse
from controllers.common.schema import register_enum_models, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.auth.error import (
    CannotTransferOwnerToSelfError,
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
    MemberNotInTenantError,
    NotOwnerError,
    OwnerTransferLimitError,
    OwnerTransferRateLimitExceededError,
)
from controllers.console.error import EmailSendIpLimitError, SeatsLimitExceeded, WorkspaceMembersLimitExceeded
from controllers.console.flask_admission import console_account_admission
from controllers.console.workspace.error import InvalidMemberRoleError
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.member_fields import AccountWithRoleListResponse, AccountWithRoleResponse
from libs.helper import dump_response, extract_remote_ip
from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError
from services.errors import workspace as workspace_errors
from services.errors.base import NoPermissionError
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkspaceApplicationError,
    WorkspaceInvitationQuotaError,
)


class MemberInvitePayload(BaseModel):
    emails: list[str] = Field(min_length=1)
    role: str
    language: str | None = None

    @field_validator("emails")
    @classmethod
    def normalize_emails(cls, emails: list[str]) -> list[str]:
        return list(dict.fromkeys(email.lower() for email in emails))


class MemberRoleUpdatePayload(BaseModel):
    role: str


class OwnerTransferEmailPayload(BaseModel):
    language: str | None = None


class OwnerTransferCheckPayload(BaseModel):
    code: str
    token: str


class OwnerTransferPayload(BaseModel):
    token: str


class MemberInviteSuccessResponse(ResponseModel):
    status: Literal["success"]
    email: str
    url: str


class MemberInviteAlreadyMemberResponse(ResponseModel):
    status: Literal["already_member"]
    email: str
    message: str


class MemberInviteFailedResponse(ResponseModel):
    status: Literal["failed"]
    email: str
    message: str


MemberInviteResultResponse = Annotated[
    MemberInviteSuccessResponse | MemberInviteAlreadyMemberResponse | MemberInviteFailedResponse,
    Field(discriminator="status"),
]


class MemberActionResponse(ResponseModel):
    result: str
    tenant_id: str


class MemberInviteResponse(ResponseModel):
    result: Literal["success"]
    invitation_results: list[MemberInviteResultResponse]
    tenant_id: str


class MemberInviteErrorResponse(ResponseModel):
    code: Literal["invalid_param", "invalid_role", "limit_exceeded"]
    message: str
    status: Literal[400]


register_enum_models(console_ns, TenantAccountRole)
register_schema_models(
    console_ns,
    MemberInvitePayload,
    MemberRoleUpdatePayload,
    OwnerTransferEmailPayload,
    OwnerTransferCheckPayload,
    OwnerTransferPayload,
)
register_response_schema_models(
    console_ns,
    AccountWithRoleResponse,
    AccountWithRoleListResponse,
    MemberActionResponse,
    MemberInviteErrorResponse,
    MemberInviteResponse,
    MemberInviteSuccessResponse,
    MemberInviteAlreadyMemberResponse,
    MemberInviteFailedResponse,
    SimpleResultDataResponse,
    SimpleResultResponse,
    VerificationTokenResponse,
)


@console_ns.route("/workspaces/current/members")
class MemberListApi(Resource):
    """List all members of current tenant."""

    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountWithRoleListResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        members = application_services().workspaces.member_queries.list_current(request_context)
        serialized_members = [
            {
                "id": member.id,
                "name": member.name,
                "email": member.email,
                "avatar": member.avatar,
                "last_login_at": member.last_login_at,
                "last_active_at": member.last_active_at,
                "created_at": member.created_at,
                "role": member.role,
                "roles": [{"id": role.id, "name": role.name} for role in member.roles],
                "status": member.status,
            }
            for member in members
        ]
        return dump_response(AccountWithRoleListResponse, {"accounts": serialized_members}), HTTPStatus.OK


@console_ns.route("/workspaces/current/members/invite-email")
class MemberInviteEmailApi(Resource):
    """Invite a new member by email."""

    @console_ns.expect(console_ns.models[MemberInvitePayload.__name__])
    @console_ns.response(HTTPStatus.CREATED, "Success", console_ns.models[MemberInviteResponse.__name__])
    @console_ns.response(
        HTTPStatus.BAD_REQUEST,
        "Invalid role or workspace member limit exceeded",
        console_ns.models[MemberInviteErrorResponse.__name__],
    )
    @console_account_admission()
    def post(self, request_context: RequestContext):
        args = MemberInvitePayload.model_validate(console_ns.payload or {})
        try:
            results = application_services().workspaces.invitations.invite_many(
                request_context,
                emails=args.emails,
                language=args.language,
                role=args.role,
            )
        except InvalidWorkspaceMemberRoleError:
            raise InvalidMemberRoleError() from None
        except NoPermissionError as error:
            raise Forbidden(str(error)) from error
        except WorkspaceInvitationQuotaError as error:
            if error.seats:
                raise SeatsLimitExceeded() from error
            raise WorkspaceMembersLimitExceeded() from error
        serialized: list[MemberInviteResultResponse] = []
        for result in results:
            if result.status == "success":
                email = parse.quote(result.email)
                serialized.append(
                    MemberInviteSuccessResponse(
                        status="success",
                        email=result.email,
                        url=f"{dify_config.CONSOLE_WEB_URL}/activate?email={email}&token={result.token}",
                    )
                )
            elif result.status == "already_member":
                serialized.append(
                    MemberInviteAlreadyMemberResponse(
                        status="already_member", email=result.email, message=result.message or ""
                    )
                )
            else:
                serialized.append(
                    MemberInviteFailedResponse(status="failed", email=result.email, message=result.message or "")
                )
        return dump_response(
            MemberInviteResponse,
            {"result": "success", "invitation_results": serialized, "tenant_id": request_context.active_workspace_id},
        ), HTTPStatus.CREATED


@console_ns.route("/workspaces/current/members/<uuid:member_id>")
class MemberCancelInviteApi(Resource):
    """Cancel an invitation by member id."""

    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[MemberActionResponse.__name__])
    @console_account_admission()
    def delete(self, request_context: RequestContext, member_id: UUID):
        try:
            application_services().workspaces.members.remove(
                request_context.active_workspace_id, str(member_id), request_context.account_id
            )
        except (WorkspaceApplicationError, AccountNotFoundError, NoPermissionError) as error:
            return _member_mutation_error_response(error)

        return MemberActionResponse(
            result="success",
            tenant_id=request_context.active_workspace_id,
        ).model_dump(mode="json"), HTTPStatus.OK


@console_ns.route("/workspaces/current/members/<uuid:member_id>/update-role")
class MemberUpdateRoleApi(Resource):
    """Update member role."""

    @console_ns.expect(console_ns.models[MemberRoleUpdatePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission()
    def put(self, request_context: RequestContext, member_id: UUID):
        payload = console_ns.payload or {}
        args = MemberRoleUpdatePayload.model_validate(payload)
        try:
            application_services().workspaces.members.update_role(
                request_context.active_workspace_id, str(member_id), args.role, request_context.account_id
            )
        except (WorkspaceApplicationError, AccountNotFoundError, NoPermissionError) as error:
            return _member_mutation_error_response(error)

        return SimpleResultResponse(result="success").model_dump(mode="json")


@console_ns.route("/workspaces/current/dataset-operators")
class DatasetOperatorMemberListApi(Resource):
    """List all members of current tenant."""

    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountWithRoleListResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        members = application_services().workspaces.member_queries.list_members(
            request_context.active_workspace_id, dataset_operators_only=True
        )
        return dump_response(AccountWithRoleListResponse, {"accounts": members}), HTTPStatus.OK


@console_ns.route("/workspaces/current/members/send-owner-transfer-confirm-email")
class SendOwnerTransferEmailApi(Resource):
    """Send owner transfer email."""

    @console_ns.expect(console_ns.models[OwnerTransferEmailPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @console_account_admission(require_owner_transfer_enabled=True)
    def post(self, request_context: RequestContext):
        args = OwnerTransferEmailPayload.model_validate(console_ns.payload or {})
        try:
            token = application_services().workspaces.owner_transfer.send_code(
                request_context,
                ip_address=extract_remote_ip(request),
                language=args.language,
            )
        except (WorkspaceApplicationError, AccountNotFoundError, NoPermissionError) as error:
            _raise_owner_transfer_error(error)
        return SimpleResultDataResponse(result="success", data=token).model_dump(mode="json")


@console_ns.route("/workspaces/current/members/owner-transfer-check")
class OwnerTransferCheckApi(Resource):
    @console_ns.expect(console_ns.models[OwnerTransferCheckPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[VerificationTokenResponse.__name__])
    @console_account_admission(require_owner_transfer_enabled=True)
    def post(self, request_context: RequestContext):
        args = OwnerTransferCheckPayload.model_validate(console_ns.payload or {})
        try:
            email, token = application_services().workspaces.owner_transfer.verify_code(
                request_context, token=args.token, code=args.code
            )
        except (WorkspaceApplicationError, AccountNotFoundError, NoPermissionError) as error:
            _raise_owner_transfer_error(error)
        return VerificationTokenResponse(is_valid=True, email=email, token=token).model_dump(mode="json")


@console_ns.route("/workspaces/current/members/<uuid:member_id>/owner-transfer")
class OwnerTransfer(Resource):
    @console_ns.expect(console_ns.models[OwnerTransferPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(require_owner_transfer_enabled=True)
    def post(self, request_context: RequestContext, member_id: UUID):
        args = OwnerTransferPayload.model_validate(console_ns.payload or {})
        try:
            application_services().workspaces.owner_transfer.transfer(
                request_context, member_id=str(member_id), token=args.token
            )
        except (WorkspaceApplicationError, AccountNotFoundError, NoPermissionError) as error:
            _raise_owner_transfer_error(error)
        return SimpleResultResponse(result="success").model_dump(mode="json")


def _member_mutation_error_response(
    error: WorkspaceApplicationError | AccountNotFoundError | NoPermissionError,
) -> tuple[dict[str, str], HTTPStatus]:
    if isinstance(error, (AccountNotFoundError, workspace_errors.WorkspaceNotFoundError)):
        raise NotFound() from error
    if isinstance(error, InvalidWorkspaceMemberRoleError):
        return {"code": "invalid-role", "message": "Invalid role"}, HTTPStatus.BAD_REQUEST
    if isinstance(error, workspace_errors.CannotOperateSelfError):
        return {"code": "cannot-operate-self", "message": str(error)}, HTTPStatus.BAD_REQUEST
    if isinstance(error, NoPermissionError):
        return {"code": "forbidden", "message": str(error)}, HTTPStatus.FORBIDDEN
    if isinstance(error, workspace_errors.MemberNotInTenantError):
        return {"code": "member-not-found", "message": str(error)}, HTTPStatus.NOT_FOUND
    if isinstance(error, workspace_errors.RoleAlreadyAssignedError):
        return {"code": "role-already-assigned", "message": str(error)}, HTTPStatus.BAD_REQUEST
    raise error


def _raise_owner_transfer_error(
    error: WorkspaceApplicationError | AccountNotFoundError | NoPermissionError,
) -> NoReturn:
    if isinstance(error, NoPermissionError):
        raise NotOwnerError() from error
    if isinstance(error, (AccountNotFoundError, workspace_errors.WorkspaceNotFoundError)):
        raise NotFound() from error
    if isinstance(error, workspace_errors.OwnerTransferSendIPLimitedError):
        raise EmailSendIpLimitError() from error
    if isinstance(error, workspace_errors.OwnerTransferSendRateLimitError):
        raise OwnerTransferRateLimitExceededError(error.retry_after_minutes) from error
    if isinstance(error, workspace_errors.OwnerTransferVerificationLimitError):
        raise OwnerTransferLimitError() from error
    if isinstance(error, workspace_errors.InvalidOwnerTransferTokenError):
        raise InvalidTokenError() from error
    if isinstance(error, workspace_errors.InvalidOwnerTransferEmailError):
        raise InvalidEmailError() from error
    if isinstance(error, workspace_errors.InvalidOwnerTransferCodeError):
        raise EmailCodeError() from error
    if isinstance(error, workspace_errors.CannotOperateSelfError):
        raise CannotTransferOwnerToSelfError() from error
    if isinstance(error, workspace_errors.MemberNotInTenantError):
        raise MemberNotInTenantError() from error
    raise error

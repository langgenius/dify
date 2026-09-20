from collections.abc import Callable
from datetime import datetime
from http import HTTPStatus
from inspect import unwrap
from typing import NamedTuple, override
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from flask_restx import Api, Resource
from werkzeug.exceptions import NotFound

from controllers.console.auth.error import (
    CannotTransferOwnerToSelfError,
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
    NotOwnerError,
    OwnerTransferLimitError,
    OwnerTransferRateLimitExceededError,
)
from controllers.console.auth.error import (
    MemberNotInTenantError as MemberNotInTenantRequestError,
)
from controllers.console.error import EmailSendIpLimitError, SeatsLimitExceeded, WorkspaceMembersLimitExceeded
from controllers.console.workspace.members import (
    DatasetOperatorMemberListApi,
    MemberCancelInviteApi,
    MemberInviteEmailApi,
    MemberListApi,
    MemberUpdateRoleApi,
    OwnerTransfer,
    OwnerTransferCheckApi,
    SendOwnerTransferEmailApi,
)
from libs.external_api import register_external_error_handlers
from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError
from services.errors.base import NoPermissionError
from services.errors.workspace import (
    CannotOperateSelfError,
    InvalidOwnerTransferCodeError,
    InvalidOwnerTransferEmailError,
    InvalidOwnerTransferTokenError,
    InvalidWorkspaceMemberRoleError,
    MemberNotInTenantError,
    OwnerTransferSendIPLimitedError,
    OwnerTransferSendRateLimitError,
    OwnerTransferVerificationLimitError,
    RoleAlreadyAssignedError,
    WorkspaceNotFoundError,
    WorkspaceNotLinkedError,
)
from services.workspace.contracts import WorkspaceMemberRole, WorkspaceMemberSummary
from services.workspace.member_service import WorkspaceMemberQueryService, WorkspaceMemberService


class _RecordingWorkspaceMemberQueryService(WorkspaceMemberQueryService):
    def __init__(self, result: tuple[WorkspaceMemberSummary, ...]) -> None:
        self._result = result
        self.contexts: list[RequestContext] = []

    @override
    def list_current(self, context: RequestContext) -> tuple[WorkspaceMemberSummary, ...]:
        self.contexts.append(context)
        return self._result


class _WorkspaceServicesStub(NamedTuple):
    member_queries: WorkspaceMemberQueryService


class _ApplicationServicesStub(NamedTuple):
    workspaces: _WorkspaceServicesStub


class TestMemberListApi:
    def test_get_passes_context_and_serializes_application_result(self, app: Flask) -> None:
        api = MemberListApi()
        method = unwrap(api.get)
        request_context = RequestContext(
            request_id="request-1",
            trace_id="trace-1",
            account_id="actor-1",
            active_workspace_id="workspace-1",
        )
        timestamp = datetime(2026, 1, 1)
        workspace_member_queries = _RecordingWorkspaceMemberQueryService(
            (
                WorkspaceMemberSummary(
                    id="member-1",
                    name="Member",
                    email="member@example.com",
                    avatar=None,
                    last_login_at=None,
                    last_active_at=timestamp,
                    created_at=timestamp,
                    role="owner",
                    roles=(
                        WorkspaceMemberRole(id="workspace.owner", name="Owner"),
                        WorkspaceMemberRole(id="workspace.editor", name="Editor"),
                    ),
                    status="active",
                ),
            )
        )
        application_services_stub = _ApplicationServicesStub(_WorkspaceServicesStub(workspace_member_queries))

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.members.application_services",
                return_value=application_services_stub,
            ),
        ):
            result, status = method(api, request_context=request_context)

        assert status == HTTPStatus.OK
        assert result == {
            "accounts": [
                {
                    "id": "member-1",
                    "name": "Member",
                    "email": "member@example.com",
                    "avatar": None,
                    "avatar_url": None,
                    "last_login_at": None,
                    "last_active_at": int(timestamp.timestamp()),
                    "created_at": int(timestamp.timestamp()),
                    "role": "owner",
                    "roles": [
                        {"id": "workspace.owner", "name": "Owner"},
                        {"id": "workspace.editor", "name": "Editor"},
                    ],
                    "status": "active",
                }
            ]
        }
        assert workspace_member_queries.contexts == [request_context]


@pytest.fixture
def services(monkeypatch: pytest.MonkeyPatch) -> Mock:
    from extensions.application_services.workspace import WorkspaceServices
    from extensions.ext_application_services import AccountServices, ApplicationServices
    from services.workspace.member_service import WorkspaceInvitationService, WorkspaceOwnerTransferService

    services = Mock(spec=ApplicationServices)
    services.accounts = Mock(spec=AccountServices)
    services.workspaces = Mock(spec=WorkspaceServices)
    services.workspaces.invitations = Mock(spec=WorkspaceInvitationService)
    services.workspaces.owner_transfer = Mock(spec=WorkspaceOwnerTransferService)
    services.workspaces.members = Mock(spec=WorkspaceMemberService)
    services.workspaces.member_queries = Mock(spec=WorkspaceMemberQueryService)
    import importlib

    monkeypatch.setattr(
        importlib.import_module("controllers.console.workspace.members"), "application_services", lambda: services
    )
    return services


@pytest.mark.parametrize("operation", ["remove", "update_role"])
def test_member_mutation_delegates_admitted_ids(app: Flask, services: Mock, operation: str) -> None:
    context = RequestContext("request", None, "actor", "workspace")
    with app.test_request_context("/", json={"role": "editor"}):
        if operation == "remove":
            api = MemberCancelInviteApi()
            response, status = unwrap(api.delete)(api, context, "member")
            assert status == 200
            assert response == {"result": "success", "tenant_id": "workspace"}
            services.workspaces.members.remove.assert_called_once_with("workspace", "member", "actor")
        else:
            api = MemberUpdateRoleApi()
            assert unwrap(api.put)(api, context, "member") == {"result": "success"}
            services.workspaces.members.update_role.assert_called_once_with("workspace", "member", "editor", "actor")


@pytest.mark.parametrize("operation", ["remove", "update_role"])
@pytest.mark.parametrize(
    ("error", "code", "status"),
    [
        (CannotOperateSelfError("self"), "cannot-operate-self", 400),
        (NoPermissionError("denied"), "forbidden", 403),
        (MemberNotInTenantError("missing"), "member-not-found", 404),
    ],
)
def test_member_mutation_maps_errors(
    app: Flask, services: Mock, operation: str, error: Exception, code: str, status: int
) -> None:
    service_method = (
        services.workspaces.members.remove if operation == "remove" else services.workspaces.members.update_role
    )
    service_method.side_effect = error
    api = MemberCancelInviteApi() if operation == "remove" else MemberUpdateRoleApi()
    method = api.delete if isinstance(api, MemberCancelInviteApi) else api.put
    with app.test_request_context("/", json={"role": "editor"}):
        result = unwrap(method)(api, RequestContext("request", None, "actor", "workspace"), "member")
    assert result == ({"code": code, "message": str(error)}, status)


@pytest.mark.parametrize("operation", ["remove", "update_role"])
def test_member_mutation_maps_missing_account(app: Flask, services: Mock, operation: str) -> None:
    service_method = (
        services.workspaces.members.remove if operation == "remove" else services.workspaces.members.update_role
    )
    service_method.side_effect = AccountNotFoundError()
    api = MemberCancelInviteApi() if operation == "remove" else MemberUpdateRoleApi()
    method = api.delete if isinstance(api, MemberCancelInviteApi) else api.put
    with app.test_request_context("/", json={"role": "editor"}), pytest.raises(NotFound):
        unwrap(method)(api, RequestContext("request", None, "actor", "workspace"), "missing")


@pytest.mark.parametrize(
    ("error", "code", "message"),
    [
        (InvalidWorkspaceMemberRoleError(), "invalid-role", "Invalid role"),
        (RoleAlreadyAssignedError("unchanged"), "role-already-assigned", "unchanged"),
    ],
)
def test_update_role_maps_role_errors(app: Flask, services: Mock, error: Exception, code: str, message: str) -> None:
    services.workspaces.members.update_role.side_effect = error
    api = MemberUpdateRoleApi()
    with app.test_request_context("/", json={"role": "editor"}):
        result = unwrap(api.put)(api, RequestContext("request", None, "actor", "workspace"), "member")
    assert result == ({"code": code, "message": message}, 400)


def test_dataset_operator_list_uses_admitted_workspace(app: Flask, services: Mock) -> None:
    services.workspaces.member_queries.list_members.return_value = ()
    api = DatasetOperatorMemberListApi()
    with app.test_request_context("/"):
        result = unwrap(api.get)(api, RequestContext("request", None, "actor", "workspace"))
    assert result == ({"accounts": []}, 200)
    services.workspaces.member_queries.list_members.assert_called_once_with("workspace", dataset_operators_only=True)


def test_bulk_invite_serializes_results_and_normalizes_input(app: Flask, services: Mock) -> None:
    from services.workspace.contracts import WorkspaceInvitationResult

    services.workspaces.invitations.invite_many.return_value = (
        WorkspaceInvitationResult("a@example.com", "success", token="token"),
        WorkspaceInvitationResult("b@example.com", "already_member", message="Account already in workspace."),
        WorkspaceInvitationResult("c@example.com", "failed", message="Registration failed"),
    )
    context = RequestContext("request", None, "owner", "workspace")
    with app.test_request_context(
        "/",
        method="POST",
        json={"emails": ["A@example.com", "a@example.com", "b@example.com", "c@example.com"], "role": "normal"},
    ):
        api = MemberInviteEmailApi()
        result, status = unwrap(api.post)(api, context)
    assert status == 201
    assert result["tenant_id"] == "workspace"
    assert [item["status"] for item in result["invitation_results"]] == ["success", "already_member", "failed"]
    assert "email=a%40example.com&token=token" in result["invitation_results"][0]["url"]
    services.workspaces.invitations.invite_many.assert_called_once_with(
        context, emails=["a@example.com", "b@example.com", "c@example.com"], language=None, role="normal"
    )


@pytest.mark.parametrize(("seats", "expected"), [(True, SeatsLimitExceeded), (False, WorkspaceMembersLimitExceeded)])
def test_invite_maps_capacity_error(app: Flask, services: Mock, seats: bool, expected: type[Exception]) -> None:
    from services.errors.workspace import WorkspaceInvitationQuotaError

    services.workspaces.invitations.invite_many.side_effect = WorkspaceInvitationQuotaError(seats=seats)
    api = MemberInviteEmailApi()
    with (
        app.test_request_context("/", method="POST", json={"emails": ["a@example.com"], "role": "normal"}),
        pytest.raises(expected),
    ):
        unwrap(api.post)(api, RequestContext("request", None, "owner", "workspace"))


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (NoPermissionError(), NotOwnerError),
        (AccountNotFoundError(), NotFound),
        (WorkspaceNotFoundError(), NotFound),
        (OwnerTransferSendIPLimitedError(), EmailSendIpLimitError),
        (OwnerTransferSendRateLimitError(3), OwnerTransferRateLimitExceededError),
        (OwnerTransferVerificationLimitError(), OwnerTransferLimitError),
        (InvalidOwnerTransferTokenError(), InvalidTokenError),
        (InvalidOwnerTransferEmailError(), InvalidEmailError),
        (InvalidOwnerTransferCodeError(), EmailCodeError),
        (CannotOperateSelfError(), CannotTransferOwnerToSelfError),
        (MemberNotInTenantError(), MemberNotInTenantRequestError),
    ],
)
def test_owner_verification_maps_errors(
    app: Flask, services: Mock, error: Exception, expected: type[Exception]
) -> None:
    services.workspaces.owner_transfer.verify_code.side_effect = error
    api = OwnerTransferCheckApi()
    with (
        app.test_request_context("/", method="POST", json={"token": "token", "code": "123456"}),
        pytest.raises(expected) as raised,
    ):
        unwrap(api.post)(api, RequestContext("request", None, "owner", "workspace"))
    assert raised.value.__cause__ is error
    if isinstance(error, OwnerTransferSendRateLimitError):
        assert "3" in str(raised.value)


def test_owner_verification_serializes_promoted_token(app: Flask, services: Mock) -> None:
    services.workspaces.owner_transfer.verify_code.return_value = ("owner@example.com", "promoted")
    with app.test_request_context("/", method="POST", json={"token": "token", "code": "123456"}):
        api = OwnerTransferCheckApi()
        response = unwrap(api.post)(api, RequestContext("request", None, "owner", "workspace"))
    assert response == {"is_valid": True, "email": "owner@example.com", "token": "promoted"}


@pytest.mark.parametrize(
    ("service_method", "resource_type", "handler", "has_member_id"),
    [
        pytest.param(
            lambda services: services.workspaces.members.remove,
            MemberCancelInviteApi,
            MemberCancelInviteApi.delete,
            True,
            id="remove",
        ),
        pytest.param(
            lambda services: services.workspaces.members.update_role,
            MemberUpdateRoleApi,
            MemberUpdateRoleApi.put,
            True,
            id="update_role",
        ),
        pytest.param(
            lambda services: services.workspaces.owner_transfer.send_code,
            SendOwnerTransferEmailApi,
            SendOwnerTransferEmailApi.post,
            False,
            id="send_code",
        ),
        pytest.param(
            lambda services: services.workspaces.owner_transfer.verify_code,
            OwnerTransferCheckApi,
            OwnerTransferCheckApi.post,
            False,
            id="verify_code",
        ),
        pytest.param(
            lambda services: services.workspaces.owner_transfer.transfer,
            OwnerTransfer,
            OwnerTransfer.post,
            True,
            id="transfer",
        ),
    ],
)
@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (RuntimeError("backend unavailable"), 500, "unknown"),
        (WorkspaceNotLinkedError("unmapped workspace failure"), 500, "unknown"),
        (WorkspaceNotFoundError(), 404, "not_found"),
        (AccountNotFoundError(), 404, "not_found"),
    ],
)
def test_member_errors_reach_the_http_boundary(
    services: Mock,
    service_method: Callable[[Mock], Mock],
    resource_type: type[Resource],
    handler: Callable[..., object],
    has_member_id: bool,
    error: Exception,
    status: int,
    code: str,
) -> None:
    service_method(services).side_effect = error
    resource = resource_type()
    method = unwrap(handler)
    context = RequestContext("request", None, "owner", "workspace")
    http_app = Flask(__name__)
    http_api = Api(http_app, doc=False)
    register_external_error_handlers(http_api)

    class Endpoint(Resource):
        def post(self):
            if has_member_id:
                return method(resource, context, "member")
            return method(resource, context)

    http_api.add_resource(Endpoint, "/members")
    response = http_app.test_client().post("/members", json={"role": "editor", "token": "token", "code": "123456"})
    assert response.status_code == status
    assert response.json["code"] == code
    if status == 500:
        assert response.json["message"] == "Internal Server Error"

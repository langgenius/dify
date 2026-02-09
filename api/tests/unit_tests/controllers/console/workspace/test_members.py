from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import HTTPException

import services
from controllers.console.auth.error import (
    CannotTransferOwnerToSelfError,
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
    MemberNotInTenantError,
    NotOwnerError,
    OwnerTransferLimitError,
)
from controllers.console.error import EmailSendIpLimitError, WorkspaceMembersLimitExceeded
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
from services.errors.account import AccountAlreadyInTenantError


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestMemberListApi:
    def test_get_success(self, app):
        api = MemberListApi()
        method = unwrap(api.get)

        tenant = MagicMock()
        user = MagicMock(current_tenant=tenant)
        member = MagicMock()
        member.id = "m1"
        member.name = "Member"
        member.email = "member@test.com"
        member.avatar = "avatar.png"
        member.role = "admin"
        member.status = "active"
        members = [member]

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.get_tenant_members", return_value=members),
        ):
            result, status = method(api)

        assert status == 200
        assert len(result["accounts"]) == 1

    def test_get_no_tenant(self, app):
        api = MemberListApi()
        method = unwrap(api.get)

        user = MagicMock(current_tenant=None)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestMemberInviteEmailApi:
    def test_invite_success(self, app):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.workspace_members.is_available.return_value = True

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
            "language": "en-US",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members.RegisterService.invite_new_member", return_value="token"),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
        ):
            result, status = method(api)

        assert status == 201
        assert result["result"] == "success"

    def test_invite_limit_exceeded(self, app):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.workspace_members.is_available.return_value = False

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
        ):
            with pytest.raises(WorkspaceMembersLimitExceeded):
                method(api)

    def test_invite_already_member(self, app):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.workspace_members.is_available.return_value = True

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member",
                side_effect=AccountAlreadyInTenantError(),
            ),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
        ):
            result, status = method(api)

        assert result["invitation_results"][0]["status"] == "success"

    def test_invite_invalid_role(self, app):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        payload = {
            "emails": ["a@test.com"],
            "role": "owner",
        }

        with app.test_request_context("/", json=payload):
            result, status = method(api)

        assert status == 400
        assert result["code"] == "invalid-role"

    def test_invite_generic_exception(self, app):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.workspace_members.is_available.return_value = True

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member",
                side_effect=Exception("boom"),
            ),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
        ):
            result, _ = method(api)

        assert result["invitation_results"][0]["status"] == "failed"


class TestMemberCancelInviteApi:
    def test_cancel_success(self, app):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        member = MagicMock()

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.db.session.query") as q,
            patch("controllers.console.workspace.members.TenantService.remove_member_from_tenant"),
        ):
            q.return_value.where.return_value.first.return_value = member
            result, status = method(api, member.id)

        assert status == 200
        assert result["result"] == "success"

    def test_cancel_not_found(self, app):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.db.session.query") as q,
        ):
            q.return_value.where.return_value.first.return_value = None

            with pytest.raises(HTTPException):
                method(api, "x")

    def test_cancel_cannot_operate_self(self, app):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        member = MagicMock()

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.db.session.query") as q,
            patch(
                "controllers.console.workspace.members.TenantService.remove_member_from_tenant",
                side_effect=services.errors.account.CannotOperateSelfError("x"),
            ),
        ):
            q.return_value.where.return_value.first.return_value = member
            result, status = method(api, member.id)

        assert status == 400

    def test_cancel_no_permission(self, app):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        member = MagicMock()

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.db.session.query") as q,
            patch(
                "controllers.console.workspace.members.TenantService.remove_member_from_tenant",
                side_effect=services.errors.account.NoPermissionError("x"),
            ),
        ):
            q.return_value.where.return_value.first.return_value = member
            result, status = method(api, member.id)

        assert status == 403

    def test_cancel_member_not_in_tenant(self, app):
        api = MemberCancelInviteApi()
        method = unwrap(api.delete)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        member = MagicMock()

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.db.session.query") as q,
            patch(
                "controllers.console.workspace.members.TenantService.remove_member_from_tenant",
                side_effect=services.errors.account.MemberNotInTenantError(),
            ),
        ):
            q.return_value.where.return_value.first.return_value = member
            result, status = method(api, member.id)

        assert status == 404


class TestMemberUpdateRoleApi:
    def test_update_success(self, app):
        api = MemberUpdateRoleApi()
        method = unwrap(api.put)

        tenant = MagicMock()
        user = MagicMock(current_tenant=tenant)
        member = MagicMock()

        payload = {"role": "normal"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.db.session.get", return_value=member),
            patch("controllers.console.workspace.members.TenantService.update_member_role"),
        ):
            result = method(api, "id")

        if isinstance(result, tuple):
            result = result[0]

        assert result["result"] == "success"

    def test_update_invalid_role(self, app):
        api = MemberUpdateRoleApi()
        method = unwrap(api.put)

        payload = {"role": "invalid-role"}

        with app.test_request_context("/", json=payload):
            result, status = method(api, "id")

        assert status == 400

    def test_update_member_not_found(self, app):
        api = MemberUpdateRoleApi()
        method = unwrap(api.put)

        payload = {"role": "normal"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.members.current_account_with_tenant",
                return_value=(MagicMock(current_tenant=MagicMock()), "t1"),
            ),
            patch("controllers.console.workspace.members.db.session.get", return_value=None),
        ):
            with pytest.raises(HTTPException):
                method(api, "id")


class TestDatasetOperatorMemberListApi:
    def test_get_success(self, app):
        api = DatasetOperatorMemberListApi()
        method = unwrap(api.get)

        tenant = MagicMock()
        user = MagicMock(current_tenant=tenant)
        member = MagicMock()
        member.id = "op1"
        member.name = "Operator"
        member.email = "operator@test.com"
        member.avatar = "avatar.png"
        member.role = "operator"
        member.status = "active"
        members = [member]

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch(
                "controllers.console.workspace.members.TenantService.get_dataset_operator_members", return_value=members
            ),
        ):
            result, status = method(api)

        assert status == 200
        assert len(result["accounts"]) == 1

    def test_get_no_tenant(self, app):
        api = DatasetOperatorMemberListApi()
        method = unwrap(api.get)

        user = MagicMock(current_tenant=None)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
        ):
            with pytest.raises(ValueError):
                method(api)


class TestSendOwnerTransferEmailApi:
    def test_send_success(self, app):
        api = SendOwnerTransferEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(name="ws")
        user = MagicMock(email="a@test.com", current_tenant=tenant)

        payload = {}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.extract_remote_ip", return_value="1.1.1.1"),
            patch("controllers.console.workspace.members.AccountService.is_email_send_ip_limit", return_value=False),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.send_owner_transfer_email", return_value="token"
            ),
        ):
            result = method(api)

        assert result["result"] == "success"

    def test_send_ip_limit(self, app):
        api = SendOwnerTransferEmailApi()
        method = unwrap(api.post)

        payload = {}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.extract_remote_ip", return_value="1.1.1.1"),
            patch("controllers.console.workspace.members.AccountService.is_email_send_ip_limit", return_value=True),
        ):
            with pytest.raises(EmailSendIpLimitError):
                method(api)

    def test_send_not_owner(self, app):
        api = SendOwnerTransferEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(current_tenant=tenant)

        with (
            app.test_request_context("/", json={}),
            patch("controllers.console.workspace.members.extract_remote_ip", return_value="1.1.1.1"),
            patch("controllers.console.workspace.members.AccountService.is_email_send_ip_limit", return_value=False),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=False),
        ):
            with pytest.raises(NotOwnerError):
                method(api)


class TestOwnerTransferCheckApi:
    def test_check_invalid_code(self, app):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)

        payload = {"code": "x", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.is_owner_transfer_error_rate_limit",
                return_value=False,
            ),
            patch(
                "controllers.console.workspace.members.AccountService.get_owner_transfer_data",
                return_value={"email": "a@test.com", "code": "y"},
            ),
        ):
            with pytest.raises(EmailCodeError):
                method(api)

    def test_rate_limited(self, app):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)

        payload = {"code": "x", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.is_owner_transfer_error_rate_limit",
                return_value=True,
            ),
        ):
            with pytest.raises(OwnerTransferLimitError):
                method(api)

    def test_invalid_token(self, app):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)

        payload = {"code": "x", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.is_owner_transfer_error_rate_limit",
                return_value=False,
            ),
            patch("controllers.console.workspace.members.AccountService.get_owner_transfer_data", return_value=None),
        ):
            with pytest.raises(InvalidTokenError):
                method(api)

    def test_invalid_email(self, app):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)

        payload = {"code": "x", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.is_owner_transfer_error_rate_limit",
                return_value=False,
            ),
            patch(
                "controllers.console.workspace.members.AccountService.get_owner_transfer_data",
                return_value={"email": "b@test.com", "code": "x"},
            ),
        ):
            with pytest.raises(InvalidEmailError):
                method(api)


class TestOwnerTransferApi:
    def test_transfer_self(self, app):
        api = OwnerTransfer()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(id="1", email="a@test.com", current_tenant=tenant)

        payload = {"token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
        ):
            with pytest.raises(CannotTransferOwnerToSelfError):
                method(api, "1")

    def test_invalid_token(self, app):
        api = OwnerTransfer()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(id="1", email="a@test.com", current_tenant=tenant)

        payload = {"token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch("controllers.console.workspace.members.AccountService.get_owner_transfer_data", return_value=None),
        ):
            with pytest.raises(InvalidTokenError):
                method(api, "2")

    def test_member_not_in_tenant(self, app):
        api = OwnerTransfer()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(id="1", email="a@test.com", current_tenant=tenant)
        member = MagicMock()

        payload = {"token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "t1")),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.get_owner_transfer_data",
                return_value={"email": "a@test.com"},
            ),
            patch("controllers.console.workspace.members.db.session.get", return_value=member),
            patch("controllers.console.workspace.members.TenantService.is_member", return_value=False),
        ):
            with pytest.raises(MemberNotInTenantError):
                method(api, "2")

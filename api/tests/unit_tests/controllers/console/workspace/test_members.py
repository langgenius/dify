from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.error import (
    CannotTransferOwnerToSelfError,
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
    NotOwnerError,
    OwnerTransferLimitError,
)
from controllers.console.error import EmailSendIpLimitError, WorkspaceMembersLimitExceeded
from controllers.console.workspace.members import (
    DatasetOperatorMemberListApi,
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
    def test_get_success(self, app: Flask):
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
        session = MagicMock()

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.TenantService.get_tenant_members", return_value=members),
        ):
            result, status = method(api, session, user)

        assert status == 200
        assert len(result["accounts"]) == 1

    def test_get_no_tenant(self, app: Flask):
        api = MemberListApi()
        method = unwrap(api.get)

        user = MagicMock(current_tenant=None)
        session = MagicMock()

        with (
            app.test_request_context("/"),
        ):
            with pytest.raises(ValueError):
                method(api, session, user)


class TestMemberInviteEmailApi:
    @pytest.fixture(autouse=True)
    def _mock_member_invite_lock(self):
        with patch("controllers.console.workspace.members.redis_client.lock", return_value=nullcontext()):
            yield

    def test_invite_success(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        features.workspace_members.is_available.return_value = True
        session = MagicMock()

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
            "language": "en-US",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=1),
            patch("controllers.console.workspace.members.RegisterService.invite_new_member", return_value="token"),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, status = method(api, session, user)

        assert status == 201
        assert result["result"] == "success"

    def test_invite_limit_exceeded(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = True
        features.workspace_members.is_available.return_value = False
        session = MagicMock()

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=1),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", True),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            with pytest.raises(WorkspaceMembersLimitExceeded):
                method(api, session, user)

    def test_invite_billing_limit_exceeded(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = True
        features.members.size = 9
        features.members.limit = 10
        features.workspace_members.enabled = False
        session = MagicMock()

        payload = {
            "emails": ["a@test.com", "b@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=2),
            patch("controllers.console.workspace.members._count_current_members", return_value=9),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", True),
        ):
            with pytest.raises(WorkspaceMembersLimitExceeded):
                method(api, session, user)

    def test_invite_already_member(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        features.workspace_members.is_available.return_value = True
        session = MagicMock()

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=0),
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member",
                side_effect=AccountAlreadyInTenantError(),
            ),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, status = method(api, session, user)

        assert result["invitation_results"][0]["status"] == "success"

    def test_invite_invalid_role(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        payload = {
            "emails": ["a@test.com"],
            "role": "owner",
        }
        session = MagicMock()

        with app.test_request_context("/", json=payload):
            result, status = method(api, session, MagicMock())

        assert status == 400
        assert result["code"] == "invalid-role"

    def test_invite_generic_exception(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        features.workspace_members.is_available.return_value = True
        session = MagicMock()

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=1),
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member",
                side_effect=Exception("boom"),
            ),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, _ = method(api, session, user)

        assert result["invitation_results"][0]["status"] == "failed"


class TestMemberUpdateRoleApi:
    def test_update_invalid_role(self, app: Flask):
        api = MemberUpdateRoleApi()
        method = unwrap(api.put)

        payload = {"role": "invalid-role"}
        session = MagicMock()

        with app.test_request_context("/", json=payload):
            result, status = method(api, session, MagicMock(), "id")

        assert status == 400


class TestDatasetOperatorMemberListApi:
    def test_get_success(self, app: Flask):
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
        session = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.members.TenantService.get_dataset_operator_members", return_value=members
            ),
        ):
            result, status = method(api, session, user)

        assert status == 200
        assert len(result["accounts"]) == 1

    def test_get_no_tenant(self, app: Flask):
        api = DatasetOperatorMemberListApi()
        method = unwrap(api.get)

        user = MagicMock(current_tenant=None)
        session = MagicMock()

        with (
            app.test_request_context("/"),
        ):
            with pytest.raises(ValueError):
                method(api, session, user)


class TestSendOwnerTransferEmailApi:
    def test_send_success(self, app: Flask):
        api = SendOwnerTransferEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(name="ws")
        user = MagicMock(email="a@test.com", current_tenant=tenant)
        session = MagicMock()

        payload = {}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.extract_remote_ip", return_value="1.1.1.1"),
            patch("controllers.console.workspace.members.AccountService.is_email_send_ip_limit", return_value=False),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.send_owner_transfer_email", return_value="token"
            ),
        ):
            result = method(api, session, user)

        assert result["result"] == "success"

    def test_send_ip_limit(self, app: Flask):
        api = SendOwnerTransferEmailApi()
        method = unwrap(api.post)

        payload = {}
        session = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.extract_remote_ip", return_value="1.1.1.1"),
            patch("controllers.console.workspace.members.AccountService.is_email_send_ip_limit", return_value=True),
        ):
            with pytest.raises(EmailSendIpLimitError):
                method(api, session, MagicMock())

    def test_send_not_owner(self, app: Flask):
        api = SendOwnerTransferEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(current_tenant=tenant)
        session = MagicMock()

        with (
            app.test_request_context("/", json={}),
            patch("controllers.console.workspace.members.extract_remote_ip", return_value="1.1.1.1"),
            patch("controllers.console.workspace.members.AccountService.is_email_send_ip_limit", return_value=False),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=False),
        ):
            with pytest.raises(NotOwnerError):
                method(api, session, user)


class TestOwnerTransferCheckApi:
    def test_check_invalid_code(self, app: Flask):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)
        session = MagicMock()

        payload = {"code": "x", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
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
                method(api, session, user)

    def test_rate_limited(self, app: Flask):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)
        session = MagicMock()

        payload = {"code": "x", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.is_owner_transfer_error_rate_limit",
                return_value=True,
            ),
        ):
            with pytest.raises(OwnerTransferLimitError):
                method(api, session, user)

    def test_invalid_token(self, app: Flask):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)
        session = MagicMock()

        payload = {"code": "x", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.is_owner_transfer_error_rate_limit",
                return_value=False,
            ),
            patch("controllers.console.workspace.members.AccountService.get_owner_transfer_data", return_value=None),
        ):
            with pytest.raises(InvalidTokenError):
                method(api, session, user)

    def test_invalid_email(self, app: Flask):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)
        session = MagicMock()

        payload = {"code": "x", "token": "t"}

        with (
            app.test_request_context("/", json=payload),
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
                method(api, session, user)


class TestOwnerTransferApi:
    def test_transfer_self(self, app: Flask):
        api = OwnerTransfer()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(id="1", email="a@test.com", current_tenant=tenant)
        session = MagicMock()

        payload = {"token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
        ):
            with pytest.raises(CannotTransferOwnerToSelfError):
                method(api, session, user, "1")

    def test_invalid_token(self, app: Flask):
        api = OwnerTransfer()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(id="1", email="a@test.com", current_tenant=tenant)
        session = MagicMock()

        payload = {"token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch("controllers.console.workspace.members.AccountService.get_owner_transfer_data", return_value=None),
        ):
            with pytest.raises(InvalidTokenError):
                method(api, session, user, "2")

    def test_transfer_success_sends_notifications_after_commit(self, app: Flask):
        api = OwnerTransfer()
        method = unwrap(api.post)

        tenant = MagicMock()
        tenant.name = "ws"
        user = MagicMock(id="1", email="old@test.com", current_tenant=tenant)
        member = MagicMock(email="new@test.com")
        session = MagicMock()
        session.get.return_value = member

        payload = {"token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch(
                "controllers.console.workspace.members.AccountService.get_owner_transfer_data",
                return_value={"email": "old@test.com"},
            ),
            patch("controllers.console.workspace.members.AccountService.revoke_owner_transfer_token"),
            patch("controllers.console.workspace.members.TenantService.is_member", return_value=True),
            patch("controllers.console.workspace.members.TenantService.update_member_role"),
            patch("controllers.console.workspace.members.event.listen") as listen_mock,
            patch(
                "controllers.console.workspace.members.AccountService.send_new_owner_transfer_notify_email"
            ) as send_new,
            patch(
                "controllers.console.workspace.members.AccountService.send_old_owner_transfer_notify_email"
            ) as send_old,
        ):
            result = method(api, session, user, "2")

            assert result["result"] == "success"
            send_new.assert_not_called()
            send_old.assert_not_called()
            listen_mock.assert_called_once()

            after_commit = listen_mock.call_args.args[2]
            after_commit(session)

            send_new.assert_called_once_with(email="new@test.com", workspace_name="ws")
            send_old.assert_called_once_with(
                email="old@test.com",
                workspace_name="ws",
                new_owner_email="new@test.com",
            )

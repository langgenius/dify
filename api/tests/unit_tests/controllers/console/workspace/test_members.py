from contextlib import nullcontext
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask_restx import Resource

from controllers.console.auth.error import (
    CannotTransferOwnerToSelfError,
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
    NotOwnerError,
    OwnerTransferLimitError,
)
from controllers.console.error import EmailSendIpLimitError, SeatsLimitExceeded, WorkspaceMembersLimitExceeded
from controllers.console.workspace.error import InvalidMemberRoleError
from controllers.console.workspace.members import (
    DatasetOperatorMemberListApi,
    MemberInviteEmailApi,
    MemberInviteErrorResponse,
    MemberListApi,
    MemberUpdateRoleApi,
    OwnerTransfer,
    OwnerTransferCheckApi,
    SendOwnerTransferEmailApi,
    _count_new_member_invites,
)
from libs.external_api import ExternalApi
from services.errors.account import AccountAlreadyInTenantError, SeatsLimitExceededError


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
        member.current_role = SimpleNamespace(value="admin")
        member.status = SimpleNamespace(value="active")
        members = [member]

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.TenantService.get_tenant_members", return_value=members),
        ):
            result, status = method(api, user)

        assert status == 200
        assert len(result["accounts"]) == 1
        assert result["accounts"][0]["role"] == "admin"
        assert result["accounts"][0]["roles"] == [{"id": "admin", "name": "admin"}]

    def test_get_with_rbac_enabled_fetches_roles_in_batch(self, app):
        api = MemberListApi()
        method = unwrap(api.get)

        tenant = MagicMock(id="tenant-1")
        user = MagicMock(id="acct-1", current_tenant=tenant)
        member = SimpleNamespace(
            id="m1",
            name="Member",
            email="member@test.com",
            avatar=None,
            last_login_at=1,
            last_active_at=2,
            created_at=3,
            current_role=SimpleNamespace(value="editor"),
            status=SimpleNamespace(value="active"),
        )
        role_item = SimpleNamespace(
            account_id="m1",
            roles=[
                SimpleNamespace(id="workspace.owner", name="Owner"),
                SimpleNamespace(id="workspace.editor", name="Editor"),
            ],
        )

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.members.current_account_with_tenant", return_value=(user, "tenant-1")),
            patch("controllers.console.workspace.members.dify_config.RBAC_ENABLED", True),
            patch("controllers.console.workspace.members.TenantService.get_tenant_members", return_value=[member]),
            patch(
                "controllers.console.workspace.members.enterprise_rbac_service.RBACService.MemberRoles.batch_get",
                return_value=[role_item],
            ) as mock_batch_get,
        ):
            result, status = method(api)

        assert status == 200
        assert result["accounts"][0]["role"] == "editor"
        assert result["accounts"][0]["roles"] == [
            {"id": "workspace.owner", "name": "Owner"},
            {"id": "workspace.editor", "name": "Editor"},
        ]
        mock_batch_get.assert_called_once_with("tenant-1", "acct-1", ["m1"])

    def test_get_no_tenant(self, app: Flask):
        api = MemberListApi()
        method = unwrap(api.get)

        user = MagicMock(current_tenant=None)

        with (
            app.test_request_context("/"),
        ):
            with pytest.raises(ValueError):
                method(api, user)


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

        payload = {
            "emails": ["A@TEST.com", "a@test.com"],
            "role": "normal",
            "language": "en-US",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(1, 1)) as mock_count,
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member", return_value="token"
            ) as mock_invite,
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, status = method(api, user)

        assert status == 201
        assert result["result"] == "success"
        assert result["invitation_results"][0]["email"] == "a@test.com"
        mock_count.assert_not_called()
        mock_invite.assert_called_once()
        assert mock_invite.call_args.kwargs["email"] == "a@test.com"

    def test_invite_limit_exceeded(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = True
        features.workspace_members.is_available.return_value = False

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(1, 1)),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", True),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            with pytest.raises(WorkspaceMembersLimitExceeded):
                method(api, user)

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

        payload = {
            "emails": ["a@test.com", "b@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(2, 2)),
            patch("controllers.console.workspace.members._count_current_members", return_value=9),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", True),
        ):
            with pytest.raises(WorkspaceMembersLimitExceeded):
                method(api, user)

    def test_invite_already_member(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        features.workspace_members.is_available.return_value = True

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(0, 0)),
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member",
                side_effect=AccountAlreadyInTenantError(),
            ),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, status = method(api, user)

        assert status == 201
        assert result["invitation_results"][0]["status"] == "already_member"
        assert result["invitation_results"][0]["message"] == "Account already in workspace."

    def test_invite_invalid_role(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        payload = {
            "emails": ["a@test.com"],
            "role": "owner",
        }

        with app.test_request_context("/", json=payload):
            with pytest.raises(InvalidMemberRoleError) as exc_info:
                method(api, MagicMock())

        assert exc_info.value.error_code == "invalid_role"

    def test_invite_invalid_payload_matches_documented_error_response(self):
        app = Flask(__name__)
        api = ExternalApi(app)
        method = unwrap(MemberInviteEmailApi.post)

        @api.route("/workspaces/current/members/invite-email")
        class MemberInviteValidationApi(Resource):
            def post(self):
                return method(MemberInviteEmailApi(), MagicMock())

        response = app.test_client().post(
            "/workspaces/current/members/invite-email",
            json={"emails": [], "role": "normal"},
        )

        assert response.status_code == 400
        error = MemberInviteErrorResponse.model_validate(response.get_json())
        assert error.code == "invalid_param"

    def test_invite_generic_exception(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        features.workspace_members.is_available.return_value = True

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(1, 1)),
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member",
                side_effect=Exception("boom"),
            ),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, _ = method(api, user)

        assert result["invitation_results"][0]["status"] == "failed"

    def test_invite_seats_limit_exceeded(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        system_features = MagicMock()
        system_features.license.seats.is_available.return_value = False

        payload = {
            "emails": ["a@test.com", "b@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(2, 2)),
            patch(
                "controllers.console.workspace.members.FeatureService.get_system_features",
                return_value=system_features,
            ) as mock_get_system_features,
            patch("controllers.console.workspace.members.RegisterService.invite_new_member") as mock_invite,
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", True),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            with pytest.raises(SeatsLimitExceeded):
                method(api, user)

        mock_get_system_features.assert_called_once_with(is_authenticated=True)
        system_features.license.seats.is_available.assert_called_once_with(2)
        mock_invite.assert_not_called()

    def test_invite_existing_accounts_do_not_consume_seats(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        system_features = MagicMock()
        system_features.license.seats.is_available.return_value = False

        payload = {
            "emails": ["a@test.com", "b@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(2, 0)),
            patch(
                "controllers.console.workspace.members.FeatureService.get_system_features",
                return_value=system_features,
            ) as mock_get_system_features,
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member", return_value="token"
            ) as mock_invite,
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", True),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, status = method(api, user)

        assert status == 201
        assert len(result["invitation_results"]) == 2
        mock_get_system_features.assert_not_called()
        system_features.license.seats.is_available.assert_not_called()
        assert mock_invite.call_count == 2

    def test_invite_mixed_accounts_with_available_seats(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        system_features = MagicMock()
        system_features.license.seats.is_available.return_value = True

        payload = {
            "emails": ["a@test.com", "b@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(2, 1)),
            patch(
                "controllers.console.workspace.members.FeatureService.get_system_features",
                return_value=system_features,
            ) as mock_get_system_features,
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member", return_value="token"
            ) as mock_invite,
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", True),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, status = method(api, user)

        assert status == 201
        assert len(result["invitation_results"]) == 2
        mock_get_system_features.assert_called_once_with(is_authenticated=True)
        system_features.license.seats.is_available.assert_called_once_with(1)
        assert mock_invite.call_count == 2

    def test_invite_skips_seats_limit_when_enterprise_disabled(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        system_features = MagicMock()
        system_features.license.seats.is_available.return_value = False

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(1, 1)),
            patch(
                "controllers.console.workspace.members.FeatureService.get_system_features",
                return_value=system_features,
            ) as mock_get_system_features,
            patch("controllers.console.workspace.members.RegisterService.invite_new_member", return_value="token"),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, status = method(api, user)

        assert status == 201
        assert result["invitation_results"][0]["status"] == "success"
        mock_get_system_features.assert_not_called()
        system_features.license.seats.is_available.assert_not_called()

    def test_invite_seats_error_is_reported_as_failed_result(self, app: Flask):
        api = MemberInviteEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(id="t1")
        user = MagicMock(current_tenant=tenant)
        features = MagicMock()
        features.billing.enabled = False
        features.workspace_members.enabled = False
        system_features = MagicMock()
        system_features.license.seats.is_available.return_value = True

        payload = {
            "emails": ["a@test.com"],
            "role": "normal",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.FeatureService.get_features", return_value=features),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=(1, 1)),
            patch(
                "controllers.console.workspace.members.FeatureService.get_system_features",
                return_value=system_features,
            ),
            patch(
                "controllers.console.workspace.members.RegisterService.invite_new_member",
                side_effect=SeatsLimitExceededError("licensed seats limit exceeded"),
            ),
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "http://x"),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", True),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
            result, status = method(api, user)

        assert status == 201
        assert result["invitation_results"][0]["status"] == "failed"
        assert result["invitation_results"][0]["message"] == "licensed seats limit exceeded"


class TestCountNewMemberInvites:
    def test_count_new_member_invites(self):
        new_account = None
        existing_account_not_in_tenant = SimpleNamespace(id="account-2")
        existing_account_in_tenant = SimpleNamespace(id="account-3")

        with (
            patch(
                "controllers.console.workspace.members.AccountService.get_account_by_email_with_case_fallback",
                side_effect=[new_account, existing_account_not_in_tenant, existing_account_in_tenant],
            ) as mock_get_account,
            patch("controllers.console.workspace.members.db.session") as mock_session,
        ):
            mock_session.scalar.side_effect = [None, "join-id"]
            result = _count_new_member_invites(
                "tenant-1",
                ["new@test.com", "existing@test.com", "member@test.com"],
            )

        assert result == (2, 1)
        assert mock_get_account.call_count == 3
        assert mock_session.scalar.call_count == 2


class TestMemberUpdateRoleApi:
    def test_update_invalid_role(self, app: Flask):
        api = MemberUpdateRoleApi()
        method = unwrap(api.put)

        payload = {"role": "invalid-role"}

        with app.test_request_context("/", json=payload):
            result, status = method(api, MagicMock(), "id")

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

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.members.TenantService.get_dataset_operator_members", return_value=members
            ),
        ):
            result, status = method(api, user)

        assert status == 200
        assert len(result["accounts"]) == 1

    def test_get_no_tenant(self, app: Flask):
        api = DatasetOperatorMemberListApi()
        method = unwrap(api.get)

        user = MagicMock(current_tenant=None)

        with (
            app.test_request_context("/"),
        ):
            with pytest.raises(ValueError):
                method(api, user)


class TestSendOwnerTransferEmailApi:
    def test_send_success(self, app: Flask):
        api = SendOwnerTransferEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock(name="ws")
        user = MagicMock(email="a@test.com", current_tenant=tenant)

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
            result = method(api, user)

        assert result["result"] == "success"

    def test_send_ip_limit(self, app: Flask):
        api = SendOwnerTransferEmailApi()
        method = unwrap(api.post)

        payload = {}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.extract_remote_ip", return_value="1.1.1.1"),
            patch("controllers.console.workspace.members.AccountService.is_email_send_ip_limit", return_value=True),
        ):
            with pytest.raises(EmailSendIpLimitError):
                method(api, MagicMock())

    def test_send_not_owner(self, app: Flask):
        api = SendOwnerTransferEmailApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(current_tenant=tenant)

        with (
            app.test_request_context("/", json={}),
            patch("controllers.console.workspace.members.extract_remote_ip", return_value="1.1.1.1"),
            patch("controllers.console.workspace.members.AccountService.is_email_send_ip_limit", return_value=False),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=False),
        ):
            with pytest.raises(NotOwnerError):
                method(api, user)


class TestOwnerTransferCheckApi:
    def test_check_invalid_code(self, app: Flask):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)

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
                method(api, user)

    def test_rate_limited(self, app: Flask):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)

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
                method(api, user)

    def test_invalid_token(self, app: Flask):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)

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
                method(api, user)

    def test_invalid_email(self, app: Flask):
        api = OwnerTransferCheckApi()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(email="a@test.com", current_tenant=tenant)

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
                method(api, user)


class TestOwnerTransferApi:
    def test_transfer_self(self, app: Flask):
        api = OwnerTransfer()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(id="1", email="a@test.com", current_tenant=tenant)

        payload = {"token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
        ):
            with pytest.raises(CannotTransferOwnerToSelfError):
                method(api, user, "1")

    def test_invalid_token(self, app: Flask):
        api = OwnerTransfer()
        method = unwrap(api.post)

        tenant = MagicMock()
        user = MagicMock(id="1", email="a@test.com", current_tenant=tenant)

        payload = {"token": "t"}

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.members.TenantService.is_owner", return_value=True),
            patch("controllers.console.workspace.members.AccountService.get_owner_transfer_data", return_value=None),
        ):
            with pytest.raises(InvalidTokenError):
                method(api, user, "2")

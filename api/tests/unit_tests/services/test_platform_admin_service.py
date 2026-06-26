from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from models.account import AccountStatus, TenantAccountRole
from services.errors.account import MemberNotInTenantError
from services.platform_admin_service import PlatformAdminService


def test_serialize_workspace_uses_supplied_owner_and_member_count():
    tenant = SimpleNamespace(
        id="tenant-1",
        name="Enterprise Workspace",
        plan="sandbox",
        status="normal",
        created_at=SimpleNamespace(timestamp=lambda: 1710000000),
    )
    owner = {"id": "account-1", "name": "Owner", "email": "owner@example.com"}

    result = PlatformAdminService.serialize_workspace(tenant, owner=owner, member_count=3)

    assert result == {
        "id": "tenant-1",
        "name": "Enterprise Workspace",
        "plan": "sandbox",
        "status": "normal",
        "created_at": 1710000000,
        "member_count": 3,
        "owner": owner,
    }


@patch("services.platform_admin_service.send_invite_member_mail_task")
@patch("services.platform_admin_service.RegisterService")
@patch("services.platform_admin_service.TenantService")
@patch("services.platform_admin_service.dify_config")
@patch(
    "services.platform_admin_service.PlatformAdminService._get_account_by_email_with_case_fallback",
    return_value=None,
)
def test_assign_workspace_owner_registers_pending_owner_and_returns_invite_url(
    mock_get_account,
    mock_dify_config,
    mock_tenant_service,
    mock_register_service,
    mock_mail_task,
):
    mock_dify_config.CONSOLE_WEB_URL = "http://localhost"
    tenant = SimpleNamespace(id="tenant-1", name="Managed Workspace")
    inviter = SimpleNamespace(name="Platform Admin")
    account = SimpleNamespace(
        email="owner@example.com",
        interface_language="en-US",
    )
    mock_register_service.register.return_value = account
    mock_register_service.generate_invite_token.return_value = "invite-token"

    result = PlatformAdminService.assign_workspace_owner(
        tenant=tenant,
        owner_email="Owner@Example.com",
        owner_name="Owner",
        inviter=inviter,
        language="en-US",
    )

    mock_get_account.assert_called_once_with("owner@example.com")
    mock_register_service.register.assert_called_once_with(
        email="owner@example.com",
        name="Owner",
        language="en-US",
        status=AccountStatus.PENDING,
        is_setup=True,
        create_workspace_required=False,
    )
    mock_tenant_service.create_tenant_member.assert_called_once_with(
        tenant,
        account,
        role=TenantAccountRole.OWNER,
    )
    mock_tenant_service.switch_tenant.assert_called_once_with(account, tenant.id)
    mock_mail_task.delay.assert_called_once_with(
        language="en-US",
        to="owner@example.com",
        token="invite-token",
        inviter_name="Platform Admin",
        workspace_name="Managed Workspace",
    )
    assert result == "http://localhost/activate?email=owner%40example.com&token=invite-token"


@patch("services.platform_admin_service.dify_config")
@patch("services.platform_admin_service.db")
def test_remove_member_deletes_pending_account_without_remaining_workspaces(mock_db, mock_dify_config):
    mock_dify_config.BILLING_ENABLED = False
    tenant = SimpleNamespace(id="tenant-1")
    account = SimpleNamespace(id="account-1", email="pending@example.com", status=AccountStatus.PENDING)
    tenant_join = SimpleNamespace(id="join-1")
    first_query = MagicMock()
    first_query.filter_by.return_value.first.return_value = tenant_join
    second_query = MagicMock()
    second_query.filter_by.return_value.count.return_value = 0
    mock_db.session.query.side_effect = [first_query, second_query]

    result = PlatformAdminService.remove_member(tenant=tenant, account=account)

    mock_db.session.delete.assert_any_call(tenant_join)
    mock_db.session.delete.assert_any_call(account)
    mock_db.session.commit.assert_called_once()
    assert result == {"deleted_pending_account_email": "pending@example.com"}


@patch("services.platform_admin_service.valid_password")
@patch("services.platform_admin_service.hash_password", return_value=b"hashed-password")
@patch("services.platform_admin_service.secrets.token_bytes", return_value=b"1234567890123456")
@patch("services.platform_admin_service.db")
def test_reset_member_password_updates_active_member_password(
    mock_db,
    mock_token_bytes,
    mock_hash_password,
    mock_valid_password,
):
    tenant = SimpleNamespace(id="tenant-1")
    member = SimpleNamespace(id="account-1", status=AccountStatus.ACTIVE, password=None, password_salt=None)
    tenant_join = SimpleNamespace(id="join-1")
    mock_query = MagicMock()
    mock_query.filter_by.return_value.first.return_value = tenant_join
    mock_db.session.query.return_value = mock_query

    PlatformAdminService.reset_member_password(
        tenant=tenant,
        member=member,
        new_password="Temp123456",
    )

    mock_query.filter_by.assert_called_once_with(tenant_id="tenant-1", account_id="account-1")
    mock_valid_password.assert_called_once_with("Temp123456")
    mock_token_bytes.assert_called_once_with(16)
    mock_hash_password.assert_called_once_with("Temp123456", b"1234567890123456")
    assert member.password == "aGFzaGVkLXBhc3N3b3Jk"
    assert member.password_salt == "MTIzNDU2Nzg5MDEyMzQ1Ng=="
    mock_db.session.add.assert_called_once_with(member)
    mock_db.session.commit.assert_called_once()


@patch("services.platform_admin_service.db")
def test_reset_member_password_rejects_non_workspace_member(mock_db):
    tenant = SimpleNamespace(id="tenant-1")
    member = SimpleNamespace(id="account-1", status=AccountStatus.ACTIVE)
    mock_query = MagicMock()
    mock_query.filter_by.return_value.first.return_value = None
    mock_db.session.query.return_value = mock_query

    with pytest.raises(MemberNotInTenantError):
        PlatformAdminService.reset_member_password(
            tenant=tenant,
            member=member,
            new_password="Temp123456",
        )

    mock_db.session.commit.assert_not_called()


@patch("services.platform_admin_service.db")
def test_reset_member_password_rejects_pending_member(mock_db):
    tenant = SimpleNamespace(id="tenant-1")
    member = SimpleNamespace(id="account-1", status=AccountStatus.PENDING)
    tenant_join = SimpleNamespace(id="join-1")
    mock_query = MagicMock()
    mock_query.filter_by.return_value.first.return_value = tenant_join
    mock_db.session.query.return_value = mock_query

    with pytest.raises(ValueError, match="Only active accounts"):
        PlatformAdminService.reset_member_password(
            tenant=tenant,
            member=member,
            new_password="Temp123456",
        )

    mock_db.session.commit.assert_not_called()
